import type { Core } from "@strapi/strapi";

const config: Core.Config.Middlewares = [
  "strapi::logger",
  "strapi::errors",
  "strapi::security",
  "strapi::cors",
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
