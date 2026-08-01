import type { Core } from "@strapi/strapi";

import {
  type CatalogSearchCandidate,
  type PreparedCatalogSearchQuery,
} from "./catalog-search-v2";
import { getStorefrontVisibleProductFilter } from "./storefront-product-visibility";

const PRODUCT_UID = "api::moysklad-product.moysklad-product";

const CATALOG_ROOT_PARENT_ID = 14;
const EXACT_CODE_CANDIDATE_LIMIT = 10;
const TEXT_CANDIDATE_LIMIT = 80;

const CANDIDATE_SELECT = ["id", "name", "code", "searchText", "searchCodes"] as const;

export type CatalogSearchCandidatesResult = {
  candidates: CatalogSearchCandidate[];
  exactCodeCount: number;
  textCount: number;
};

type ProductQuery = {
  findMany: (args: Record<string, unknown>) => Promise<CatalogSearchCandidate[]>;
};

function buildVisibilityFilters() {
  return [
    {
      category: {
        id: {
          $notIn: [CATALOG_ROOT_PARENT_ID],
        },
      },
    },
    getStorefrontVisibleProductFilter(),
  ];
}

async function findExactCodeCandidates(
  strapi: Core.Strapi,
  query: PreparedCatalogSearchQuery,
): Promise<CatalogSearchCandidate[]> {
  if (!query.exactCodeNeedle) {
    return [];
  }

  const productQuery = strapi.db.query(PRODUCT_UID) as ProductQuery;

  return productQuery.findMany({
    where: {
      $and: [
        {
          searchCodes: {
            $containsi: query.exactCodeNeedle,
          },
        },
        ...buildVisibilityFilters(),
      ],
    },
    select: [...CANDIDATE_SELECT],
    orderBy: { id: "desc" },
    limit: EXACT_CODE_CANDIDATE_LIMIT,
  });
}

async function findTextCandidates(
  strapi: Core.Strapi,
  query: PreparedCatalogSearchQuery,
): Promise<CatalogSearchCandidate[]> {
  if (query.tokens.length === 0) {
    return [];
  }

  const productQuery = strapi.db.query(PRODUCT_UID) as ProductQuery;

  return productQuery.findMany({
    where: {
      $and: [
        ...query.tokens.map((token) => ({
          searchText: {
            $containsi: token,
          },
        })),
        ...buildVisibilityFilters(),
      ],
    },
    select: [...CANDIDATE_SELECT],
    orderBy: { id: "desc" },
    limit: TEXT_CANDIDATE_LIMIT,
  });
}

function mergeCandidatesById(
  exactCodeCandidates: CatalogSearchCandidate[],
  textCandidates: CatalogSearchCandidate[],
): CatalogSearchCandidate[] {
  const seenIds = new Set<number>();
  const merged: CatalogSearchCandidate[] = [];

  for (const candidate of [...exactCodeCandidates, ...textCandidates]) {
    if (seenIds.has(candidate.id)) {
      continue;
    }

    seenIds.add(candidate.id);
    merged.push(candidate);
  }

  return merged;
}

export async function findCatalogSearchCandidates(
  strapi: Core.Strapi,
  query: PreparedCatalogSearchQuery,
): Promise<CatalogSearchCandidatesResult> {
  if (!query.isValid) {
    return {
      candidates: [],
      exactCodeCount: 0,
      textCount: 0,
    };
  }

  const exactCodeCandidates = await findExactCodeCandidates(strapi, query);
  const textCandidates = await findTextCandidates(strapi, query);

  return {
    candidates: mergeCandidatesById(exactCodeCandidates, textCandidates),
    exactCodeCount: exactCodeCandidates.length,
    textCount: textCandidates.length,
  };
}
