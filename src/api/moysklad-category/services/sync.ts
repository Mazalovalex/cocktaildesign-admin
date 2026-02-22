// src/api/moysklad-category/services/sync.ts
import {
  acquireMoySkladSyncLock,
  releaseMoySkladSyncLock,
  markSyncError,
  markSyncOk,
  markSyncRunning,
} from "../../../utils/moysklad-sync-state";

type MoySkladMeta = { href: string; type: string; mediaType?: string };

type MoySkladProductFolder = {
  id: string;
  name: string;
  pathName?: string;
  meta: MoySkladMeta;
  productFolder?: { meta: MoySkladMeta };
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

const ROOT_NAME = "COCKTAILDESIGN (Процент офис)";

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

function buildFolderFullPath(folder: MoySkladProductFolder): string {
  const parentPath = folder.pathName?.trim() ?? "";
  return parentPath ? `${parentPath}/${folder.name}` : folder.name;
}

export default () => ({
  async syncAll() {
    // ✅ 1) Lock до любых действий
    await acquireMoySkladSyncLock("categories");

    // ✅ 2) Статус
    await markSyncRunning("categories");

    try {
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

      const rootFolder = all.find((f) => f.name === ROOT_NAME) ?? null;
      if (!rootFolder) {
        throw new Error(`Root folder "${ROOT_NAME}" not found in MoySklad productfolder`);
      }

      const rootPath = buildFolderFullPath(rootFolder);

      const filtered = all.filter((f) => {
        const full = buildFolderFullPath(f);
        return full === rootPath || full.startsWith(`${rootPath}/`);
      });

      const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");
      const nowIso = new Date().toISOString();

      // 4) upsert без parent
      for (const folder of filtered) {
        const existing = await categoryQuery.findOne({ where: { moyskladId: folder.id } });

        const payload = {
          name: folder.name,
          moyskladId: folder.id,
          href: folder.meta.href,
          pathName: folder.pathName ?? null,
          publishedAt: nowIso,
        };

        if (existing) {
          await categoryQuery.update({ where: { id: existing.id }, data: payload });
        } else {
          await categoryQuery.create({ data: payload });
        }
      }

      // 5) parent (2-й проход)
      for (const folder of filtered) {
        const parentMoyskladId = pickIdFromHref(folder.productFolder?.meta?.href);
        if (!parentMoyskladId) continue;

        const parentInTree = filtered.some((f) => f.id === parentMoyskladId);
        if (!parentInTree) continue;

        const me = await categoryQuery.findOne({ where: { moyskladId: folder.id } });
        const parent = await categoryQuery.findOne({ where: { moyskladId: parentMoyskladId } });
        if (!me || !parent) continue;

        await categoryQuery.update({
          where: { id: me.id },
          data: { parent: parent.id },
        });
      }

      // 6) чистка вне поддерева
      const keepIds = new Set(filtered.map((f) => f.id));
      await categoryQuery.deleteMany({
        where: {
          moyskladId: { $notIn: Array.from(keepIds) },
        },
      });

      const result = { ok: true, total: filtered.length, root: rootPath };

      await markSyncOk("categories", { categories: filtered.length });

      return result;
    } catch (e) {
      await markSyncError("categories", e);
      throw e;
    } finally {
      // ✅ 3) Всегда освобождаем lock
      await releaseMoySkladSyncLock("categories");
    }
  },
});
