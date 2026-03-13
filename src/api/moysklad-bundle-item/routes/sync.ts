// backend/src/api/moysklad-bundle-item/routes/sync.ts

import syncController from "../controllers/sync";

export default {
  routes: [
    {
      method: "POST",
      path: "/moysklad/sync/bundle-items",
      handler: syncController.syncOne,
      config: {
        auth: false,
      },
    },
  ],
};
