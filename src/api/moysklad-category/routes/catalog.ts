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
    // Сейчас это заглушка: на следующем шаге добавим реальную логику и выборку из БД.
    // ----------------------------------------------------------------------------
    {
      method: "GET",
      path: "/catalog/products",
      handler: "moysklad-category.products",
      config: {
        auth: false,
      },
    },
		
    // получить товар по ID
    {
      method: "GET",
      path: "/catalog/products-by-ids",
      handler: "moysklad-category.productsByIds",
      config: { auth: false },
    },
  ],
};
