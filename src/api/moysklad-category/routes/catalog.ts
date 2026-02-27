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
  ],
};
