// backend/src/admin/vite.config.ts
import { mergeConfig, type UserConfig } from "vite";

/**
 * Strapi ожидает, что vite.config экспортирует ФУНКЦИЮ.
 * Она получает базовый конфиг от Strapi и возвращает расширенный конфиг.
 */
export default function configureVite(baseConfig: UserConfig): UserConfig {
  return mergeConfig(baseConfig, {
    server: {
      /**
       * ✅ Разрешаем внешние host (ngrok) в DEV.
       * Иначе Vite режет запросы: "host is not allowed".
       */
      allowedHosts: true,
    },
  });
}
