import type { Core } from "@strapi/strapi";

const config: Core.Config.Middlewares = [
  "strapi::logger",
  "strapi::errors",
  "strapi::security",

  {
    name: "strapi::cors",
    config: {
      origin: [
        "https://cocktaildesign.vercel.app",
        "https://new.cocktaildesign.ru",
        "https://cocktaildesign.ru",
        "https://www.cocktaildesign.ru",
      ],
      credentials: true,
      headers: "*",
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
