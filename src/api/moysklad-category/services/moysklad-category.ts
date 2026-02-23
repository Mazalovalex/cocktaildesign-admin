// src/api/moysklad-category/services/moysklad-category.ts
import { factories } from "@strapi/strapi";

/**
 * Core-service для content-type "moysklad-category".
 * Нужен для стандартных REST методов (find/findOne/...).
 * Sync-логика должна быть отдельно (НЕ здесь).
 */
export default factories.createCoreService("api::moysklad-category.moysklad-category");
