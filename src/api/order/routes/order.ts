export default {
  routes: [
    {
      method: "POST",
      path: "/orders",
      handler: "order.create",
      config: {
        // Открытый эндпоинт — без авторизации
        auth: false,
      },
    },
  ],
};
