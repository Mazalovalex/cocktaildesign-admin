import type { Core } from "@strapi/strapi";

const config: Core.Config.Middlewares = [
  "strapi::logger",
  "strapi::errors",
  "strapi::security",

  // ✅ CORS: разрешаем фронту ходить в API
  {
    name: "strapi::cors",
    config: {
      enabled: true,

      /**
       * Разрешённые origin (ВАЖНО: указываем именно ORIGIN фронта).
       * - Сейчас Vercel
       * - Скоро поддомен new
       * - Потом основной домен
       */
      origin: ["https://cocktaildesign.vercel.app", "https://new.cocktaildesign.ru", "https://cocktaildesign.ru"],

      /**
       * Если на фронте будут запросы с куками (например, авторизация по cookie),
       * ставим credentials: true.
       * Если куки не используешь — можно оставить true, это не ломает работу.
       */
      credentials: true,

      // Разрешаем стандартные заголовки
      headers: ["Content-Type", "Authorization", "Origin", "Accept"],

      // Какие методы разрешаем
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    },
  },

  "strapi::poweredBy",
  "strapi::query",

  {
    name: "strapi::body",
    config: {
      formLimit: "50mb",
      jsonLimit: "50mb",
      textLimit: "50mb",
      formidable: {
        maxFileSize: 50 * 1024 * 1024,
      },
    },
  },

  "strapi::session",
  "strapi::favicon",
  "strapi::public",
];

export default config;
