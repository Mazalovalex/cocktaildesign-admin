export function getStorefrontVisibleProductFilter() {
  return {
    $or: [{ isHiddenOnSite: false }, { isHiddenOnSite: { $null: true } }],
  };
}
