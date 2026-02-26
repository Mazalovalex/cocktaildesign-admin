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
    try {
      const result = await syncAllVariants();

      ctx.body = {
        ok: true,
        ...result,
      };
    } catch (err) {
      // Приводим к удобному типу для логирования
      const e = err as {
        message?: string;
        stack?: string;
        cause?: unknown;
      };

      // === ВАЖНО: подробные логи ===
      strapi.log.error("[moysklad] variants sync failed");

      if (e?.message) {
        strapi.log.error(`[moysklad] message: ${e.message}`);
      } else {
        strapi.log.error(`[moysklad] message: ${String(err)}`);
      }

      // cause часто содержит реальную причину fetch failed:
      // ENOTFOUND, ECONNREFUSED, CERT_*, UND_ERR_CONNECT_TIMEOUT и т.д.
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

      // Ответ клиенту
      ctx.status = 500;
      ctx.body = {
        ok: false,
        error: e?.message ?? String(err),
      };
    }
  },
};
