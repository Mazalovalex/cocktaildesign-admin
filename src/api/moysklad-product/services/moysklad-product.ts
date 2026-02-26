// backend/src/api/moysklad-product/services/moysklad-product.ts
// Задача файла:
// 1) Забрать товары (product) из MoySklad
// 2) Оставить только товары, которые попадают в уже синкнутые категории
// 3) Сделать upsert товаров в Strapi
// 4) Удалить товары, которых больше нет в MoySklad/в витринных категориях
// 5) Пересчитать productsCount у категорий (aggregate по descendants)
// 6) Вести статусы синка + lock, чтобы синк не запускался параллельно
//
// ДОБАВЛЕНО (bundle):
// - Тянем bundle из MoySklad отдельно
// - Апсертим bundle в ту же таблицу moysklad-product с type="bundle"
// - Удаляем отдельно type=product и type=bundle (чтобы не снести друг друга)
//
// ДОБАВЛЕНО (bundle items auto-sync):
// - После sync/products автоматически синкаем состав ДЛЯ ВСЕХ bundles, найденных в витрине
// - Возвращаем агрегированную статистику: created/skipped/failed
//
// ВАЖНО ПРО СЧЁТЧИКИ:
// - productsCount теперь считает И товары И комплекты (product + bundle)
// - category sync больше НЕ пересчитывает счётчики (только строит дерево)

import { factories } from "@strapi/strapi";
import {
  acquireMoySkladSyncLock,
  releaseMoySkladSyncLock,
  markSyncError,
  markSyncOk,
  markSyncRunning,
} from "../../../utils/moysklad-sync-state";

// ✅ ВАЖНО: путь из moysklad-product/services -> api -> moysklad-bundle-item/services/sync
import { syncBundleItemsForBundle } from "../../moysklad-bundle-item/services/sync";

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

/**
 * Payload из webhook fetchByHref может быть "не строгим":
 * - id обычно есть, но подстрахуемся
 * - meta.href есть практически всегда
 */
type MoySkladWebhookProduct = {
  id?: string;
  name?: string;
  code?: string;
  updated?: string;

  meta?: { href?: string };

  productFolder?: { meta?: { href?: string } };

  salePrices?: MoySkladSalePrice[];

  uom?: { name?: string };

  weight?: number | null;
  volume?: number | null;
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
 * - directProducts / directBundles: сколько сущностей привязано напрямую к категории
 * - total: direct + сумма total всех дочерних
 *
 * Что пишем:
 * - productsCount = totalProducts + totalBundles (единый счётчик для витрины)
 * - если есть productsCountDirect / productsCountTotal — пишем туда тоже (единые totals)
 * - если когда-нибудь добавишь отдельные поля (опционально), мы аккуратно их заполним:
 *   productsCountProductsDirect/Total, productsCountBundlesDirect/Total
 */
async function recomputeCategoryCountsForTree(
  directProductsByCategoryId: Map<number, number>,
  directBundlesByCategoryId: Map<number, number>,
) {
  const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

  const categories = await categoryQuery.findMany({
    select: ["id"],
    populate: { parent: { select: ["id"] } },
    limit: 100000,
  });

  const childrenByParentId = new Map<number, number[]>();
  for (const c of categories) {
    const parentId = c.parent?.id;
    if (!parentId) continue;

    const arr = childrenByParentId.get(parentId) ?? [];
    arr.push(c.id);
    childrenByParentId.set(parentId, arr);
  }

  const totalProductsByCategoryId = new Map<number, number>();
  const totalBundlesByCategoryId = new Map<number, number>();

  const computeTotalProducts = (categoryId: number): number => {
    const cached = totalProductsByCategoryId.get(categoryId);
    if (cached !== undefined) return cached;

    const direct = directProductsByCategoryId.get(categoryId) ?? 0;
    const children = childrenByParentId.get(categoryId) ?? [];

    let total = direct;
    for (const childId of children) {
      total += computeTotalProducts(childId);
    }

    totalProductsByCategoryId.set(categoryId, total);
    return total;
  };

  const computeTotalBundles = (categoryId: number): number => {
    const cached = totalBundlesByCategoryId.get(categoryId);
    if (cached !== undefined) return cached;

    const direct = directBundlesByCategoryId.get(categoryId) ?? 0;
    const children = childrenByParentId.get(categoryId) ?? [];

    let total = direct;
    for (const childId of children) {
      total += computeTotalBundles(childId);
    }

    totalBundlesByCategoryId.set(categoryId, total);
    return total;
  };

  const canWriteDirect = hasCategoryAttribute("productsCountDirect");
  const canWriteTotal = hasCategoryAttribute("productsCountTotal");

  // опциональные поля (если ты потом захочешь хранить раздельно)
  const canWriteProductsDirect = hasCategoryAttribute("productsCountProductsDirect");
  const canWriteProductsTotal = hasCategoryAttribute("productsCountProductsTotal");
  const canWriteBundlesDirect = hasCategoryAttribute("productsCountBundlesDirect");
  const canWriteBundlesTotal = hasCategoryAttribute("productsCountBundlesTotal");

  for (const c of categories) {
    const directProducts = directProductsByCategoryId.get(c.id) ?? 0;
    const directBundles = directBundlesByCategoryId.get(c.id) ?? 0;

    const totalProducts = computeTotalProducts(c.id);
    const totalBundles = computeTotalBundles(c.id);

    const directAll = directProducts + directBundles;
    const totalAll = totalProducts + totalBundles;

    const data: Record<string, unknown> = {
      productsCount: totalAll,
    };

    if (canWriteDirect) data.productsCountDirect = directAll;
    if (canWriteTotal) data.productsCountTotal = totalAll;

    if (canWriteProductsDirect) data.productsCountProductsDirect = directProducts;
    if (canWriteProductsTotal) data.productsCountProductsTotal = totalProducts;

    if (canWriteBundlesDirect) data.productsCountBundlesDirect = directBundles;
    if (canWriteBundlesTotal) data.productsCountBundlesTotal = totalBundles;

    await categoryQuery.update({
      where: { id: c.id },
      data,
    });
  }
}

export default factories.createCoreService("api::moysklad-product.moysklad-product", ({ strapi }) => ({
  /**
   * Webhook: upsert ОДНОГО product по payload из fetchByHref(href).
   * Важно: не трогаем bundles здесь (вебхук сейчас шлёт type=product).
   */
  async syncOneFromWebhook(entity: MoySkladWebhookProduct) {
    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");
    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    const moyskladId = entity.id ?? pickIdFromHref(entity.meta?.href);
    const href = entity.meta?.href ?? null;

    if (!moyskladId || !href) {
      strapi.log.warn("[moysklad-product] webhook skipped: no moyskladId/href");
      return;
    }

    const categoryMsId = pickIdFromHref(entity.productFolder?.meta?.href);
    if (!categoryMsId) {
      strapi.log.warn(`[moysklad-product] webhook skipped: no category href for product=${moyskladId}`);
      return;
    }

    const category = await categoryQuery.findOne({
      where: { moyskladId: categoryMsId },
      select: ["id"],
    });

    if (!category) {
      // это нормальная ситуация: если category sync ещё не догнал
      strapi.log.warn(
        `[moysklad-product] webhook skipped: category not found msId=${categoryMsId} product=${moyskladId}`,
      );
      return;
    }

    const existing = await productQuery.findOne({
      where: { moyskladId },
      select: ["id"],
    });

    const nowIso = new Date().toISOString();

    const payload = {
      type: "product",

      name: entity.name ?? "",
      displayTitle: entity.name ?? "",

      moyskladId,
      href,

      code: entity.code ?? null,
      updated: entity.updated ?? null,

      category: category.id,

      price: priceByName(entity.salePrices, "Цена с сайта"),
      priceOld: priceByName(entity.salePrices, "Цена продажи"),

      uom: entity.uom?.name ?? null,
      weight: typeof entity.weight === "number" ? entity.weight : null,
      volume: typeof entity.volume === "number" ? entity.volume : null,

      publishedAt: nowIso,
    };

    if (existing) {
      await productQuery.update({ where: { id: existing.id }, data: payload });
      strapi.log.info(`[moysklad-product] updated: ${moyskladId}`);
      return;
    }

    await productQuery.create({ data: payload });
    strapi.log.info(`[moysklad-product] created: ${moyskladId}`);
  },

  /**
   * Webhook: upsert ОДНОГО bundle по payload из fetchByHref(href).
   * Отличия от product:
   * - type всегда "bundle"
   * - логи маркируем как bundle (чтобы отличать в pm2 logs)
   */
  async syncOneBundleFromWebhook(entity: MoySkladWebhookProduct) {
    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");
    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    const moyskladId = entity.id ?? pickIdFromHref(entity.meta?.href);
    const href = entity.meta?.href ?? null;

    if (!moyskladId || !href) {
      strapi.log.warn("[moysklad-product] bundle webhook skipped: no moyskladId/href");
      return;
    }

    const categoryMsId = pickIdFromHref(entity.productFolder?.meta?.href);
    if (!categoryMsId) {
      strapi.log.warn(`[moysklad-product] bundle webhook skipped: no category href for bundle=${moyskladId}`);
      return;
    }

    const category = await categoryQuery.findOne({
      where: { moyskladId: categoryMsId },
      select: ["id"],
    });

    if (!category) {
      strapi.log.warn(
        `[moysklad-product] bundle webhook skipped: category not found msId=${categoryMsId} bundle=${moyskladId}`,
      );
      return;
    }

    const existing = await productQuery.findOne({
      where: { moyskladId },
      select: ["id"],
    });

    const nowIso = new Date().toISOString();

    const payload = {
      type: "bundle",

      name: entity.name ?? "",
      displayTitle: entity.name ?? "",

      moyskladId,
      href,

      code: entity.code ?? null,
      updated: entity.updated ?? null,

      category: category.id,

      price: priceByName(entity.salePrices, "Цена с сайта"),
      priceOld: priceByName(entity.salePrices, "Цена продажи"),

      uom: entity.uom?.name ?? null,
      weight: typeof entity.weight === "number" ? entity.weight : null,
      volume: typeof entity.volume === "number" ? entity.volume : null,

      publishedAt: nowIso,
    };

    if (existing) {
      await productQuery.update({ where: { id: existing.id }, data: payload });
      strapi.log.info(`[moysklad-product] updated bundle: ${moyskladId}`);
      return;
    }

    await productQuery.create({ data: payload });
    strapi.log.info(`[moysklad-product] created bundle: ${moyskladId}`);
  },

  /**
   * Webhook: delete по moyskladId (без fetchByHref)
   */
  async deleteOneFromWebhook(moyskladId: string) {
    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    await productQuery.deleteMany({ where: { moyskladId } });
    strapi.log.info(`[moysklad-product] deleted: ${moyskladId}`);
  },

  /**
   * Полный синк товаров + комплектов (bundle).
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

      const keepMsIds = new Set<string>(); // type=product
      const keepBundleMsIds = new Set<string>(); // type=bundle

      // direct counts для пересчёта category counters:
      // считаем отдельно products и bundles, чтобы потом сложить корректно
      const directProductsByCategoryId = new Map<number, number>();
      const directBundlesByCategoryId = new Map<number, number>();

      // 3) Upsert только тех товаров, что попадают в allowed категории
      for (const p of all) {
        const categoryMsId = pickIdFromHref(p.productFolder?.meta?.href);
        if (!categoryMsId) continue;

        if (!allowedCategoryMsIds.has(categoryMsId)) continue;

        const categoryId = categoryIdByMsId.get(categoryMsId);
        if (!categoryId) continue;

        keepMsIds.add(p.id);

        // ✅ direct count: PRODUCT
        directProductsByCategoryId.set(categoryId, (directProductsByCategoryId.get(categoryId) ?? 0) + 1);

        const existing = await productQuery.findOne({
          where: { moyskladId: p.id },
          select: ["id"],
        });

        const payload = {
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

          weight: typeof p.weight === "number" ? p.weight : null,
          volume: typeof p.volume === "number" ? p.volume : null,

          publishedAt: nowIso,
        };

        if (existing) {
          await productQuery.update({ where: { id: existing.id }, data: payload });
        } else {
          await productQuery.create({ data: payload });
        }
      }

      // 3.1) Апсерт bundle (type=bundle)
      let bundlesAllowed = 0;

      for (const b of allBundles) {
        const categoryMsId = pickIdFromHref(b.productFolder?.meta?.href);
        if (!categoryMsId) continue;

        if (!allowedCategoryMsIds.has(categoryMsId)) continue;

        const categoryId = categoryIdByMsId.get(categoryMsId);
        if (!categoryId) continue;

        bundlesAllowed += 1;
        keepBundleMsIds.add(b.id);

        // ✅ direct count: BUNDLE
        directBundlesByCategoryId.set(categoryId, (directBundlesByCategoryId.get(categoryId) ?? 0) + 1);

        const existing = await productQuery.findOne({
          where: { moyskladId: b.id },
          select: ["id"],
        });

        const payload = {
          type: "bundle",

          name: b.name,
          displayTitle: b.name,

          moyskladId: b.id,
          href: b.meta.href,
          code: b.code ?? null,
          updated: b.updated ?? null,

          category: categoryId,

          price: priceByName(b.salePrices, "Цена с сайта"),
          priceOld: priceByName(b.salePrices, "Цена продажи"),

          uom: b.uom?.name ?? null,
          weight: typeof b.weight === "number" ? b.weight : null,
          volume: typeof b.volume === "number" ? b.volume : null,

          publishedAt: nowIso,
        };

        if (existing) {
          await productQuery.update({ where: { id: existing.id }, data: payload });
        } else {
          await productQuery.create({ data: payload });
        }
      }

      strapi.log.info(`[moysklad] products total fetched: ${all.length}`);
      strapi.log.info(`[moysklad] bundles total fetched: ${allBundles.length}`);
      strapi.log.info(`[moysklad] bundles allowed by category: ${bundlesAllowed}`);

      // 4) Удаляем только products
      await productQuery.deleteMany({
        where: { type: "product", moyskladId: { $notIn: Array.from(keepMsIds) } },
      });

      // 4.1) Удаляем только bundles
      await productQuery.deleteMany({
        where: { type: "bundle", moyskladId: { $notIn: Array.from(keepBundleMsIds) } },
      });

      // 5) Пересчитываем productsCount:
      // ✅ ВАЖНО: считаем product + bundle (комплекты тоже входят)
      await recomputeCategoryCountsForTree(directProductsByCategoryId, directBundlesByCategoryId);

      // ✅ 6) Автосинк состава для ВСЕХ bundles
      // Важно: синкаем после апсерта bundles и products, чтобы componentProduct уже существовали.
      let bundleItemsCreatedTotal = 0;
      let bundleItemsSkippedTotal = 0;
      let bundlesProcessed = 0;
      let bundlesFailed = 0;

      for (const bundleMsId of keepBundleMsIds) {
        try {
          const r = await syncBundleItemsForBundle(bundleMsId);
          bundleItemsCreatedTotal += r.created;
          bundleItemsSkippedTotal += r.skipped;
          bundlesProcessed += 1;
        } catch (err) {
          bundlesFailed += 1;
          // Не валим весь sync/products из-за одного проблемного комплекта.
          strapi.log.error(`[moysklad] bundle items sync failed: bundle=${bundleMsId} error=${String(err)}`);
        }
      }

      await markSyncOk("products", { products: keepMsIds.size });

      return {
        ok: true,
        total: keepMsIds.size,
        bundles: keepBundleMsIds.size,
        bundleItems: {
          bundlesProcessed,
          created: bundleItemsCreatedTotal,
          skipped: bundleItemsSkippedTotal,
          failed: bundlesFailed,
        },
      };
    } catch (e) {
      await markSyncError("products", e);
      throw e;
    } finally {
      await releaseMoySkladSyncLock("products");
    }
  },
}));
