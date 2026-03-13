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
    // Общие переменные
    // ─────────────────────────────────────────────────────────

    const secret = process.env.MOYSKLAD_WEBHOOK_SECRET;
    const tgToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgChatId = process.env.TELEGRAM_CHAT_ID;
    const apiBase = process.env.STRAPI_SELF_URL ?? "http://localhost:1337";
    const apiExternal = "https://api.cocktaildesign.ru";

    if (!secret) {
      strapi.log.warn("[moysklad-cron] MOYSKLAD_WEBHOOK_SECRET не задан — автосинк отключён");
      return;
    }

    // ─────────────────────────────────────────────────────────
    // Telegram
    // ─────────────────────────────────────────────────────────

    async function sendTelegram(text: string): Promise<void> {
      if (!tgToken || !tgChatId) return;
      try {
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: tgChatId, text, parse_mode: "HTML" }),
        });
      } catch (err) {
        strapi.log.warn(`[telegram] недоступен: ${String(err)}`);
      }
    }

    // ─────────────────────────────────────────────────────────
    // Мониторинг endpoint'ов (каждые 5 минут)
    // Алерт только при смене статуса — упал / восстановился
    // ─────────────────────────────────────────────────────────

    const MONITORS = [
      { name: "Sync Status", url: `${apiExternal}/api/moysklad/sync/status` },
      { name: "Категории", url: `${apiExternal}/api/catalog/categories-flat` },
      { name: "Товары", url: `${apiExternal}/api/catalog/random-products?count=1` },
      { name: "Скидки", url: `${apiExternal}/api/catalog/products-discounted?limit=1` },
      { name: "Поиск", url: `${apiExternal}/api/catalog/search?q=шейкер` },
    ];

    const downState = new Map<string, boolean>(MONITORS.map((m) => [m.name, false]));

    async function checkEndpoint(name: string, url: string): Promise<"ok" | "down"> {
      try {
        const res = await fetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok || res.status === 302) {
          if (downState.get(name)) {
            downState.set(name, false);
            const time = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
            strapi.log.info(`[monitor] ✅ ${name} восстановился`);
            await sendTelegram(`✅ <b>${name} восстановился</b>\n🕐 ${time}`);
          }
          return "ok";
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (!downState.get(name)) {
          downState.set(name, true);
          const time = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
          strapi.log.error(`[monitor] ❌ ${name} недоступен: ${String(err)}`);
          await sendTelegram(`🚨 <b>${name} недоступен!</b>\n🕐 ${time}\n<code>${url}</code>\n${String(err)}`);
        }
        return "down";
      }
    }

    async function runHealthCheck(): Promise<void> {
      await Promise.all(MONITORS.map((m) => checkEndpoint(m.name, m.url)));
    }

    cron.schedule("*/5 * * * *", runHealthCheck, { timezone: "Europe/Moscow" });
    strapi.log.info(`[monitor] ✅ Мониторинг запущен (каждые 5 мин, ${MONITORS.length} endpoint'ов)`);

    // ─────────────────────────────────────────────────────────
    // Автосинк + отчёт (каждые 2 часа круглосуточно)
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

    async function getDbStats(): Promise<{ categories: number; products: number; variants: number; bundles: number }> {
      const [categories, products, variants, bundles] = await Promise.all([
        strapi.db.query("api::moysklad-category.moysklad-category").count({}),
        strapi.db.query("api::moysklad-product.moysklad-product").count({ where: { type: "product" } }),
        strapi.db.query("api::moysklad-variant.moysklad-variant").count({}),
        strapi.db.query("api::moysklad-product.moysklad-product").count({ where: { type: "bundle" } }),
      ]);
      return { categories, products, variants, bundles };
    }

    async function runFullSync(): Promise<void> {
      const startedAt = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      strapi.log.info("[moysklad-cron] ▶ Запуск автосинка");

      let syncOk = true;
      let syncError = "";

      try {
        strapi.log.info("[moysklad-cron] Шаг 1/3: категории");
        await callSync("categories");

        strapi.log.info("[moysklad-cron] Шаг 2/3: продукты");
        await callSync("products");

        strapi.log.info("[moysklad-cron] Шаг 3/3: варианты");
        await callSync("variants");

        strapi.log.info("[moysklad-cron] ✅ Автосинк завершён");
      } catch (err) {
        syncOk = false;
        syncError = String(err);
        strapi.log.error(`[moysklad-cron] ❌ Ошибка: ${syncError}`);
      }

      // Статистика базы
      let stats = { categories: 0, products: 0, variants: 0, bundles: 0 };
      try {
        stats = await getDbStats();
      } catch (err) {
        strapi.log.error(`[monitor] ошибка счётчиков БД: ${String(err)}`);
      }

      // Статус endpoint'ов
      const endpointResults = await Promise.all(
        MONITORS.map(async (m) => {
          const status = await checkEndpoint(m.name, m.url);
          return `• ${m.name} — ${status === "ok" ? "✅" : "❌"}`;
        }),
      );

      // Формируем отчёт
      const syncStatus = syncOk ? "✅ Успешно" : `❌ Ошибка\n${syncError}`;

      const report = [
        `📊 <b>Отчёт CocktailDesign</b>`,
        `🕐 ${startedAt}`,
        ``,
        `🔄 <b>Синк:</b> ${syncStatus}`,
        ``,
        `📦 <b>База данных:</b>`,
        `• Категории: ${stats.categories}`,
        `• Товары: ${stats.products}`,
        `• Варианты: ${stats.variants}`,
        `• Комплекты: ${stats.bundles}`,
        ``,
        `🔗 <b>Endpoints:</b>`,
        ...endpointResults,
      ].join("\n");

      await sendTelegram(report);
    }

    // Каждые 2 часа круглосуточно
    cron.schedule("0 0,2,4,6,8,10,12,14,16,18,20,22 * * *", runFullSync, {
      timezone: "Europe/Moscow",
    });

    strapi.log.info("[moysklad-cron] ✅ Расписание зарегистрировано (каждые 2ч круглосуточно)");
  },
};
