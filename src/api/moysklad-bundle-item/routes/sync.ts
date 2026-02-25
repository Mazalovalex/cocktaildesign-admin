// backend/src/api/moysklad-bundle-item/routes/sync.ts

import controller from "../controllers/sync";

export default {
  routes: [
    {
      method: "POST",
      path: "/moysklad/sync/bundle-items",
      handler: controller.syncOne,
      config: {
        auth: false,
      },
    },
  ],
};
