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
// parseIdsQuery
// ----------------------------------------------------------------------------
function parseIdsQuery(value: unknown, max = 100): number[] {
  if (typeof value !== "string") return [];

  const parts = value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const result: number[] = [];
  const seen = new Set<number>();

  for (const part of parts) {
    const n = Number(part);

    if (!Number.isFinite(n)) continue;
    if (seen.has(n)) continue;

    seen.add(n);
    result.push(n);

    if (result.length >= max) break;
  }

  return result;
}

// ----------------------------------------------------------------------------
// collectDescendantCategoryIds
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

// ----------------------------------------------------------------------------
// Breadcrumbs: собрать цепочку категорий от листа к корню (по parent)
// ----------------------------------------------------------------------------
type CategoryRowLite = {
  id: number;
  name?: string | null;
  slug?: string | null;
  parent?: { id?: number | null } | null;
};

type BreadcrumbCategory = {
  id: string;
  slug: string;
  name: string;
};

// Технический корень витрины (у тебя на фронте такой же id).
// Нужен только чтобы НЕ показывать его в хлебных крошках.
const CATALOG_ROOT_PARENT_ID = 14;

function buildCategoryChain(params: { startId: number; all: CategoryRowLite[] }): BreadcrumbCategory[] {
  const { startId, all } = params;

  const byId = new Map<number, CategoryRowLite>();
  for (const row of all) byId.set(row.id, row);

  const chain: BreadcrumbCategory[] = [];
  const visited = new Set<number>();

  let currentId: number | null = startId;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const node = byId.get(currentId);
    if (!node) break;

    if (node.id !== CATALOG_ROOT_PARENT_ID) {
      const slug = typeof node.slug === "string" ? node.slug.trim() : "";
      const name = typeof node.name === "string" ? node.name.trim() : "";

      if (slug && name) {
        chain.push({
          id: String(node.id),
          slug,
          name,
        });
      }
    }

    const parentId = node.parent?.id ?? null;
    currentId = parentId ? parentId : null;
  }

  chain.reverse();
  return chain;
}

type VariantRow = {
  id: number;
  name?: string | null;
  moyskladId?: string | null;
  price?: number | null;
  priceOld?: number | null;
  characteristics?: unknown;
};

type ProductSpecificationRow = {
  id?: number;
  label?: string | null;
  value?: string | null;
  href?: string | null;
};

type ProductRow = {
  id: number;
  name?: string | null;
  moyskladId?: string | null;
  slug?: string | null;

  price?: number | null;
  priceOld?: number | null;
  description?: string | null;

  image?: unknown;
  category?: { id?: number | null; name?: string | null } | null;

  specifications?: ProductSpecificationRow[] | null;
  variants?: VariantRow[] | null;
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

    const rootCategory: { id: number } | null = await categoryQuery.findOne({
      where: { slug: categorySlug },
      select: ["id"],
    });

    if (!rootCategory) {
      ctx.body = { items: [], total: 0, limit, offset, hasMore: false };
      return;
    }

    const allCategories = await categoryQuery.findMany({
      select: ["id"],
      populate: { parent: { select: ["id"] } },
      limit: 100000,
    });

    const categoryIds = collectDescendantCategoryIds({
      rootId: rootCategory.id,
      all: allCategories as any,
    });

    const total = await productQuery.count({
      where: {
        category: { id: { $in: categoryIds } },
      },
    });

    const rows: ProductRow[] = await productQuery.findMany({
      where: {
        category: { id: { $in: categoryIds } },
      },
      select: ["id", "name", "moyskladId", "slug", "price", "priceOld"],
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
          slug: p.slug ?? null,
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

  /**
   * GET /api/catalog/products-by-ids
   */
  async productsByIds(ctx) {
    const ids = parseIdsQuery(ctx.query.ids);

    if (ids.length === 0) {
      ctx.body = { items: [] };
      return;
    }

    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    const rows: ProductRow[] = await productQuery.findMany({
      where: {
        id: { $in: ids },
      },
      select: ["id", "name", "moyskladId", "slug", "price", "priceOld"],
      populate: {
        image: {
          select: ["url", "alternativeText", "formats"],
        },
      },
      limit: 100,
    });

    const order = new Map<number, number>();
    ids.forEach((id, index) => order.set(id, index));

    rows.sort((a, b) => {
      return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    });

    ctx.body = {
      items: rows.map((p) => ({
        id: p.id,
        attributes: {
          name: p.name ?? null,
          moyskladId: p.moyskladId ?? null,
          slug: p.slug ?? null,
          price: p.price ?? null,
          priceOld: p.priceOld ?? null,
          image: (p as any).image ?? null,
        },
      })),
    };
  },

  /**
   * GET /api/catalog/product?slug=ms-xxxxxxx
   */
  async productBySlug(ctx) {
    const slug = String(ctx.query.slug ?? "").trim();

    if (!slug) {
      ctx.status = 400;
      ctx.body = { error: "slug_required" };
      return;
    }

    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");
    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    const product: ProductRow | null = await productQuery.findOne({
      where: { slug },
      select: ["id", "name", "moyskladId", "slug", "price", "priceOld", "description"],
      populate: {
        image: { select: ["url", "alternativeText", "formats"] },
        category: { select: ["id"] },
        specifications: true,
        variants: {
          select: ["id", "name", "moyskladId", "price", "priceOld", "characteristics"],
          orderBy: { id: "asc" },
        },
      },
    });

    strapi.log.info(`productBySlug raw product: ${JSON.stringify(product, null, 2)}`);

    if (!product) {
      ctx.status = 404;
      ctx.body = { error: "not_found" };
      return;
    }

    const categoryId = product.category?.id ?? null;

    let breadcrumbsCategories: BreadcrumbCategory[] = [];

    if (categoryId) {
      const allCategories: CategoryRowLite[] = await categoryQuery.findMany({
        select: ["id", "name", "slug"],
        populate: { parent: { select: ["id"] } },
        limit: 100000,
      });

      breadcrumbsCategories = buildCategoryChain({
        startId: categoryId,
        all: allCategories,
      });
    }

    const variants = (product.variants ?? []).map((v) => ({
      id: v.id,
      attributes: {
        name: v.name ?? null,
        moyskladId: v.moyskladId ?? null,
        price: v.price ?? null,
        priceOld: v.priceOld ?? null,
        characteristics: (v as any).characteristics ?? null,
      },
    }));

    const specifications = (product.specifications ?? []).map((spec) => ({
      id: spec.id ?? null,
      label: spec.label ?? null,
      value: spec.value ?? null,
      href: spec.href ?? null,
    }));

    ctx.body = {
      item: {
        id: product.id,
        attributes: {
          name: product.name ?? null,
          moyskladId: product.moyskladId ?? null,
          slug: product.slug ?? null,
          price: product.price ?? null,
          priceOld: product.priceOld ?? null,
          description: product.description ?? null,
          image: Array.isArray((product as any).image) ? (product as any).image : [],
          specifications,
        },
      },
      variants,
      breadcrumbsCategories,
    };
  },

  /**
   * GET /api/catalog/search?q=шейкер
   */
  async search(ctx) {
    const q = String(ctx.query.q ?? "").trim();

    if (q.length < 2) {
      ctx.body = { items: [] };
      return;
    }

    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    const rows: ProductRow[] = await productQuery.findMany({
      where: {
        name: { $containsi: q },
        category: { id: { $notIn: [14] } },
      },
      select: ["id", "name", "moyskladId", "slug", "price", "priceOld"],
      populate: {
        image: {
          select: ["url", "alternativeText", "formats"],
        },
        category: {
          select: ["name"],
        },
      },
      orderBy: { id: "desc" },
      limit: 10,
    });

    ctx.body = {
      items: rows.map((p) => ({
        id: p.id,
        attributes: {
          name: p.name ?? null,
          moyskladId: p.moyskladId ?? null,
          slug: p.slug ?? null,
          price: p.price ?? null,
          priceOld: p.priceOld ?? null,
          image: (p as any).image ?? null,
          categoryName: (p as any).category?.name ?? null,
        },
      })),
    };
  },

  /**
   * GET /api/catalog/random-products?count=2
   */
  async randomProducts(ctx) {
    const count = Math.min(Math.max(Number(ctx.query.count ?? 2), 1), 6);

    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    const total = await productQuery.count({
      where: {
        category: { id: { $notIn: [14] } },
      },
    });

    if (total === 0) {
      ctx.body = { items: [] };
      return;
    }

    const maxOffset = Math.max(0, total - count);
    const randomOffset = Math.floor(Math.random() * (maxOffset + 1));

    const rows: ProductRow[] = await productQuery.findMany({
      where: {
        category: { id: { $notIn: [14] } },
      },
      select: ["id", "name", "moyskladId", "slug", "price", "priceOld"],
      populate: {
        image: { select: ["url", "alternativeText", "formats"] },
        category: { select: ["name"] },
      },
      orderBy: { id: "asc" },
      limit: count,
      offset: randomOffset,
    });

    ctx.body = {
      items: rows.map((p) => ({
        id: p.id,
        attributes: {
          name: p.name ?? null,
          slug: p.slug ?? null,
          price: p.price ?? null,
          priceOld: p.priceOld ?? null,
          image: (p as any).image ?? null,
          categoryName: (p as any).category?.name ?? null,
        },
      })),
    };
  },
}));
