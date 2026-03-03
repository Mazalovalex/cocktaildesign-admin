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
    // ----------------------------------------------------------------------------
    {
      method: "GET",
      path: "/catalog/product",
      handler: "moysklad-category.productBySlug",
      config: { auth: false },
    },

    // ----------------------------------------------------------------------------
    // Поиск товаров по названию
    // GET /api/catalog/search?q=шейкер
    // ----------------------------------------------------------------------------
    {
      method: "GET",
      path: "/catalog/search",
      handler: "moysklad-category.search",
      config: { auth: false },
    },
  ],
};
