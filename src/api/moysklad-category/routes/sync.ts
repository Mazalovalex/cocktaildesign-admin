// src/api/moysklad-category/routes/sync.ts

export default {
  routes: [
    {
      method: "POST",
      path: "/moysklad/sync/categories",
      handler: "moysklad-category.syncAll",
      config: {
        auth: false,
      },
    },
  ],
};
