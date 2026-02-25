// backend/src/api/moysklad-bundle-item/services/sync.ts
// Задача: синкнуть состав ОДНОГО комплекта (bundle) в Strapi таблицу moysklad-bundle-item.
//
// Важно по draft/publish:
// - В твоём schema для moysklad-bundle-item сейчас draftAndPublish = false,
//   поэтому publishedAt НЕ нужен (и может отсутствовать).
// - Чтобы в админке показывались не documentId, а нормальные названия,
//   мы заполняем обязательное поле title автоматически: "<Название товара> × <кол-во>".

type MoySkladMeta = { href: string };

type MoySkladBundleComponentRow = {
  quantity: number;
  assortment?: { meta?: MoySkladMeta };
};

type MoySkladComponentsResponse = {
  rows: MoySkladBundleComponentRow[];
};

function getMoySkladHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json;charset=utf-8",
  } as const;
}

/** UUID из meta.href (последний сегмент, без ?query/#hash) */
function pickIdFromHref(href?: string): string | null {
  if (!href) return null;

  const clean = href.split("?")[0]?.split("#")[0];
  if (!clean) return null;

  const parts = clean.split("/");
  const last = parts[parts.length - 1];
  return last ? last : null;
}

async function fetchBundleComponents(bundleMsId: string, token: string): Promise<MoySkladBundleComponentRow[]> {
  const url = `https://api.moysklad.ru/api/remap/1.2/entity/bundle/${bundleMsId}/components?limit=1000`;

  const res = await fetch(url, { headers: getMoySkladHeaders(token) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MoySklad API error ${res.status} (bundle components): ${text}`);
  }

  const data = (await res.json()) as MoySkladComponentsResponse;
  return Array.isArray(data.rows) ? data.rows : [];
}

/**
 * Полная перезапись состава:
 * - удаляем старые строки по bundle
 * - создаём новые строки (bundle + componentProduct + quantity + title)
 *
 * title заполняем автоматически, чтобы в админке было читабельно.
 */
export async function syncBundleItemsForBundle(bundleMsId: string) {
  const token = process.env.MOYSKLAD_ACCESS_TOKEN;
  if (!token) throw new Error("MOYSKLAD_ACCESS_TOKEN is not set");

  const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");
  const itemQuery = strapi.db.query("api::moysklad-bundle-item.moysklad-bundle-item");

  // 1) Находим bundle в Strapi по moyskladId
  const bundleEntity = await productQuery.findOne({
    where: { moyskladId: bundleMsId },
    select: ["id", "type"],
  });

  if (!bundleEntity) {
    throw new Error(`Bundle not found in Strapi by moyskladId=${bundleMsId}`);
  }

  // (не строго обязательно, но помогает ловить ошибки данных)
  if (bundleEntity.type !== "bundle") {
    strapi.log.warn(`[moysklad] sync bundle items: entity type is "${bundleEntity.type}", expected "bundle"`);
  }

  // 2) Получаем компоненты из MoySklad
  const rows = await fetchBundleComponents(bundleMsId, token);

  // 3) Удаляем старые строки состава для этого bundle
  await itemQuery.deleteMany({
    where: { bundle: bundleEntity.id },
  });

  // 4) Создаём новые строки
  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const componentMsId = pickIdFromHref(row.assortment?.meta?.href);
    if (!componentMsId) {
      skipped += 1;
      continue;
    }

    // Компонент должен существовать в Strapi как moysklad-product
    // ✅ Берём name, чтобы сформировать title
    const componentEntity = await productQuery.findOne({
      where: { moyskladId: componentMsId },
      select: ["id", "name"],
    });

    if (!componentEntity) {
      // Не падаем: просто пропускаем (например, товар ещё не синкнут)
      skipped += 1;
      continue;
    }

    // ✅ Читабельный title для админки
    // Пример: "Гейзер ... (серебро) × 15"
    const qty = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
    const safeQty = Number.isFinite(qty) ? qty : 1;
    const title = `${componentEntity.name} × ${safeQty}`;

    await itemQuery.create({
      data: {
        title,
        bundle: bundleEntity.id,
        componentProduct: componentEntity.id,
        quantity: safeQty,
      },
    });

    created += 1;
  }

  strapi.log.info(`[moysklad] bundle items synced: bundle=${bundleMsId} created=${created} skipped=${skipped}`);

  return { ok: true, bundleMsId, created, skipped };
}

export default () => ({ syncBundleItemsForBundle });
