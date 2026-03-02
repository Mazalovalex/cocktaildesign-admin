// backend/src/api/moysklad-category/routes/catalog.ts

export default {
  routes: [
    {
      method: "GET",
      path: "/catalog/categories-flat",
      handler: "moysklad-category.categoriesFlat",
      config: {
        auth: false,
      },
    },

    // ----------------------------------------------------------------------------
    // Товары категории (категория + все потомки), пагинация limit/offset.
    // ----------------------------------------------------------------------------

    {
      method: "GET",
      path: "/catalog/products",
      handler: "moysklad-category.products",
      config: {
        auth: false,
      },
    },

    // ----------------------------------------------------------------------------
    // Получить товары по массиву Strapi id
    // ----------------------------------------------------------------------------
    {
      method: "GET",
      path: "/catalog/products-by-ids",
      handler: "moysklad-category.productsByIds",
      config: { auth: false },
    },
    // ----------------------------------------------------------------------------
    // Детальная карточка товара по slug (ms-xxxxxxx)
    // Возвращает:
    //  - item (Strapi-like: { id, attributes })
    //  - breadcrumbsCategories: цепочка категорий (для хлебных крошек)
    // ----------------------------------------------------------------------------
    {
      method: "GET",
      path: "/catalog/product",
      handler: "moysklad-category.productBySlug",
      config: { auth: false },
    },
  ],
};
