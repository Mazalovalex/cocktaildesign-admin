import {
  normalizeSearchCode,
  normalizeSearchText,
} from "./product-search-index";

export type PreparedCatalogSearchQuery = {
  raw: string;
  normalizedText: string;
  normalizedCode: string;
  tokens: string[];
  exactCodeNeedle: string;
  isValid: boolean;
};

export type CatalogSearchCandidate = {
  id: number;
  name?: string | null;
  code?: string | null;
  searchText?: string | null;
  searchCodes?: string | null;
};

const CATALOG_SEARCH_RESULT_LIMIT = 10;

function uniqueTokensInOrder(tokens: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (!token || seen.has(token)) {
      continue;
    }

    seen.add(token);
    result.push(token);
  }

  return result;
}

export function prepareCatalogSearchQuery(value: unknown): PreparedCatalogSearchQuery {
  const raw = String(value ?? "").trim();
  const normalizedText = normalizeSearchText(raw);
  const normalizedCode = normalizeSearchCode(raw);
  const tokens = uniqueTokensInOrder(normalizedText.split(" ").filter(Boolean));
  const exactCodeNeedle = normalizedCode ? `|${normalizedCode}|` : "";
  const isValid =
    raw.length >= 2 && (normalizedText.length > 0 || normalizedCode.length > 0);

  return {
    raw,
    normalizedText,
    normalizedCode,
    tokens,
    exactCodeNeedle,
    isValid,
  };
}

export function containsAllSearchTokens(
  searchText: string | null | undefined,
  tokens: string[],
): boolean {
  const haystack = searchText ?? "";

  if (!haystack || tokens.length === 0) {
    return false;
  }

  const haystackTokens = new Set(haystack.split(" ").filter(Boolean));

  return tokens.every((token) => haystackTokens.has(token));
}

export function scoreCatalogSearchCandidate(
  candidate: CatalogSearchCandidate,
  query: PreparedCatalogSearchQuery,
): number {
  const normalizedName = normalizeSearchText(candidate.name);
  const normalizedParentCode = normalizeSearchCode(candidate.code);
  const searchText = candidate.searchText ?? "";
  const searchCodes = candidate.searchCodes ?? "";

  let score = 0;

  if (query.normalizedCode && normalizedParentCode === query.normalizedCode) {
    score += 1200;
  }

  if (query.exactCodeNeedle && searchCodes.includes(query.exactCodeNeedle)) {
    score += 1000;
  }

  if (query.normalizedText && normalizedName === query.normalizedText) {
    score += 800;
  }

  if (query.normalizedText && normalizedName.startsWith(query.normalizedText)) {
    score += 600;
  }

  if (query.normalizedText && normalizedName.includes(query.normalizedText)) {
    score += 500;
  }

  if (query.normalizedText && searchText.includes(query.normalizedText)) {
    score += 300;
  }

  if (query.normalizedCode && searchText.includes(query.normalizedCode)) {
    score += 250;
  }

  if (containsAllSearchTokens(searchText, query.tokens)) {
    score += 200;
  }

  return score;
}

export function rankCatalogSearchCandidates(
  candidates: CatalogSearchCandidate[],
  query: PreparedCatalogSearchQuery,
): CatalogSearchCandidate[] {
  return [...candidates].sort((left, right) => {
    const scoreDiff = scoreCatalogSearchCandidate(right, query) - scoreCatalogSearchCandidate(left, query);

    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return right.id - left.id;
  });
}

export function selectTopCatalogSearchCandidates(
  candidates: CatalogSearchCandidate[],
  query: PreparedCatalogSearchQuery,
): CatalogSearchCandidate[] {
  const scoredCandidates = candidates.map((candidate) => ({
    candidate,
    score: scoreCatalogSearchCandidate(candidate, query),
  }));

  return scoredCandidates
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.candidate.id - left.candidate.id;
    })
    .slice(0, CATALOG_SEARCH_RESULT_LIMIT)
    .map(({ candidate }) => candidate);
}
