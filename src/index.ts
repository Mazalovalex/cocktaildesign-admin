// backend/src/index.ts
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
  },
};
