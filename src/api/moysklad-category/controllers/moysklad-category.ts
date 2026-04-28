//backend/src/api/moysklad-category/controllers/moysklad-category.ts
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

// ----------------------------------------------------------------------------
// VISIBLE_PRODUCTS_FILTER
//
// Фильтр для скрытия товаров с сайта.
// Менеджер ставит флаг isHiddenOnSite = true в Strapi → товар не показывается.
// Если флаг false ИЛИ null — товар показывается (по умолчанию все видимы).
//
// Используется во всех endpoint'ах товаров: products, productsDiscounted,
// productsByIds, productBySlug, search, randomProducts, getCollectionProducts.
// ----------------------------------------------------------------------------
const VISIBLE_PRODUCTS_FILTER = {
  $or: [{ isHiddenOnSite: false }, { isHiddenOnSite: { $null: true } }],
};

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
  // Флаг — товар не участвует в скидках и промокодах
  discountExcluded?: boolean | null;
  // Состав/комплектация — каждая строка = пункт списка на фронте
  composition?: string | null;
  // Флаг — товар скрыт с сайта (менеджер выключил его в Strapi)
  isHiddenOnSite?: boolean | null;
  image?: unknown;
  category?: { id?: number | null; name?: string | null } | null;
  specifications?: ProductSpecificationRow[] | null;
  variants?: VariantRow[] | null;
};

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

// ----------------------------------------------------------------------------
// getCollectionProducts
// Вспомогательная функция — берёт товары коллекции по её selectionMode.
// Используется в двух handlers: collectionProducts и collectionCategoriesTree.
//
// Скрытые товары (isHiddenOnSite = true) исключаются во всех режимах.
// ----------------------------------------------------------------------------
async function getCollectionProducts(strapi: any, collectionSlug: string): Promise<ProductRow[]> {
  const collectionQuery = strapi.db.query("api::catalog-collection.catalog-collection");
  const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");
  const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

  // Находим коллекцию по slug
  const collection = await collectionQuery.findOne({
    where: { slug: collectionSlug },
    populate: {
      products: { select: ["id"] },
      sourceCategory: { select: ["id", "slug"] },
    },
  });

  if (!collection) return [];

  const selectionMode = collection.selectionMode ?? "manual";

  // --- manual: товары выбраны вручную в админке ---
  if (selectionMode === "manual") {
    const productIds = (collection.products ?? []).map((p: any) => p.id);

    if (productIds.length === 0) return [];

    return productQuery.findMany({
      where: {
        id: { $in: productIds },
        // Скрываем товары которые выключены менеджером (isHiddenOnSite = true)
        ...VISIBLE_PRODUCTS_FILTER,
      },
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
      },
      limit: 100000,
    });
  }

  // --- category: все товары из указанной категории ---
  if (selectionMode === "category") {
    const sourceCategorySlug = collection.sourceCategory?.slug ?? null;
    if (!sourceCategorySlug) return [];

    const rootCategory = await categoryQuery.findOne({
      where: { slug: sourceCategorySlug },
      select: ["id"],
    });

    if (!rootCategory) return [];

    const allCategories = await categoryQuery.findMany({
      select: ["id"],
      populate: { parent: { select: ["id"] } },
      limit: 100000,
    });

    const categoryIds = collectDescendantCategoryIds({
      rootId: rootCategory.id,
      all: allCategories,
    });

    return productQuery.findMany({
      where: {
        category: { id: { $in: categoryIds } },
        // Скрываем товары которые выключены менеджером (isHiddenOnSite = true)
        ...VISIBLE_PRODUCTS_FILTER,
      },
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
      },
      limit: 100000,
    });
  }

  // --- discount: все товары со скидкой ---
  if (selectionMode === "discount") {
    const rows: ProductRow[] = await productQuery.findMany({
      where: {
        price: { $gt: 0 },
        priceOld: { $gt: 0 },
        // Скрываем товары которые выключены менеджером (isHiddenOnSite = true)
        ...VISIBLE_PRODUCTS_FILTER,
      },
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
      },
      limit: 100000,
    });

    // Фильтруем только реальные скидки (priceOld > price)
    return rows.filter((p) => {
      const price = typeof p.price === "number" ? p.price : 0;
      const priceOld = typeof p.priceOld === "number" ? p.priceOld : 0;
      return price > 0 && priceOld > price;
    });
  }

  return [];
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
   *
   * Отдаёт плоский список категорий для построения меню на фронте.
   *
   * Логика сортировки и фильтрации:
   * 1. Скрытые категории (isHiddenInMenu = true) НЕ отдаются вообще
   * 2. Сначала идут категории с заданным menuOrder (по возрастанию)
   * 3. Потом — категории без menuOrder (новые из МойСклад) по алфавиту
   *
   * Порядок применяется на ВСЕХ уровнях дерева — фронт строит
   * дерево из плоского массива и порядок сохраняется.
   *
   * В ответе есть imageUrl и alt — чтобы можно было использовать дерево
   * везде, где раньше использовался getTopCategoriesFromStrapi (плитки
   * с картинками на /catalog, главной, мобильный drill-down).
   */
  async categoriesFlat(ctx) {
    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    // Берём только видимые категории
    // (isHiddenInMenu может быть false ИЛИ null — оба значения считаем "видимая")
    const rows = await categoryQuery.findMany({
      where: {
        $or: [{ isHiddenInMenu: false }, { isHiddenInMenu: { $null: true } }],
      },
      select: ["id", "name", "slug", "productsCount", "menuOrder", "isHiddenInMenu"],
      populate: {
        parent: { select: ["id"] },
        // Подтягиваем картинку категории — нужна для фронта
        // (плитки на /catalog, главная, мобильный drill-down)
        image: { select: ["url", "alternativeText", "formats"] },
      },
      limit: 100000,
    });

    // Сортируем категории:
    // 1) Если у обеих задан menuOrder — сравниваем по нему
    // 2) Если только у одной — она идёт первой
    // 3) Если у обеих не задан — сортируем по имени (алфавит)
    const sorted = [...rows].sort((a: any, b: any) => {
      const orderA = typeof a.menuOrder === "number" ? a.menuOrder : null;
      const orderB = typeof b.menuOrder === "number" ? b.menuOrder : null;

      // Обе с явным порядком — сравниваем числа
      if (orderA !== null && orderB !== null) {
        return orderA - orderB;
      }

      // Только у A есть порядок — A идёт первой
      if (orderA !== null && orderB === null) {
        return -1;
      }

      // Только у B есть порядок — B идёт первой
      if (orderA === null && orderB !== null) {
        return 1;
      }

      // У обеих нет порядка — сортируем по имени (алфавит, регистронезависимо)
      const nameA = typeof a.name === "string" ? a.name : "";
      const nameB = typeof b.name === "string" ? b.name : "";
      return nameA.localeCompare(nameB, "ru");
    });

    // Преобразуем результат в плоский формат для фронта.
    // Картинку отдаём как готовый URL (без массива форматов) и поле alt.
    ctx.body = sorted.map((c: any) => {
      // Достаём картинку — берём лучший доступный размер
      // medium → small → thumbnail → оригинал
      const image = c.image ?? null;
      const imagePath =
        image?.formats?.medium?.url ??
        image?.formats?.small?.url ??
        image?.formats?.thumbnail?.url ??
        image?.url ??
        null;

      // Alt-текст: если в Strapi задан alternativeText — берём его,
      // иначе используем имя категории
      const altFromStrapi = typeof image?.alternativeText === "string" ? image.alternativeText.trim() : "";
      const alt = altFromStrapi || (typeof c.name === "string" ? c.name : "");

      return {
        id: String(c.id),
        slug: typeof c.slug === "string" ? c.slug : "",
        name: typeof c.name === "string" ? c.name : "",
        productsCount: toSafeCount(c.productsCount),
        parentId: c.parent?.id ? String(c.parent.id) : null,
        // Новые поля — для замены getTopCategoriesFromStrapi
        imageUrl: imagePath,
        alt,
      };
    });
  },

  /**
   * GET /api/catalog/products
   * Скрытые товары (isHiddenOnSite = true) исключаются из выдачи.
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

    // Фильтр: товары нужной категории + не скрытые менеджером
    const where = {
      category: { id: { $in: categoryIds } },
      ...VISIBLE_PRODUCTS_FILTER,
    };

    const total = await productQuery.count({ where });

    const rows: ProductRow[] = await productQuery.findMany({
      where,
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

  /**
   * GET /api/catalog/products-discounted
   * Скрытые товары (isHiddenOnSite = true) исключаются из выдачи.
   */
  async productsDiscounted(ctx) {
    const limit = toSafeLimit(ctx.query.limit, 50);
    const offset = toSafeOffset(ctx.query.offset);

    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    const rows: ProductRow[] = await productQuery.findMany({
      where: {
        price: { $gt: 0 },
        priceOld: { $gt: 0 },
        // Скрываем товары которые выключены менеджером (isHiddenOnSite = true)
        ...VISIBLE_PRODUCTS_FILTER,
      },
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
      limit: 100000,
    });

    const discountedRows = rows.filter((product) => {
      const price = typeof product.price === "number" ? product.price : 0;
      const priceOld = typeof product.priceOld === "number" ? product.priceOld : 0;
      return price > 0 && priceOld > price;
    });

    const total = discountedRows.length;
    const paginatedRows = discountedRows.slice(offset, offset + limit);
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
    };
  },

  /**
   * GET /api/catalog/products-by-ids
   * Скрытые товары (isHiddenOnSite = true) исключаются из выдачи.
   * Используется для избранного — если пользователь добавил в избранное
   * товар, который менеджер потом скрыл — товар просто не вернётся.
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
        // Скрываем товары которые выключены менеджером (isHiddenOnSite = true)
        ...VISIBLE_PRODUCTS_FILTER,
      },
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

  /**
   * GET /api/catalog/product?slug=ms-xxxxxxx
   * Если товар скрыт (isHiddenOnSite = true) — возвращаем 404.
   * Это защита прямых ссылок (например из Google) на скрытые товары.
   */
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
      where: {
        slug,
        // Скрываем товары которые выключены менеджером (isHiddenOnSite = true)
        // Если товар скрыт — findOne вернёт null → 404 ниже
        ...VISIBLE_PRODUCTS_FILTER,
      },
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
        "composition",
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
      // --- значение ---
      const value = typeof spec.value === "string" ? spec.value.trim() : null;

      // --- label (старое поле, может быть null) ---
      const label = typeof spec.label === "string" ? spec.label.trim() : null;

      // --- название характеристики (Материал, Тип и т.д.) ---
      const specification = spec.specification
        ? {
            id: spec.specification.id ?? null,
            name: typeof spec.specification.name === "string" ? spec.specification.name.trim() : null,
          }
        : null;

      // --- ссылка из категории ---
      let href: string | null = null;

      if (spec.kategorii && typeof spec.kategorii.slug === "string" && spec.kategorii.slug.trim()) {
        href = `/catalog/${spec.kategorii.slug.trim()}`;
      }

      // --- fallback: если категории нет, берем ручной href ---
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
          composition: product.composition ?? null,
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

  /**
   * GET /api/catalog/search?q=шейкер
   * Скрытые товары (isHiddenOnSite = true) исключаются из выдачи.
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
        // Скрываем товары которые выключены менеджером (isHiddenOnSite = true)
        ...VISIBLE_PRODUCTS_FILTER,
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

  /**
   * GET /api/catalog/random-products?count=2
   * Скрытые товары (isHiddenOnSite = true) исключаются из выдачи.
   */
  async randomProducts(ctx) {
    const count = Math.min(Math.max(Number(ctx.query.count ?? 2), 1), 6);

    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    // Фильтр: не корневая категория + не скрытые товары
    const where = {
      category: { id: { $notIn: [14] } },
      ...VISIBLE_PRODUCTS_FILTER,
    };

    const total = await productQuery.count({ where });

    if (total === 0) {
      ctx.body = { items: [] };
      return;
    }

    const maxOffset = Math.max(0, total - count);
    const randomOffset = Math.floor(Math.random() * (maxOffset + 1));

    const rows: ProductRow[] = await productQuery.findMany({
      where,
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

  /**
   * GET /api/catalog/collection/:slug/products
   *
   * Возвращает товары коллекции с пагинацией.
   * Логика зависит от selectionMode коллекции:
   * - manual: товары выбраны вручную в админке
   * - category: все товары из указанной категории
   * - discount: все товары со скидкой
   *
   * Скрытые товары (isHiddenOnSite = true) исключаются — фильтр стоит
   * внутри getCollectionProducts() для всех режимов.
   */
  async collectionProducts(ctx) {
    const collectionSlug = String(ctx.params.slug ?? "").trim();
    const limit = toSafeLimit(ctx.query.limit, 50);
    const offset = toSafeOffset(ctx.query.offset);

    if (!collectionSlug) {
      ctx.status = 400;
      ctx.body = { error: "slug_required" };
      return;
    }

    // Проверяем что коллекция существует и получаем её мета-данные
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

    // Получаем все товары коллекции через общую функцию
    let allRows = await getCollectionProducts(strapi, collectionSlug);

    // Если передан categorySlug — фильтруем товары только из этой категории
    // и всех её потомков
    const filterCategorySlug = String(ctx.query.categorySlug ?? "").trim();

    if (filterCategorySlug) {
      const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

      const rootCategory = await categoryQuery.findOne({
        where: { slug: filterCategorySlug },
        select: ["id"],
      });

      if (rootCategory) {
        // Загружаем все категории чтобы найти всех потомков
        const allCategories = await categoryQuery.findMany({
          select: ["id"],
          populate: { parent: { select: ["id"] } },
          limit: 100000,
        });

        // Собираем id корневой категории + все дочерние
        const allowedCategoryIds = new Set(
          collectDescendantCategoryIds({ rootId: rootCategory.id, all: allCategories }),
        );

        // Оставляем только товары из нужных категорий
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
    };
  },

  /**
   * GET /api/catalog/collection/:slug/categories-tree
   *
   * Возвращает плоский список категорий из товаров коллекции.
   * Фронт передаёт его в buildCatalogTree → получает дерево для CatalogSidebar.
   *
   * Формат ответа совпадает с /api/catalog/categories-flat:
   * [{ id, slug, name, productsCount, parentId }]
   *
   * Скрытые товары (isHiddenOnSite = true) исключаются — фильтр стоит
   * внутри getCollectionProducts(). То есть если в категории остались
   * только скрытые товары — категория вообще не попадёт в дерево.
   */
  async collectionCategoriesTree(ctx) {
    const collectionSlug = String(ctx.params.slug ?? "").trim();

    if (!collectionSlug) {
      ctx.status = 400;
      ctx.body = { error: "slug_required" };
      return;
    }

    // Получаем все товары коллекции
    const allRows = await getCollectionProducts(strapi, collectionSlug);

    if (allRows.length === 0) {
      ctx.body = [];
      return;
    }

    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    // Собираем уникальные id категорий из товаров
    const categoryIdSet = new Set<number>();
    for (const product of allRows) {
      const catId = (product as any).category?.id ?? null;
      if (catId) categoryIdSet.add(catId);
    }

    if (categoryIdSet.size === 0) {
      ctx.body = [];
      return;
    }

    const allCategories: CategoryRowLite[] = await categoryQuery.findMany({
      select: ["id", "name", "slug", "productsCount"],
      populate: { parent: { select: ["id"] } },
      limit: 100000,
    });

    const byId = new Map<number, CategoryRowLite>();
    for (const cat of allCategories) byId.set(cat.id, cat);

    // Для каждой категории товара строим цепочку до корня
    // и добавляем все категории из цепочки в результирующий Set
    const resultCategoryIds = new Set<number>();

    for (const catId of categoryIdSet) {
      // Идём вверх по дереву от листа к корню
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

    // Считаем прямые товары по категориям
    const directCountByCategoryId = new Map<number, number>();
    for (const product of allRows) {
      const catId = (product as any).category?.id ?? null;
      if (!catId) continue;
      directCountByCategoryId.set(catId, (directCountByCategoryId.get(catId) ?? 0) + 1);
    }

    // Суммируем count вверх по дереву — родитель получает сумму всех потомков
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

    // Формируем плоский список в формате categories-flat
    const result = [];
    for (const catId of resultCategoryIds) {
      const cat = byId.get(catId);
      if (!cat) continue;

      const slug = typeof cat.slug === "string" ? cat.slug.trim() : "";
      const name = typeof cat.name === "string" ? cat.name.trim() : "";
      if (!slug || !name) continue;

      const parentId = cat.parent?.id ?? null;

      result.push({
        id: String(catId),
        slug,
        name,
        // productsCount — сколько товаров из коллекции в этой категории
        productsCount: productCountByCategoryId.get(catId) ?? 0,
        parentId: parentId && parentId !== CATALOG_ROOT_PARENT_ID ? String(parentId) : null,
      });
    }

    ctx.body = result;
  },
}));
