// backend/src/api/moysklad-category/controllers/moysklad-category.ts
import { factories } from "@strapi/strapi";
import syncServiceFactory from "../services/sync";

function isSyncLockError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.startsWith('Sync lock is already acquired by "');
}

function toSafeCount(value: unknown): number {
  if (typeof value !== "number") return 0;
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return value;
}

function toSafeLimit(value: unknown, fallback = 50): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

function toSafeOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

// ----------------------------------------------------------------------------
// collectDescendantCategoryIds
// Собираем id категории + всех потомков через BFS.
// Делается в памяти по "карте parentId -> childrenIds", чтобы избежать N+1 запросов.
// ----------------------------------------------------------------------------
function collectDescendantCategoryIds(params: {
  rootId: number;
  all: Array<{ id: number; parent?: { id?: number | null } | null }>;
}): number[] {
  const { rootId, all } = params;

  const childrenByParentId = new Map<number, number[]>();

  for (const row of all) {
    const parentId = row.parent?.id ?? null;
    if (!parentId) continue;

    const list = childrenByParentId.get(parentId) ?? [];
    list.push(row.id);
    childrenByParentId.set(parentId, list);
  }

  const result: number[] = [];
  const queue: number[] = [rootId];
  const visited = new Set<number>();

  while (queue.length > 0) {
    const current = queue.shift() as number;

    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);

    const children = childrenByParentId.get(current) ?? [];
    for (const childId of children) queue.push(childId);
  }

  return result;
}

type ProductRow = {
  id: number;
  name?: string | null;
  moyskladId?: string | null;
  price?: number | null;
  priceOld?: number | null;

  // media multiple: приходит через populate (не колонка таблицы!)
  image?: unknown;
};

export default factories.createCoreController("api::moysklad-category.moysklad-category", ({ strapi }) => ({
  /**
   * POST /api/moysklad/sync/categories
   */
  async syncAll(ctx) {
    const secret = ctx.request.headers["x-webhook-secret"];

    if (secret !== process.env.MOYSKLAD_WEBHOOK_SECRET) {
      ctx.status = 401;
      ctx.body = { ok: false };
      return;
    }

    try {
      const syncService = syncServiceFactory();
      const result = await syncService.syncAll();
      ctx.body = result;
    } catch (err) {
      if (isSyncLockError(err)) {
        ctx.status = 409;
        ctx.body = { ok: false, error: "sync_already_running" };
        return;
      }

      ctx.status = 500;
      ctx.body = { ok: false, error: "sync_failed" };
      strapi.log.error(err);
    }
  },

  /**
   * GET /api/catalog/categories-flat
   */
  async categoriesFlat(ctx) {
    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    const rows = await categoryQuery.findMany({
      select: ["id", "name", "slug", "productsCount"],
      populate: {
        parent: { select: ["id"] },
      },
      limit: 100000,
    });

    ctx.body = rows.map((c: any) => ({
      id: String(c.id),
      slug: typeof c.slug === "string" ? c.slug : "",
      name: typeof c.name === "string" ? c.name : "",
      productsCount: toSafeCount(c.productsCount),
      parentId: c.parent?.id ? String(c.parent.id) : null,
    }));
  },

  /**
   * GET /api/catalog/products
   *
   * Query:
   *   ?categorySlug=ms-xxxx&limit=50&offset=0
   *
   * Ответ:
   *   { items, total, limit, offset, hasMore }
   *
   * items — массив Strapi-like объектов: { id, attributes: {...} }
   * Это сделано специально, чтобы фронтовый mapProductPreview мог работать без переделок.
   */
  async products(ctx) {
    const categorySlug = String(ctx.query.categorySlug ?? "").trim();
    const limit = toSafeLimit(ctx.query.limit, 50);
    const offset = toSafeOffset(ctx.query.offset);

    if (!categorySlug) {
      ctx.body = { items: [], total: 0, limit, offset, hasMore: false };
      return;
    }

    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");
    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    // 1) Находим категорию по slug
    const rootCategory: { id: number } | null = await categoryQuery.findOne({
      where: { slug: categorySlug },
      select: ["id"],
    });

    if (!rootCategory) {
      ctx.body = { items: [], total: 0, limit, offset, hasMore: false };
      return;
    }

    // 2) Берём все категории (id + parent.id), строим список потомков (вариант B)
    const allCategories = await categoryQuery.findMany({
      select: ["id"],
      populate: { parent: { select: ["id"] } },
      limit: 100000,
    });

    const categoryIds = collectDescendantCategoryIds({
      rootId: rootCategory.id,
      all: allCategories as any,
    });

    // 3) total — отдельным запросом
    const total = await productQuery.count({
      where: {
        category: { id: { $in: categoryIds } },
      },
    });

    // 4) items — порция товаров
    // ВАЖНО: image — это media relation. Её нельзя включать в select.
    // Нужен populate.
    const rows: ProductRow[] = await productQuery.findMany({
      where: {
        category: { id: { $in: categoryIds } },
      },

      // только реальные колонки таблицы
      select: ["id", "name", "moyskladId", "price", "priceOld"],

      // медиа тянем через populate
      populate: {
        image: {
          select: ["url", "alternativeText", "formats"],
        },
      },

      orderBy: { id: "desc" },
      limit,
      offset,
    });

    const hasMore = offset + rows.length < total;

    ctx.body = {
      items: rows.map((p) => ({
        id: p.id,
        attributes: {
          name: p.name ?? null,
          moyskladId: p.moyskladId ?? null,
          price: p.price ?? null,
          priceOld: p.priceOld ?? null,
          image: (p as any).image ?? null,
        },
      })),
      total,
      limit,
      offset,
      hasMore,
    };
  },
}));
