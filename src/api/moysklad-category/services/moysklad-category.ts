// backend/src/api/moysklad-category/services/moysklad-category.ts
import { factories } from "@strapi/strapi";

type MoySkladMeta = { href?: string };

type MoySkladWebhookCategory = {
  id?: string;
  name?: string;
  pathName?: string;

  meta?: MoySkladMeta;

  // parent в MoySklad productfolder приходит как productFolder.meta.href
  productFolder?: { meta?: MoySkladMeta };
};

function pickIdFromHref(href?: string): string | null {
  if (!href) return null;

  const clean = href.split("?")[0]?.split("#")[0];
  if (!clean) return null;

  const parts = clean.split("/");
  const last = parts[parts.length - 1];

  return last ? last : null;
}

function makeStableSlug(moyskladId: string): string {
  return `ms-${moyskladId.slice(0, 8)}`;
}

/**
 * Core-service для content-type "moysklad-category".
 * Здесь живут методы, которые вызываются через:
 *   strapi.service("api::moysklad-category.moysklad-category").<method>()
 *
 * Полный sync дерева категорий остаётся в services/sync.ts
 */
export default factories.createCoreService("api::moysklad-category.moysklad-category", ({ strapi }) => ({
  /**
   * Webhook: upsert одной категории по payload из fetchByHref(href)
   */
  async syncOneFromWebhook(entity: MoySkladWebhookCategory) {
    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    const moyskladId = entity.id ?? pickIdFromHref(entity.meta?.href);
    const href = entity.meta?.href ?? null;

    if (!moyskladId || !href) {
      strapi.log.warn("[moysklad-category] webhook skipped: no moyskladId/href");
      return;
    }

    const existing = await categoryQuery.findOne({
      where: { moyskladId },
      select: ["id", "slug"],
    });

    const nowIso = new Date().toISOString();

    const payload: Record<string, unknown> = {
      name: entity.name ?? "",
      moyskladId,
      href,
      pathName: entity.pathName ?? null,

      // slug стабилен, не ломается при переименовании
      slug: existing?.slug ?? makeStableSlug(moyskladId),

      publishedAt: nowIso,
    };

    // parent (если уже есть в БД — проставим; если нет — не трогаем)
    const parentMsId = pickIdFromHref(entity.productFolder?.meta?.href);
    if (parentMsId) {
      const parent = await categoryQuery.findOne({
        where: { moyskladId: parentMsId },
        select: ["id"],
      });

      if (parent) payload.parent = parent.id;
    }

    if (existing) {
      await categoryQuery.update({ where: { id: existing.id }, data: payload });
      strapi.log.info(`[moysklad-category] updated: ${moyskladId}`);
      return;
    }

    await categoryQuery.create({ data: payload });
    strapi.log.info(`[moysklad-category] created: ${moyskladId}`);
  },

  /**
   * Webhook: delete по moyskladId (без fetchByHref)
   */
  async deleteOneFromWebhook(moyskladId: string) {
    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    await categoryQuery.deleteMany({ where: { moyskladId } });
    strapi.log.info(`[moysklad-category] deleted: ${moyskladId}`);
  },
}));
