import { factories } from "@strapi/strapi";

type MoySkladMeta = { href: string; type: string; mediaType?: string };

type MoySkladProductFolder = {
  id: string;
  name: string;
  pathName?: string;
  meta: MoySkladMeta;
  productFolder?: { meta: MoySkladMeta }; // parent folder (если есть)
};

type MoySkladListResponse<T> = {
  rows: T[];
  meta: {
    size: number;
    limit: number;
    offset: number;
    nextHref?: string;
  };
};

function getMoySkladHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json;charset=utf-8",
  } as const;
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: getMoySkladHeaders(token) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MoySklad API error ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

function pickIdFromHref(href?: string): string | null {
  if (!href) return null;
  const parts = href.split("/");
  return parts[parts.length - 1] ?? null;
}

export default factories.createCoreService("api::moysklad-category.moysklad-category", () => ({
  async syncAll() {
    const token = process.env.MOYSKLAD_ACCESS_TOKEN;
    if (!token) throw new Error("MOYSKLAD_ACCESS_TOKEN is not set");

    const all: MoySkladProductFolder[] = [];
    const limit = 100;
    let offset = 0;

    while (true) {
      const url = `https://api.moysklad.ru/api/remap/1.2/entity/productfolder?limit=${limit}&offset=${offset}`;
      const data = await fetchJson<MoySkladListResponse<MoySkladProductFolder>>(url, token);

      all.push(...data.rows);
      if (!data.meta.nextHref) break;

      offset += limit;
    }

    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    for (const folder of all) {
      const existing = await categoryQuery.findOne({ where: { moyskladId: folder.id } });

      const payload = {
        name: folder.name,
        moyskladId: folder.id,
        href: folder.meta.href,
        pathName: folder.pathName ?? null,
      };

      if (existing) {
        await categoryQuery.update({ where: { id: existing.id }, data: payload });
      } else {
        await categoryQuery.create({ data: payload });
      }
    }

    for (const folder of all) {
      const parentId = pickIdFromHref(folder.productFolder?.meta?.href);
      if (!parentId) continue;

      const me = await categoryQuery.findOne({ where: { moyskladId: folder.id } });
      const parent = await categoryQuery.findOne({ where: { moyskladId: parentId } });

      if (!me || !parent) continue;

      await categoryQuery.update({
        where: { id: me.id },
        data: { parent: parent.id },
      });
    }

    return { ok: true, total: all.length };
  },

  /**
   * Upsert одной категории, пришедшей через webhook (уже fetchByHref сделан).
   */
  async syncOneFromWebhook(entity: any) {
    const folder = entity as MoySkladProductFolder;

    if (!folder?.id || !folder?.meta?.href) {
      throw new Error("Invalid productfolder payload");
    }

    const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

    const existing = await categoryQuery.findOne({ where: { moyskladId: folder.id } });

    const payload = {
      name: folder.name,
      moyskladId: folder.id,
      href: folder.meta.href,
      pathName: folder.pathName ?? null,
    };

    const saved = existing
      ? await categoryQuery.update({ where: { id: existing.id }, data: payload })
      : await categoryQuery.create({ data: payload });

    // parent (если есть)
    const parentMoyskladId = pickIdFromHref(folder.productFolder?.meta?.href);
    if (parentMoyskladId) {
      const parent = await categoryQuery.findOne({ where: { moyskladId: parentMoyskladId } });
      if (parent) {
        await categoryQuery.update({
          where: { id: (saved as any).id },
          data: { parent: parent.id },
        });
      }
    }

    return { ok: true };
  },
}));
