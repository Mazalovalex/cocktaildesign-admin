const MS_BASE = "https://api.moysklad.ru/api/remap/1.2";

function msHeaders() {
  return {
    Authorization: `Bearer ${process.env.MOYSKLAD_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function findProductHref(code: string): Promise<string | null> {
  const res = await fetch(`${MS_BASE}/entity/product?filter=code=${code}`, {
    headers: msHeaders(),
  });
  const data = (await res.json()) as { rows: { meta: { href: string } }[] };
  return data.rows?.[0]?.meta?.href ?? null;
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
  positions: { productHref: string; quantity: number; price: number }[];
  description: string;
  shipmentAddress: string;
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
    description: params.description,
    shipmentAddress: params.shipmentAddress,
    positions: params.positions.map((p) => ({
      quantity: p.quantity,
      price: p.price * 100,
      discount: 0,
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
