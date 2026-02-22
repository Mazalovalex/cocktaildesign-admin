import type { Core } from "@strapi/strapi";

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  upload: {
    config: {
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    },
  },
});

export default config;
