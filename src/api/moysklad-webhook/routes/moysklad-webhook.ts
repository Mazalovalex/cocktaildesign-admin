import controller from "../controllers/moysklad-webhook";

export default {
  routes: [
    {
      method: "POST",
      path: "/moysklad/webhook",
      handler: controller.handle,
      config: {
        auth: false,
      },
    },
  ],
};
