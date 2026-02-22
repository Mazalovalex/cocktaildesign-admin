import { factories } from "@strapi/strapi";
import {
  acquireMoySkladSyncLock,
  releaseMoySkladSyncLock,
  markSyncError,
  markSyncOk,
  markSyncRunning,
} from "../../../utils/moysklad-sync-state";

type MoySkladMeta = { href: string; type: string; mediaType?: string };

type MoySkladPriceType = { name: string };

type MoySkladSalePrice = {
  value: number;
  priceType?: MoySkladPriceType;
};

type MoySkladUom = {
  name?: string;
  meta?: MoySkladMeta;
};

type MoySkladProduct = {
  id: string;
  name: string;
  code?: string;
  article?: string;
  updated?: string;

  meta: MoySkladMeta;
  productFolder?: { meta: MoySkladMeta };

  salePrices?: MoySkladSalePrice[];

  uom?: MoySkladUom;
  weight?: number | null;
  volume?: number | null;
};

type MoySkladListResponse<T> = {
  rows: T[];
  meta: {
    size: number;
    limit: number;
    offset: number;
    nextHref?: string;
  };
};

function getMoySkladHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json;charset=utf-8",
  } as const;
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: getMoySkladHeaders(token) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MoySklad API error ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

function pickIdFromHref(href?: string): string | null {
  if (!href) return null;

  const clean = href.split("?")[0]?.split("#")[0];
  if (!clean) return null;

  const parts = clean.split("/");
  const last = parts[parts.length - 1];

  return last ? last : null;
}

function kopecksToRub(value?: number | null): number | null {
  if (typeof value !== "number") return null;
  return Math.round(value) / 100;
}

/**
 * Ищем цену по точному названию типа цены.
 * Важно: без fallback, чтобы не перепутать цены.
 */
function pickPriceByTypeName(prices: MoySkladSalePrice[] | undefined, name: string): number | null {
  if (!prices?.length) return null;

  const found = prices.find((p) => p?.priceType?.name === name);
  if (!found) return null;

  return kopecksToRub(found.value);
}

export default factories.createCoreService("api::moysklad-product.moysklad-product", () => ({
  /**
   * Полный синк товаров.
   * - берём только товары из синкнутых категорий
   * - price     = "Цена с сайта"
   * - priceOld  = "Цена продажи"
   */
  async syncAll() {
    await acquireMoySkladSyncLock("products");
    await markSyncRunning("products");

    try {
      const token = process.env.MOYSKLAD_ACCESS_TOKEN;
      if (!token) throw new Error("MOYSKLAD_ACCESS_TOKEN is not set");

      const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");
      const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

      // допустимые категории
      const categories = await categoryQuery.findMany({
        select: ["id", "moyskladId"],
        limit: 10000,
      });

      const allowedCategoryIds = new Set(categories.map((c) => c.moyskladId));

      const categoryIdByMoyskladId = new Map<string, number>(categories.map((c) => [c.moyskladId, c.id]));

      // fetch products
      const all: MoySkladProduct[] = [];
      const limit = 100;
      let offset = 0;

      while (true) {
        const url = `https://api.moysklad.ru/api/remap/1.2/entity/product` + `?limit=${limit}&offset=${offset}`;

        const data = await fetchJson<MoySkladListResponse<MoySkladProduct>>(url, token);

        all.push(...data.rows);

        if (!data.meta.nextHref) break;
        offset += limit;
      }

      // фильтрация по категориям
      const filtered = all.filter((p) => {
        const categoryId = pickIdFromHref(p.productFolder?.meta?.href);
        return categoryId && allowedCategoryIds.has(categoryId);
      });

      const nowIso = new Date().toISOString();

      // upsert
      for (const p of filtered) {
        const existing = await productQuery.findOne({
          where: { moyskladId: p.id },
          select: ["id"],
        });

        const categoryMoyskladId = pickIdFromHref(p.productFolder?.meta?.href);

        const categoryId = categoryMoyskladId ? (categoryIdByMoyskladId.get(categoryMoyskladId) ?? null) : null;

        const price = pickPriceByTypeName(p.salePrices, "Цена с сайта");

        const priceOld = pickPriceByTypeName(p.salePrices, "Цена продажи");

        const payload = {
          name: p.name,
          displayTitle: p.name,

          moyskladId: p.id,
          href: p.meta.href,
          code: p.code ?? null,
          updated: p.updated ?? null,

          category: categoryId,

          price,
          priceOld,

          uom: p.uom?.name ?? null,
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

      // удаляем лишние товары
      const keepIds = new Set(filtered.map((p) => p.id));

      await productQuery.deleteMany({
        where: {
          moyskladId: {
            $notIn: Array.from(keepIds),
          },
        },
      });

      await markSyncOk("products", {
        products: filtered.length,
      });

      return {
        ok: true,
        total: filtered.length,
      };
    } catch (e) {
      await markSyncError("products", e);
      throw e;
    } finally {
      await releaseMoySkladSyncLock("products");
    }
  },

  /**
   * Sync одного товара через webhook
   */
  async syncOneFromWebhook(entity: unknown) {
    const p = entity as MoySkladProduct;

    if (!p?.id || !p?.meta?.href) {
      throw new Error("Invalid product payload");
    }

    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    const categoryMoyskladId = pickIdFromHref(p.productFolder?.meta?.href);

    if (!categoryMoyskladId) {
      return { ok: true, skipped: true };
    }

    const category = await categoryQuery.findOne({
      where: { moyskladId: categoryMoyskladId },
    });

    if (!category) {
      return { ok: true, skipped: true };
    }

    const existing = await productQuery.findOne({
      where: { moyskladId: p.id },
      select: ["id"],
    });

    const nowIso = new Date().toISOString();

    const price = pickPriceByTypeName(p.salePrices, "Цена с сайта");

    const priceOld = pickPriceByTypeName(p.salePrices, "Цена продажи");

    const payload = {
      name: p.name,
      displayTitle: p.name,

      moyskladId: p.id,
      href: p.meta.href,
      code: p.code ?? null,
      updated: p.updated ?? null,

      category: category.id,

      price,
      priceOld,

      uom: p.uom?.name ?? null,
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

    return { ok: true };
  },
}));
