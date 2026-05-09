'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const SPECIFICATION_TYPE_UID = 'api::specification-type.specification-type';

const DEFAULT_CSV_FILE = 'imports/tilda-strainers.csv';
const CSV_FILE = process.env.CSV_FILE || DEFAULT_CSV_FILE;
const APPLY = process.env.APPLY === '1';
const PRINT_LIMIT = Number(process.env.PRINT_LIMIT || 40);

const REQUIRED_SPEC_TYPES = [
  'Тип товара',
  'Тип',
  'Материал',
  'Марка стали',
  'Цвет / покрытие',
  'Диаметр',
  'Длина',
  'Габариты',
  'Совместимость',
  'Особенности',
  'Уход',
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (char === ';' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }

      row.push(cell);

      if (row.some((value) => value.trim() !== '')) {
        rows.push(row);
      }

      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell || row.length > 0) {
    row.push(cell);

    if (row.some((value) => value.trim() !== '')) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => normalizeSpace(header.replace(/^\uFEFF/, '')));

  return rows.slice(1).map((values) => {
    const item = {};

    headers.forEach((header, index) => {
      item[header] = values[index] ?? '';
    });

    return item;
  });
}

function normalizeSku(value) {
  return String(value ?? '')
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/С/g, 'C')
    .replace(/с/g, 'c');
}

function normalizeSpace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|#nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function capitalizeFirst(value) {
  const text = normalizeSpace(value);

  if (!text) {
    return text;
  }

  return text[0].toUpperCase() + text.slice(1);
}

function unique(values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = normalizeSpace(value);

    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function normalizeNumber(value) {
  return String(value).replace(',', '.').replace(/\.$/, '');
}

function normalizeDimensionValue(value, unit) {
  const number = String(value).replace('.', ',');
  return `${number} ${unit}`;
}

function getRowSource(row, parentRow) {
  return [
    row.Title,
    row.Description,
    row.Text,
    row.Category,
    parentRow?.Title,
    parentRow?.Description,
    parentRow?.Text,
    parentRow?.Category,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join('\n');
}

function getEffectiveValue(row, parentRow, key) {
  return row[key] || parentRow?.[key] || '';
}

function getStrainerType(row, parentRow) {
  const sku = normalizeSku(row.SKU);
  const source = getRowSource(row, parentRow).toLowerCase();
  const category = cleanText(getEffectiveValue(row, parentRow, 'Category')).toLowerCase();
  const title = cleanText(row.Title).toLowerCase();

  if (sku === 'CoilStr' || title.includes('пружина для стрейнер')) {
    return 'Запасная часть';
  }

  if (category.includes('арт стрейнер')) {
    return 'Арт стрейнер';
  }

  if (category.includes('файн стрейнер') || title.includes('файн') || source.includes('файн-стрейнер')) {
    return 'Файн стрейнер';
  }

  if (category.includes('джулеп стрейнер') || title.includes('джулеп') || source.includes('джулеп-стрейнер')) {
    return 'Джулеп стрейнер';
  }

  if (category.includes('хоторн стрейнер') || title.includes('хоторн') || source.includes('хоторн-стрейнер')) {
    return 'Хоторн стрейнер';
  }

  return 'Стрейнер';
}

function getMaterial(source) {
  const lower = source.toLowerCase();

  if (lower.includes('нержав') || lower.includes('aisi') || lower.includes('аиси') || lower.includes('сталь')) {
    return 'Нержавеющая сталь';
  }

  return 'Нержавеющая сталь';
}

function getSteelGrade(source) {
  const match = source.match(/(?:AISI|АИСИ)\s*([0-9]{3})/i);

  if (!match?.[1]) {
    return null;
  }

  return `AISI ${match[1]}`;
}

function getColor(row) {
  const title = cleanText(row.Title);
  const sku = normalizeSku(row.SKU);
  const lowerTitle = title.toLowerCase();

  const afterDash = title.match(/\s-\s([^—–-]+)$/);

  if (afterDash?.[1]) {
    const color = getColorFromText(afterDash[1]);

    if (color) {
      return color;
    }
  }

  const titleColor = getColorFromText(title);

  if (titleColor && /серебро|золото|медь|черн|чёрн/i.test(lowerTitle)) {
    return titleColor;
  }

  if (/Sil$/i.test(sku)) return 'Серебро';
  if (/(Gold|Gld)$/i.test(sku)) return 'Золото';
  if (/Cop$/i.test(sku)) return 'Медь';
  if (/Bl$/i.test(sku)) return 'Черный';

  return null;
}

function getColorFromText(value) {
  const lower = String(value).toLowerCase();

  if (lower.includes('серебро') || lower.includes('серебря')) return 'Серебро';
  if (lower.includes('золото') || lower.includes('золот')) return 'Золото';
  if (lower.includes('медь') || lower.includes('медн')) return 'Медь';
  if (lower.includes('черный') || lower.includes('чёрный') || lower.includes('black')) return 'Черный';

  return null;
}

function getMainLength(source) {
  const patterns = [
    /(?:^|[•\n]\s*)Длина\s*:\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)/i,
    /Длина стрейнера\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)/i,
    /Длина всего изделия\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1] && match?.[2]) {
      return normalizeDimensionValue(normalizeNumber(match[1]), match[2]);
    }
  }

  return null;
}

function getMainDiameter(source, type) {
  const patterns = [
    /Максимм?альный диаметр\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)/i,
    /Диаметр стрейнера\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)/i,
    /Диаметр с пружиной\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)/i,
    /Диаметр "по умолчанию"\s*:?\s*([0-9]+(?:[,.][0-9]+)?(?:\s*-\s*[0-9]+(?:[,.][0-9]+)?)?)\s*(см|мм)/i,
    /Внешний диаметр кольца\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)/i,
    /Диаметр внешний\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)/i,
    /(?:^|[•\n]\s*)Диаметр\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1] && match?.[2]) {
      return normalizeDimensionValue(normalizeNumber(match[1]), match[2]);
    }
  }

  if (type === 'Файн стрейнер') {
    const titleLikeMatch = source.match(/файн-стрейнер[^.\n]*?([0-9]+(?:[,.][0-9]+)?)\s*см/i);

    if (titleLikeMatch?.[1]) {
      return normalizeDimensionValue(normalizeNumber(titleLikeMatch[1]), 'см');
    }
  }

  return null;
}

function getDimensions(source) {
  const match = source.match(/Размер стрейнера\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*[*×xх]\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)/i);

  if (!match?.[1] || !match?.[2] || !match?.[3]) {
    return null;
  }

  const width = String(match[1]).replace('.', ',');
  const height = String(match[2]).replace('.', ',');

  return `${width} × ${height} ${match[3]}`;
}

function extractFeatureDimension(source, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escapedLabel}\\s*:?\\s*([0-9]+(?:[,.][0-9]+)?(?:\\s*-\\s*[0-9]+(?:[,.][0-9]+)?)?)\\s*(см|мм)`, 'i');
  const match = source.match(pattern);

  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return `${label} ${String(match[1]).replace('.', ',')} ${match[2]}`;
}

function buildFeatures(row, parentRow, type) {
  const sku = normalizeSku(row.SKU);
  const source = getRowSource(row, parentRow);
  const lower = source.toLowerCase();
  const features = [];

  if (sku === 'CoilStr') {
    return ['Сменная пружина'];
  }

  if (lower.includes('арт стрейнер')) features.push('Арт-серия');
  if (lower.includes('эксклюзивн') || lower.includes('уникальн')) features.push('Эксклюзивный дизайн');
  if (lower.includes('узор')) features.push('Узор на рабочей поверхности');
  if (lower.includes('объемный узор') || lower.includes('объёмный узор')) features.push('Объемный узор');

  if (lower.includes('гравиров')) {
    if (lower.includes('трехцвет') || lower.includes('трёхцвет')) {
      features.push('Трехцветная гравировка');
    } else if (lower.includes('двухцвет')) {
      features.push('Двухцветная гравировка');
    } else if (lower.includes('цветная гравировка') || lower.includes('цветными элементами')) {
      features.push('Цветная гравировка');
    } else if (lower.includes('черная гравировка') || lower.includes('чёрная гравировка')) {
      features.push('Черная гравировка');
    } else if (lower.includes('белая гравировка')) {
      features.push('Белая гравировка');
    } else if (lower.includes('глубокая гравировка')) {
      features.push('Глубокая гравировка');
    } else {
      features.push('Гравировка по поверхности');
    }
  }

  if (lower.includes('под гравировку') || lower.includes('вашей гравировкой') || lower.includes('вашего лого')) {
    features.push('Подходит для индивидуальной гравировки');
  }

  if (lower.includes('полностью ручная работа') || lower.includes('ручная работа')) features.push('Ручная работа');
  if (lower.includes('лазер')) features.push('Лазерная резка');
  if (lower.includes('шлифовк')) features.push('Ручная шлифовка');

  if (lower.includes('плотное прилегание')) features.push('Плотное прилегание к смесительной емкости');
  if (lower.includes('новой системе встраивания пружины') || lower.includes('встраивания пружины')) {
    features.push('Встроенная пружина');
  }

  if (lower.includes('без ушек')) features.push('Без ушек');
  if (lower.includes('с ушками') || lower.includes('есть ушки')) features.push('С ушками');
  if (lower.includes('есть рожки')) features.push('Рожки вместо ручки');
  if (lower.includes('без рукоятки') || lower.includes('ручки нет')) features.push('Без рукоятки');
  if (lower.includes('укороченная рукоятка') || lower.includes('короткой рукояткой')) features.push('Укороченная рукоятка');

  if (lower.includes('не погружной') || lower.includes('непогружной')) {
    features.push('Непогружной');
  } else if (lower.includes('погружной')) {
    features.push('Погружной');
  }

  if (lower.includes('изгиб для крепления') || lower.includes('имеет изгиб')) {
    features.push('Изгиб для крепления к смесительной емкости');
  }

  if (lower.includes('изогнутой ручкой') || lower.includes('изгиб рукоятки на 90')) {
    features.push('Изгиб рукоятки на 90°');
  }

  if (lower.includes('мелкая сетка')) features.push('Мелкая сетка');
  if (lower.includes('очень мелкая сетка')) features.push('Очень мелкая сетка');
  if (lower.includes('двойной сеткой') || lower.includes('двойная сетка')) features.push('Двойная сетка');
  if (lower.includes('глубокий') || lower.includes('глубина сита')) features.push('Глубокое сито');
  if (lower.includes('без ручки')) features.push('Без ручки');
  if (lower.includes('с ручкой')) features.push('С ручкой');

  if (lower.includes('болты по периметру') || lower.includes('винты по периметру') || lower.includes('клёпки') || lower.includes('клепки') || lower.includes('проклёпан')) {
    features.push('Усиленное крепление сетки');
  }

  if (lower.includes('форма овала') || lower.includes('форме овала')) features.push('Овальная форма');
  if (lower.includes('форме ракушки')) features.push('Форма ракушки');
  if (lower.includes('форме треугольника') || lower.includes('треугольный')) features.push('Треугольная форма');
  if (lower.includes('лепестки гнутся')) features.push('Гибкие лепестки');

  if (lower.includes('реплика')) features.push('Реплика прототипа');
  if (lower.includes('прочная нержавеющая сталь') || lower.includes('прочная сталь') || lower.includes('толстую и прочную сталь')) {
    features.push('Прочная сталь');
  }
  if (lower.includes('легкой моделью') || lower.includes('лёгкой моделью') || lower.includes('легкий') || lower.includes('лёгкий')) {
    features.push('Легкая конструкция');
  }

  if (lower.includes('лимитированная серия')) features.push('Лимитированная серия');
  if (lower.includes('разливать в 2 бокала') || lower.includes('в 2 бокала одновременно')) {
    features.push('Позволяет разливать в два бокала одновременно');
  }

  const featureDimensions = [
    extractFeatureDimension(source, 'Длина ручки'),
    extractFeatureDimension(source, 'Диаметр пружины'),
    extractFeatureDimension(source, 'Диаметр ячейки'),
    extractFeatureDimension(source, 'Глубина сита'),
    extractFeatureDimension(source, 'Длина лепестка'),
    extractFeatureDimension(source, 'Размах крыльев'),
  ].filter(Boolean);

  features.push(...featureDimensions);

  if (type === 'Арт стрейнер') {
    features.unshift('Хоторн-форма');
  }

  return unique(features).map(capitalizeFirst).slice(0, 10);
}

function getCare(source) {
  const lower = source.toLowerCase();

  if (lower.includes('не мыть в посудомоечной машине') || lower.includes('посудомоеч')) {
    return 'Не мыть в посудомоечной машине';
  }

  return null;
}

function makeSpec(label, value, specTypeByName) {
  const type = specTypeByName.get(label);

  if (!type) {
    throw new Error(`Не найден тип характеристики: ${label}`);
  }

  return {
    label,
    value,
    specification: {
      id: type.id,
    },
  };
}

function buildStrainerSpecifications(row, parentRow, specTypeByName) {
  const sku = normalizeSku(row.SKU);
  const source = getRowSource(row, parentRow);
  const type = getStrainerType(row, parentRow);
  const specs = [];

  if (sku === 'CoilStr') {
    specs.push(makeSpec('Тип товара', 'Пружина для стрейнера', specTypeByName));
    specs.push(makeSpec('Тип', 'Запасная часть', specTypeByName));
    specs.push(makeSpec('Материал', 'Нержавеющая сталь', specTypeByName));
    specs.push(makeSpec('Совместимость', 'Для стрейнеров Cocktail Design', specTypeByName));
    specs.push(makeSpec('Особенности', 'Сменная пружина', specTypeByName));

    return specs;
  }

  specs.push(makeSpec('Тип товара', 'Стрейнер', specTypeByName));
  specs.push(makeSpec('Тип', type, specTypeByName));
  specs.push(makeSpec('Материал', getMaterial(source), specTypeByName));

  const steelGrade = getSteelGrade(source);
  const color = getColor(row);
  const diameter = getMainDiameter(source, type);
  const length = getMainLength(source);
  const dimensions = getDimensions(source);
  const features = buildFeatures(row, parentRow, type);
  const care = getCare(source);

  if (steelGrade) specs.push(makeSpec('Марка стали', steelGrade, specTypeByName));
  if (color) specs.push(makeSpec('Цвет / покрытие', color, specTypeByName));
  if (diameter) specs.push(makeSpec('Диаметр', diameter, specTypeByName));
  if (length) specs.push(makeSpec('Длина', length, specTypeByName));
  if (dimensions) specs.push(makeSpec('Габариты', dimensions, specTypeByName));
  if (features.length > 0) specs.push(makeSpec('Особенности', features.join('; '), specTypeByName));
  if (care) specs.push(makeSpec('Уход', care, specTypeByName));

  return specs;
}

async function main() {
  const absoluteCsvPath = path.resolve(process.cwd(), CSV_FILE);

  if (!fs.existsSync(absoluteCsvPath)) {
    throw new Error(`CSV файл не найден: ${absoluteCsvPath}`);
  }

  const rows = parseCsv(fs.readFileSync(absoluteCsvPath, 'utf-8'));
  const parentByUid = new Map();

  for (const row of rows) {
    const uid = normalizeSpace(row['Tilda UID']);

    if (uid) {
      parentByUid.set(uid, row);
    }
  }

  const productRows = rows.filter((row) => normalizeSku(row.SKU));

  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    const specTypes = await strapi.db.query(SPECIFICATION_TYPE_UID).findMany({
      select: ['id', 'name'],
      limit: 1000,
    });

    const specTypeByName = new Map(specTypes.map((type) => [type.name, type]));
    const missingSpecTypes = REQUIRED_SPEC_TYPES.filter((name) => !specTypeByName.has(name));

    if (missingSpecTypes.length > 0) {
      throw new Error(`Не найдены типы характеристик: ${missingSpecTypes.join(', ')}`);
    }

    const products = await strapi.db.query(PRODUCT_UID).findMany({
      select: ['id', 'name', 'code'],
      populate: {
        specifications: {
          populate: {
            specification: {
              select: ['id', 'name'],
            },
          },
        },
      },
      limit: 100000,
    });

    const productByCode = new Map();

    for (const product of products) {
      const code = normalizeSku(product.code);

      if (code) {
        productByCode.set(code, product);
      }
    }

    const items = [];
    const missingProducts = [];

    for (const row of productRows) {
      const sku = normalizeSku(row.SKU);
      const parentUid = normalizeSpace(row['Parent UID']);
      const parentRow = parentUid ? parentByUid.get(parentUid) : null;
      const product = productByCode.get(sku);

      if (!product) {
        missingProducts.push({
          sku,
          title: normalizeSpace(row.Title),
        });
        continue;
      }

      const specifications = buildStrainerSpecifications(row, parentRow, specTypeByName);

      items.push({
        sku,
        row,
        parentRow,
        product,
        specifications,
      });
    }

    const typeCounters = new Map();

    for (const item of items) {
      const typeSpec = item.specifications.find((spec) => spec.label === 'Тип');
      const type = typeSpec?.value ?? 'Без типа';
      typeCounters.set(type, (typeCounters.get(type) ?? 0) + 1);
    }

    console.log('');
    console.log(APPLY ? 'Режим: APPLY=1, характеристики будут записаны' : 'Режим: dry-run, база не меняется');
    console.log('------------------------------------------------');
    console.log(`CSV файл: ${absoluteCsvPath}`);
    console.log(`CSV строк всего: ${rows.length}`);
    console.log(`Строк с SKU: ${productRows.length}`);
    console.log(`Найдено товаров в Strapi: ${items.length}`);
    console.log(`Не найдено товаров в Strapi: ${missingProducts.length}`);
    console.log('');
    console.log('Разбивка по типам');
    console.log('-----------------');

    for (const [type, count] of Array.from(typeCounters.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
      console.log(`${type}: ${count}`);
    }

    if (missingProducts.length > 0) {
      console.log('');
      console.log('Не найдены товары');
      console.log('-----------------');

      for (const item of missingProducts) {
        console.log(`❌ ${item.sku} | ${item.title}`);
      }
    }

    console.log('');
    console.log(`Что будет записано${items.length > PRINT_LIMIT ? ` — показаны первые ${PRINT_LIMIT} из ${items.length}` : ''}`);
    console.log('------------------');

    for (const item of items.slice(0, PRINT_LIMIT)) {
      const title = normalizeSpace(item.row.Title);
      const currentSpecs = item.product.specifications ?? [];

      console.log('');
      console.log(`✅ ${item.sku} | ${title}`);
      console.log(`Strapi: id=${item.product.id} | ${item.product.name}`);
      console.log(`Текущих характеристик: ${currentSpecs.length}`);

      for (const spec of item.specifications) {
        console.log(`  ${spec.label} — ${spec.value}`);
      }
    }

    if (!APPLY) {
      console.log('');
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи после проверки на текущей базе:');
      console.log('APPLY=1 CSV_FILE=imports/tilda-strainers.csv node scripts/import-tilda-strainers-specs.js');
      return;
    }

    let updatedCount = 0;

    for (const item of items) {
      await strapi.entityService.update(PRODUCT_UID, item.product.id, {
        data: {
          specifications: item.specifications,
        },
      });

      updatedCount += 1;
    }

    console.log('');
    console.log(`Готово. Обновлено товаров: ${updatedCount}`);
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
