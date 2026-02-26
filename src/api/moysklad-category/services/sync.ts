// backend/src/api/moysklad-category/services/sync.ts
// Задача файла:
// 1) Забрать категории (productfolder) из MoySklad
// 2) Оставить только нужное поддерево (витринный корень ROOT_NAME)
// 3) Сделать upsert категорий в Strapi
// 4) Во втором проходе проставить parent-связи (чтобы дерево было любой глубины: 2–4+ уровней)
// 5) Удалить категории вне поддерева
// 6) Вести статусы синка + lock, чтобы синк не запускался параллельно
//
// ВАЖНО ПРО СЧЁТЧИКИ:
// - productsCount / productsCountDirect / productsCountTotal пересчитываются ТОЛЬКО в sync/products
// - category sync их НЕ трогает (чтобы не было двойного пересчёта и случайных перетираний)

import {
  acquireMoySkladSyncLock,
  releaseMoySkladSyncLock,
  markSyncError,
  markSyncOk,
  markSyncRunning,
} from "../../../utils/moysklad-sync-state";

/** Упрощённый тип meta из MoySklad (нам нужен href и служебные поля). */
type MoySkladMeta = { href: string; type: string; mediaType?: string };

/** Папка/категория из MoySklad productfolder. */
type MoySkladProductFolder = {
  id: string; // UUID MoySklad
  name: string;
  pathName?: string; // часть пути (используем для фильтрации поддерева)
  meta: MoySkladMeta;
  productFolder?: { meta: MoySkladMeta }; // ссылка на родителя (если есть)
};

/** Тип ответа списка от MoySklad (rows + meta с пагинацией). */
type MoySkladListResponse<T> = {
  rows: T[];
  meta: {
    size: number;
    limit: number;
    offset: number;
    nextHref?: string;
  };
};

/**
 * Витринный корень: от него и ниже мы синкаем дерево.
 * Это "граница" — всё выше/вне поддерева мы не берём в витрину.
 */
const ROOT_NAME = "COCKTAILDESIGN (Процент офис)";

/** Заголовки для MoySklad API. */
function getMoySkladHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json;charset=utf-8",
  } as const;
}

/**
 * Универсальный fetch JSON из MoySklad с нормальной ошибкой.
 */
async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: getMoySkladHeaders(token) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MoySklad API error ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

/**
 * Из meta.href вынимаем UUID сущности (последний сегмент URL).
 * Дополнительно режем query/hash, чтобы не словить баги сопоставления.
 */
function pickIdFromHref(href?: string): string | null {
  if (!href) return null;

  const clean = href.split("?")[0]?.split("#")[0];
  if (!clean) return null;

  const parts = clean.split("/");
  const last = parts[parts.length - 1];

  return last ? last : null;
}

/**
 * Строим "полный путь" для папки:
 * - MoySklad даёт pathName + name
 * - Это удобно для фильтрации поддерева (root + все дочерние).
 */
function buildFolderFullPath(folder: MoySkladProductFolder): string {
  const parentPath = folder.pathName?.trim() ?? "";
  return parentPath ? `${parentPath}/${folder.name}` : folder.name;
}

/**
 * Стабильный slug из MoySklad ID.
 * НЕ используем name → URL не ломается при переименовании.
 */
function makeStableSlug(moyskladId: string): string {
  return `ms-${moyskladId.slice(0, 8)}`;
}

/**
 * Важно: выносим фабрику в константу.
 * Так TS/Strapi гарантированно видят модуль (ESM), и не будет TS2306.
 */
const syncServiceFactory = () => ({
  async syncAll() {
    // 1) Lock: не даём запустить синк параллельно (важно для целостности БД)
    await acquireMoySkladSyncLock("categories");

    // 2) Статус: фиксируем, что синк начался
    await markSyncRunning("categories");

    try {
      // 3) Проверяем токен (без него MoySklad API не доступен)
      const token = process.env.MOYSKLAD_ACCESS_TOKEN;
      if (!token) throw new Error("MOYSKLAD_ACCESS_TOKEN is not set");

      // 4) Вытягиваем все productfolder с пагинацией
      const all: MoySkladProductFolder[] = [];
      const limit = 100;
      let offset = 0;

      while (true) {
        const url = `https://api.moysklad.ru/api/remap/1.2/entity/productfolder?limit=${limit}&offset=${offset}`;
        const data = await fetchJson<MoySkladListResponse<MoySkladProductFolder>>(url, token);

        all.push(...data.rows);

        // MoySklad говорит "следующая страница есть" через nextHref
        if (!data.meta.nextHref) break;
        offset += limit;
      }

      // 5) Ищем витринный корень по имени
      const rootFolder = all.find((f) => f.name === ROOT_NAME) ?? null;
      if (!rootFolder) {
        throw new Error(`Root folder "${ROOT_NAME}" not found in MoySklad productfolder`);
      }

      // 6) Формируем путь корня и фильтруем поддерево (root + все дочерние)
      const rootPath = buildFolderFullPath(rootFolder);

      const filtered = all.filter((f) => {
        const full = buildFolderFullPath(f);
        return full === rootPath || full.startsWith(`${rootPath}/`);
      });

      // 7) Доступ к Strapi Query API
      const categoryQuery = strapi.db.query("api::moysklad-category.moysklad-category");

      const nowIso = new Date().toISOString();

      /**
       * 8) Upsert без parent (первый проход)
       * ВАЖНО: счётчики productsCount здесь НЕ трогаем.
       */
      for (const folder of filtered) {
        const existing = await categoryQuery.findOne({
          where: { moyskladId: folder.id },
          select: ["id", "slug"],
        });

        const payload = {
          name: folder.name,
          moyskladId: folder.id,
          href: folder.meta.href,
          pathName: folder.pathName ?? null,

          // slug стабилен и не ломает URL при переименовании
          slug: existing?.slug ?? makeStableSlug(folder.id),

          publishedAt: nowIso,
        };

        if (existing) {
          await categoryQuery.update({ where: { id: existing.id }, data: payload });
        } else {
          await categoryQuery.create({ data: payload });
        }
      }

      /**
       * 9) Parent-связи (второй проход)
       * Здесь проставляем дерево любой глубины.
       */
      for (const folder of filtered) {
        const parentMoyskladId = pickIdFromHref(folder.productFolder?.meta?.href);
        if (!parentMoyskladId) continue;

        // Родитель должен быть внутри витринного поддерева, иначе не связываем.
        const parentInTree = filtered.some((f) => f.id === parentMoyskladId);
        if (!parentInTree) continue;

        const me = await categoryQuery.findOne({
          where: { moyskladId: folder.id },
          select: ["id"],
        });

        const parent = await categoryQuery.findOne({
          where: { moyskladId: parentMoyskladId },
          select: ["id"],
        });

        if (!me || !parent) continue;

        await categoryQuery.update({
          where: { id: me.id },
          data: { parent: parent.id },
        });
      }

      /**
       * 10) Чистка: удаляем категории вне поддерева
       */
      const keepIds = new Set(filtered.map((f) => f.id));

      await categoryQuery.deleteMany({
        where: { moyskladId: { $notIn: Array.from(keepIds) } },
      });

      const result = { ok: true, total: filtered.length, root: rootPath };

      await markSyncOk("categories", { categories: filtered.length });

      return result;
    } catch (e) {
      await markSyncError("categories", e);
      throw e;
    } finally {
      await releaseMoySkladSyncLock("categories");
    }
  },
});

export default syncServiceFactory;
