// backend/src/utils/moysklad-own-production.ts
// Определяет, относится ли товар МойСклад к «Нашему производству».

const OWN_PRODUCTION_SUPPLIER_ID =
  "bf69d16f-ae44-11ed-0a80-045000024272";

const COCKTAILDESIGN_FOLDER_PATH =
  "Товары интернет-магазинов/COCKTAILDESIGN (Процент офис)";

export type MoySkladOwnProductionFields = {
  supplier?: {
    meta?: {
      href?: string;
    };
  };
  pathName?: string;
  archived?: boolean;
};

/**
 * UUID из href — режем ?query и #hash, берём последний сегмент пути.
 * Та же логика, что в sync-сервисах МойСклад.
 */
function pickIdFromHref(href?: string): string | null {
  if (!href) return null;

  const clean = href.split("?")[0]?.split("#")[0];
  if (!clean) return null;

  const parts = clean.split("/");
  const last = parts[parts.length - 1];

  return last ? last : null;
}

export function isOwnProductionMoySkladProduct(
  product: MoySkladOwnProductionFields,
): boolean {
  if (product.archived === true) {
    return false;
  }

  const supplierId = pickIdFromHref(product.supplier?.meta?.href);
  if (!supplierId) {
    return false;
  }

  if (supplierId !== OWN_PRODUCTION_SUPPLIER_ID) {
    return false;
  }

  if (typeof product.pathName !== "string") {
    return false;
  }

  const pathName = product.pathName.trim();
  if (!pathName) {
    return false;
  }

  if (pathName === COCKTAILDESIGN_FOLDER_PATH) {
    return true;
  }

  if (pathName.startsWith(`${COCKTAILDESIGN_FOLDER_PATH}/`)) {
    return true;
  }

  return false;
}
