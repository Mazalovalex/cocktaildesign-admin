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

type CategoryRow = { id: number };
type ProductRow = {
  id: number;
  name?: string | null;
  moyskladId?: string | null;
  price?: number | null;
  image?: unknown;
};

// ----------------------------------------------------------------------------
// collectDescendantCategoryIds
// Собираем id категории + всех потомков.
// Делаем BFS через один запрос всех категорий (id + parent.id),
// чтобы избежать N запросов и рекурсии в БД.
// ----------------------------------------------------------------------------
function collectDescendantCategoryIds(params: {
  rootId: number;
  all: Array<{ id: number; parent?: { id?: number | null } | null }>;
}): number[] {
  const { rootId, all } = params;

  // index: parentId -> childIds[]
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
   * Контракт:
   *   ?categorySlug=ms-xxxx&limit=50&offset=0
   * Ответ:
   *   { items, total, limit, offset, hasMore }
   *
   * ВАЖНО:
   * - Включаем товары категории + всех её потомков (вариант B).
   * - Фильтрация потомков делается на backend, не на frontend.
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
    const rootCategory: CategoryRow | null = await categoryQuery.findOne({
      where: { slug: categorySlug },
      select: ["id"],
    });

    if (!rootCategory) {
      // slug не найден — это не 404 endpoint, это "пустая выборка"
      ctx.body = { items: [], total: 0, limit, offset, hasMore: false };
      return;
    }

    // 2) Берём все категории (id + parent.id) и собираем потомков в памяти
    // Это один запрос и быстрый BFS.
    const allCategories = await categoryQuery.findMany({
      select: ["id"],
      populate: { parent: { select: ["id"] } },
      limit: 100000,
    });

    const categoryIds = collectDescendantCategoryIds({
      rootId: rootCategory.id,
      all: allCategories as any,
    });

    // 3) total — отдельным запросом (без limit/offset)
    const total = await productQuery.count({
      where: {
        category: { id: { $in: categoryIds } },
      },
    });

    // 4) items — порция товаров
    // Выбираем минимум полей, нужных для карточки. Image оставляем как есть (Strapi media),
    // фронт уже умеет маппить разные формы.
    const rows: ProductRow[] = await productQuery.findMany({
      where: {
        category: { id: { $in: categoryIds } },
      },
      select: ["id", "name", "moyskladId", "price", "image"],
      // Сортировка — пока стабильная и простая. Позже можно сделать "по популярности" и т.п.
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
