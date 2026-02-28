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
    // Пока это только роут: на следующем шаге добавим метод в controller.
    // ----------------------------------------------------------------------------
    {
      method: "GET",
      path: "/catalog/products",
      handler: "moysklad-category.products",
      config: {
        auth: false,
      },
    },
  ],
};
