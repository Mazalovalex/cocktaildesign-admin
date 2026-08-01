import type { Core } from "@strapi/strapi";
import { buildProductSearchFields } from "./product-search-index";

const PRODUCT_UID = "api::moysklad-product.moysklad-product";

export type RebuildProductSearchIndexResult = {
  found: boolean;
  changed: boolean;
};

type ProductRow = {
  id: number;
  name?: string | null;
  code?: string | null;
  searchText?: string | null;
  searchCodes?: string | null;
  variants?: Array<{
    id: number;
    name?: string | null;
    code?: string | null;
  }> | null;
};

export async function rebuildProductSearchIndex(
  strapi: Core.Strapi,
  productId: number,
): Promise<RebuildProductSearchIndexResult> {
  if (!Number.isInteger(productId) || productId < 1) {
    throw new Error("Некорректный productId для пересчёта поискового индекса");
  }

  const product = (await strapi.db.query(PRODUCT_UID).findOne({
    where: { id: productId },
    select: ["id", "name", "code", "searchText", "searchCodes"],
    populate: {
      variants: {
        select: ["id", "name", "code"],
        orderBy: { id: "asc" },
      },
    },
  })) as ProductRow | null;

  if (!product) {
    return {
      found: false,
      changed: false,
    };
  }

  const next = buildProductSearchFields({
    name: product.name,
    code: product.code,
    variants: (product.variants ?? []).map((variant) => ({
      name: variant.name,
      code: variant.code,
    })),
  });

  const currentSearchText = product.searchText ?? "";
  const currentSearchCodes = product.searchCodes ?? "";

  if (currentSearchText === next.searchText && currentSearchCodes === next.searchCodes) {
    return {
      found: true,
      changed: false,
    };
  }

  await strapi.db.query(PRODUCT_UID).update({
    where: { id: productId },
    data: {
      searchText: next.searchText,
      searchCodes: next.searchCodes,
    },
  });

  return {
    found: true,
    changed: true,
  };
}

const DEFAULT_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 200;

export type RebuildAllProductSearchIndexesResult = {
  scanned: number;
  changed: number;
  unchanged: number;
};

export async function rebuildAllProductSearchIndexes(
  strapi: Core.Strapi,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<RebuildAllProductSearchIndexesResult> {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < MIN_BATCH_SIZE ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error("Некорректный batchSize для пакетного пересчёта поискового индекса");
  }

  let scanned = 0;
  let changed = 0;
  let unchanged = 0;
  let offset = 0;

  while (true) {
    const products = (await strapi.db.query(PRODUCT_UID).findMany({
      select: ["id", "name", "code", "searchText", "searchCodes"],
      populate: {
        variants: {
          select: ["id", "name", "code"],
          orderBy: { id: "asc" },
        },
      },
      orderBy: { id: "asc" },
      limit: batchSize,
      offset,
    })) as ProductRow[];

    if (!Array.isArray(products) || products.length === 0) {
      break;
    }

    for (const product of products) {
      scanned += 1;

      const next = buildProductSearchFields({
        name: product.name,
        code: product.code,
        variants: (product.variants ?? []).map((variant) => ({
          name: variant.name,
          code: variant.code,
        })),
      });

      const currentSearchText = product.searchText ?? "";
      const currentSearchCodes = product.searchCodes ?? "";

      if (currentSearchText === next.searchText && currentSearchCodes === next.searchCodes) {
        unchanged += 1;
        continue;
      }

      await strapi.db.query(PRODUCT_UID).update({
        where: { id: product.id },
        data: {
          searchText: next.searchText,
          searchCodes: next.searchCodes,
        },
      });

      changed += 1;
    }

    offset += products.length;

    if (products.length < batchSize) {
      break;
    }
  }

  return {
    scanned,
    changed,
    unchanged,
  };
}
