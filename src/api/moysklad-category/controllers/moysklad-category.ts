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

function toSafeBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

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

type CategoryRowLite = {
  id: number;
  name?: string | null;
  slug?: string | null;
  productsCount?: number | null;
  parent?: { id?: number | null } | null;
};

type BreadcrumbCategory = {
  id: string;
  slug: string;
  name: string;
};

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
        chain.push({ id: String(node.id), slug, name });
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
  code?: string | null;
  characteristics?: unknown;
  image?: unknown;
};

type ProductSpecificationRow = {
  id?: number;
  label?: string | null;
  value?: string | null;
  href?: string | null;
};

type BundleComponentProductRow = {
  id: number;
  name?: string | null;
  slug?: string | null;
  price?: number | null;
  priceOld?: number | null;
  variants?: VariantRow[] | null;
};

type BundleItemRow = {
  id: number;
  quantity?: number | null;
  componentProduct?: BundleComponentProductRow | null;
};

type ProductRow = {
  id: number;
  name?: string | null;
  moyskladId?: string | null;
  slug?: string | null;
  price?: number | null;
  priceOld?: number | null;
  description?: string | null;
  code?: string | null;
  engravingEnabled?: boolean | null;
  discountExcluded?: boolean | null;
  image?: unknown;
  category?: { id?: number | null; name?: string | null; slug?: string | null } | null;
  specifications?: ProductSpecificationRow[] | null;
  variants?: VariantRow[] | null;
  bundleItems?: BundleItemRow[] | null;
};

type DiscountDebugItem = {
  id: number;
  name: string | null;
  slug: string | null;
  price: number | null;
  priceOld: number | null;
  discountExcluded: boolean;
  hasOwnDiscount: boolean;
  hasVariantDiscount: boolean;
  hasBundleDiscount: boolean;
  category: {
    id: number | null;
    name: string | null;
    slug: string | null;
  } | null;
  variants: Array<{
    id: number;
    name: string | null;
    price: number | null;
    priceOld: number | null;
    hasDiscount: boolean;
  }>;
  bundleItems: Array<{
    id: number;
    componentProduct: {
      id: number;
      name: string | null;
      slug: string | null;
      price: number | null;
      priceOld: number | null;
      hasOwnDiscount: boolean;
      variants: Array<{
        id: number;
        name: string | null;
        price: number | null;
        priceOld: number | null;
        hasDiscount: boolean;
      }>;
    } | null;
  }>;
};

function hasRealDiscount(price?: number | null, priceOld?: number | null): boolean {
  if (typeof price !== "number") return false;
  if (typeof priceOld !== "number") return false;
  if (!Number.isFinite(price) || !Number.isFinite(priceOld)) return false;

  return price > 0 && priceOld > price;
}

function variantsHaveDiscount(variants?: VariantRow[] | null): boolean {
  return (variants ?? []).some((variant) => hasRealDiscount(variant.price, variant.priceOld));
}

function bundleItemsHaveDiscount(bundleItems?: BundleItemRow[] | null): boolean {
  return (bundleItems ?? []).some((item) => {
    const componentProduct = item.componentProduct;
    if (!componentProduct) return false;

    if (hasRealDiscount(componentProduct.price, componentProduct.priceOld)) {
      return true;
    }

    return variantsHaveDiscount(componentProduct.variants);
  });
}

function productHasAnyDiscount(product: ProductRow, respectDiscountExcluded = false): boolean {
  if (respectDiscountExcluded && product.discountExcluded === true) {
    return false;
  }

  if (hasRealDiscount(product.price, product.priceOld)) {
    return true;
  }

  if (variantsHaveDiscount(product.variants)) {
    return true;
  }

  if (bundleItemsHaveDiscount(product.bundleItems)) {
    return true;
  }

  return false;
}

function buildDiscountDebugItem(product: ProductRow): DiscountDebugItem {
  return {
    id: product.id,
    name: product.name ?? null,
    slug: product.slug ?? null,
    price: typeof product.price === "number" ? product.price : null,
    priceOld: typeof product.priceOld === "number" ? product.priceOld : null,
    discountExcluded: product.discountExcluded === true,
    hasOwnDiscount: hasRealDiscount(product.price, product.priceOld),
    hasVariantDiscount: variantsHaveDiscount(product.variants),
    hasBundleDiscount: bundleItemsHaveDiscount(product.bundleItems),
    category: product.category
      ? {
          id: product.category.id ?? null,
          name: product.category.name ?? null,
          slug: product.category.slug ?? null,
        }
      : null,
    variants: (product.variants ?? []).map((variant) => ({
      id: variant.id,
      name: variant.name ?? null,
      price: typeof variant.price === "number" ? variant.price : null,
      priceOld: typeof variant.priceOld === "number" ? variant.priceOld : null,
      hasDiscount: hasRealDiscount(variant.price, variant.priceOld),
    })),
    bundleItems: (product.bundleItems ?? []).map((item) => {
      const componentProduct = item.componentProduct ?? null;

      return {
        id: item.id,
        componentProduct: componentProduct
          ? {
              id: componentProduct.id,
              name: componentProduct.name ?? null,
              slug: componentProduct.slug ?? null,
              price: typeof componentProduct.price === "number" ? componentProduct.price : null,
              priceOld: typeof componentProduct.priceOld === "number" ? componentProduct.priceOld : null,
              hasOwnDiscount: hasRealDiscount(componentProduct.price, componentProduct.priceOld),
              variants: (componentProduct.variants ?? []).map((variant) => ({
                id: variant.id,
                name: variant.name ?? null,
                price: typeof variant.price === "number" ? variant.price : null,
                priceOld: typeof variant.priceOld === "number" ? variant.priceOld : null,
                hasDiscount: hasRealDiscount(variant.price, variant.priceOld),
              })),
            }
          : null,
      };
    }),
  };
}

function mapPreviewVariants(rawVariants: VariantRow[] | null | undefined) {
  return (rawVariants ?? []).map((variant) => ({
    id: variant.id,
    attributes: {
      name: variant.name ?? null,
      moyskladId: variant.moyskladId ?? null,
      price: variant.price ?? null,
      priceOld: variant.priceOld ?? null,
      code: variant.code ?? null,
      characteristics: variant.characteristics ?? null,
      image: (variant as any).image ?? null,
    },
  }));
}

async function getCollectionProducts(
  strapi: any,
  collectionSlug: string,
  options?: {
    debug?: boolean;
    respectDiscountExcluded?: boolean;
  },
): Promise<{
  items: ProductRow[];
  debug?: {
    selectionMode: string;
    sourceRowsCount: number;
    discountedRowsCount: number;
    respectDiscountExcluded: boolean;
    discountedItems: DiscountDebugItem[];
  };
}> {
  const debug = options?.debug ?? false;
  const respectDiscountExcluded = options?.respectDiscountExcluded ?? false;

  const collectionQuery = strapi.db.query("api::catalog-collection.catalog-collection");
  const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");
  const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

  const collection = await collectionQuery.findOne({
    where: { slug: collectionSlug },
    select: ["id", "slug", "selectionMode"],
    populate: {
      products: { select: ["id"] },
      sourceCategory: { select: ["id", "slug"] },
    },
  });

  if (!collection) {
    return { items: [] };
  }

  const selectionMode = collection.selectionMode ?? "manual";

  if (selectionMode === "manual") {
    const productIds = (collection.products ?? []).map((p: any) => p.id);

    if (productIds.length === 0) {
      return {
        items: [],
        ...(debug
          ? {
              debug: {
                selectionMode,
                sourceRowsCount: 0,
                discountedRowsCount: 0,
                respectDiscountExcluded,
                discountedItems: [],
              },
            }
          : {}),
      };
    }

    const rows: ProductRow[] = await productQuery.findMany({
      where: { id: { $in: productIds } },
      select: ["id", "name", "moyskladId", "slug", "price", "priceOld", "engravingEnabled", "code", "discountExcluded"],
      populate: {
        image: { select: ["url", "alternativeText", "formats"] },
        category: { select: ["id", "name", "slug"] },
        variants: {
          select: ["id", "name", "moyskladId", "price", "priceOld", "code", "characteristics"],
          populate: {
            image: { select: ["url", "alternativeText", "formats"] },
          },
          orderBy: { id: "asc" },
        },
        bundleItems: {
          populate: {
            componentProduct: {
              select: ["id", "name", "slug", "price", "priceOld"],
              populate: {
                variants: {
                  select: ["id", "name", "moyskladId", "price", "priceOld", "code", "characteristics"],
                  orderBy: { id: "asc" },
                },
              },
            },
          },
        },
      },
      limit: 100000,
    });

    return {
      items: rows,
      ...(debug
        ? {
            debug: {
              selectionMode,
              sourceRowsCount: rows.length,
              discountedRowsCount: rows.length,
              respectDiscountExcluded,
              discountedItems: rows.map(buildDiscountDebugItem),
            },
          }
        : {}),
    };
  }

  if (selectionMode === "category") {
    const sourceCategorySlug = collection.sourceCategory?.slug ?? null;
    if (!sourceCategorySlug) {
      return {
        items: [],
        ...(debug
          ? {
              debug: {
                selectionMode,
                sourceRowsCount: 0,
                discountedRowsCount: 0,
                respectDiscountExcluded,
                discountedItems: [],
              },
            }
          : {}),
      };
    }

    const rootCategory = await categoryQuery.findOne({
      where: { slug: sourceCategorySlug },
      select: ["id"],
    });

    if (!rootCategory) {
      return {
        items: [],
        ...(debug
          ? {
              debug: {
                selectionMode,
                sourceRowsCount: 0,
                discountedRowsCount: 0,
                respectDiscountExcluded,
                discountedItems: [],
              },
            }
          : {}),
      };
    }

    const allCategories = await categoryQuery.findMany({
      select: ["id"],
      populate: { parent: { select: ["id"] } },
      limit: 100000,
    });

    const categoryIds = collectDescendantCategoryIds({
      rootId: rootCategory.id,
      all: allCategories,
    });

    const rows: ProductRow[] = await productQuery.findMany({
      where: { category: { id: { $in: categoryIds } } },
      select: ["id", "name", "moyskladId", "slug", "price", "priceOld", "engravingEnabled", "code", "discountExcluded"],
      populate: {
        image: { select: ["url", "alternativeText", "formats"] },
        category: { select: ["id", "name", "slug"] },
        variants: {
          select: ["id", "name", "moyskladId", "price", "priceOld", "code", "characteristics"],
          populate: {
            image: { select: ["url", "alternativeText", "formats"] },
          },
          orderBy: { id: "asc" },
        },
        bundleItems: {
          populate: {
            componentProduct: {
              select: ["id", "name", "slug", "price", "priceOld"],
              populate: {
                variants: {
                  select: ["id", "name", "moyskladId", "price", "priceOld", "code", "characteristics"],
                  orderBy: { id: "asc" },
                },
              },
            },
          },
        },
      },
      limit: 100000,
    });

    return {
      items: rows,
      ...(debug
        ? {
            debug: {
              selectionMode,
              sourceRowsCount: rows.length,
              discountedRowsCount: rows.length,
              respectDiscountExcluded,
              discountedItems: rows.map(buildDiscountDebugItem),
            },
          }
        : {}),
    };
  }

  if (selectionMode === "discount") {
    const rows: ProductRow[] = await productQuery.findMany({
      select: ["id", "name", "moyskladId", "slug", "price", "priceOld", "engravingEnabled", "code", "discountExcluded"],
      populate: {
        image: { select: ["url", "alternativeText", "formats"] },
        category: { select: ["id", "name", "slug"] },
        variants: {
          select: ["id", "name", "moyskladId", "price", "priceOld", "code", "characteristics"],
          populate: {
            image: { select: ["url", "alternativeText", "formats"] },
          },
          orderBy: { id: "asc" },
        },
        bundleItems: {
          populate: {
            componentProduct: {
              select: ["id", "name", "slug", "price", "priceOld"],
              populate: {
                variants: {
                  select: ["id", "name", "moyskladId", "price", "priceOld", "code", "characteristics"],
                  orderBy: { id: "asc" },
                },
              },
            },
          },
        },
      },
      limit: 100000,
    });

    const discountedRows = rows.filter((product) => productHasAnyDiscount(product, respectDiscountExcluded));

    return {
      items: discountedRows,
      ...(debug
        ? {
            debug: {
              selectionMode,
              sourceRowsCount: rows.length,
              discountedRowsCount: discountedRows.length,
              respectDiscountExcluded,
              discountedItems: discountedRows.map(buildDiscountDebugItem),
            },
          }
        : {}),
    };
  }

  return {
    items: [],
    ...(debug
      ? {
          debug: {
            selectionMode,
            sourceRowsCount: 0,
            discountedRowsCount: 0,
            respectDiscountExcluded,
            discountedItems: [],
          },
        }
      : {}),
  };
}

export default factories.createCoreController("api::moysklad-category.moysklad-category", ({ strapi }) => ({
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

  async categoriesFlat(ctx) {
    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    const rows = await categoryQuery.findMany({
      select: ["id", "name", "slug", "productsCount"],
      populate: { parent: { select: ["id"] } },
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
      where: { category: { id: { $in: categoryIds } } },
    });

    const rows: ProductRow[] = await productQuery.findMany({
      where: { category: { id: { $in: categoryIds } } },
      select: ["id", "name", "moyskladId", "slug", "price", "priceOld", "engravingEnabled", "code", "discountExcluded"],
      populate: {
        image: { select: ["url", "alternativeText", "formats"] },
        variants: {
          select: ["id", "name", "moyskladId", "price", "priceOld", "code", "characteristics"],
          populate: {
            image: { select: ["url", "alternativeText", "formats"] },
          },
          orderBy: { id: "asc" },
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
          engravingEnabled: p.engravingEnabled ?? false,
          discountExcluded: p.discountExcluded ?? false,
          code: p.code ?? null,
          image: (p as any).image ?? null,
          variants: mapPreviewVariants((p as any).variants),
        },
      })),
      total,
      limit,
      offset,
      hasMore,
    };
  },

  async productsDiscounted(ctx) {
    const limit = toSafeLimit(ctx.query.limit, 50);
    const offset = toSafeOffset(ctx.query.offset);
    const debug = toSafeBooleanFlag(ctx.query.debug);
    const respectDiscountExcluded = toSafeBooleanFlag(ctx.query.respectDiscountExcluded);

    const result = await getCollectionProducts(strapi, "sale", {
      debug,
      respectDiscountExcluded,
    });

    const total = result.items.length;
    const paginatedRows = result.items.slice(offset, offset + limit);
    const hasMore = offset + paginatedRows.length < total;

    ctx.body = {
      items: paginatedRows.map((p) => ({
        id: p.id,
        attributes: {
          name: p.name ?? null,
          moyskladId: p.moyskladId ?? null,
          slug: p.slug ?? null,
          price: p.price ?? null,
          priceOld: p.priceOld ?? null,
          engravingEnabled: p.engravingEnabled ?? false,
          discountExcluded: p.discountExcluded ?? false,
          code: p.code ?? null,
          image: (p as any).image ?? null,
          variants: mapPreviewVariants((p as any).variants),
        },
      })),
      total,
      limit,
      offset,
      hasMore,
      ...(debug ? { debug: result.debug ?? null } : {}),
    };
  },

  async productsByIds(ctx) {
    const ids = parseIdsQuery(ctx.query.ids);

    if (ids.length === 0) {
      ctx.body = { items: [] };
      return;
    }

    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    const rows: ProductRow[] = await productQuery.findMany({
      where: { id: { $in: ids } },
      select: ["id", "name", "moyskladId", "slug", "price", "priceOld", "engravingEnabled", "code", "discountExcluded"],
      populate: {
        image: { select: ["url", "alternativeText", "formats"] },
        variants: {
          select: ["id", "name", "moyskladId", "price", "priceOld", "code", "characteristics"],
          populate: {
            image: { select: ["url", "alternativeText", "formats"] },
          },
          orderBy: { id: "asc" },
        },
      },
      limit: 100,
    });

    const order = new Map<number, number>();
    ids.forEach((id, index) => order.set(id, index));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    ctx.body = {
      items: rows.map((p) => ({
        id: p.id,
        attributes: {
          name: p.name ?? null,
          moyskladId: p.moyskladId ?? null,
          slug: p.slug ?? null,
          price: p.price ?? null,
          priceOld: p.priceOld ?? null,
          engravingEnabled: p.engravingEnabled ?? false,
          discountExcluded: p.discountExcluded ?? false,
          code: p.code ?? null,
          image: (p as any).image ?? null,
          variants: mapPreviewVariants((p as any).variants),
        },
      })),
    };
  },

  async productBySlug(ctx) {
    console.log("PRODUCT BY SLUG CONTROLLER HIT");
    console.log("PRODUCT BY SLUG QUERY:", ctx.query);

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
      select: [
        "id",
        "name",
        "moyskladId",
        "slug",
        "price",
        "priceOld",
        "description",
        "engravingEnabled",
        "code",
        "discountExcluded",
      ],
      populate: {
        image: { select: ["url", "alternativeText", "formats"] },
        category: { select: ["id"] },
        specifications: {
          populate: {
            specification: {
              select: ["id", "name"],
            },
            kategorii: {
              select: ["id", "slug", "name"],
            },
          },
        },
        variants: {
          select: ["id", "name", "moyskladId", "price", "priceOld", "characteristics", "code"],
          populate: {
            image: { select: ["url", "alternativeText", "formats"] },
          },
          orderBy: { id: "asc" },
        },
        bundleItems: {
          populate: {
            componentProduct: {
              select: ["id", "name", "slug", "price"],
              populate: { image: { select: ["url", "alternativeText", "formats"] } },
            },
          },
        },
      },
    });

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

      breadcrumbsCategories = buildCategoryChain({ startId: categoryId, all: allCategories });
    }

    const variants = (product.variants ?? []).map((v) => ({
      id: v.id,
      attributes: {
        name: v.name ?? null,
        moyskladId: v.moyskladId ?? null,
        price: v.price ?? null,
        priceOld: v.priceOld ?? null,
        code: v.code ?? null,
        characteristics: (v as any).characteristics ?? null,
        image: v.image ?? null,
      },
    }));

    const specifications = (product.specifications ?? []).map((spec: any) => {
      const value = typeof spec.value === "string" ? spec.value.trim() : null;
      const label = typeof spec.label === "string" ? spec.label.trim() : null;

      const specification = spec.specification
        ? {
            id: spec.specification.id ?? null,
            name: typeof spec.specification.name === "string" ? spec.specification.name.trim() : null,
          }
        : null;

      let href: string | null = null;

      if (spec.kategorii && typeof spec.kategorii.slug === "string" && spec.kategorii.slug.trim()) {
        href = `/catalog/${spec.kategorii.slug.trim()}`;
      }

      if (!href && typeof spec.href === "string" && spec.href.trim()) {
        href = spec.href.trim();
      }

      return {
        id: spec.id ?? null,
        label,
        value,
        href,
        specification,
      };
    });

    const bundleItems = ((product as any).bundleItems ?? []).map((item: any) => {
      const cp = item.componentProduct ?? null;
      const firstImage = Array.isArray(cp?.image) ? cp.image[0] : null;
      const imagePath =
        firstImage?.formats?.large?.url ??
        firstImage?.formats?.medium?.url ??
        firstImage?.formats?.small?.url ??
        firstImage?.formats?.thumbnail?.url ??
        firstImage?.url ??
        null;

      return {
        id: item.id,
        quantity: item.quantity ?? 1,
        componentProduct: cp
          ? {
              id: cp.id,
              name: cp.name ?? null,
              slug: cp.slug ?? null,
              price: cp.price ?? null,
              imageUrl: imagePath ?? null,
            }
          : null,
      };
    });

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
          engravingEnabled: product.engravingEnabled ?? false,
          discountExcluded: product.discountExcluded ?? false,
          code: product.code ?? null,
        },
      },
      variants,
      breadcrumbsCategories,
      bundleItems,
    };
  },

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
        image: { select: ["url", "alternativeText", "formats"] },
        category: { select: ["name"] },
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

  async randomProducts(ctx) {
    const count = Math.min(Math.max(Number(ctx.query.count ?? 2), 1), 6);

    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    const total = await productQuery.count({
      where: { category: { id: { $notIn: [14] } } },
    });

    if (total === 0) {
      ctx.body = { items: [] };
      return;
    }

    const maxOffset = Math.max(0, total - count);
    const randomOffset = Math.floor(Math.random() * (maxOffset + 1));

    const rows: ProductRow[] = await productQuery.findMany({
      where: { category: { id: { $notIn: [14] } } },
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

  async collectionProducts(ctx) {
    const collectionSlug = String(ctx.params.slug ?? "").trim();
    const limit = toSafeLimit(ctx.query.limit, 50);
    const offset = toSafeOffset(ctx.query.offset);
    const debug = toSafeBooleanFlag(ctx.query.debug);
    const respectDiscountExcluded = toSafeBooleanFlag(ctx.query.respectDiscountExcluded);

    if (!collectionSlug) {
      ctx.status = 400;
      ctx.body = { error: "slug_required" };
      return;
    }

    const collectionQuery = strapi.db.query("api::catalog-collection.catalog-collection");
    const collection = await collectionQuery.findOne({
      where: { slug: collectionSlug },
      select: ["id", "title", "slug", "description", "selectionMode"],
    });

    if (!collection) {
      ctx.status = 404;
      ctx.body = { error: "collection_not_found" };
      return;
    }

    const result = await getCollectionProducts(strapi, collectionSlug, {
      debug,
      respectDiscountExcluded,
    });

    let allRows = result.items;

    const filterCategorySlug = String(ctx.query.categorySlug ?? "").trim();

    if (filterCategorySlug) {
      const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

      const rootCategory = await categoryQuery.findOne({
        where: { slug: filterCategorySlug },
        select: ["id"],
      });

      if (rootCategory) {
        const allCategories = await categoryQuery.findMany({
          select: ["id"],
          populate: { parent: { select: ["id"] } },
          limit: 100000,
        });

        const allowedCategoryIds = new Set(
          collectDescendantCategoryIds({ rootId: rootCategory.id, all: allCategories }),
        );

        allRows = allRows.filter((p) => {
          const catId = (p as any).category?.id ?? null;
          return catId && allowedCategoryIds.has(catId);
        });
      }
    }

    const total = allRows.length;
    const paginatedRows = allRows.slice(offset, offset + limit);
    const hasMore = offset + paginatedRows.length < total;

    ctx.body = {
      collection: {
        id: String(collection.id),
        title: collection.title ?? "",
        slug: collection.slug ?? "",
        description: collection.description ?? null,
      },
      items: paginatedRows.map((p) => ({
        id: p.id,
        attributes: {
          name: p.name ?? null,
          moyskladId: p.moyskladId ?? null,
          slug: p.slug ?? null,
          price: p.price ?? null,
          priceOld: p.priceOld ?? null,
          engravingEnabled: p.engravingEnabled ?? false,
          discountExcluded: p.discountExcluded ?? false,
          code: p.code ?? null,
          image: (p as any).image ?? null,
          variants: mapPreviewVariants((p as any).variants),
        },
      })),
      total,
      limit,
      offset,
      hasMore,
      ...(debug ? { debug: result.debug ?? null } : {}),
    };
  },

  async collectionCategoriesTree(ctx) {
    const collectionSlug = String(ctx.params.slug ?? "").trim();
    const debug = toSafeBooleanFlag(ctx.query.debug);
    const respectDiscountExcluded = toSafeBooleanFlag(ctx.query.respectDiscountExcluded);

    if (!collectionSlug) {
      ctx.status = 400;
      ctx.body = { error: "slug_required" };
      return;
    }

    const result = await getCollectionProducts(strapi, collectionSlug, {
      debug,
      respectDiscountExcluded,
    });

    const allRows = result.items;

    if (allRows.length === 0) {
      ctx.body = debug ? { items: [], debug: result.debug ?? null } : [];
      return;
    }

    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    const categoryIdSet = new Set<number>();
    for (const product of allRows) {
      const catId = (product as any).category?.id ?? null;
      if (catId) categoryIdSet.add(catId);
    }

    if (categoryIdSet.size === 0) {
      ctx.body = debug ? { items: [], debug: result.debug ?? null } : [];
      return;
    }

    const allCategories: CategoryRowLite[] = await categoryQuery.findMany({
      select: ["id", "name", "slug", "productsCount"],
      populate: { parent: { select: ["id"] } },
      limit: 100000,
    });

    const byId = new Map<number, CategoryRowLite>();
    for (const cat of allCategories) byId.set(cat.id, cat);

    const resultCategoryIds = new Set<number>();

    for (const catId of categoryIdSet) {
      let currentId: number | null = catId;
      const visited = new Set<number>();

      while (currentId) {
        if (visited.has(currentId)) break;
        visited.add(currentId);

        if (currentId !== CATALOG_ROOT_PARENT_ID) {
          resultCategoryIds.add(currentId);
        }

        const node = byId.get(currentId);
        currentId = node?.parent?.id ?? null;
      }
    }

    const directCountByCategoryId = new Map<number, number>();
    for (const product of allRows) {
      const catId = (product as any).category?.id ?? null;
      if (!catId) continue;
      directCountByCategoryId.set(catId, (directCountByCategoryId.get(catId) ?? 0) + 1);
    }

    const productCountByCategoryId = new Map<number, number>(directCountByCategoryId);

    for (const catId of resultCategoryIds) {
      const cat = byId.get(catId);
      if (!cat) continue;

      let currentId: number | null = cat.parent?.id ?? null;
      const directCount = directCountByCategoryId.get(catId) ?? 0;

      if (directCount === 0) continue;

      const visited = new Set<number>();
      while (currentId && currentId !== CATALOG_ROOT_PARENT_ID) {
        if (visited.has(currentId)) break;
        visited.add(currentId);

        productCountByCategoryId.set(currentId, (productCountByCategoryId.get(currentId) ?? 0) + directCount);

        const parentNode = byId.get(currentId);
        currentId = parentNode?.parent?.id ?? null;
      }
    }

    const items = [];
    for (const catId of resultCategoryIds) {
      const cat = byId.get(catId);
      if (!cat) continue;

      const slug = typeof cat.slug === "string" ? cat.slug.trim() : "";
      const name = typeof cat.name === "string" ? cat.name.trim() : "";
      if (!slug || !name) continue;

      const parentId = cat.parent?.id ?? null;

      items.push({
        id: String(catId),
        slug,
        name,
        productsCount: productCountByCategoryId.get(catId) ?? 0,
        parentId: parentId && parentId !== CATALOG_ROOT_PARENT_ID ? String(parentId) : null,
      });
    }

    ctx.body = debug ? { items, debug: result.debug ?? null } : items;
  },
}));
