// src/api/moysklad-product/controllers/moysklad-product.ts
import { factories } from "@strapi/strapi";
import { getMoySkladSyncState } from "../../../utils/moysklad-sync-state";

function isSyncLockError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.startsWith('Sync lock is already acquired by "');
}

function assertWebhookSecret(ctx: any): boolean {
  const secret = ctx.request.headers["x-webhook-secret"];
  return secret === process.env.MOYSKLAD_WEBHOOK_SECRET;
}

export default factories.createCoreController("api::moysklad-product.moysklad-product", ({ strapi }) => ({
  /**
   * GET /api/moysklad/sync/status
   * Публичный статус синка (без секретов)
   */
  async syncStatus(ctx) {
    const state = await getMoySkladSyncState();
    ctx.body = { ok: true, state };
  },

  async syncAll(ctx) {
    if (!assertWebhookSecret(ctx)) {
      ctx.status = 401;
      ctx.body = { ok: false };
      return;
    }

    try {
      const result = await strapi.service("api::moysklad-product.moysklad-product").syncAll();
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
}));
