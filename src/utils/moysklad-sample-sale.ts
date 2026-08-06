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

/** Папка productfolder из МойСклад (только GET). */
export type SampleSaleFolderEntity = {
  id: string;
  name: string;
  pathName?: string | null;
  meta: {
    href: string;
    type?: string;
  };
  productFolder?: {
    meta?: {
      href?: string;
    };
  };
};

/** Сырой product из МойСклад для точечного upsert (только GET). */
export type SampleSaleProductEntity = {
  id?: string;
  name?: string;
  code?: string;
  updated?: string;
  description?: string;
  meta?: {
    href?: string;
    type?: string;
  };
  productFolder?: {
    meta?: {
      href?: string;
    };
  };
  salePrices?: unknown[];
  uom?: {
    name?: string;
  };
  weight?: number | null;
  volume?: number | null;
  supplier?: {
    meta?: {
      href?: string;
    };
  };
  pathName?: string;
  archived?: boolean;
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

/**
 * stock из assortment.
 *
 * Отсутствующее значение → null: это допустимо и означает «нет в наличии».
 * Значение другого типа НЕ подменяем на null или 0 — иначе битый ответ API
 * молча превратился бы в «распродано». Такое значение отбрасывает
 * assertValidSampleSaleStock() до любых записей в базу.
 */
function toStockValue(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value as number;
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
    stock: toStockValue(row.stock),
    quantity: toNullableNumber(row.quantity),
    reserve: toNullableNumber(row.reserve),
    archived: toNullableBoolean(row.archived),
    variantsCount: toNullableNumber(row.variantsCount),
    imagesCount: resolveImagesCount(row.images),
  };
}

function requireAccessToken(): string {
  const token = process.env.MOYSKLAD_ACCESS_TOKEN;

  if (!token) {
    throw new Error("MOYSKLAD_ACCESS_TOKEN is not set");
  }

  return token;
}

async function requestJson<T>(url: string, token: string): Promise<T> {
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

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithRetry<T>(url: string, token: string, label: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestJson<T>(url, token);
    } catch (err) {
      if (err instanceof MoySkladSampleSaleHttpError) {
        if (!isRetryableHttpStatus(err.status)) {
          throw err;
        }

        lastError = err;

        if (attempt >= MAX_ATTEMPTS) {
          throw new Error(`MoySklad sample-sale ${label} failed: ${err.message}`);
        }

        await delay(RETRY_DELAYS_MS[attempt - 1] ?? 4000);
        continue;
      }

      if (err instanceof SyntaxError) {
        throw new Error(`MoySklad sample-sale ${label} failed: invalid JSON response`);
      }

      // AbortError / сетевые ошибки fetch — retry
      lastError =
        err instanceof Error ? err : new Error(`MoySklad sample-sale network error: ${label}`);

      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(`MoySklad sample-sale ${label} failed: ${lastError.message}`);
      }

      await delay(RETRY_DELAYS_MS[attempt - 1] ?? 4000);
    }
  }

  throw lastError ?? new Error(`MoySklad sample-sale ${label} failed: exhausted retries`);
}

async function fetchAssortmentPage(
  offset: number,
  token: string,
): Promise<MoySkladAssortmentListResponse> {
  return fetchJsonWithRetry<MoySkladAssortmentListResponse>(
    buildAssortmentPageUrl(offset),
    token,
    `assortment offset=${offset}`,
  );
}

/**
 * Флаг отсутствия по физическому stock.
 * null или <= 0 → нет в наличии. quantity и reserve не участвуют.
 */
export function resolveSampleSaleIsOutOfStock(stock: number | null): boolean {
  return stock === null || stock <= 0;
}

/** Принадлежность папке Sample Sale только по точному ID. */
export function isSampleSaleFolderId(folderId: string | null | undefined): boolean {
  return folderId === SAMPLE_SALE_FOLDER_ID;
}

/**
 * Проверка одной строки остатка.
 *
 * null допустим и позднее трактуется как isOutOfStock = true.
 * Любое число, включая 0, отрицательные и дробные, допустимо.
 * Ошибка только если значение присутствует, но не является конечным number:
 * строку "0" в число не превращаем.
 */
export function assertValidSampleSaleStock(item: SampleSaleAssortmentItem): void {
  const stock: unknown = item.stock;

  if (stock === null) {
    return;
  }

  if (typeof stock !== "number" || !Number.isFinite(stock)) {
    throw new Error(
      `MoySklad sample-sale invalid stock for ${item.moyskladId}: type=${typeof stock}`,
    );
  }
}

/** Системные поля остатка для записи в Strapi. */
export function buildSampleSaleStockFields(stock: number | null): {
  moyskladStock: number | null;
  isOutOfStock: boolean;
} {
  return {
    moyskladStock: stock,
    isOutOfStock: resolveSampleSaleIsOutOfStock(stock),
  };
}

/** Сброс системных полей остатка (товар покинул Sample Sale). */
export function buildClearedSampleSaleStockFields(): {
  moyskladStock: null;
  isOutOfStock: null;
} {
  return {
    moyskladStock: null,
    isOutOfStock: null,
  };
}

/**
 * Map остатков по moyskladId с валидацией до любых записей в базу.
 * Бросает ошибку при пустом ответе, дублях и чужой папке —
 * пустой/битый ответ нельзя трактовать как «всё распродано».
 */
export function buildSampleSaleStockMap(
  items: SampleSaleAssortmentItem[],
): Map<string, SampleSaleAssortmentItem> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      "MoySklad sample-sale stock map aborted: assortment is empty (possible API or filter error)",
    );
  }

  const map = new Map<string, SampleSaleAssortmentItem>();

  for (const item of items) {
    if (!item || typeof item.moyskladId !== "string" || !item.moyskladId) {
      throw new Error("MoySklad sample-sale stock map aborted: row without moyskladId");
    }

    if (!isSampleSaleFolderId(item.productFolderId)) {
      throw new Error(
        `MoySklad sample-sale stock map aborted: foreign folder for ${item.moyskladId}`,
      );
    }

    assertValidSampleSaleStock(item);

    if (map.has(item.moyskladId)) {
      throw new Error(
        `MoySklad sample-sale stock map aborted: duplicate moyskladId ${item.moyskladId}`,
      );
    }

    map.set(item.moyskladId, item);
  }

  return map;
}

/**
 * Загружает весь ассортимент папки Sample Sale (только GET).
 * Фильтр — точный href папки по ID, без имени и pathName.
 */
export async function fetchSampleSaleAssortment(): Promise<SampleSaleAssortmentItem[]> {
  const token = requireAccessToken();
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

/**
 * Один товар из ассортимента Sample Sale по moyskladId (только GET).
 * Фильтр: id + точный href папки.
 */
export async function fetchSampleSaleAssortmentItemById(
  moyskladId: string,
): Promise<SampleSaleAssortmentItem | null> {
  const token = requireAccessToken();
  const safeId = moyskladId.trim();

  if (!safeId) {
    throw new Error("MoySklad sample-sale assortment item: empty moyskladId");
  }

  const filter = encodeURIComponent(`id=${safeId};productFolder=${SAMPLE_SALE_FOLDER_HREF}`);
  const url = `${MOYSKLAD_API_BASE}/entity/assortment?filter=${filter}&limit=10`;
  const data = await fetchJsonWithRetry<MoySkladAssortmentListResponse>(
    url,
    token,
    `assortment item id=${safeId}`,
  );

  const rows = Array.isArray(data.rows) ? data.rows : [];

  for (const row of rows) {
    const item = normalizeAssortmentRow(row);
    if (item && item.moyskladId === safeId) {
      // Битый stock должен стать ошибкой запроса, а не «нет в наличии».
      assertValidSampleSaleStock(item);
      return item;
    }
  }

  return null;
}

/**
 * Папка Sample Sale из МойСклад (только GET).
 */
export async function fetchSampleSaleFolder(): Promise<SampleSaleFolderEntity> {
  const token = requireAccessToken();
  const url = `${MOYSKLAD_API_BASE}/entity/productfolder/${SAMPLE_SALE_FOLDER_ID}`;
  const data = await fetchJsonWithRetry<SampleSaleFolderEntity>(
    url,
    token,
    `productfolder id=${SAMPLE_SALE_FOLDER_ID}`,
  );

  if (!data || typeof data.id !== "string" || !data.id) {
    throw new Error("MoySklad sample-sale folder response has no id");
  }

  if (data.id !== SAMPLE_SALE_FOLDER_ID) {
    throw new Error("MoySklad sample-sale folder id mismatch");
  }

  if (!data.meta || typeof data.meta.href !== "string" || !data.meta.href) {
    throw new Error("MoySklad sample-sale folder response has no meta.href");
  }

  if (typeof data.name !== "string") {
    throw new Error("MoySklad sample-sale folder response has no name");
  }

  return data;
}

/**
 * Полный product из МойСклад по id (только GET).
 * Нужен для точечного upsert через syncOneFromWebhook.
 */
export async function fetchMoySkladProductEntity(
  moyskladId: string,
): Promise<SampleSaleProductEntity> {
  const token = requireAccessToken();
  const safeId = moyskladId.trim();

  if (!safeId) {
    throw new Error("MoySklad sample-sale product: empty moyskladId");
  }

  const url = `${MOYSKLAD_API_BASE}/entity/product/${encodeURIComponent(safeId)}`;
  const data = await fetchJsonWithRetry<SampleSaleProductEntity>(
    url,
    token,
    `product id=${safeId}`,
  );

  const entityId =
    typeof data.id === "string" && data.id.trim()
      ? data.id.trim()
      : pickIdFromHref(data.meta?.href);

  if (!entityId || entityId !== safeId) {
    throw new Error(`MoySklad sample-sale product id mismatch for ${safeId}`);
  }

  return data;
}
