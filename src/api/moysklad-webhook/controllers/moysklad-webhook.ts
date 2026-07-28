// apps/strapi/src/api/moysklad-webhook/controllers/moysklad-webhook.ts
import { timingSafeEqual } from "crypto";
import type { Context } from "koa";
import {
  persistMoySkladWebhookBatch,
  scheduleMoySkladWebhookDrain,
  type MoySkladWebhookEvent,
} from "../../../utils/moysklad-mutation-queue";

type IncomingSecretSource = "header" | "query" | "missing";

const WEBHOOK_SECRET_HEADER = "x-webhook-secret";

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

  const querySecret = getStringQuery(ctx, "secret");

  if (querySecret) {
    return { value: querySecret, source: "query" };
  }

  return { value: null, source: "missing" };
}

function sanitizeWebhookEvents(raw: unknown[]): MoySkladWebhookEvent[] | null {
  const result: MoySkladWebhookEvent[] = [];

  for (const item of raw) {
    if (item === null || item === undefined) {
      return null;
    }
    if (typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const ev = item as Record<string, unknown>;
    const metaRaw = ev.meta;

    if (metaRaw === null || metaRaw === undefined) {
      return null;
    }
    if (typeof metaRaw !== "object" || Array.isArray(metaRaw)) {
      return null;
    }

    const meta = metaRaw as Record<string, unknown>;
    const href = meta.href;
    const type = meta.type;

    if (typeof href !== "string" || href.trim().length === 0) {
      return null;
    }
    if (typeof type !== "string" || type.trim().length === 0) {
      return null;
    }

    const action = ev.action;
    if (action !== undefined && typeof action !== "string") {
      return null;
    }

    result.push({
      action: typeof action === "string" ? action : undefined,
      meta: {
        href: href.trim(),
        type: type.trim(),
      },
    });
  }

  return result;
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

    const sanitizedEvents = sanitizeWebhookEvents(events);

    if (sanitizedEvents === null) {
      ctx.status = 400;
      ctx.body = { ok: false, error: "invalid_events" };
      return;
    }

    try {
      await persistMoySkladWebhookBatch(sanitizedEvents);
    } catch (error) {
      strapi.log.error("[moysklad-webhook] failed to persist batch", error as Error);

      ctx.status = 500;
      ctx.body = {
        ok: false,
        error: "webhook_queue_unavailable",
      };
      return;
    }

    ctx.status = 204;
    ctx.body = null;

    scheduleMoySkladWebhookDrain();
  },
};
