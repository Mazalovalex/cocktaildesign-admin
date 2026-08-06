// backend/src/utils/moysklad-sample-sale.ts
// Изолированная GET-загрузка ассортимента только из папки Sample Sale.
// Не пишет в Strapi и не меняет данные в МойСклад.

export const SAMPLE_SALE_FOLDER_ID = "b4121850-6ab7-11ef-0a80-01fa00116171";

export const SAMPLE_SALE_FOLDER_HREF =
  "https://api.moysklad.ru/api/remap/1.2/entity/productfolder/b4121850-6ab7-11ef-0a80-01fa00116171";

export type SampleSaleAssortmentItem = {
  moyskladId: string;
  name: string | null;
  type: string | null;
  productFolderId: string | null;
  stock: number | null;
  quantity: number | null;
  reserve: number | null;
  archived: boolean | null;
  variantsCount: number | null;
  imagesCount: number | null;
};

type MoySkladMeta = {
  href?: string;
  type?: string;
  size?: number;
};

type MoySkladAssortmentRow = {
  id?: string;
  name?: string;
  stock?: number;
  quantity?: number;
  reserve?: number;
  archived?: boolean;
  variantsCount?: number;
  images?: unknown;
  meta?: MoySkladMeta;
  productFolder?: {
    meta?: MoySkladMeta;
  };
};

type MoySkladAssortmentListResponse = {
  rows?: MoySkladAssortmentRow[];
  meta?: {
    size?: number;
    limit?: number;
    offset?: number;
    nextHref?: string;
  };
};

class MoySkladSampleSaleHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`MoySklad sample-sale HTTP ${status}`);
    this.name = "MoySkladSampleSaleHttpError";
    this.status = status;
  }
}

const MOYSKLAD_API_BASE = "https://api.moysklad.ru/api/remap/1.2";
const PAGE_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
/** Защита от бесконечной пагинации: 100 * 1000 = 100_000 строк максимум. */
const MAX_PAGES = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * images в assortment бывает массивом или объектом с meta.size.
 * Если структуры нет — возвращаем null, а не 0.
 */
function resolveImagesCount(images: unknown): number | null {
  if (Array.isArray(images)) {
    return images.length;
  }

  if (!images || typeof images !== "object") {
    return null;
  }

  const meta = (images as { meta?: { size?: unknown } }).meta;
  if (meta && typeof meta.size === "number" && Number.isFinite(meta.size)) {
    return meta.size;
  }

  return null;
}

function buildAssortmentPageUrl(offset: number): string {
  const filter = encodeURIComponent(`productFolder=${SAMPLE_SALE_FOLDER_HREF}`);
  return `${MOYSKLAD_API_BASE}/entity/assortment?filter=${filter}&limit=${PAGE_LIMIT}&offset=${offset}`;
}

function normalizeAssortmentRow(row: MoySkladAssortmentRow): SampleSaleAssortmentItem | null {
  const moyskladId =
    typeof row.id === "string" && row.id.trim()
      ? row.id.trim()
      : pickIdFromHref(row.meta?.href);

  if (!moyskladId) {
    return null;
  }

  return {
    moyskladId,
    name: toNullableString(row.name),
    type: toNullableString(row.meta?.type),
    productFolderId: pickIdFromHref(row.productFolder?.meta?.href),
    stock: toNullableNumber(row.stock),
    quantity: toNullableNumber(row.quantity),
    reserve: toNullableNumber(row.reserve),
    archived: toNullableBoolean(row.archived),
    variantsCount: toNullableNumber(row.variantsCount),
    imagesCount: resolveImagesCount(row.images),
  };
}

async function requestAssortmentPage(
  url: string,
  token: string,
): Promise<MoySkladAssortmentListResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: getMoySkladHeaders(token),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Текст ответа не включаем: там не должно оказаться токена / лишнего payload.
      throw new MoySkladSampleSaleHttpError(response.status);
    }

    return (await response.json()) as MoySkladAssortmentListResponse;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAssortmentPage(
  offset: number,
  token: string,
): Promise<MoySkladAssortmentListResponse> {
  const url = buildAssortmentPageUrl(offset);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestAssortmentPage(url, token);
    } catch (err) {
      if (err instanceof MoySkladSampleSaleHttpError) {
        if (!isRetryableHttpStatus(err.status)) {
          throw err;
        }

        lastError = err;

        if (attempt >= MAX_ATTEMPTS) {
          throw new Error(
            `MoySklad sample-sale assortment failed at offset=${offset}: ${err.message}`,
          );
        }

        await delay(RETRY_DELAYS_MS[attempt - 1] ?? 4000);
        continue;
      }

      if (err instanceof SyntaxError) {
        throw new Error(
          `MoySklad sample-sale assortment failed at offset=${offset}: invalid JSON response`,
        );
      }

      // AbortError / сетевые ошибки fetch — retry
      lastError =
        err instanceof Error
          ? err
          : new Error(`MoySklad sample-sale network error at offset=${offset}`);

      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(
          `MoySklad sample-sale assortment failed at offset=${offset}: ${lastError.message}`,
        );
      }

      await delay(RETRY_DELAYS_MS[attempt - 1] ?? 4000);
    }
  }

  throw (
    lastError ??
    new Error(`MoySklad sample-sale assortment failed at offset=${offset}: exhausted retries`)
  );
}

/**
 * Загружает весь ассортимент папки Sample Sale (только GET).
 * Фильтр — точный href папки по ID, без имени и pathName.
 */
export async function fetchSampleSaleAssortment(): Promise<SampleSaleAssortmentItem[]> {
  const token = process.env.MOYSKLAD_ACCESS_TOKEN;

  if (!token) {
    throw new Error("MOYSKLAD_ACCESS_TOKEN is not set");
  }

  const items: SampleSaleAssortmentItem[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await fetchAssortmentPage(offset, token);
    const rows = Array.isArray(data.rows) ? data.rows : [];

    for (const row of rows) {
      const item = normalizeAssortmentRow(row);
      if (item) {
        items.push(item);
      }
    }

    if (!data.meta?.nextHref) {
      return items;
    }

    if (rows.length === 0) {
      return items;
    }

    offset += rows.length;
  }

  throw new Error(
    `MoySklad sample-sale assortment pagination aborted: exceeded MAX_PAGES=${MAX_PAGES}`,
  );
}
