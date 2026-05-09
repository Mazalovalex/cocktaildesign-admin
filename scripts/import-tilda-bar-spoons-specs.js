'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';

const CSV_FILE = process.env.CSV_FILE || 'imports/tilda-bar-spoons.csv';
const APPLY = process.env.APPLY === '1';
const PRINT_LIMIT = Number(process.env.PRINT_LIMIT || 80);

const SKU_ALIASES = {
  'SpPn44Sil-1': 'SpPn44Sil',
};

const SKIPPED_SKUS = new Set([
  'SpDr40Cop', // В серверной Strapi сейчас нет нормального товара с этим SKU.
]);

const SPEC_ORDER = [
  'Тип товара',
  'Тип',
  'Материал',
  'Марка стали',
  'Цвет / покрытие',
  'Длина',
  'Особенности',
  'Уход',
];

function normalizeSku(value) {
  return String(value ?? '')
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/С/g, 'C')
    .replace(/с/g, 'c');
}

function getStrapiSku(csvSku) {
  const normalizedSku = normalizeSku(csvSku);
  return SKU_ALIASES[normalizedSku] || normalizedSku;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === ';' && !insideQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i += 1;
      }

      row.push(cell);

      if (row.some((value) => String(value).trim() !== '')) {
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
    rows.push(row);
  }

  return rows;
}

function rowsToObjects(rows) {
  const header = rows[0].map((name) => cleanText(name));

  return rows.slice(1)
    .map((row) => {
      const result = {};

      header.forEach((name, index) => {
        result[name] = row[index] ?? '';
      });

      return result;
    })
    .filter((row) => cleanText(row['Tilda UID']) !== 'Tilda UID');
}

function unique(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = cleanText(value);

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

function capitalizeFirst(value) {
  const text = cleanText(value);

  if (!text) {
    return '';
  }

  return text[0].toUpperCase() + text.slice(1);
}

function normalizeNumber(value) {
  return String(value ?? '').replace(',', '.').trim();
}

function normalizeLengthValue(value, unit) {
  const normalizedValue = normalizeNumber(value).replace('.', ',');
  const normalizedUnit = String(unit ?? '').toLowerCase().replace('.', '');

  return `${normalizedValue} ${normalizedUnit}`;
}

function getEffectiveValue(row, parentRow, key) {
  const ownValue = cleanText(row[key]);

  if (ownValue) {
    return ownValue;
  }

  return cleanText(parentRow?.[key]);
}

function getRowSource(row, parentRow) {
  return [
    cleanText(row.Title),
    cleanText(row.Description),
    cleanText(row.Text),
    cleanText(row.Category),
    cleanText(parentRow?.Title),
    cleanText(parentRow?.Description),
    cleanText(parentRow?.Text),
    cleanText(parentRow?.Category),
  ].filter(Boolean).join(' ');
}

function getSpoonType(row, parentRow) {
  const sku = normalizeSku(row.SKU).toLowerCase();
  const source = getRowSource(row, parentRow).toLowerCase();
  const title = cleanText(row.Title).toLowerCase();

  if (
    source.includes('стиррер') ||
    source.includes('stirrer') ||
    source.includes('swizzle') ||
    sku.startsWith('strr') ||
    sku.startsWith('swzzl')
  ) {
    return 'Стиррер';
  }

  if (title.includes('стрейнер') || source.includes('ложка-стрейнер')) {
    return 'Ложка-стрейнер';
  }

  if (title.includes('мадлер') || source.includes('ложка-мадлер')) {
    return 'Ложка-мадлер';
  }

  if (title.includes('вилка') || source.includes('ложка-вилка')) {
    return 'Ложка-вилка';
  }

  if (source.includes('телескоп')) {
    return 'Телескопическая ложка';
  }

  if (source.includes('абсент')) {
    return 'Ложка для абсента';
  }

  return 'Ложка';
}

function getProductType(spoonType) {
  if (spoonType === 'Стиррер') {
    return 'Стиррер';
  }

  if (spoonType === 'Ложка для абсента') {
    return 'Ложка для абсента';
  }

  return 'Барная ложка';
}

function getMaterial(row, parentRow) {
  const source = getRowSource(row, parentRow).toLowerCase();

  if (source.includes('полипропилен')) {
    return 'Полипропилен';
  }

  if (source.includes('пластик')) {
    return 'Пластик';
  }

  if (source.includes('дерево') || source.includes('дерев')) {
    return 'Дерево';
  }

  if (source.includes('латунь')) {
    return 'Латунь';
  }

  if (source.includes('стекло')) {
    return 'Стекло';
  }

  return 'Нержавеющая сталь';
}

function getSteelGrade(row, parentRow) {
  const source = getRowSource(row, parentRow);
  const match = source.match(/AISI\s*([0-9]{3})/i);

  if (!match) {
    return null;
  }

  return `AISI ${match[1]}`;
}

function getColor(row, parentRow) {
  const source = getRowSource(row, parentRow).toLowerCase();

  if (
    source.includes('серебро') ||
    source.includes('серебрист') ||
    source.includes('silver')
  ) {
    return 'Серебро';
  }

  if (source.includes('золото') || source.includes('gold')) {
    return 'Золото';
  }

  if (source.includes('медь') || source.includes('copper')) {
    return 'Медь';
  }

  if (source.includes('черный') || source.includes('чёрный') || source.includes('black')) {
    return 'Черный';
  }

  return null;
}

function getLength(row, parentRow) {
  const title = cleanText(row.Title);
  const source = getRowSource(row, parentRow);

  const titleRangeMatch = title.match(/([0-9]+(?:[,.][0-9]+)?)\s*[-–—]\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)\.?/i);

  if (titleRangeMatch?.[1] && titleRangeMatch?.[2] && titleRangeMatch?.[3]) {
    const from = normalizeNumber(titleRangeMatch[1]).replace('.', ',');
    const to = normalizeNumber(titleRangeMatch[2]).replace('.', ',');
    const unit = String(titleRangeMatch[3]).toLowerCase().replace('.', '');

    return `${from}-${to} ${unit}`;
  }

  const titleMatch = title.match(/([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)\.?/i);

  if (titleMatch?.[1] && titleMatch?.[2]) {
    return normalizeLengthValue(titleMatch[1], titleMatch[2]);
  }

  const lengthPatterns = [
    /длина\s*[:—-]?\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)\.?/i,
    /([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)\.?\s*длина/i,
  ];

  for (const pattern of lengthPatterns) {
    const match = source.match(pattern);

    if (match?.[1] && match?.[2]) {
      return normalizeLengthValue(match[1], match[2]);
    }
  }

  return null;
}

function getQuotedPattern(source) {
  const match = source.match(/[«"]([^«»"]+)[»"]/);

  if (!match?.[1]) {
    return null;
  }

  return cleanText(match[1]);
}

function getCare(row, parentRow) {
  const source = getRowSource(row, parentRow).toLowerCase();
  const care = [];

  if (source.includes('не мыть') && source.includes('посудомо')) {
    care.push('Не мыть в посудомоечной машине');
  }

  if (source.includes('жестк') && source.includes('губ')) {
    care.push('Не использовать жесткую губку');
  }

  return unique(care);
}

function buildFeatures(row, parentRow, spoonType) {
  const source = getRowSource(row, parentRow);
  const lower = source.toLowerCase();
  const title = cleanText(row.Title).toLowerCase();

  const features = [];

  if (lower.includes('cocktail design')) {
    features.push('Дизайнерская серия');
  }

  if (lower.includes('ручная работа')) {
    features.push('Ручная работа');
  }

  if (lower.includes('лазерная резка')) {
    features.push('Лазерная резка');
  }

  if (lower.includes('ручная шлифовка')) {
    features.push('Ручная шлифовка');
  }

  if (title.includes('капля')) {
    features.push('Наконечник-капля');
  }

  if (title.includes('плоским наконечником') || title.includes('плоский наконечник')) {
    features.push('Плоский наконечник');
  }

  if (title.includes('без скрутки')) {
    features.push('Без скрутки');
  } else if (lower.includes('скрутка') || lower.includes('витая')) {
    features.push('Витая ручка');
  }

  if (spoonType === 'Ложка-мадлер') {
    features.push('Наконечник-мадлер');
  }

  if (spoonType === 'Ложка-вилка') {
    features.push('Наконечник-вилка');
  }

  if (spoonType === 'Ложка-стрейнер') {
    features.push('Наконечник-стрейнер');
  }

  if (title.includes('ананас')) {
    features.push('Наконечник-ананас');
  }

  if (title.includes('скрипичный ключ')) {
    features.push('Наконечник в форме скрипичного ключа');
  }

  if (lower.includes('телескоп')) {
    features.push('Телескопическая конструкция');
  }

  if (lower.includes('pattern') || lower.includes('узор')) {
    features.push('Узор на поверхности');
  }

  if (lower.includes('под гравировку')) {
    features.push('Подходит для индивидуальной гравировки');
  }

  if (lower.includes('гравиров')) {
    const pattern = getQuotedPattern(source);
    features.push(pattern ? `Гравировка ${pattern}` : 'Гравировка по поверхности');
  }

  if (lower.includes('баланс')) {
    features.push('Сбалансированная конструкция');
  }

  if (lower.includes('длинная ручка') || lower.includes('длинной ручкой')) {
    features.push('Удлиненная ручка');
  }

  if (lower.includes('коктейль') || lower.includes('перемешив')) {
    features.push('Для перемешивания коктейлей');
  }

  return unique(features).map(capitalizeFirst);
}

function buildSpecifications(row, parentRow, specTypeByName) {
  const spoonType = getSpoonType(row, parentRow);
  const productType = getProductType(spoonType);
  const material = getMaterial(row, parentRow);
  const steelGrade = getSteelGrade(row, parentRow);
  const color = getColor(row, parentRow);
  const length = getLength(row, parentRow);
  const features = buildFeatures(row, parentRow, spoonType);
  const care = getCare(row, parentRow);

  const valuesByName = new Map();

  function add(name, value) {
    const normalizedValue = Array.isArray(value)
      ? unique(value).join('; ')
      : cleanText(value);

    if (!normalizedValue) {
      return;
    }

    const specType = specTypeByName.get(name);

    if (!specType) {
      throw new Error(`Не найден тип характеристики: ${name}`);
    }

    valuesByName.set(name, {
      specification: specType.id,
      value: normalizedValue,
    });
  }

  add('Тип товара', productType);
  add('Тип', spoonType);
  add('Материал', material);
  add('Марка стали', steelGrade);
  add('Цвет / покрытие', color);
  add('Длина', length);
  add('Особенности', features);
  add('Уход', care);

  return SPEC_ORDER
    .map((name) => valuesByName.get(name))
    .filter(Boolean);
}

function getSpecificationUid() {
  const productContentType = strapi.contentTypes[PRODUCT_UID];
  const specificationsAttribute = productContentType?.attributes?.specifications;

  if (!specificationsAttribute?.component) {
    throw new Error('Не найден component product.specifications');
  }

  const component = strapi.components[specificationsAttribute.component];
  const specificationAttribute = component?.attributes?.specification;

  if (!specificationAttribute?.target) {
    throw new Error('Не найден relation target у product.specifications.specification');
  }

  return specificationAttribute.target;
}

async function getSpecTypeByName(names) {
  const specificationUid = getSpecificationUid();

  const specTypes = await strapi.db.query(specificationUid).findMany({
    select: ['id', 'name'],
    where: {
      name: {
        $in: names,
      },
    },
    limit: 1000,
  });

  const specTypeByName = new Map();

  for (const specType of specTypes) {
    specTypeByName.set(specType.name, specType);
  }

  const missingNames = names.filter((name) => !specTypeByName.has(name));

  if (missingNames.length > 0) {
    throw new Error(`В Strapi не найдены типы характеристик: ${missingNames.join(', ')}`);
  }

  return specTypeByName;
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const csvPath = path.resolve(CSV_FILE);
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const csvRows = rowsToObjects(parseCsv(csvText));

  const parentRows = new Map();

  for (const row of csvRows) {
    const tildaUid = cleanText(row['Tilda UID']);
    const sku = normalizeSku(row.SKU);

    if (tildaUid && !sku) {
      parentRows.set(tildaUid, row);
    }
  }

  const skuRows = csvRows.filter((row) => normalizeSku(row.SKU));

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    const specTypeByName = await getSpecTypeByName(SPEC_ORDER);

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
    const skipped = [];
    const missing = [];
    const typeCounts = new Map();

    for (const row of skuRows) {
      const csvSku = normalizeSku(row.SKU);

      if (SKIPPED_SKUS.has(csvSku)) {
        skipped.push(row);
        continue;
      }

      const strapiSku = getStrapiSku(csvSku);
      const product = productByCode.get(strapiSku);

      if (!product) {
        missing.push(row);
        continue;
      }

      const parentUid = cleanText(row['Parent UID']);
      const parentRow = parentUid ? parentRows.get(parentUid) : null;
      const specifications = buildSpecifications(row, parentRow, specTypeByName);
      const typeSpec = specifications.find((spec) => spec.specification === specTypeByName.get('Тип').id);
      const typeValue = typeSpec?.value || 'Без типа';

      typeCounts.set(typeValue, (typeCounts.get(typeValue) || 0) + 1);

      items.push({
        row,
        product,
        csvSku,
        strapiSku,
        specifications,
      });
    }

    console.log('');
    console.log(APPLY ? 'Режим: APPLY=1, характеристики будут записаны' : 'Режим: dry-run, база не меняется');
    console.log('------------------------------------------------');
    console.log(`CSV файл: ${csvPath}`);
    console.log(`CSV строк всего: ${csvRows.length}`);
    console.log(`Родительских строк без SKU: ${parentRows.size}`);
    console.log(`Строк с SKU: ${skuRows.length}`);
    console.log(`Пропущено товаров: ${skipped.length}`);
    console.log(`К импорту: ${items.length}`);
    console.log(`Найдено товаров в Strapi: ${items.length}`);
    console.log(`Не найдено товаров в Strapi: ${missing.length}`);

    console.log('');
    console.log('Разбивка по типам');
    console.log('-----------------');

    for (const [type, count] of [...typeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`${type}: ${count}`);
    }

    if (skipped.length > 0) {
      console.log('');
      console.log('Пропущены');
      console.log('---------');

      for (const row of skipped) {
        console.log(`⏭️ ${normalizeSku(row.SKU)} | ${cleanText(row.Title)}`);
      }
    }

    if (missing.length > 0) {
      console.log('');
      console.log('Не найдены товары');
      console.log('-----------------');

      for (const row of missing) {
        console.log(`❌ ${normalizeSku(row.SKU)} | ${cleanText(row.Title)}`);
      }
    }

    const printedItems = items.slice(0, PRINT_LIMIT);

    console.log('');
    console.log(`Что будет записано — показаны первые ${printedItems.length} из ${items.length}`);
    console.log('------------------');

    for (const item of printedItems) {
      const currentSpecs = item.product.specifications ?? [];
      const title = cleanText(item.row.Title);
      const aliasText = item.csvSku === item.strapiSku ? item.csvSku : `${item.csvSku} → Strapi SKU ${item.strapiSku}`;

      console.log('');
      console.log(`✅ ${aliasText} | ${title}`);
      console.log(`Strapi: id=${item.product.id} | ${item.product.name}`);
      console.log(`Текущих характеристик: ${currentSpecs.length}`);

      for (const spec of item.specifications) {
        const specTypeName = [...specTypeByName.entries()]
          .find(([, specType]) => specType.id === spec.specification)?.[0] ?? 'Без типа';

        console.log(`  ${specTypeName} — ${spec.value}`);
      }
    }

    if (!APPLY) {
      console.log('');
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи после проверки на текущей базе:');
      console.log('APPLY=1 CSV_FILE=imports/tilda-bar-spoons.csv node scripts/import-tilda-bar-spoons-specs.js');
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
