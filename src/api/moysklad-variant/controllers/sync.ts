// backend/src/api/moysklad-variant/controllers/sync.ts

import { syncAllVariants } from "../services/sync";

export default {
  /**
   * POST /api/moysklad/sync/variants
   *
   * Назначение:
   * - запускает синхронизацию ВСЕХ variant из MoySklad → Strapi
   *
   * Предусловие:
   * - /api/moysklad/sync/products уже был выполнен,
   *   иначе variants не смогут привязаться к product
   *
   * Ответ:
   * {
   *   ok: true,
   *   upserted: number,
   *   skippedNoProduct: number
   * }
   *
   * Ошибка:
   * {
   *   ok: false,
   *   error: string
   * }
   */
  async syncVariants(ctx) {
    // ✅ Проверяем секрет — как и в остальных sync endpoints
    const secret = ctx.request.headers["x-webhook-secret"];
    if (secret !== process.env.MOYSKLAD_WEBHOOK_SECRET) {
      ctx.status = 401;
      ctx.body = { ok: false };
      return;
    }

    try {
      const result = await syncAllVariants();

      ctx.body = {
        ok: true,
        ...result,
      };
    } catch (err) {
      const e = err as {
        message?: string;
        stack?: string;
        cause?: unknown;
      };

      strapi.log.error("[moysklad] variants sync failed");

      if (e?.message) {
        strapi.log.error(`[moysklad] message: ${e.message}`);
      } else {
        strapi.log.error(`[moysklad] message: ${String(err)}`);
      }

      if (e?.cause) {
        strapi.log.error(`[moysklad] cause: ${String(e.cause)}`);

        try {
          strapi.log.error(`[moysklad] cause.json: ${JSON.stringify(e.cause, null, 2)}`);
        } catch {
          strapi.log.error("[moysklad] cause.json: (failed to stringify)");
        }
      }

      if (e?.stack) {
        strapi.log.error(`[moysklad] stack:\n${e.stack}`);
      }

      ctx.status = 500;
      ctx.body = {
        ok: false,
        error: e?.message ?? String(err),
      };
    }
  },
};
