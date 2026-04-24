const MS_BASE = "https://api.moysklad.ru/api/remap/1.2";

function msHeaders() {
  return {
    Authorization: `Bearer ${process.env.MOYSKLAD_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
    "Accept-Encoding": "gzip",
  };
}

async function findProductHref(code: string): Promise<{ href: string; type: string } | null> {
  // Assortment возвращает всё: products, bundles, services, variants
  // Нужно именно оно, т.к. часть SKU в МС лежит как bundle (например Speed-opener'ы)
  const filter = encodeURIComponent(`code=${code}`);
  const url = `${MS_BASE}/entity/assortment?filter=${filter}&limit=10`;

  const res = await fetch(url, { headers: msHeaders() });

  if (!res.ok) {
    strapi.log.error(`[MS findProductHref] HTTP ${res.status} для code=${code}`);
    return null;
  }

  const data = (await res.json()) as {
    rows: {
      code?: string;
      article?: string;
      name?: string;
      meta: { href: string; type: string };
    }[];
  };

  const rows = data.rows ?? [];

  // Точное совпадение по code
  const exact = rows.find((r) => r.code === code);
  if (exact) {
    return { href: exact.meta.href, type: exact.meta.type };
  }

  // Fallback: вдруг артикул в поле article, а не code
  const byArticle = rows.find((r) => r.article === code);
  if (byArticle) {
    strapi.log.warn(`[MS findProductHref] ${code} найден по article, а не по code`);
    return { href: byArticle.meta.href, type: byArticle.meta.type };
  }

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
  positions: {
    productHref: string;
    productType: string;
    quantity: number;
    price: number;
    engraving: boolean;
  }[];
  description: string;
  shipmentAddress: string;
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
      discount: params.volumeDiscountPercent ?? 0,
      vat: 0,
      vatEnabled: false,
      assortment: {
        meta: {
          href: p.productHref,
          type: p.productType,
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
