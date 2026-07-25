'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const SPEC_TYPE_UID = 'api::specification-type.specification-type';

const CSV_FILE = process.env.CSV_FILE || 'imports/tilda-useful-small-things.csv';
const SERVER_PRODUCTS_PATH = process.env.SERVER_PRODUCTS_PATH || '/tmp/useful-small-things-server-products.tsv';
const APPLY = process.env.APPLY === '1';
const PRINT_LIMIT = Number(process.env.PRINT_LIMIT || 120);

const ALLOW_OVERWRITE_CODES = new Set([
  'BrshPipe',
  'CrkGlss',
  'DoskWhMini',
  'FunnelPlast',
  'GsrBtlBs',
  'GsrBtlLng',
  'GsrPrb',
  'Rinzer',
  'SpHl',
  'SpIceCr',
  'StrT',
]);

const TARGET_ITEMS = [
  {
    code: '1011501251',
    title: 'Бутылка тренировочная для флейринга Flybottle',
    specs: [
      ['Тип товара', 'Тренировочная бутылка'],
      ['Назначение', 'Для тренировки элементов флейринга'],
      ['Материал', 'Пластик'],
      ['Объем', '700 мл'],
      ['Высота', '285 мм'],
      ['Вес', '480 г'],
      ['Цвет / покрытие', 'Прозрачный; Белый; Неон'],
      ['Комплектация', 'Пластиковый гейзер'],
    ],
  },
  {
    code: 'BarMat',
    title: 'Коврик барный (каплесборник) резиновый',
    specs: [
      ['Тип товара', 'Барный коврик'],
      ['Назначение', 'Для сбора капель и проливов при работе с мокрым инвентарем'],
      ['Материал', 'Резина'],
      ['Габариты', '60×10 см; 60×20 см; 40×20 см; 45×30 см'],
      ['Особенности', 'Легко отмывается; Не впитывает запах'],
    ],
  },
  {
    code: 'BarMsh',
    title: 'Сетка барная, рулон 1 м, ширина 50 см, на отрез',
    specs: [
      ['Тип товара', 'Барная сетка'],
      ['Назначение', 'Подкладка под бокалы'],
      ['Материал', 'Пластик'],
      ['Габариты', '100×50 см'],
      ['Вес', '254 г за 1 м'],
      ['Цвет / покрытие', 'Черный; Белый'],
      ['Особенности', 'Отрезается на нужную длину'],
    ],
  },
  {
    code: 'CapperLid',
    title: 'Кроненпробки для бутылок 26 мм (50 шт.)',
    specs: [
      ['Тип товара', 'Кроненпробки'],
      ['Назначение', 'Для ручной укупорки бутылок 26 мм'],
      ['Диаметр', '26 мм'],
      ['Количество в упаковке', '50 шт.'],
      ['Цвет / покрытие', 'Черный; Серебро'],
      ['Особенности', 'Прокладка внутри'],
    ],
  },
  {
    code: 'Clmp',
    title: 'Зажим для пакетов',
    specs: [
      ['Тип товара', 'Зажим'],
      ['Назначение', 'Для пакетов'],
      ['Материал', 'Нержавеющая сталь'],
      ['Ширина', '4 см; 7 см'],
      ['Особенности', 'Можно нанести гравировку'],
    ],
  },
  {
    code: 'Dosk30/40',
    title: 'Доска разделочная пластиковая 40*30*0,8 см P.L. PROFF CUISINE',
    specs: [
      ['Тип товара', 'Доска разделочная'],
      ['Назначение', 'Для кухни и бара'],
      ['Материал', 'Пластик'],
      ['Габариты', '400×300×8 мм'],
      ['Вес', '894 г'],
      ['Цвет / покрытие', 'Белый; Коричневый'],
    ],
  },
  {
    code: 'FlyBtl',
    title: 'Бутылка тренировочная, эластичная для флейринга Flybottle',
    specs: [
      ['Тип товара', 'Тренировочная бутылка'],
      ['Назначение', 'Для тренировки элементов флейринга'],
      ['Материал', 'Силикон'],
      ['Объем', '700 мл'],
      ['Высота', '305 мм'],
      ['Вес', '440 г'],
      ['Цвет / покрытие', 'Красный; Зеленый; Белый; Желтый'],
    ],
  },
  {
    code: 'Gsr',
    title: 'Гейзер для бутылок металлический',
    specs: [
      ['Тип товара', 'Гейзер'],
      ['Назначение', 'Для контроля налива в двух режимах'],
      ['Материал', 'Нержавеющая сталь, TPR резина'],
      ['Длина', '11,3 см'],
      ['Цвет / покрытие', 'Серебро; Золото; Черный; Черный матовый'],
      ['Уход', 'Нельзя обрабатывать кипятком'],
    ],
  },
  {
    code: 'GzrFgr',
    title: 'Гейзер для бутылок металлический фигурный',
    specs: [
      ['Тип товара', 'Гейзер'],
      ['Тип', 'Фигурный'],
      ['Материал', 'Цинковый сплав, TPR резина'],
      ['Модель', 'Волк; Баран; Олень; Лев; Череп'],
      ['Комплектация', '1 шт.'],
      ['Уход', 'Нельзя обрабатывать кипятком'],
    ],
  },
  {
    code: 'MgnStrBl',
    title: 'Полоса магнитная черная',
    specs: [
      ['Тип товара', 'Магнитная полоса'],
      ['Назначение', 'Для хранения ножей, пиллеров и других инструментов'],
      ['Материал', 'Сталь, пластик'],
      ['Ширина', '4,8 см'],
      ['Длина', '48 см; 33 см; 20 см'],
      ['Цвет / покрытие', 'Черный'],
    ],
  },
  {
    code: 'MgnStrMtl',
    title: 'Полоса магнитная металлическая',
    specs: [
      ['Тип товара', 'Магнитная полоса'],
      ['Назначение', 'Для хранения ножей, пиллеров и других инструментов'],
      ['Материал', 'Сталь'],
      ['Ширина', '4,5 см'],
      ['Длина', '46 см; 31 см'],
      ['Цвет / покрытие', 'Металлический'],
    ],
  },
  {
    code: 'SetcSgun',
    title: 'Металлическая сетка для Smoking Gun',
    specs: [
      ['Тип товара', 'Сетка'],
      ['Назначение', 'Для Smoking Gun'],
      ['Материал', 'Металл'],
      ['Диаметр', '15 мм; 20 мм'],
      ['Комплектация', '1 шт.'],
      ['Особенности', 'Защита от высоких температур'],
    ],
  },
  {
    code: 'SinkBskt',
    title: 'Дуршлаг для раковины',
    specs: [
      ['Тип товара', 'Дуршлаг'],
      ['Назначение', 'Для мытья и сушки фруктов, овощей и посуды'],
      ['Материал', 'Сталь'],
      ['Габариты', '13 см; 21 см'],
      ['Особенности', 'Раздвижная конструкция; Ручки регулируются по длине'],
    ],
  },
  {
    code: 'Stncl',
    title: 'Трафарет металлический',
    specs: [
      ['Тип товара', 'Трафарет'],
      ['Назначение', 'Для украшения напитков с пеной'],
      ['Материал', 'Сталь'],
      ['Диаметр', '85 мм'],
      ['Модель', 'Сердце; Роза; Звезда'],
      ['Особенности', 'Размеры рисунков: сердце 40×35 мм; роза 50×35 мм; звезда 37×37 мм'],
      ['Уход', 'Можно мыть в посудомоечной машине'],
    ],
  },
  {
    code: 'TwlGls',
    title: 'Безворсовое полотно для натирки бокалов Base',
    specs: [
      ['Тип товара', 'Полотно для бокалов'],
      ['Назначение', 'Для натирки бокалов'],
      ['Материал', '100% хлопок'],
      ['Габариты', '40×40 см; 55×55 см'],
      ['Особенности', 'Не оставляет разводы и ворсинки; Впитывает влагу'],
    ],
  },
  {
    code: 'BrshPipe',
    title: 'Щеточка для чистки трубочек',
    specs: [
      ['Тип товара', 'Щетка'],
      ['Назначение', 'Для чистки многоразовых трубочек'],
      ['Длина', '20 см'],
    ],
  },
  {
    code: 'CrkGlss',
    title: 'Пробка для бутылок стеклянная',
    specs: [
      ['Тип товара', 'Пробка'],
      ['Назначение', 'Для бутылок и дропперов'],
      ['Материал', 'Пластик, стекло'],
      ['Высота', '5,5 см'],
      ['Диаметр', '2 см'],
    ],
  },
  {
    code: 'DoskWhMini',
    title: 'Доска разделочная пластиковая 29,5x20см',
    specs: [
      ['Тип товара', 'Доска разделочная'],
      ['Назначение', 'Для кухни и бара'],
      ['Материал', 'Пластик'],
      ['Габариты', '295×200×4 мм'],
      ['Вес', '200 г'],
    ],
  },
  {
    code: 'FunnelPlast',
    title: 'Мини воронка для налива биттеров',
    specs: [
      ['Тип товара', 'Воронка'],
      ['Назначение', 'Для налива жидкостей в узкое горлышко'],
      ['Материал', 'Пластик'],
      ['Особенности', 'Подходит для биттеров, форм для льда и фляжек'],
    ],
  },
  {
    code: 'GsrBtlBs',
    title: 'Гейзер для дроппера Base',
    specs: [
      ['Тип товара', 'Гейзер'],
      ['Тип', 'Base'],
      ['Назначение', 'Для дозации концентрированных биттеров, настоек и инфьюзов'],
      ['Материал', 'Нержавеющая сталь, пробка'],
      ['Совместимость', 'Дропперы с узким горлышком'],
    ],
  },
  {
    code: 'GsrBtlLng',
    title: 'Гейзер для дроппера Long',
    specs: [
      ['Тип товара', 'Гейзер'],
      ['Тип', 'Long'],
      ['Назначение', 'Для дозации концентрированных биттеров, настоек и инфьюзов'],
      ['Материал', 'Нержавеющая сталь, пробка'],
      ['Совместимость', 'Дропперы с узким горлышком'],
      ['Особенности', 'Более широкое горлышко по сравнению с базовым гейзером'],
    ],
  },
  {
    code: 'GsrPrb',
    title: 'Пробка для бутылок Toti',
    specs: [
      ['Тип товара', 'Пробка'],
      ['Назначение', 'Для бутылок'],
      ['Материал', 'Нержавеющая сталь, пробковое дерево'],
      ['Высота', '9 см'],
      ['Диаметр', 'До 2 см'],
      ['Особенности', 'Конусная форма'],
    ],
  },
  {
    code: 'Rinzer',
    title: 'Ринзер (омыватель) для бокалов, питчеров',
    specs: [
      ['Тип товара', 'Ринзер'],
      ['Назначение', 'Для мытья стаканов, чашек и питчеров'],
      ['Диаметр', '11,3 см'],
      ['Вес', '190 г'],
      ['Совместимость', 'Мойки, станции и спилстопы'],
    ],
  },
  {
    code: 'SpHl',
    title: 'Ложка-шумовка',
    specs: [
      ['Тип товара', 'Ложка-шумовка'],
      ['Назначение', 'Для приготовления молекулярной икры'],
      ['Материал', 'Сталь'],
    ],
  },
  {
    code: 'SpIceCr',
    title: 'Ложка для мороженого',
    specs: [
      ['Тип товара', 'Ложка для мороженого'],
      ['Назначение', 'Для формирования шариков мороженого'],
      ['Материал', 'Алюминий'],
      ['Длина', '17 см'],
      ['Особенности', 'Порция около 50 г мороженого'],
    ],
  },
  {
    code: 'StrT',
    title: 'Сито-щипцы',
    specs: [
      ['Тип товара', 'Сито-щипцы'],
      ['Назначение', 'Для посыпки сыпучими продуктами и подачи'],
      ['Материал', 'Нержавеющая сталь'],
      ['Особенности', 'Подходит для подачи с сухим льдом'],
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

function readServerItems(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');

      return {
        code: clean(parts[0]),
        id: clean(parts[1]),
        name: clean(parts[2]),
        slug: clean(parts[3]),
        specsCount: Number(parts[4] || 0),
      };
    });
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

function printCodeList(title, codes, itemByCode) {
  if (!codes.length) return;

  console.log('');
  console.log(title);
  console.log('------------------------------------------------');

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
  const serverProductsPath = path.resolve(SERVER_PRODUCTS_PATH);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV файл не найден: ${csvPath}`);
  }

  if (!fs.existsSync(serverProductsPath)) {
    throw new Error(`Файл серверных товаров не найден: ${serverProductsPath}`);
  }

  const finalItems = buildItems();
  const finalByCode = new Map(finalItems.map((item) => [item.code, item]));
  const finalCodes = [...finalByCode.keys()].sort();

  if (finalCodes.length !== finalItems.length) {
    throw new Error('В TARGET_ITEMS есть повторяющиеся code. Импорт остановлен.');
  }

  const serverItems = readServerItems(serverProductsPath);
  const serverByCode = new Map(serverItems.map((item) => [item.code, item]));
  const serverCodeSet = new Set(serverByCode.keys());

  const missingInCategory = finalCodes.filter((code) => !serverCodeSet.has(code));
  const untouchedEmpty = serverItems.filter((item) => item.specsCount === 0 && !finalByCode.has(item.code));

  console.log(APPLY ? 'Режим: APPLY=1, база будет изменена' : 'Режим: dry-run, база не меняется');
  console.log('------------------------------------------------');
  console.log(`CSV файл: ${csvPath}`);
  console.log(`Файл серверных товаров: ${serverProductsPath}`);
  console.log(`Товаров в серверной категории: ${serverItems.length}`);
  console.log(`Целевых товаров для импорта/исправления: ${finalItems.length}`);
  console.log(`Не хватает целевых товаров в серверной категории: ${missingInCategory.length}`);
  console.log(`Пустых товаров, которые НЕ трогаем сейчас: ${untouchedEmpty.length}`);

  printCodeList('Не хватает целевых товаров в серверной категории', missingInCategory, finalByCode);

  if (untouchedEmpty.length) {
    console.log('');
    console.log('Пустые товары НЕ в этом импорте');
    console.log('------------------------------------------------');

    for (const item of untouchedEmpty) {
      console.log(`${item.code} | ${item.name}`);
    }
  }

  if (missingInCategory.length) {
    throw new Error('Есть целевые товары, которых нет в серверной категории. Импорт остановлен.');
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
      printCodeList(
        'Не найдено товаров в Strapi',
        missingProducts.map((item) => item.code),
        finalByCode
      );

      throw new Error('Есть товары, которые не найдены в Strapi. Импорт остановлен.');
    }

    const filledNotAllowed = finalItems.filter((item) => {
      const product = productsByCode.get(item.code);
      const hasSpecs = (product.specifications || []).length > 0;

      return hasSpecs && !ALLOW_OVERWRITE_CODES.has(item.code);
    });

    if (filledNotAllowed.length) {
      printCodeList(
        'Уже есть характеристики, но перезапись для этих товаров не разрешена',
        filledNotAllowed.map((item) => item.code),
        finalByCode
      );

      throw new Error('Найдены заполненные товары вне списка разрешённой перезаписи. Импорт остановлен.');
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
      const mode = currentSpecs.length ? 'перезапись текущих характеристик' : 'заполнение пустого товара';

      if (printed < PRINT_LIMIT) {
        console.log('');
        console.log(`✅ ${item.code} | ${item.title}`);
        console.log(`Режим товара: ${mode}`);
        console.log(`Strapi: id=${product.id} | ${product.name}`);
        console.log(`Категория Strapi: ${product.category?.name || '-'}`);
        console.log(`Текущих характеристик: ${currentSpecs.length}`);

        if (currentSpecs.length) {
          console.log('Текущие характеристики:');

          for (const spec of currentSpecs) {
            console.log(`  OLD: ${spec.specification?.name || '-'} — ${spec.value}`);
          }
        }

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
      console.log(
        `APPLY=1 CSV_FILE=${CSV_FILE} SERVER_PRODUCTS_PATH=${SERVER_PRODUCTS_PATH} node ${process.argv[1]}`
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
