// backend/src/api/moysklad-webhook/services/moysklad-webhook.ts

import type { MoySkladWebhookEvent } from "../../../utils/moysklad-mutation-queue";

type MoySkladMeta = { href: string; type: string; mediaType?: string };

const MOYSKLAD_API_HOST = "https://api.moysklad.ru/";

function getMoySkladHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json;charset=utf-8",
  } as const;
}

function isSafeHref(href: string): boolean {
  return href.startsWith(MOYSKLAD_API_HOST);
}

function pickIdFromHref(href?: string): string | null {
  if (!href) return null;

  const clean = href.split("?")[0]?.split("#")[0];
  if (!clean) return null;

  const parts = clean.split("/");
  const last = parts[parts.length - 1];

  return last ? last : null;
}

async function deleteLocalByWebhookType(type: string, moyskladId: string): Promise<void> {
  if (type === "product") {
    await strapi.service("api::moysklad-product.moysklad-product").deleteOneFromWebhook(moyskladId);
    return;
  }

  if (type === "bundle") {
    await strapi.db.query("api::moysklad-product.moysklad-product").deleteMany({
      where: { moyskladId, type: "bundle" },
    });
    await strapi.service("api::moysklad-product.moysklad-product").recomputeCategoryCounts();
    strapi.log.info(`[moysklad-webhook] deleted bundle ${moyskladId}`);
    return;
  }

  if (type === "productfolder") {
    await strapi.db.query("api::moysklad-category.moysklad-category").deleteMany({
      where: { moyskladId },
    });
    await strapi.service("api::moysklad-product.moysklad-product").recomputeCategoryCounts();
    strapi.log.info(`[moysklad-webhook] deleted productfolder ${moyskladId}`);
    return;
  }

  if (type === "variant") {
    await strapi.db.query("api::moysklad-variant.moysklad-variant").deleteMany({
      where: { moyskladId },
    });
    strapi.log.info(`[moysklad-webhook] deleted variant ${moyskladId}`);
    return;
  }

  strapi.log.info(`[moysklad-webhook] delete skipped: type=${type}`);
}

export default () => ({
  async fetchByHref(href: string) {
    const token = process.env.MOYSKLAD_ACCESS_TOKEN;
    if (!token) throw new Error("MOYSKLAD_ACCESS_TOKEN is not set");

    const res = await fetch(href, { headers: getMoySkladHeaders(token) });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MoySklad API error ${res.status}: ${text}`);
    }

    return (await res.json()) as { meta?: MoySkladMeta } & Record<string, unknown>;
  },

  async processEvent(event: MoySkladWebhookEvent) {
    const href = event?.meta?.href;
    const type = event?.meta?.type;
    const action = event?.action ?? null;

    if (!href || !type) {
      strapi.log.warn("[moysklad-webhook] skipped: missing href/type");
      return;
    }

    if (!isSafeHref(href)) {
      strapi.log.warn(`[moysklad-webhook] blocked unsafe href: ${href}`);
      return;
    }

    if (action === "DELETE") {
      const moyskladId = pickIdFromHref(href);
      if (!moyskladId) {
        strapi.log.warn("[moysklad-webhook] delete skipped: no id in href");
        return;
      }

      await deleteLocalByWebhookType(type, moyskladId);
      return;
    }

    const entity = await this.fetchByHref(href);

    if (entity === null) {
      const moyskladId = pickIdFromHref(href);
      if (!moyskladId) {
        strapi.log.warn("[moysklad-webhook] entity missing and no id in href");
        return;
      }

      strapi.log.warn(
        `[moysklad-webhook] entity no longer exists, local record removed: type=${type} id=${moyskladId}`,
      );
      await deleteLocalByWebhookType(type, moyskladId);
      return;
    }

    if (type === "productfolder") {
      await strapi.service("api::moysklad-category.moysklad-category").syncOneFromWebhook(entity);
      await strapi.service("api::moysklad-product.moysklad-product").recomputeCategoryCounts();
      strapi.log.info(`[moysklad-webhook] ok: ${type} ${action ?? ""}`);
      return;
    }

    if (type === "product") {
      await strapi.service("api::moysklad-product.moysklad-product").syncOneFromWebhook(entity);
      strapi.log.info(`[moysklad-webhook] ok: ${type} ${action ?? ""}`);
      return;
    }

    if (type === "bundle") {
      await strapi.service("api::moysklad-product.moysklad-product").syncOneBundleFromWebhook(entity);
      strapi.log.info(`[moysklad-webhook] ok: ${type} ${action ?? ""}`);
      return;
    }

    if (type === "variant") {
      await strapi.service("api::moysklad-variant.moysklad-variant").syncOneFromWebhook(entity);
      strapi.log.info(`[moysklad-webhook] ok: ${type} ${action ?? ""}`);
      return;
    }

    strapi.log.info(`[moysklad-webhook] skipped: type=${type} action=${action ?? ""}`);
  },

  async processBatch(events: MoySkladWebhookEvent[]) {
    for (const event of events) {
      await this.processEvent(event);
    }
  },
});
