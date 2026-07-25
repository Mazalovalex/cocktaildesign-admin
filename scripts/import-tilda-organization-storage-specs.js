'use strict';

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const SPEC_TYPE_UID = 'api::specification-type.specification-type';

const APPLY = process.env.APPLY === '1';
const PRINT_LIMIT = Number(process.env.PRINT_LIMIT || 50);

const TARGET_CATEGORY_NAME = 'Органайзеры';

const TARGET_ITEMS = [
  {
    code: 'BarOgrMtl',
    title: 'Барный органайзер металлический',
    specs: [
      ['Тип товара', 'Органайзер'],
      ['Тип', 'Барный органайзер'],
      ['Назначение', 'Хранение заготовок, фруктов, орехов и декора'],
      ['Материал', 'Сталь, пластик'],
      ['Габариты', '6 ячеек: 46×15×9 см; 4 ячейки: 30×15×9 см; 3 ячейки: 23×15×9 см'],
      ['Комплектация', '3, 4 или 6 ячеек'],
      ['Особенности', 'Размер ячейки: 14,5×7,5×5 см'],
    ],
  },
  {
    code: 'BarOgrPlst',
    title: 'Барный органайзер',
    specs: [
      ['Тип товара', 'Органайзер'],
      ['Тип', 'Барный органайзер'],
      ['Назначение', 'Хранение заготовок, фруктов, орехов и декора'],
      ['Материал', 'Пластик'],
      ['Габариты', '49×16×9 см'],
      ['Комплектация', '3, 4 или 6 ячеек'],
      ['Особенности', 'Размер ячейки для 6 ячеек: 6,5×13×7 см; для 4 ячеек: 10×13×7 см; для 3 ячеек: 14×13×7 см'],
    ],
  },
];

const APPROVED_SPEC_NAMES = new Set([
  'Тип товара',
  'Тип',
  'Назначение',
  'Материал',
  'Марка стали',
  'Цвет / покрытие',
  'Объем',
  'Габариты',
  'Длина',
  'Ширина',
  'Высота',
  'Диаметр',
  'Вес',
  'Количество в упаковке',
  'Комплектация',
  'Совместимость',
  'Особенности',
  'Уход',
  'Состав',
  'Вкус и аромат',
  'Способ применения',
  'Условия хранения',
  'Срок годности',
  'Производитель',
  'Модель',
  'Мощность',
  'Напряжение',
  'Производительность',
  'Тип охлаждения',
  'Хладагент',
  'Температурный режим',
  'Тип льда',
  'Размер льда',
  'Гарантия',
  'Толщина металла',
  'Борт',
  'Снос ног',
  'Регулировка по высоте',
]);

function clean(value) {
  return String(value ?? '').trim().replace(/\uFEFF/g, '');
}

function normalizeSpaces(value) {
  return clean(value).replace(/\s+/g, ' ');
}

function buildItems() {
  return TARGET_ITEMS.map((item) => {
    const specs = [];

    for (const [name, value] of item.specs) {
      const specName = clean(name);
      const specValue = normalizeSpaces(value);

      if (!APPROVED_SPEC_NAMES.has(specName)) {
        throw new Error(`Запрещённая характеристика: ${item.code} | ${specName}`);
      }

      if (!specValue) {
        throw new Error(`Пустая характеристика: ${item.code} | ${specName}`);
      }

      specs.push({
        name: specName,
        value: specValue,
      });
    }

    return {
      code: item.code,
      title: item.title,
      specs,
    };
  });
}

async function getSpecTypeIds(usedSpecNames) {
  const result = {};
  const missing = [];

  for (const name of usedSpecNames) {
    let existing = await strapi.db.query(SPEC_TYPE_UID).findOne({
      where: { name },
    });

    if (!existing) {
      missing.push(name);

      if (APPLY) {
        existing = await strapi.db.query(SPEC_TYPE_UID).create({
          data: { name },
        });
      }
    }

    if (existing) {
      result[name] = existing.id;
    }
  }

  if (missing.length) {
    console.log('');
    console.log(APPLY ? 'Созданы specification-type:' : 'Будут созданы specification-type при APPLY=1:');

    for (const name of missing) {
      console.log(`- ${name}`);
    }
  }

  return result;
}

function toStrapiSpecifications(specs, specTypeIds) {
  return specs.map((item) => {
    const specificationId = specTypeIds[item.name];

    if (!specificationId) {
      throw new Error(`Нет id для specification-type: ${item.name}`);
    }

    return {
      specification: specificationId,
      value: item.value,
    };
  });
}

async function main() {
  const finalItems = buildItems();
  const finalCodes = finalItems.map((item) => item.code);

  if (new Set(finalCodes).size !== finalCodes.length) {
    throw new Error('В TARGET_ITEMS есть повторяющиеся code. Импорт остановлен.');
  }

  console.log(APPLY ? 'Режим: APPLY=1, база будет изменена' : 'Режим: dry-run, база не меняется');
  console.log('------------------------------------------------');
  console.log(`Целевых товаров: ${finalItems.length}`);
  console.log(`Категория должна быть: ${TARGET_CATEGORY_NAME}`);

  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  try {
    const products = await strapi.db.query(PRODUCT_UID).findMany({
      where: {
        code: {
          $in: finalCodes,
        },
      },
      populate: {
        category: true,
        specifications: {
          populate: {
            specification: true,
          },
        },
      },
      limit: 10000,
    });

    const productsByCode = new Map(products.map((product) => [product.code, product]));

    const missingProducts = finalItems.filter((item) => !productsByCode.has(item.code));

    console.log(`Найдено товаров в Strapi: ${products.length}`);
    console.log(`Не найдено товаров в Strapi: ${missingProducts.length}`);

    if (missingProducts.length) {
      console.log('');
      console.log('Не найдено товаров:');
      console.log('------------------------------------------------');

      for (const item of missingProducts) {
        console.log(`${item.code} | ${item.title}`);
      }

      throw new Error('Есть товары, которые не найдены в Strapi. Импорт остановлен.');
    }

    const wrongCategory = finalItems.filter((item) => {
      const product = productsByCode.get(item.code);
      return product.category?.name !== TARGET_CATEGORY_NAME;
    });

    if (wrongCategory.length) {
      console.log('');
      console.log('Товары не в нужной категории:');
      console.log('------------------------------------------------');

      for (const item of wrongCategory) {
        const product = productsByCode.get(item.code);
        console.log(`${item.code} | ${product.category?.name || '-'} | ${product.name}`);
      }

      throw new Error('Есть товары не из категории "Органайзеры". Импорт остановлен.');
    }

    const alreadyFilled = finalItems.filter((item) => {
      const product = productsByCode.get(item.code);
      return (product.specifications || []).length > 0;
    });

    if (alreadyFilled.length) {
      console.log('');
      console.log('Уже есть характеристики, импорт остановлен:');
      console.log('------------------------------------------------');

      for (const item of alreadyFilled) {
        const product = productsByCode.get(item.code);
        console.log(`${item.code} | specs=${product.specifications.length} | ${product.name}`);
      }

      throw new Error('Есть уже заполненные товары. Импорт остановлен.');
    }

    const usedSpecNames = [
      ...new Set(finalItems.flatMap((item) => item.specs.map((spec) => spec.name))),
    ];

    const specTypeIds = await getSpecTypeIds(usedSpecNames);

    console.log('');
    console.log(`Что будет записано — показаны первые ${PRINT_LIMIT} из ${finalItems.length}`);
    console.log('------------------------------------------------');

    let printed = 0;
    let updatedCount = 0;

    for (const item of finalItems) {
      const product = productsByCode.get(item.code);

      if (printed < PRINT_LIMIT) {
        console.log('');
        console.log(`✅ ${item.code} | ${item.title}`);
        console.log(`Strapi: id=${product.id} | ${product.name}`);
        console.log(`Категория Strapi: ${product.category?.name || '-'}`);
        console.log(`Текущих характеристик: ${product.specifications?.length || 0}`);
        console.log('Новые характеристики:');

        for (const spec of item.specs) {
          console.log(`  NEW: ${spec.name} — ${spec.value}`);
        }

        printed += 1;
      }

      if (!APPLY) continue;

      await strapi.entityService.update(PRODUCT_UID, product.id, {
        data: {
          specifications: toStrapiSpecifications(item.specs, specTypeIds),
        },
      });

      updatedCount += 1;
    }

    console.log('');

    if (!APPLY) {
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи после проверки:');
      console.log(`APPLY=1 node ${process.argv[1]}`);
    } else {
      console.log(`Готово. Обновлено товаров: ${updatedCount}`);
    }
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
