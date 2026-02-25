// backend/src/api/moysklad-bundle-item/controllers/sync.ts

import type { Context } from "koa";
import syncServiceFactory from "../services/sync";

export default {
  /**
   * POST /api/moysklad/sync/bundle-items
   * body: { bundleMsId: string }
   */
  async syncOne(ctx: Context) {
    const secret = ctx.request.headers["x-webhook-secret"];

    if (secret !== process.env.MOYSKLAD_WEBHOOK_SECRET) {
      ctx.status = 401;
      ctx.body = { ok: false };
      return;
    }

    const bundleMsId = ctx.request.body?.bundleMsId;

    if (!bundleMsId || typeof bundleMsId !== "string") {
      ctx.status = 400;
      ctx.body = { ok: false, error: "bundleMsId is required" };
      return;
    }

    try {
      const syncService = syncServiceFactory();

      const result = await syncService.syncBundleItemsForBundle(bundleMsId);

      ctx.body = result;
    } catch (err) {
      strapi.log.error(err);

      ctx.status = 500;
      ctx.body = { ok: false, error: "sync_failed" };
    }
  },
};
