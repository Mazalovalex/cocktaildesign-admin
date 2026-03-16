export default {
  routes: [
    {
      method: "POST",
      path: "/promo-code/apply",
      handler: "promo-code.apply",
      config: {
        // Роут публичный — авторизация не нужна
        auth: false,
      },
    },
  ],
};
