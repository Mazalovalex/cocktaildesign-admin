export type ProductBadgeDto = {
  id: number;
  label: string;
  backgroundColor: string;
  textColor: string;
};

const DEFAULT_BACKGROUND_COLOR = "#0F172A";
const DEFAULT_TEXT_COLOR = "#FFFFFF";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();

  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}

export function mapProductBadges(assignments: unknown): ProductBadgeDto[] {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return [];
  }

  const result: ProductBadgeDto[] = [];
  const seenIds = new Set<number>();

  for (const assignment of assignments) {
    if (!assignment || typeof assignment !== "object") {
      continue;
    }

    const badge = (assignment as { badge?: unknown }).badge;

    if (!badge || typeof badge !== "object") {
      continue;
    }

    const rawBadge = badge as {
      id?: unknown;
      label?: unknown;
      backgroundColor?: unknown;
      textColor?: unknown;
    };

    if (typeof rawBadge.id !== "number" || !Number.isFinite(rawBadge.id)) {
      continue;
    }

    if (seenIds.has(rawBadge.id)) {
      continue;
    }

    const label = typeof rawBadge.label === "string" ? rawBadge.label.trim() : "";

    if (!label) {
      continue;
    }

    seenIds.add(rawBadge.id);

    result.push({
      id: rawBadge.id,
      label,
      backgroundColor: normalizeHexColor(rawBadge.backgroundColor, DEFAULT_BACKGROUND_COLOR),
      textColor: normalizeHexColor(rawBadge.textColor, DEFAULT_TEXT_COLOR),
    });
  }

  return result;
}
