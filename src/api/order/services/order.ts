const MS_BASE = "https://api.moysklad.ru/api/remap/1.2";

function msHeaders() {
  return {
    Authorization: `Bearer ${process.env.MOYSKLAD_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function findProductHref(code: string): Promise<string | null> {
  // Экранируем значение — защита от слэшей и спецсимволов в артикулах (например JigV30/60)
  const filter = encodeURIComponent(`code=${code}`);
  const url = `${MS_BASE}/entity/product?filter=${filter}&limit=10`;

  const res = await fetch(url, { headers: msHeaders() });

  if (!res.ok) {
    strapi.log.error(`[MS findProductHref] HTTP ${res.status} для code=${code}`);
    return null;
  }

  const data = (await res.json()) as {
    rows: { code?: string; article?: string; name?: string; meta: { href: string } }[];
  };

  const rows = data.rows ?? [];

  // Ищем точное совпадение по code
  const exact = rows.find((r) => r.code === code);
  if (exact) return exact.meta.href;

  // Fallback: вдруг артикул хранится в поле article, а не в code
  const byArticle = rows.find((r) => r.article === code);
  if (byArticle) {
    strapi.log.warn(`[MS findProductHref] ${code} найден по article, а не по code`);
    return byArticle.meta.href;
  }

  // Товар реально не найден — логируем подробно, чтобы было понятно почему
  strapi.log.warn(
    `[MS findProductHref] Нет точного совпадения для "${code}". ` +
      `МС вернул ${rows.length} строк. Первые 3: ` +
      JSON.stringify(rows.slice(0, 3).map((r) => ({ code: r.code, article: r.article, name: r.name }))),
  );
  return null;
}

async function createCounterparty(name: string, phone: string): Promise<string> {
  const res = await fetch(`${MS_BASE}/entity/counterparty`, {
    method: "POST",
    headers: msHeaders(),
    body: JSON.stringify({
      name,
      phone,
      companyType: "individual",
      tags: ["клиенты интернет-магазинов", "cocktaildesign"],
    }),
  });
  const data = (await res.json()) as { meta: { href: string } };
  return data.meta.href;
}

async function createCustomerOrder(params: {
  agentHref: string;
  positions: { productHref: string; quantity: number; price: number; engraving: boolean }[];
  description: string;
  shipmentAddress: string;
  // Скидка за объём в процентах — если есть, проставляем во все позиции
  volumeDiscountPercent?: number;
}): Promise<{ id: string; name: string }> {
  const body = {
    organization: {
      meta: {
        href: process.env.MOYSKLAD_ORGANIZATION_HREF,
        type: "organization",
        mediaType: "application/json",
      },
    },
    agent: {
      meta: {
        href: params.agentHref,
        type: "counterparty",
        mediaType: "application/json",
      },
    },
    salesChannel: {
      meta: {
        href: process.env.MOYSKLAD_SALES_CHANNEL_HREF,
        type: "saleschannel",
        mediaType: "application/json",
      },
    },
    store: {
      meta: {
        href: process.env.MOYSKLAD_STORE_HREF,
        type: "store",
        mediaType: "application/json",
      },
    },
    description: params.description,
    shipmentAddress: params.shipmentAddress,
    attributes: [
      {
        meta: {
          href: process.env.MOYSKLAD_SOURCE_ATTRIBUTE_HREF,
          type: "attributemetadata",
          mediaType: "application/json",
        },
        value: {
          meta: {
            href: process.env.MOYSKLAD_SOURCE_HREF,
            type: "customentity",
            mediaType: "application/json",
          },
        },
      },
    ],
    positions: params.positions.map((p) => ({
      quantity: p.quantity,
      price: p.price * 100,
      // Скидка за объём — только для товаров без флага discountExcluded
      // Если скидки нет — 0
      discount: params.volumeDiscountPercent ?? 0,
      vat: 0,
      vatEnabled: false,
      assortment: {
        meta: {
          href: p.productHref,
          type: "product",
          mediaType: "application/json",
        },
      },
    })),
  };

  const res = await fetch(`${MS_BASE}/entity/customerorder`, {
    method: "POST",
    headers: msHeaders(),
    body: JSON.stringify(body),
  });

  const result = (await res.json()) as { id: string; name: string };
  strapi.log.info("[order] МойСклад ответ: " + JSON.stringify(result));
  return result;
}

export default { findProductHref, createCounterparty, createCustomerOrder };
