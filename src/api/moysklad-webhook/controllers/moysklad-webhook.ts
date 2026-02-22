import type { Context } from "koa";

type WebhookEvent = {
  action?: "CREATE" | "UPDATE" | "DELETE" | "PROCESSED" | string;
  meta?: { href?: string; type?: string };
};

function getStringQuery(ctx: Context, key: string): string | null {
  const v = (ctx.query as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

function pickIdFromHref(href?: string): string | null {
  if (!href) return null;
  const parts = href.split("/");
  return parts[parts.length - 1] ?? null;
}

async function processEvent(event: WebhookEvent) {
  const href = event?.meta?.href;
  const type = event?.meta?.type;
  const action = event?.action ?? null;

  if (!href || !type) {
    strapi.log.warn("[moysklad-webhook] skipped: missing href/type");
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

    if (type === "productfolder") {
      await strapi.db.query("api::moysklad-category.moysklad-category").deleteMany({
        where: { moyskladId },
      });
      strapi.log.info(`[moysklad-webhook] deleted productfolder ${moyskladId}`);
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

  strapi.log.info(`[moysklad-webhook] skipped: type=${type} action=${action ?? ""}`);
}

export default {
  async handle(ctx: Context) {
    const secret = process.env.MOYSKLAD_WEBHOOK_SECRET;
    if (!secret) {
      ctx.status = 500;
      ctx.body = { ok: false, error: "MOYSKLAD_WEBHOOK_SECRET is not set" };
      return;
    }

    const incomingSecret = getStringQuery(ctx, "secret");
    if (incomingSecret !== secret) {
      ctx.status = 401;
      ctx.body = { ok: false };
      return;
    }

    const events = (ctx.request.body as any)?.events as WebhookEvent[] | undefined;
    if (!events?.length) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "Missing events[]" };
      return;
    }

    // ✅ отвечаем быстро, обработка асинхронно
    ctx.status = 204;
    ctx.body = null;

    void (async () => {
      try {
        for (const e of events) {
          await processEvent(e);
        }
      } catch (err) {
        strapi.log.error("[moysklad-webhook] processing failed", err as Error);
      }
    })();
  },
};
