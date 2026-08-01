type SearchIndexEntity = {
  name?: string | null;
  code?: string | null;
};

type BuildProductSearchFieldsInput = SearchIndexEntity & {
  variants?: SearchIndexEntity[] | null;
};

export type ProductSearchFields = {
  searchText: string;
  searchCodes: string;
};

export function normalizeSearchText(value: string | null | undefined): string {
  if (value == null) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CYRILLIC_TO_LATIN_LOOKALIKES: Record<string, string> = {
  а: "a",
  в: "b",
  с: "c",
  е: "e",
  н: "h",
  к: "k",
  м: "m",
  о: "o",
  р: "p",
  т: "t",
  х: "x",
  у: "y",
};

function replaceCyrillicLookalikesWithLatin(value: string): string {
  let result = "";

  for (const char of value) {
    result += CYRILLIC_TO_LATIN_LOOKALIKES[char] ?? char;
  }

  return result;
}

export function normalizeSearchCode(value: string | null | undefined): string {
  const normalized = normalizeSearchText(value);
  const latinized = replaceCyrillicLookalikesWithLatin(normalized);

  return latinized.replace(/\s+/g, "");
}

function addUniquePart(parts: string[], seen: Set<string>, value: string): void {
  if (!value || seen.has(value)) {
    return;
  }

  seen.add(value);
  parts.push(value);
}

function addUniqueCode(codes: string[], seen: Set<string>, value: string | null | undefined): void {
  const compact = normalizeSearchCode(value);

  if (!compact || seen.has(compact)) {
    return;
  }

  seen.add(compact);
  codes.push(compact);
}

export function buildProductSearchFields(input: BuildProductSearchFieldsInput): ProductSearchFields {
  const searchTextParts: string[] = [];
  const searchTextSeen = new Set<string>();

  addUniquePart(searchTextParts, searchTextSeen, normalizeSearchText(input.name));
  addUniquePart(searchTextParts, searchTextSeen, normalizeSearchText(input.code));
  addUniquePart(searchTextParts, searchTextSeen, normalizeSearchCode(input.code));

  const variants = input.variants ?? [];

  for (const variant of variants) {
    addUniquePart(searchTextParts, searchTextSeen, normalizeSearchText(variant.name));
    addUniquePart(searchTextParts, searchTextSeen, normalizeSearchText(variant.code));
    addUniquePart(searchTextParts, searchTextSeen, normalizeSearchCode(variant.code));
  }

  const searchCodesParts: string[] = [];
  const searchCodesSeen = new Set<string>();

  addUniqueCode(searchCodesParts, searchCodesSeen, input.code);

  for (const variant of variants) {
    addUniqueCode(searchCodesParts, searchCodesSeen, variant.code);
  }

  return {
    searchText: searchTextParts.join(" "),
    searchCodes: searchCodesParts.length > 0 ? `|${searchCodesParts.join("|")}|` : "",
  };
}
