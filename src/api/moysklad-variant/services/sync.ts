// src/api/moysklad-variant/services/sync.ts

type MoySkladMeta = { href: string };

type MoySkladSalePrice = {
  value: number; // копейки
  priceType?: { name: string };
};

type MoySkladCharacteristic = {
  name: string;
  value: string;
};

type MoySkladVariant = {
  id: string;
  name: string;
  code?: string;
  updated?: string;

  product: {
    meta: MoySkladMeta; // href на entity/product/<uuid>
  };

  salePrices?: MoySkladSalePrice[];
  characteristics?: MoySkladCharacteristic[];
};

type MoySkladVariantListResponse = {
  rows: MoySkladVariant[];
  meta: {
    nextHref?: string;
  };
};

function getMoySkladHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json;charset=utf-8",
  } as const;
}

function pickIdFromHref(href?: string): string | null {
  if (!href) return null;

  const clean = href.split("?")[0]?.split("#")[0];
  if (!clean) return null;

  const parts = clean.split("/");
  const last = parts[parts.length - 1];

  return last ? last : null;
}

function priceByName(prices: MoySkladSalePrice[] | undefined, name: string): number | null {
  if (!prices?.length) return null;

  const found = prices.find((p) => p.priceType?.name === name);
  if (!found) return null;

  // как и в товарах: кладём рубли integer
  return Math.round(found.value / 100);
}

function isMoySkladVariantListResponse(data: unknown): data is MoySkladVariantListResponse {
  if (!data || typeof data !== "object") return false;

  const d = data as { rows?: unknown; meta?: unknown };
  const hasRows = Array.isArray(d.rows);
  const hasMeta = typeof d.meta === "object" && d.meta !== null;

  return hasRows && hasMeta;
}

async function fetchVariantJson(url: string, token: string): Promise<MoySkladVariantListResponse> {
  const res = await fetch(url, { headers: getMoySkladHeaders(token) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MoySklad API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as unknown;

  if (!isMoySkladVariantListResponse(data)) {
    throw new Error(`Unexpected MoySklad response shape (variant): ${JSON.stringify(data).slice(0, 500)}`);
  }

  return data;
}

/**
 * Синк ВСЕХ variants.
 * Предусловие: товары уже синкнуты, иначе не найдём product в Strapi.
 */
export async function syncAllVariants(): Promise<{ upserted: number; skippedNoProduct: number }> {
  const token = process.env.MOYSKLAD_ACCESS_TOKEN;
  if (!token) throw new Error("MOYSKLAD_ACCESS_TOKEN is not set");

  const variantQuery = strapi.db.query("api::moysklad-variant.moysklad-variant");
  const productQuery = strapi.db.query("api::moysklad-product.moysklad-product");

  const keepVariantMsIds = new Set<string>();

  const all: MoySkladVariant[] = [];
  let offset = 0;

  while (true) {
    const url = `https://api.moysklad.ru/api/remap/1.2/entity/variant?limit=100&offset=${offset}`;
    const data = await fetchVariantJson(url, token);

    all.push(...data.rows);

    if (!data.meta.nextHref) break;
    offset += 100;
  }

  let upserted = 0;
  let skippedNoProduct = 0;

  for (const v of all) {
    keepVariantMsIds.add(v.id);

    const productMsId = pickIdFromHref(v.product?.meta?.href);
    if (!productMsId) {
      skippedNoProduct += 1;
      continue;
    }

    const product = await productQuery.findOne({
      where: { moyskladId: productMsId },
      select: ["id"],
    });

    if (!product) {
      skippedNoProduct += 1;
      continue;
    }

    const existing = await variantQuery.findOne({
      where: { moyskladId: v.id },
      select: ["id"],
    });

    const payload = {
      name: v.name,
      moyskladId: v.id,
      code: v.code ?? null,
      updated: v.updated ?? null,

      product: product.id,

      // Пока кладём как массив {name,value} — удобно и быстро.
      characteristics: v.characteristics ?? [],

      price: priceByName(v.salePrices, "Цена с сайта"),
      priceOld: priceByName(v.salePrices, "Цена продажи"),

      // publishedAt не трогаем (у тебя draftAndPublish=false обычно)
    };

    if (existing) {
      await variantQuery.update({ where: { id: existing.id }, data: payload });
    } else {
      await variantQuery.create({ data: payload });
    }

    upserted += 1;
  }

  // Чистка: удаляем variants которых больше нет в МС
  await variantQuery.deleteMany({
    where: { moyskladId: { $notIn: Array.from(keepVariantMsIds) } },
  });

  return { upserted, skippedNoProduct };
}
