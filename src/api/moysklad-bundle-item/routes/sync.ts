// backend/src/api/moysklad-bundle-item/routes/sync.ts

export default {
  routes: [
    {
      method: "POST",
      path: "/moysklad/sync/bundle-items",
      handler: "moysklad-bundle-item.syncOne",
      config: {
        auth: false,
      },
    },
  ],
};
