'use strict';

const SHOULD_APPLY = process.env.APPLY === '1';

async function getProductsReadyForTemplate() {
  return strapi.db.query('api::moysklad-product.moysklad-product').findMany({
    select: ['id', 'name', 'slug'],
    populate: {
      category: {
        select: ['id', 'name', 'pathName'],
        populate: {
          defaultSpecificationTemplate: {
            select: ['id', 'name'],
          },
        },
      },
      specificationTemplate: {
        select: ['id', 'name'],
      },
    },
    limit: 10000,
  });
}

async function updateProductTemplate(product, template) {
  await strapi.db.query('api::moysklad-product.moysklad-product').update({
    where: { id: product.id },
    data: {
      specificationTemplate: template.id,
    },
  });
}

async function seedProductSpecificationTemplates() {
  const products = await getProductsReadyForTemplate();

  const withoutCategory = products.filter((product) => !product.category);

  const withoutCategoryTemplate = products.filter((product) => {
    return product.category && !product.category.defaultSpecificationTemplate;
  });

  const alreadyHasTemplate = products.filter((product) => {
    return Boolean(product.specificationTemplate);
  });

  const readyToUpdate = products.filter((product) => {
    return (
      !product.specificationTemplate &&
      product.category &&
      product.category.defaultSpecificationTemplate
    );
  });

  console.log(`Всего товаров: ${products.length}`);
  console.log(`Без категории: ${withoutCategory.length}`);
  console.log(`С категорией без шаблона: ${withoutCategoryTemplate.length}`);
  console.log(`Уже имеют шаблон: ${alreadyHasTemplate.length}`);
  console.log(`Будут обновлены: ${readyToUpdate.length}`);
  console.log(`Режим записи: ${SHOULD_APPLY ? 'APPLY=1, изменения будут записаны' : 'dry-run, без записи в базу'}`);
  console.log('');

  for (const product of readyToUpdate) {
    const template = product.category.defaultSpecificationTemplate;

    if (SHOULD_APPLY) {
      await updateProductTemplate(product, template);

      console.log(
        `Обновлено: ${product.name} → ${template.name} | категория: ${product.category.name}`
      );
    } else {
      console.log(
        `Будет обновлено: ${product.name} → ${template.name} | категория: ${product.category.name}`
      );
    }
  }

  console.log('');

  if (SHOULD_APPLY) {
    console.log(`Готово: товарам проставлены шаблоны: ${readyToUpdate.length}.`);
  } else {
    console.log(`Проверка завершена: к обновлению готово товаров: ${readyToUpdate.length}.`);
    console.log('Для записи в базу запусти: APPLY=1 npm run seed:product-spec-templates');
  }

  if (withoutCategoryTemplate.length) {
    console.log('');
    console.log('Товары без шаблона категории не обновлялись:');

    for (const product of withoutCategoryTemplate.slice(0, 30)) {
      console.log(
        `- ${product.name} | категория: ${product.category.name} | ${product.category.pathName || ''}`
      );
    }

    if (withoutCategoryTemplate.length > 30) {
      console.log(`...и ещё ${withoutCategoryTemplate.length - 30}`);
    }
  }
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    await seedProductSpecificationTemplates();
  } finally {
    await app.destroy();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
