// backend/src/api/moysklad-category/controllers/moysklad-category.ts
import { factories } from "@strapi/strapi";
import syncServiceFactory from "../services/sync";

function isSyncLockError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.startsWith('Sync lock is already acquired by "');
}

function toSafeCount(value: unknown): number {
  // Приводим счётчик к корректному числу:
  // - null/undefined/NaN/отрицательные -> 0
  if (typeof value !== "number") return 0;
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return value;
}

function toSafeLimit(value: unknown, fallback = 50): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100); // защита от случайных "limit=100000"
}

function toSafeOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export default factories.createCoreController("api::moysklad-category.moysklad-category", ({ strapi }) => ({
  /**
   * POST /api/moysklad/sync/categories
   */
  async syncAll(ctx) {
    const secret = ctx.request.headers["x-webhook-secret"];

    if (secret !== process.env.MOYSKLAD_WEBHOOK_SECRET) {
      ctx.status = 401;
      ctx.body = { ok: false };
      return;
    }

    try {
      // ✅ ВАЖНО: используем правильный sync с фильтрацией поддерева от ROOT_NAME
      const syncService = syncServiceFactory();
      const result = await syncService.syncAll();

      ctx.body = result;
    } catch (err) {
      if (isSyncLockError(err)) {
        ctx.status = 409;
        ctx.body = { ok: false, error: "sync_already_running" };
        return;
      }

      ctx.status = 500;
      ctx.body = { ok: false, error: "sync_failed" };
      strapi.log.error(err);
    }
  },

  /**
   * GET /api/catalog/categories-flat
   *
   * Плоский список всех витринных категорий для построения дерева на фронте.
   * Отдаём:
   * - id, slug, name
   * - productsCount (total, уже пересчитан sync/products)
   * - parentId (для сборки дерева любой глубины)
   *
   * ВАЖНО:
   * - Никаких children populate: дерево строится на фронте/в API-слое фронта.
   * - Мы считаем, что таблица категорий уже "очищена" sync/categories (в БД только витрина).
   */
  async categoriesFlat(ctx) {
    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    // Берём все категории.
    // parent нужен только для parent.id
    const rows = await categoryQuery.findMany({
      select: ["id", "name", "slug", "productsCount"],
      populate: {
        parent: { select: ["id"] },
      },
      limit: 100000,
    });

    // Нормализуем ответ в плоский массив.
    // id и parentId отдаём строками, чтобы на фронте не смешивать number/string.
    ctx.body = rows.map((c: any) => ({
      id: String(c.id),
      slug: typeof c.slug === "string" ? c.slug : "",
      name: typeof c.name === "string" ? c.name : "",
      productsCount: toSafeCount(c.productsCount),
      parentId: c.parent?.id ? String(c.parent.id) : null,
    }));
  },

  /**
   * GET /api/catalog/products
   *
   * Заглушка, чтобы Strapi успешно стартовал.
   * На следующем шаге добавим реальную логику:
   * - найти категорию по slug
   * - собрать всех потомков (рекурсивно)
   * - выбрать товары по category IN (...)
   * - total + limit/offset + hasMore
   */
  async products(ctx) {
    const categorySlug = String(ctx.query.categorySlug ?? "").trim();
    const limit = toSafeLimit(ctx.query.limit, 50);
    const offset = toSafeOffset(ctx.query.offset);

    // Сейчас отдаём валидный контракт (чтобы фронт уже мог интегрироваться)
    // и чтобы мы проверили Postman/роутинг без падения Strapi.
    ctx.body = {
      items: [],
      total: 0,
      limit,
      offset,
      hasMore: false,

      // Временно: для быстрой диагностики в Postman (на следующем шаге уберём)
      debug: { categorySlug },
    };
  },
}));
