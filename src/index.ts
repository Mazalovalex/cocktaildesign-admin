import type { Core } from "@strapi/strapi";
import cron from "node-cron";

let moySkladCronTask: ReturnType<typeof cron.schedule> | null = null;

export default {
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Одноразовая чистка старого поля stockUpdated из store
    if (process.env.MOYSKLAD_CLEAN_SYNC_STATE === "true") {
      const storeConfig = {
        type: "plugin",
        name: "moysklad",
        key: "syncState",
      } as const;

      const stored = (await strapi.store(storeConfig).get()) as {
        lastTotals?: Record<string, unknown>;
      } | null;

      if (stored?.lastTotals && typeof stored.lastTotals === "object" && "stockUpdated" in stored.lastTotals) {
        delete stored.lastTotals.stockUpdated;

        await strapi.store(storeConfig).set({
          value: stored,
        });

        strapi.log.info("[moysklad] syncState cleaned: removed lastTotals.stockUpdated");
      } else {
        strapi.log.info("[moysklad] syncState clean skipped: stockUpdated not found");
      }
    }

    // Локально cron не запускаем.
    // Синхронизация по расписанию должна работать только на production.
    if (process.env.NODE_ENV !== "production") {
      strapi.log.info("[moysklad-cron] Development-режим — автосинк отключён");

      return;
    }

    const secret = process.env.MOYSKLAD_WEBHOOK_SECRET;
    const apiBase = process.env.STRAPI_SELF_URL ?? "http://127.0.0.1:1337";

    if (!secret) {
      strapi.log.warn("[moysklad-cron] MOYSKLAD_WEBHOOK_SECRET не задан — автосинк отключён");

      return;
    }

    async function callSync(path: string): Promise<void> {
      const url = `${apiBase}/api/moysklad/sync/${path}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-webhook-secret": secret,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const responseText = await response.text();

        throw new Error(`${path} вернул ${response.status}: ${responseText}`);
      }
    }

    async function runFullSync(): Promise<void> {
      strapi.log.info("[moysklad-cron] ▶ Запуск автосинка");

      try {
        strapi.log.info("[moysklad-cron] Шаг 1/3: категории");
        await callSync("categories");

        strapi.log.info("[moysklad-cron] Шаг 2/3: продукты");
        await callSync("products");

        strapi.log.info("[moysklad-cron] Шаг 3/3: варианты");
        await callSync("variants");

        strapi.log.info("[moysklad-cron] ✅ Автосинк завершён");
      } catch (error) {
        strapi.log.error(`[moysklad-cron] ❌ Ошибка: ${String(error)}`);
      }
    }

    // Защита от повторной регистрации в одном процессе
    if (moySkladCronTask) {
      moySkladCronTask.stop();
      moySkladCronTask.destroy();
    }

    // Каждый час в 0 минут по московскому времени
    moySkladCronTask = cron.schedule("0 * * * *", runFullSync, {
      timezone: "Europe/Moscow",
    });

    strapi.log.info("[moysklad-cron] ✅ Расписание зарегистрировано (каждый час)");
  },

  async destroy({ strapi }: { strapi: Core.Strapi }) {
    if (!moySkladCronTask) {
      return;
    }

    moySkladCronTask.stop();
    moySkladCronTask.destroy();
    moySkladCronTask = null;

    strapi.log.info("[moysklad-cron] Расписание остановлено");
  },
};
