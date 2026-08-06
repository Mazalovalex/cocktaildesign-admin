/**
 * Единый фильтр видимости товара на витрине.
 *
 * Товар виден, когда одновременно:
 * - isHiddenOnSite не равен true (ручной флаг менеджера);
 * - isOutOfStock не равен true (системный флаг остатка Sample Sale).
 *
 * Значение null у обоих полей означает «видим» — поэтому старые товары,
 * для которых остатки не контролируются, остаются на витрине без миграции.
 */
export function getStorefrontVisibleProductFilter() {
  return {
    $and: [
      { $or: [{ isHiddenOnSite: false }, { isHiddenOnSite: { $null: true } }] },
      { $or: [{ isOutOfStock: false }, { isOutOfStock: { $null: true } }] },
    ],
  };
}
