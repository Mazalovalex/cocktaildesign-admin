import type { Core } from "@strapi/strapi";

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env("HOST", "0.0.0.0"),
  port: env.int("PORT", 1337),

  app: {
    keys: env.array("APP_KEYS"),
  },

  /**
   * Критично для ngrok / внешних webhook
   */
  proxy: true,

  /**
   * Разрешаем все внешние host (включая ngrok)
   */
  url: env("PUBLIC_URL", ""),
});

export default config;
