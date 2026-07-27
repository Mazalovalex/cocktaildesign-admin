export type MoySkladSalePrice = {
  value?: number | null;
  priceType?: {
    id?: string | null;
    name?: string | null;
  };
};

const SALE_PRICE_TYPE_ID =
  "3956b8da-94d4-11ec-0a80-053a00220ccf";

const OLD_PRICE_TYPE_ID =
  "3e088b40-9166-11ef-0a80-17320000db28";

function getPriceByTypeId(
  prices: MoySkladSalePrice[] | undefined,
  priceTypeId: string,
): number {
  if (!Array.isArray(prices)) {
    return 0;
  }

  const priceItem = prices.find(
    (item) => item.priceType?.id === priceTypeId,
  );

  const value = priceItem?.value;

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return 0;
  }

  return Math.round(value / 100);
}

export function getWebsitePrices(
  prices: MoySkladSalePrice[] | undefined,
) {
  const price = getPriceByTypeId(
    prices,
    SALE_PRICE_TYPE_ID,
  );

  const oldPriceCandidate = getPriceByTypeId(
    prices,
    OLD_PRICE_TYPE_ID,
  );

  const priceOld =
    price > 0 && oldPriceCandidate > price
      ? oldPriceCandidate
      : 0;

  return {
    price,
    priceOld,
  };
}
