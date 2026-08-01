// backend/src/utils/catalog-search.ts
//
// Чистые функции нормализации и scoring для GET /api/catalog/search.
// Strapi-запросы и mapping ответа остаются в controller.

export const VARIANT_SCORE_ADVANTAGE = 100;

const EXACT_CODE_SCORE = 1200;
const EXACT_VARIANT_CODE_BONUS = 25;
const EXACT_NAME_SCORE = 1000;
const CODE_STARTS_WITH_SCORE = 900;
const NAME_STARTS_WITH_SCORE = 750;
const CODE_CONTAINS_SCORE = 650;
const NAME_CONTAINS_SCORE = 500;
const ALL_TOKENS_BASE_SCORE = 400;
const ALL_TOKENS_PER_TOKEN_SCORE = 20;

type SearchScorable = {
  name?: string | null;
  code?: string | null;
};

type ScoreSearchEntityInput = SearchScorable & {
  normalizedQuery: string;
  compactQuery: string;
  tokens: string[];
  isVariant?: boolean;
};

type PickMatchedVariantInput = {
  variants: SearchScorable[];
  parentScore: number;
  normalizedQuery: string;
  compactQuery: string;
  tokens: string[];
};

/** Текст для сравнения названий: lowercase, ё→е, знаки препинания → пробел. */
export function normalizeSearchText(value: unknown): string {
  let text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");

  text = text.replace(/[/\\\-_,.;:'"()[\]{}|+&@#*!?<>~`+=]+/g, " ");
  text = text.replace(/[^a-z0-9а-я\s]/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/** Компактный артикул без пробелов и разделителей: JigV25/50 → jigv2550. */
export function normalizeSearchCode(value: unknown): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

/** Уникальные токены запроса в порядке появления. */
export function getSearchTokens(value: unknown): string[] {
  const normalized = normalizeSearchText(value);

  if (!normalized) {
    return [];
  }

  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const token of normalized.split(" ")) {
    if (!token || seen.has(token)) {
      continue;
    }

    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

function getCombinedSearchText(entity: SearchScorable): string {
  const name = normalizeSearchText(entity.name);
  const code = normalizeSearchCode(entity.code);
  return `${name} ${code}`.trim();
}

function hasAllTokens(combinedText: string, tokens: string[]): boolean {
  if (tokens.length === 0 || !combinedText) {
    return false;
  }

  return tokens.every((token) => combinedText.includes(token));
}

/** Оценка совпадения для parent product или variant. Возвращает 0, если совпадения нет. */
export function scoreSearchEntity(input: ScoreSearchEntityInput): number {
  const normalizedName = normalizeSearchText(input.name);
  const normalizedCode = normalizeSearchCode(input.code);
  const { normalizedQuery, compactQuery, tokens } = input;

  let score = 0;

  if (compactQuery && normalizedCode && normalizedCode === compactQuery) {
    const exactCodeScore = EXACT_CODE_SCORE + (input.isVariant ? EXACT_VARIANT_CODE_BONUS : 0);
    score = Math.max(score, exactCodeScore);
  }

  if (normalizedQuery && normalizedName && normalizedName === normalizedQuery) {
    score = Math.max(score, EXACT_NAME_SCORE);
  }

  if (compactQuery && normalizedCode && normalizedCode.startsWith(compactQuery)) {
    score = Math.max(score, CODE_STARTS_WITH_SCORE);
  }

  if (normalizedQuery && normalizedName && normalizedName.startsWith(normalizedQuery)) {
    score = Math.max(score, NAME_STARTS_WITH_SCORE);
  }

  if (compactQuery && normalizedCode && normalizedCode.includes(compactQuery)) {
    score = Math.max(score, CODE_CONTAINS_SCORE);
  }

  if (normalizedQuery && normalizedName && normalizedName.includes(normalizedQuery)) {
    score = Math.max(score, NAME_CONTAINS_SCORE);
  }

  const combinedText = getCombinedSearchText(input);

  if (hasAllTokens(combinedText, tokens)) {
    score = Math.max(score, ALL_TOKENS_BASE_SCORE + tokens.length * ALL_TOKENS_PER_TOKEN_SCORE);
  }

  return score;
}

function isExactVariantMatch(
  variant: SearchScorable,
  normalizedQuery: string,
  compactQuery: string,
): boolean {
  const variantName = normalizeSearchText(variant.name);
  const variantCode = normalizeSearchCode(variant.code);

  const nameExact = normalizedQuery.length > 0 && variantName === normalizedQuery;
  const codeExact = compactQuery.length > 0 && variantCode === compactQuery;

  return nameExact || codeExact;
}

/**
 * Возвращает индекс matchedVariant в исходном массиве variants.
 * Не выбирает случайную модификацию при общем запросе вроде «джиггер».
 */
export function pickMatchedVariantIndex(input: PickMatchedVariantInput): number | null {
  const { variants, parentScore, normalizedQuery, compactQuery, tokens } = input;

  if (variants.length === 0) {
    return null;
  }

  const exactMatchIndexes: number[] = [];

  for (let index = 0; index < variants.length; index += 1) {
    if (isExactVariantMatch(variants[index], normalizedQuery, compactQuery)) {
      exactMatchIndexes.push(index);
    }
  }

  if (exactMatchIndexes.length === 1) {
    return exactMatchIndexes[0];
  }

  if (exactMatchIndexes.length > 1) {
    return null;
  }

  const scoredVariants = variants.map((variant, index) => ({
    index,
    score: scoreSearchEntity({
      name: variant.name,
      code: variant.code,
      normalizedQuery,
      compactQuery,
      tokens,
      isVariant: true,
    }),
  }));

  const positiveScored = scoredVariants.filter((row) => row.score > 0);

  if (positiveScored.length === 0) {
    return null;
  }

  const maxScore = Math.max(...positiveScored.map((row) => row.score));
  const topVariants = positiveScored.filter((row) => row.score === maxScore);

  if (topVariants.length === 1 && maxScore >= parentScore + VARIANT_SCORE_ADVANTAGE) {
    return topVariants[0].index;
  }

  return null;
}
