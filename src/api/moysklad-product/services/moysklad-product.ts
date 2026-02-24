// backend/src/api/moysklad-product/services/moysklad-product.ts
// Задача файла:
// 1) Забрать товары (product) из MoySklad
// 2) Оставить только товары, которые попадают в уже синкнутые категории
// 3) Сделать upsert товаров в Strapi
// 4) Удалить товары, которых больше нет в MoySklad/в витринных категориях
// 5) Пересчитать productsCount у категорий (aggregate по descendants, чтобы у "Шейкеры" и у ROOT
//    считалось "всё внутри дерева")
// 6) Вести статусы синка + lock, чтобы синк не запускался параллельно
//
// ДОБАВЛЕНО (шаг 1 по bundle):
// - Тянем bundle из MoySklad отдельно (пока БЕЗ апсерта в Strapi)
// - Пишем в логи сколько bundle всего и сколько из них попали в allowed категории

import { factories } from "@strapi/strapi";
import {
  acquireMoySkladSyncLock,
  releaseMoySkladSyncLock,
  markSyncError,
  markSyncOk,
  markSyncRunning,
} from "../../../utils/moysklad-sync-state";

type MoySkladMeta = {
  href: string;
};

type MoySkladSalePrice = {
  value: number; // копейки
  priceType?: {
    name: string;
  };
};

type MoySkladProduct = {
  id: string;
  name: string;
  code?: string;
  updated?: string;

  meta: MoySkladMeta;

  productFolder?: {
    meta: MoySkladMeta;
  };

  salePrices?: MoySkladSalePrice[];

  uom?: {
    name?: string;
  };

  weight?: number | null;
  volume?: number | null;
};

// Bundle в MoySklad по полям очень похож на Product для наших целей
type MoySkladBundle = {
  id: string;
  name: string;
  code?: string;
  updated?: string;

  meta: MoySkladMeta;

  productFolder?: {
    meta: MoySkladMeta;
  };

  salePrices?: MoySkladSalePrice[];

  uom?: {
    name?: string;
  };

  weight?: number | null;
  volume?: number | null;
};

type MoySkladListResponse = {
  rows: MoySkladProduct[];
  meta: {
    nextHref?: string;
  };
};

type MoySkladBundleListResponse = {
  rows: MoySkladBundle[];
  meta: {
    nextHref?: string;
  };
};

function getMoySkladHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json;charset=utf-8",
  } as const;
}

/**
 * Достаём UUID из href.
 * Важно: режем ?query и #hash, чтобы не получить кривой ID.
 */
function pickIdFromHref(href?: string): string | null {
  if (!href) return null;

  const clean = href.split("?")[0]?.split("#")[0];
  if (!clean) return null;

  const parts = clean.split("/");
  const last = parts[parts.length - 1];

  return last ? last : null;
}

/**
 * Цена из salePrices по точному имени типа цены.
 * MoySklad хранит value в копейках.
 */
function priceByName(prices: MoySkladSalePrice[] | undefined, name: string): number | null {
  if (!prices?.length) return null;

  const found = prices.find((p) => p.priceType?.name === name);
  if (!found) return null;

  // Возвращаем рубли целым числом (integer в Strapi schema)
  return Math.round(found.value / 100);
}

/**
 * Type-guard для ответа MoySklad product-list.
 * Нужен, потому что в Node/undici res.json() часто typed как unknown.
 */
function isMoySkladListResponse(data: unknown): data is MoySkladListResponse {
  if (!data || typeof data !== "object") return false;

  const d = data as { rows?: unknown; meta?: unknown };
  const hasRows = Array.isArray(d.rows);
  const hasMeta = typeof d.meta === "object" && d.meta !== null;

  return hasRows && hasMeta;
}

/**
 * Type-guard для ответа MoySklad bundle-list.
 * Он такой же по форме: { rows: [], meta: {} }
 * Делаем отдельной функцией, чтобы в ошибках было ясно, что проверяли.
 */
function isMoySkladBundleListResponse(data: unknown): data is MoySkladBundleListResponse {
  if (!data || typeof data !== "object") return false;

  const d = data as { rows?: unknown; meta?: unknown };
  const hasRows = Array.isArray(d.rows);
  const hasMeta = typeof d.meta === "object" && d.meta !== null;

  return hasRows && hasMeta;
}

async function fetchJson(url: string, token: string): Promise<MoySkladListResponse> {
  const res = await fetch(url, { headers: getMoySkladHeaders(token) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MoySklad API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as unknown;

  if (!isMoySkladListResponse(data)) {
    // Чтобы быстро увидеть реальный ответ, который прилетел
    throw new Error(`Unexpected MoySklad response shape (product): ${JSON.stringify(data).slice(0, 500)}`);
  }

  return data;
}

async function fetchBundleJson(url: string, token: string): Promise<MoySkladBundleListResponse> {
  const res = await fetch(url, { headers: getMoySkladHeaders(token) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MoySklad API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as unknown;

  if (!isMoySkladBundleListResponse(data)) {
    // Чтобы быстро увидеть реальный ответ, который прилетел
    throw new Error(`Unexpected MoySklad response shape (bundle): ${JSON.stringify(data).slice(0, 500)}`);
  }

  return data;
}

/**
 * В Strapi поля могут отличаться (в процессе миграции схемы).
 * Чтобы не падать, проверяем наличие атрибутов в content-type.
 */
function hasCategoryAttribute(attrName: string): boolean {
  const ct = strapi.contentTypes["api::moysklad-category.moysklad-category"];
  return Boolean(ct?.attributes && Object.prototype.hasOwnProperty.call(ct.attributes, attrName));
}

/**
 * Пересчёт счётчиков категорий "по дереву":
 * - direct: товары, привязанные к категории напрямую (children не включаем)
 * - total: direct + сумма total всех дочерних
 *
 * По умолчанию:
 * - total пишем в productsCount (чтобы фронт/текущие запросы сразу показывали aggregate)
 * - если в модели есть productsCountDirect / productsCountTotal — пишем и туда тоже.
 */
async function recomputeCategoryCountsForTree(directCountByCategoryId: Map<number, number>) {
  const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

  // Берём дерево: id + parent
  const categories = await categoryQuery.findMany({
    select: ["id"],
    populate: { parent: { select: ["id"] } },
    limit: 100000,
  });

  // parentId -> childIds[]
  const childrenByParentId = new Map<number, number[]>();
  for (const c of categories) {
    const parentId = c.parent?.id;
    if (!parentId) continue;

    const arr = childrenByParentId.get(parentId) ?? [];
    arr.push(c.id);
    childrenByParentId.set(parentId, arr);
  }

  const totalByCategoryId = new Map<number, number>();

  const computeTotal = (categoryId: number): number => {
    const cached = totalByCategoryId.get(categoryId);
    if (cached !== undefined) return cached;

    const direct = directCountByCategoryId.get(categoryId) ?? 0;
    const children = childrenByParentId.get(categoryId) ?? [];

    let total = direct;
    for (const childId of children) {
      total += computeTotal(childId);
    }

    totalByCategoryId.set(categoryId, total);
    return total;
  };

  const canWriteDirect = hasCategoryAttribute("productsCountDirect");
  const canWriteTotal = hasCategoryAttribute("productsCountTotal");

  // Обновляем все категории: productsCount = total (aggregate)
  for (const c of categories) {
    const direct = directCountByCategoryId.get(c.id) ?? 0;
    const total = computeTotal(c.id);

    const data: Record<string, unknown> = {
      productsCount: total,
    };

    if (canWriteDirect) data.productsCountDirect = direct;
    if (canWriteTotal) data.productsCountTotal = total;

    await categoryQuery.update({
      where: { id: c.id },
      data,
    });
  }
}

export default factories.createCoreService("api::moysklad-product.moysklad-product", ({ strapi }) => ({
  /**
   * Полный синк товаров.
   * - берём только товары из синкнутых категорий
   * - price     = "Цена с сайта"
   * - priceOld  = "Цена продажи"
   * - пересчитываем productsCount у категорий (aggregate по дереву)
   */
  async syncAll() {
    await acquireMoySkladSyncLock("products");
    await markSyncRunning("products");

    try {
      const token = process.env.MOYSKLAD_ACCESS_TOKEN;
      if (!token) throw new Error("MOYSKLAD_ACCESS_TOKEN is not set");

      const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");
      const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

      // 1) Разрешённые категории (уже синкнутые витринные)
      const categories = await categoryQuery.findMany({
        select: ["id", "moyskladId"],
        limit: 10000,
      });

      const allowedCategoryMsIds = new Set(categories.map((c) => c.moyskladId));
      const categoryIdByMsId = new Map<string, number>(categories.map((c) => [c.moyskladId, c.id]));

      // 2) Тянем все товары (product) из MoySklad (пагинация)
      const all: MoySkladProduct[] = [];
      let offset = 0;

      while (true) {
        const url = `https://api.moysklad.ru/api/remap/1.2/entity/product?limit=100&offset=${offset}`;
        const data = await fetchJson(url, token);

        all.push(...data.rows);

        if (!data.meta.nextHref) break;
        offset += 100;
      }

      // 2.1) Тянем все комплекты (bundle) из MoySklad (пагинация)
      // ВАЖНО: пока только скачиваем и считаем, без апсерта.
      const allBundles: MoySkladBundle[] = [];
      let bundleOffset = 0;

      while (true) {
        const url = `https://api.moysklad.ru/api/remap/1.2/entity/bundle?limit=100&offset=${bundleOffset}`;
        const data = await fetchBundleJson(url, token);

        allBundles.push(...data.rows);

        if (!data.meta.nextHref) break;
        bundleOffset += 100;
      }

      const nowIso = new Date().toISOString();
      const keepMsIds = new Set<string>();

      // direct count (только прямые товары, без children)
      const directCountByCategoryId = new Map<number, number>();

      // 3) Upsert только тех товаров, что попадают в allowed категории
      for (const p of all) {
        const categoryMsId = pickIdFromHref(p.productFolder?.meta?.href);
        if (!categoryMsId) continue;

        // Жёстко отсекаем товары не из витринных категорий
        if (!allowedCategoryMsIds.has(categoryMsId)) continue;

        const categoryId = categoryIdByMsId.get(categoryMsId);
        if (!categoryId) continue;

        keepMsIds.add(p.id);

        // Накапливаем direct-count сразу (без N+1 count запросов)
        directCountByCategoryId.set(categoryId, (directCountByCategoryId.get(categoryId) ?? 0) + 1);

        const existing = await productQuery.findOne({
          where: { moyskladId: p.id },
          select: ["id"],
        });

        const payload = {
          // ВАЖНО: фиксируем тип записи в нашей единой витринной модели.
          // Сейчас это обычный товар из /entity/product.
          // Позже для /entity/bundle будет type: "bundle".
          type: "product",

          name: p.name,
          displayTitle: p.name,

          moyskladId: p.id,
          href: p.meta.href,
          code: p.code ?? null,
          updated: p.updated ?? null,

          category: categoryId,

          price: priceByName(p.salePrices, "Цена с сайта"),
          priceOld: priceByName(p.salePrices, "Цена продажи"),

          uom: p.uom?.name ?? null,

          // В schema это decimal → оставляем только number, иначе null
          weight: typeof p.weight === "number" ? p.weight : null,
          volume: typeof p.volume === "number" ? p.volume : null,

          publishedAt: nowIso,
        };

        if (existing) {
          await productQuery.update({
            where: { id: existing.id },
            data: payload,
          });
        } else {
          await productQuery.create({
            data: payload,
          });
        }
      }

      // 3.1) Шаг 1 по bundle: просто считаем, сколько bundle попадает в allowed категории
      let bundlesAllowed = 0;

      for (const b of allBundles) {
        const categoryMsId = pickIdFromHref(b.productFolder?.meta?.href);
        if (!categoryMsId) continue;
        if (!allowedCategoryMsIds.has(categoryMsId)) continue;

        // На этом шаге мы НЕ апсертим bundle.
        bundlesAllowed += 1;
      }

      // Логи, чтобы глазами проверить, что bundle реально есть и попадают в витрину
      strapi.log.info(`[moysklad] products total fetched: ${all.length}`);
      strapi.log.info(`[moysklad] bundles total fetched: ${allBundles.length}`);
      strapi.log.info(`[moysklad] bundles allowed by category: ${bundlesAllowed}`);

      // 4) Удаляем товары, которые больше не должны быть в витрине
      await productQuery.deleteMany({
        where: {
          moyskladId: { $notIn: Array.from(keepMsIds) },
        },
      });

      /**
       * 5) Пересчитываем productsCount "внутри дерева"
       * - directCount мы уже посчитали при апсерте
       * - totalCount считаем по parent/children в категориях
       */
      await recomputeCategoryCountsForTree(directCountByCategoryId);

      await markSyncOk("products", { products: keepMsIds.size });

      return { ok: true, total: keepMsIds.size };
    } catch (e) {
      await markSyncError("products", e);
      throw e;
    } finally {
      await releaseMoySkladSyncLock("products");
    }
  },
}));
