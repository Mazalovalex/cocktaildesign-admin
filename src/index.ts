// backend/src/index.ts
import cron from "node-cron";

export default {
  async bootstrap() {
    // ✅ Одноразовая чистка старого поля stockUpdated из store
    if (process.env.MOYSKLAD_CLEAN_SYNC_STATE === "true") {
      const STORE = { type: "plugin", name: "moysklad", key: "syncState" } as const;
      const stored = (await strapi.store(STORE).get()) as any;
      if (stored?.lastTotals && typeof stored.lastTotals === "object" && "stockUpdated" in stored.lastTotals) {
        delete stored.lastTotals.stockUpdated;
        await strapi.store(STORE).set({ value: stored });
        strapi.log.info("[moysklad] syncState cleaned: removed lastTotals.stockUpdated");
      } else {
        strapi.log.info("[moysklad] syncState clean skipped: stockUpdated not found");
      }
    }

    const secret = process.env.MOYSKLAD_WEBHOOK_SECRET;
    const apiBase = process.env.STRAPI_SELF_URL ?? "http://localhost:1338";

    if (!secret) {
      strapi.log.warn("[moysklad-cron] MOYSKLAD_WEBHOOK_SECRET не задан — автосинк отключён");
      return;
    }

    // ─────────────────────────────────────────────────────────
    // Автосинк
    // ─────────────────────────────────────────────────────────
    async function callSync(path: string): Promise<void> {
      const url = `${apiBase}/api/moysklad/sync/${path}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "x-webhook-secret": secret!,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${path} вернул ${res.status}: ${text}`);
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
      } catch (err) {
        strapi.log.error(`[moysklad-cron] ❌ Ошибка: ${String(err)}`);
      }
    }

    // Каждый час в 0 минут
    cron.schedule("0 * * * *", runFullSync, { timezone: "Europe/Moscow" });
    strapi.log.info("[moysklad-cron] ✅ Расписание зарегистрировано (каждый час)");
  },
};
