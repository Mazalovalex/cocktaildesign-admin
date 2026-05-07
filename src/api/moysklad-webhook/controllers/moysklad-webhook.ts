// apps/strapi/src/api/moysklad-webhook/controllers/moysklad-webhook.ts
import { timingSafeEqual } from "crypto";
import type { Context } from "koa";

type WebhookEvent = {
  action?: "CREATE" | "UPDATE" | "DELETE" | "PROCESSED" | string;
  meta?: { href?: string; type?: string };
};

type IncomingSecretSource = "header" | "query" | "missing";

const WEBHOOK_SECRET_HEADER = "x-webhook-secret";

// ✅ Только официальный домен МойСклад — защита от SSRF
const MOYSKLAD_API_HOST = "https://api.moysklad.ru/";

function isSafeHref(href: string): boolean {
  return href.startsWith(MOYSKLAD_API_HOST);
}

function getStringQuery(ctx: Context, key: string): string | null {
  const v = (ctx.query as Record<string, unknown>)[key];
  return typeof v === "string" ? v.trim() : null;
}

function getStringHeader(ctx: Context, key: string): string | null {
  const value = ctx.request.headers[key.toLowerCase()];

  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0].trim() : null;
  }

  return typeof value === "string" ? value.trim() : null;
}

function safeCompareSecret(incomingSecret: string, expectedSecret: string): boolean {
  const incomingBuffer = Buffer.from(incomingSecret);
  const expectedBuffer = Buffer.from(expectedSecret);

  if (incomingBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(incomingBuffer, expectedBuffer);
}

function getIncomingSecret(ctx: Context): {
  value: string | null;
  source: IncomingSecretSource;
} {
  const headerSecret = getStringHeader(ctx, WEBHOOK_SECRET_HEADER);

  if (headerSecret) {
    return { value: headerSecret, source: "header" };
  }

  // Временная обратная совместимость.
  // Старый вариант небезопасен, потому что query может попасть в access logs.
  const querySecret = getStringQuery(ctx, "secret");

  if (querySecret) {
    return { value: querySecret, source: "query" };
  }

  return { value: null, source: "missing" };
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

async function processEvent(event: WebhookEvent) {
  const href = event?.meta?.href;
  const type = event?.meta?.type;
  const action = event?.action ?? null;

  if (!href || !type) {
    strapi.log.warn("[moysklad-webhook] skipped: missing href/type");
    return;
  }

  // ✅ Проверяем href перед любым fetch — защита от SSRF
  if (!isSafeHref(href)) {
    strapi.log.warn(`[moysklad-webhook] blocked unsafe href: ${href}`);
    return;
  }

  // ✅ DELETE обрабатываем без fetchByHref (в MoySklad уже может не существовать)
  if (action === "DELETE") {
    const moyskladId = pickIdFromHref(href);
    if (!moyskladId) {
      strapi.log.warn("[moysklad-webhook] delete skipped: no id in href");
      return;
    }

    if (type === "product") {
      await strapi.db.query("api::moysklad-product.moysklad-product").deleteMany({
        where: { moyskladId },
      });
      strapi.log.info(`[moysklad-webhook] deleted product ${moyskladId}`);
      return;
    }

    // ✅ bundle удаляем из той же таблицы, что и product (moysklad-product)
    // ВАЖНО: удаляем ТОЛЬКО type="bundle", чтобы случайно не снести product.
    if (type === "bundle") {
      await strapi.db.query("api::moysklad-product.moysklad-product").deleteMany({
        where: { moyskladId, type: "bundle" },
      });
      strapi.log.info(`[moysklad-webhook] deleted bundle ${moyskladId}`);
      return;
    }

    if (type === "productfolder") {
      await strapi.db.query("api::moysklad-category.moysklad-category").deleteMany({
        where: { moyskladId },
      });
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
    return;
  }

  // ✅ CREATE/UPDATE: берём свежую сущность из MoySklad
  const entity = await strapi.service("api::moysklad-webhook.moysklad-webhook").fetchByHref(href);

  if (type === "productfolder") {
    await strapi.service("api::moysklad-category.moysklad-category").syncOneFromWebhook(entity);
    strapi.log.info(`[moysklad-webhook] ok: ${type} ${action ?? ""}`);
    return;
  }

  if (type === "product") {
    await strapi.service("api::moysklad-product.moysklad-product").syncOneFromWebhook(entity);
    strapi.log.info(`[moysklad-webhook] ok: ${type} ${action ?? ""}`);
    return;
  }

  // ✅ bundle синкаем через moysklad-product (bundle-метод)
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
}

export default {
  async handle(ctx: Context) {
    const secret = process.env.MOYSKLAD_WEBHOOK_SECRET;

    if (!secret) {
      strapi.log.error("[moysklad-webhook] MOYSKLAD_WEBHOOK_SECRET is not set");
      ctx.status = 500;
      ctx.body = { ok: false, error: "webhook_not_configured" };
      return;
    }

    const incomingSecret = getIncomingSecret(ctx);

    if (!incomingSecret.value || !safeCompareSecret(incomingSecret.value, secret)) {
      ctx.status = 401;
      ctx.body = { ok: false };
      return;
    }

    if (incomingSecret.source === "query") {
      strapi.log.warn("[moysklad-webhook] deprecated query secret used; use x-webhook-secret header");
    }

    const body = ctx.request.body as unknown;
    const events = (body as { events?: unknown })?.events;

    if (!Array.isArray(events) || events.length === 0) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "Missing events[]" };
      return;
    }

    // ✅ отвечаем быстро, обработка асинхронно
    ctx.status = 204;
    ctx.body = null;

    void (async () => {
      for (const e of events as WebhookEvent[]) {
        try {
          await processEvent(e);
        } catch (err) {
          strapi.log.error("[moysklad-webhook] processing failed (event)", err as Error);
        }
      }
    })();
  },
};
