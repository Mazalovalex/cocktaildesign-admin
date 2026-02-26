export default {
  routes: [
    {
      method: "POST",
      path: "/moysklad/sync/variants",
      handler: "sync.syncVariants",
      config: {
        auth: false, // как у остальных sync-эндпоинтов (если у тебя иначе — потом выровняем)
      },
    },
  ],
};
