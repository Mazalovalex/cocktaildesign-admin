// src/api/moysklad-product/services/moysklad-product.ts
// Задача файла:
// 1) Забрать товары из MoySklad
// 2) Оставить только товары, которые попадают в уже синкнутые категории
// 3) Сделать upsert товаров в Strapi
// 4) Удалить товары, которых больше нет в MoySklad/в витринных категориях
// 5) Пересчитать productsCount у категорий
// 6) Вести статусы синка + lock, чтобы синк не запускался параллельно

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

type MoySkladListResponse = {
  rows: MoySkladProduct[];
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
 * Type-guard для ответа MoySklad.
 * Нужен, потому что в Node/undici res.json() часто typed как unknown.
 */
function isMoySkladListResponse(data: unknown): data is MoySkladListResponse {
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
    throw new Error(`Unexpected MoySklad response shape: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return data;
}

export default factories.createCoreService("api::moysklad-product.moysklad-product", ({ strapi }) => ({
  /**
   * Полный синк товаров.
   * - берём только товары из синкнутых категорий
   * - price     = "Цена с сайта"
   * - priceOld  = "Цена продажи"
   * - пересчитываем productsCount у категорий
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

      // 2) Тянем все товары из MoySklad (пагинация)
      const all: MoySkladProduct[] = [];
      let offset = 0;

      while (true) {
        const url = `https://api.moysklad.ru/api/remap/1.2/entity/product?limit=100&offset=${offset}`;
        const data = await fetchJson(url, token);

        all.push(...data.rows);

        if (!data.meta.nextHref) break;
        offset += 100;
      }

      const nowIso = new Date().toISOString();
      const keepIds = new Set<string>();

      // 3) Upsert только тех товаров, что попадают в allowed категории
      for (const p of all) {
        const categoryMsId = pickIdFromHref(p.productFolder?.meta?.href);
        if (!categoryMsId) continue;

        // Жёстко отсекаем товары не из витринных категорий
        if (!allowedCategoryMsIds.has(categoryMsId)) continue;

        const categoryId = categoryIdByMsId.get(categoryMsId);
        if (!categoryId) continue;

        keepIds.add(p.id);

        const existing = await productQuery.findOne({
          where: { moyskladId: p.id },
          select: ["id"],
        });

        const payload = {
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

      // 4) Удаляем товары, которые больше не должны быть в витрине
      await productQuery.deleteMany({
        where: {
          moyskladId: { $notIn: Array.from(keepIds) },
        },
      });

      // 5) Пересчитываем productsCount по каждой категории
      // (да, N+1 — но это простой и надёжный MVP; потом оптимизируем при необходимости)
      for (const category of categories) {
        // В Strapi v5 relation-фильтры надёжнее писать через вложенный объект
        const count = await productQuery.count({
          where: {
            category: {
              id: category.id,
            },
          },
        });

        await categoryQuery.update({
          where: { id: category.id },
          data: { productsCount: count },
        });
      }

      await markSyncOk("products", { products: keepIds.size });

      return { ok: true, total: keepIds.size };
    } catch (e) {
      await markSyncError("products", e);
      throw e;
    } finally {
      await releaseMoySkladSyncLock("products");
    }
  },
}));
