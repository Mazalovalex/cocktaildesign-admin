'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const SPEC_TYPE_UID = 'api::specification-type.specification-type';

const CSV_FILE = process.env.CSV_FILE || 'imports/tilda-barista.csv';
const SERVER_CODES_PATH = process.env.SERVER_CODES_PATH || '/tmp/barista-empty-products.tsv';
const APPLY = process.env.APPLY === '1';
const PRINT_LIMIT = Number(process.env.PRINT_LIMIT || 80);

const TARGET_ITEMS = [
  {
    code: 'Distr58',
    title: 'Дистрибьютор 58 мм',
    specs: [
      ['Тип товара', 'Дистрибьютор'],
      ['Материал', 'Нержавеющая сталь, алюминий'],
      ['Диаметр', '58 мм'],
    ],
  },
  {
    code: 'PitBl',
    title: 'Питчер черный',
    specs: [
      ['Тип товара', 'Питчер'],
      ['Материал', 'Нержавеющая сталь'],
      ['Объем', '350 мл; 600 мл'],
      ['Особенности', 'Тефлоновое покрытие'],
    ],
  },
  {
    code: 'PitItly',
    title: 'Питчер Italy',
    specs: [
      ['Тип товара', 'Питчер'],
      ['Материал', 'Нержавеющая сталь'],
      ['Объем', '350 мл; 500 мл; 750 мл'],
    ],
  },
  {
    code: 'PitMtl',
    title: 'Питчер классический',
    specs: [
      ['Тип товара', 'Питчер'],
      ['Материал', 'Нержавеющая сталь'],
      ['Объем', '150 мл; 350 мл; 600 мл'],
    ],
  },
  {
    code: 'PitMtlDvs',
    title: 'Питчер с делениями',
    specs: [
      ['Тип товара', 'Питчер'],
      ['Материал', 'Нержавеющая сталь'],
      ['Объем', '350 мл; 600 мл; 900 мл'],
      ['Особенности', 'Деления/насечки для измерения жидкости'],
    ],
  },
  {
    code: 'PitWht',
    title: 'Питчер с делениями белый',
    specs: [
      ['Тип товара', 'Питчер'],
      ['Материал', 'Нержавеющая сталь'],
      ['Цвет / покрытие', 'Слоновая кость'],
      ['Объем', '350 мл; 600 мл'],
      ['Особенности', 'Деления/насечки для измерения жидкости'],
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

function readServerCodes(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.split('\t')[0])
    .map(clean)
    .filter(Boolean);
}

function buildItems() {
  return TARGET_ITEMS.map((item) => {
    const specs = [];

    for (const [name, value] of item.specs) {
      const specName = clean(name);
      const specValue = normalizeSpaces(value);

      if (!APPROVED_SPEC_NAMES.has(specName)) {
        throw new Error(`Запрещённая характеристика: ${specName}`);
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

function printCodeDiff(title, codes, itemByCode) {
  if (!codes.length) return;

  console.log('');
  console.log(title);
  console.log('----------------------------------------------');

  for (const code of codes) {
    const item = itemByCode.get(code);

    console.log(`${code}${item ? ` | ${item.title}` : ''}`);
  }
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
  const csvPath = path.resolve(process.cwd(), CSV_FILE);
  const serverCodesPath = path.resolve(SERVER_CODES_PATH);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV файл не найден: ${csvPath}`);
  }

  if (!fs.existsSync(serverCodesPath)) {
    throw new Error(`Server codes файл не найден: ${serverCodesPath}`);
  }

  const finalItems = buildItems();
  const finalByCode = new Map(finalItems.map((item) => [item.code, item]));
  const finalCodes = [...finalByCode.keys()].sort();

  const serverCodes = readServerCodes(serverCodesPath).sort();
  const serverCodeSet = new Set(serverCodes);
  const finalCodeSet = new Set(finalCodes);

  const missingOnServer = finalCodes.filter((code) => !serverCodeSet.has(code));
  const extraOnServer = serverCodes.filter((code) => !finalCodeSet.has(code));

  console.log(APPLY ? 'Режим: APPLY=1, база будет изменена' : 'Режим: dry-run, база не меняется');
  console.log('------------------------------------------------');
  console.log(`CSV файл: ${csvPath}`);
  console.log(`Server codes файл: ${serverCodesPath}`);
  console.log(`Итоговый набор импорта: ${finalItems.length}`);
  console.log(`Серверная категория товаров: ${serverCodes.length}`);
  console.log(`Не хватает на сервере: ${missingOnServer.length}`);
  console.log(`Лишние на сервере относительно импорта: ${extraOnServer.length}`);

  printCodeDiff('Не хватает на сервере', missingOnServer, finalByCode);
  printCodeDiff('Лишние на сервере относительно импорта', extraOnServer, finalByCode);

  if (missingOnServer.length || extraOnServer.length) {
    throw new Error('Итоговый набор импорта не совпадает с серверной категорией. Импорт остановлен.');
  }

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
      printCodeDiff(
        'Не найдено товаров в Strapi',
        missingProducts.map((item) => item.code),
        finalByCode
      );

      throw new Error('Есть товары, которые не найдены в Strapi. Импорт остановлен.');
    }

    const productsWithSpecs = finalItems.filter((item) => {
      const product = productsByCode.get(item.code);

      return (product.specifications || []).length > 0;
    });

    if (productsWithSpecs.length) {
      printCodeDiff(
        'Уже есть характеристики, импорт остановлен',
        productsWithSpecs.map((item) => item.code),
        finalByCode
      );

      throw new Error('Есть товары с уже заполненными характеристиками. Импорт остановлен.');
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
      const currentSpecs = product.specifications || [];

      if (printed < PRINT_LIMIT) {
        console.log('');
        console.log(`✅ ${item.code} | ${item.title}`);
        console.log(`Strapi: id=${product.id} | ${product.name}`);
        console.log(`Категория Strapi: ${product.category?.name || '-'}`);
        console.log(`Текущих характеристик: ${currentSpecs.length}`);

        for (const spec of item.specs) {
          console.log(`  ${spec.name} — ${spec.value}`);
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
      console.log(
        `APPLY=1 CSV_FILE=${CSV_FILE} SERVER_CODES_PATH=${SERVER_CODES_PATH} node ${process.argv[1]}`
      );
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
