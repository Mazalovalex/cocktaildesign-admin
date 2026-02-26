/**
 * moysklad-variant service (расширенный)
 */

import { factories } from "@strapi/strapi";

type MoySkladMeta = { href?: string };

type MoySkladSalePrice = {
  value: number; // копейки
  priceType?: { name: string };
};

type MoySkladCharacteristic = {
  name: string;
  value: string;
};

type MoySkladVariant = {
  id?: string;
  name?: string;
  code?: string;
  updated?: string;

  meta?: MoySkladMeta;

  product?: {
    meta?: MoySkladMeta; // href на entity/product/<uuid>
  };

  salePrices?: MoySkladSalePrice[];
  characteristics?: MoySkladCharacteristic[];
};

function pickIdFromHref(href?: string): string | null {
  if (!href) return null;

  const clean = href.split("?")[0]?.split("#")[0];
  if (!clean) return null;

  const parts = clean.split("/");
  const last = parts[parts.length - 1];

  return last ? last : null;
}

function priceByName(prices: MoySkladSalePrice[] | undefined, name: string): number | null {
  if (!prices?.length) return null;

  const found = prices.find((p) => p.priceType?.name === name);
  if (!found) return null;

  // рубли integer
  return Math.round(found.value / 100);
}

export default factories.createCoreService("api::moysklad-variant.moysklad-variant", ({ strapi }) => ({
  /**
   * Upsert variant по payload, пришедшему из fetchByHref(href)
   */
  async syncOneFromWebhook(entity: MoySkladVariant) {
    const variantQuery = strapi.db.query("api::moysklad-variant.moysklad-variant");
    const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

    const moyskladId = entity.id ?? pickIdFromHref(entity.meta?.href);
    if (!moyskladId) {
      strapi.log.warn("[moysklad-variant] skipped: no moyskladId");
      return;
    }

    const productMsId = pickIdFromHref(entity.product?.meta?.href);
    if (!productMsId) {
      strapi.log.warn(`[moysklad-variant] skipped: no product href for variant=${moyskladId}`);
      return;
    }

    const product = await productQuery.findOne({
      where: { moyskladId: productMsId },
      select: ["id"],
    });

    if (!product) {
      strapi.log.warn(`[moysklad-variant] skipped: product not found msId=${productMsId} for variant=${moyskladId}`);
      return;
    }

    const existing = await variantQuery.findOne({
      where: { moyskladId },
      select: ["id"],
    });

    const payload = {
      name: entity.name ?? "",
      moyskladId,
      code: entity.code ?? null,
      updated: entity.updated ?? null,

      product: product.id,

      characteristics: entity.characteristics ?? [],

      price: priceByName(entity.salePrices, "Цена с сайта"),
      priceOld: priceByName(entity.salePrices, "Цена продажи"),

      publishedAt: new Date().toISOString(),
    };

    if (existing) {
      await variantQuery.update({ where: { id: existing.id }, data: payload });
      strapi.log.info(`[moysklad-variant] updated: ${moyskladId}`);
      return;
    }

    await variantQuery.create({ data: payload });
    strapi.log.info(`[moysklad-variant] created: ${moyskladId}`);
  },

  /**
   * DELETE по webhook (без fetchByHref)
   */
  async deleteOneFromWebhook(moyskladId: string) {
    const variantQuery = strapi.db.query("api::moysklad-variant.moysklad-variant");

    await variantQuery.deleteMany({ where: { moyskladId } });
    strapi.log.info(`[moysklad-variant] deleted: ${moyskladId}`);
  },
}));
