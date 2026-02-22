// src/api/moysklad-product/routes/sync.ts
export default {
  routes: [
    {
      method: "GET",
      path: "/moysklad/sync/status",
      handler: "moysklad-product.syncStatus",
      config: { auth: false },
    },
    {
      method: "POST",
      path: "/moysklad/sync/products",
      handler: "moysklad-product.syncAll",
      config: { auth: false },
    },
  ],
};
