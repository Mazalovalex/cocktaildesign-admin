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

    // ─────────────────────────────────────────────────────────
    // Автосинк МойСклад → Strapi
    // ─────────────────────────────────────────────────────────

    const secret = process.env.MOYSKLAD_WEBHOOK_SECRET;
    const apiBase = process.env.STRAPI_SELF_URL ?? "http://localhost:1337";
    const tgToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgChatId = process.env.TELEGRAM_CHAT_ID;

    if (!secret) {
      strapi.log.warn("[moysklad-cron] MOYSKLAD_WEBHOOK_SECRET не задан — автосинк отключён");
      return;
    }

    // Отправка сообщения в Telegram
    async function sendTelegram(text: string): Promise<void> {
      if (!tgToken || !tgChatId) return;
      try {
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: tgChatId, text, parse_mode: "HTML" }),
        });
      } catch (err) {
        strapi.log.warn(`[moysklad-cron] Telegram недоступен: ${String(err)}`);
      }
    }

    // Один POST-запрос к нашему же API
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

    // Полный синк: категории → продукты → варианты
    async function runFullSync(): Promise<void> {
      const startedAt = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      strapi.log.info("[moysklad-cron] ▶ Запуск автосинка");

      try {
        strapi.log.info("[moysklad-cron] Шаг 1/3: категории");
        await callSync("categories");

        strapi.log.info("[moysklad-cron] Шаг 2/3: продукты");
        await callSync("products");

        strapi.log.info("[moysklad-cron] Шаг 3/3: варианты");
        await callSync("variants");

        strapi.log.info("[moysklad-cron] ✅ Автосинк завершён успешно");
        await sendTelegram(`✅ <b>Синк завершён</b>\n🕐 ${startedAt}\n\nКатегории → Продукты → Варианты обновлены`);
      } catch (err) {
        const msg = String(err);
        strapi.log.error(`[moysklad-cron] ❌ Ошибка автосинка: ${msg}`);
        await sendTelegram(`❌ <b>Ошибка синка</b>\n🕐 ${startedAt}\n\n${msg}`);
      }
    }

    // Каждые 2 часа с 8:00 до 22:00
    cron.schedule("0 8,10,12,14,16,18,20,22 * * *", runFullSync, {
      timezone: "Europe/Moscow",
    });

    // Ночной запуск в 3:00
    cron.schedule("0 3 * * *", runFullSync, {
      timezone: "Europe/Moscow",
    });

    strapi.log.info("[moysklad-cron] ✅ Расписание зарегистрировано (каждые 2ч с 8:00-22:00 + 3:00 ночи)");
  },
};