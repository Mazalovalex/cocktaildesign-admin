'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const DEFAULT_CSV_FILE = 'imports/tilda-knives-peelers-graters.csv';

const SPEC_ORDER = [
  'Тип товара',
  'Тип',
  'Назначение',
  'Материал',
  'Производитель',
  'Модель',
  'Цвет / покрытие',
  'Длина',
  'Особенности',
];

function normalizeSku(value) {
  return String(value ?? '')
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/С/g, 'C')
    .replace(/с/g, 'c');
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(cleanText).filter(Boolean))];
}

function normalizeNumber(value) {
  const normalized = String(value ?? '').replace(',', '.').trim();
  const number = Number(normalized);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Number.isInteger(number)
    ? String(number)
    : String(number).replace('.', ',');
}

function normalizeLengthValue(value, unit) {
  const number = normalizeNumber(value);

  if (!number) {
    return null;
  }

  const normalizedUnit = String(unit ?? 'см').toLowerCase().replace('.', '');

  return `${number} ${normalizedUnit}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
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

    if (row.some((value) => String(value).trim() !== '')) {
      rows.push(row);
    }
  }

  const headers = rows.shift() ?? [];

  return rows.map((values) => {
    const result = {};

    headers.forEach((header, index) => {
      result[header] = values[index] ?? '';
    });

    return result;
  });
}

function buildParentRowsByUid(rows) {
  const parentsByUid = new Map();

  for (const row of rows) {
    const tildaUid = cleanText(row['Tilda UID']);
    const sku = normalizeSku(row.SKU);

    if (tildaUid && !sku) {
      parentsByUid.set(tildaUid, row);
    }
  }

  return parentsByUid;
}

function getParentRow(row, parentsByUid) {
  const parentUid = cleanText(row['Parent UID']);

  if (!parentUid) {
    return null;
  }

  return parentsByUid.get(parentUid) ?? null;
}

function getTitleSource(row, parentRow) {
  return [
    parentRow?.Title,
    row.Title,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(' ');
}

function getLowerTitle(row, parentRow) {
  return getTitleSource(row, parentRow).toLowerCase();
}

function getProductKind(row, parentRow) {
  const title = getLowerTitle(row, parentRow);

  if (title.includes('пиллер')) {
    return 'Пиллер';
  }

  if (title.includes('терк') || title.includes('тёрк')) {
    return 'Терка';
  }

  if (title.includes('нож')) {
    return 'Нож';
  }

  return null;
}

function getType(row, parentRow) {
  const title = getLowerTitle(row, parentRow);

  if (title.includes('пиллер')) {
    return 'Пиллер с плавающим лезвием';
  }

  if (title.includes('microplane')) {
    return 'Терка Microplane';
  }

  if (title.includes('цедр')) {
    return 'Терка для цедры';
  }

  if (title.includes('мини') && (title.includes('терк') || title.includes('тёрк'))) {
    return 'Мини терка';
  }

  if (title.includes('терк') || title.includes('тёрк')) {
    return 'Терка';
  }

  if (title.includes('тесак') || title.includes('нож-тесак') || title.includes('нож тесак')) {
    return 'Нож-тесак';
  }

  if (title.includes('овощ')) {
    return 'Овощной нож';
  }

  if (title.includes('барный')) {
    return 'Барный нож';
  }

  if (title.includes('универс')) {
    return 'Универсальный нож';
  }

  if (title.includes('нож')) {
    return 'Нож';
  }

  return null;
}

function getPurpose(row, parentRow) {
  const title = getLowerTitle(row, parentRow);
  const kind = getProductKind(row, parentRow);

  if (kind === 'Пиллер') {
    return 'Для очистки овощей и фруктов';
  }

  if (kind === 'Терка') {
    if (title.includes('цедр') || title.includes('microplane')) {
      return 'Для снятия цедры и натирания ингредиентов';
    }

    return 'Для натирания ингредиентов';
  }

  if (kind === 'Нож') {
    if (title.includes('овощ')) {
      return 'Для овощей и фруктов';
    }

    if (title.includes('барный')) {
      return 'Для нарезки цитрусовых, фруктов и гарниров';
    }

    if (title.includes('тесак')) {
      return 'Для разделки и нарезки ингредиентов';
    }

    return 'Для нарезки ингредиентов';
  }

  return null;
}

function getMaterial(row, parentRow) {
  const title = getLowerTitle(row, parentRow);
  const kind = getProductKind(row, parentRow);

  if (title.includes('металличес')) {
    return 'Металл';
  }

  if (kind === 'Нож' || kind === 'Пиллер' || kind === 'Терка') {
    return 'Нержавеющая сталь';
  }

  return null;
}

function getManufacturer(row, parentRow) {
  const title = getLowerTitle(row, parentRow);

  if (title.includes('tramontina')) {
    return 'Tramontina';
  }

  if (title.includes('satoru')) {
    return 'Satoru';
  }

  return null;
}

function getModel(row, parentRow) {
  const title = getLowerTitle(row, parentRow);

  if (title.includes('microplane')) {
    return 'Реплика Microplane';
  }

  if (title.includes('slim')) {
    return 'Slim';
  }

  if (title.includes('эко')) {
    return 'Эко';
  }

  if (title.includes('pro')) {
    return 'Pro';
  }

  return null;
}

function getColor(row, parentRow) {
  const title = getLowerTitle(row, parentRow);

  if (title.includes('синий') || title.includes('синяя') || title.includes('blue')) {
    return 'Синий';
  }

  if (title.includes('желтый') || title.includes('жёлтый') || title.includes('yellow')) {
    return 'Желтый';
  }

  if (title.includes('красный') || title.includes('red')) {
    return 'Красный';
  }

  return null;
}

function getLength(row, parentRow) {
  const title = getTitleSource(row, parentRow);

  const match = title.match(/([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)\.?/i);

  if (match?.[1] && match?.[2]) {
    return normalizeLengthValue(match[1], match[2]);
  }

  return null;
}

function addFeature(features, value) {
  const cleanedValue = cleanText(value);

  if (!cleanedValue || features.includes(cleanedValue)) {
    return;
  }

  features.push(cleanedValue);
}

function getFeatures(row, parentRow) {
  const title = getLowerTitle(row, parentRow);
  const kind = getProductKind(row, parentRow);
  const features = [];

  if (kind === 'Пиллер') {
    addFeature(features, 'Плавающее лезвие');

    if (title.includes('горизонт')) {
      addFeature(features, 'Горизонтальное лезвие');
    }

    if (title.includes('вертик')) {
      addFeature(features, 'Вертикальное лезвие');
    }

    if (title.includes('slim')) {
      addFeature(features, 'Серия Slim');
    }

    if (title.includes('эко')) {
      addFeature(features, 'Серия Эко');
    }

    if (title.includes('pro')) {
      addFeature(features, 'Серия Pro');
    }
  }

  if (kind === 'Нож') {
    addFeature(features, 'Лезвие для нарезки');

    if (title.includes('барный')) {
      addFeature(features, 'Барный формат');
    }

    if (title.includes('овощ')) {
      addFeature(features, 'Овощной формат');
    }

    if (title.includes('универс')) {
      addFeature(features, 'Универсальный формат');
    }

    if (title.includes('тесак')) {
      addFeature(features, 'Формат тесака');
    }
  }

  if (kind === 'Терка') {
    addFeature(features, 'Рабочая поверхность для натирания');

    if (title.includes('металличес')) {
      addFeature(features, 'Металлическая конструкция');
    }

    if (title.includes('мини')) {
      addFeature(features, 'Мини-формат');
    }

    if (title.includes('цедр')) {
      addFeature(features, 'Для снятия цедры');
    }

    if (title.includes('microplane')) {
      addFeature(features, 'Реплика Microplane');
    }
  }

  return features.join('; ');
}

function getSpecificationUid() {
  const productContentType = strapi.contentTypes[PRODUCT_UID];
  const specificationsAttribute = productContentType?.attributes?.specifications;
  const componentUid = specificationsAttribute?.component;
  const component = strapi.components[componentUid];
  const specificationAttribute = component?.attributes?.specification;

  if (specificationAttribute?.target) {
    return specificationAttribute.target;
  }

  console.dir(
    {
      productUid: PRODUCT_UID,
      specificationsAttribute,
      componentUid,
      componentAttributes: component?.attributes,
    },
    { depth: 8 }
  );

  throw new Error('Не удалось определить UID характеристики товара.');
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

function buildSpecifications(row, parentRow, specTypeByName) {
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

  add('Тип товара', getProductKind(row, parentRow));
  add('Тип', getType(row, parentRow));
  add('Назначение', getPurpose(row, parentRow));
  add('Материал', getMaterial(row, parentRow));
  add('Производитель', getManufacturer(row, parentRow));
  add('Модель', getModel(row, parentRow));
  add('Цвет / покрытие', getColor(row, parentRow));
  add('Длина', getLength(row, parentRow));
  add('Особенности', getFeatures(row, parentRow));

  return SPEC_ORDER
    .map((name) => valuesByName.get(name))
    .filter(Boolean);
}

function getSpecificationNameById(specTypeByName) {
  const namesById = new Map();

  for (const specType of specTypeByName.values()) {
    namesById.set(specType.id, specType.name);
  }

  return namesById;
}

function isKnivesPeelersGratersProduct(product) {
  const code = normalizeSku(product.code).toLowerCase();
  const name = cleanText(product.name).toLowerCase();

  return (
    code.startsWith('kn') ||
    code.startsWith('plr') ||
    code.startsWith('grtr') ||
    name.includes('нож') ||
    name.includes('пиллер') ||
    name.includes('терк') ||
    name.includes('тёрк') ||
    name.includes('овощечист')
  );
}

async function main() {
  const csvFile = process.env.CSV_FILE || DEFAULT_CSV_FILE;
  const csvPath = path.resolve(process.cwd(), csvFile);
  const shouldApply = process.env.APPLY === '1';
  const printLimit = Number(process.env.PRINT_LIMIT ?? 40);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV файл не найден: ${csvPath}`);
  }

  const csvText = fs.readFileSync(csvPath, 'utf-8').replace(/^\uFEFF/, '');
  const rows = parseCsv(csvText);

  const rowsWithSku = rows.filter((row) => normalizeSku(row.SKU));
  const parentRows = rows.filter((row) => !normalizeSku(row.SKU));
  const parentsByUid = buildParentRowsByUid(rows);

  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    const specTypeByName = await getSpecTypeByName(SPEC_ORDER);
    const specificationNamesById = getSpecificationNameById(specTypeByName);

    const skus = [...new Set(rowsWithSku.map((row) => normalizeSku(row.SKU)))];

    const products = await strapi.db.query(PRODUCT_UID).findMany({
      select: ['id', 'name', 'code'],
      where: {
        code: {
          $in: skus,
        },
      },
      populate: {
        specifications: {
          populate: {
            specification: {
              select: ['id', 'name'],
            },
          },
        },
      },
      limit: 1000,
    });

    const productsBySku = new Map();

    for (const product of products) {
      productsBySku.set(normalizeSku(product.code), product);
    }

    const found = [];
    const missing = [];

    for (const row of rowsWithSku) {
      const sku = normalizeSku(row.SKU);
      const product = productsBySku.get(sku);

      if (!product) {
        missing.push(row);
        continue;
      }

      const parentRow = getParentRow(row, parentsByUid);
      const specifications = buildSpecifications(row, parentRow, specTypeByName);

      found.push({
        row,
        parentRow,
        product,
        specifications,
      });
    }

    const typeCounts = new Map();

    for (const item of found) {
      const typeSpec = item.specifications.find((spec) => specificationNamesById.get(spec.specification) === 'Тип');
      const typeValue = typeSpec?.value || 'Без типа';

      typeCounts.set(typeValue, (typeCounts.get(typeValue) ?? 0) + 1);
    }

    const csvSkuSet = new Set(skus);

    const possibleExtraProducts = (await strapi.db.query(PRODUCT_UID).findMany({
      select: ['id', 'name', 'code'],
      limit: 100000,
    }))
      .filter(isKnivesPeelersGratersProduct)
      .filter((product) => !csvSkuSet.has(normalizeSku(product.code)));

    console.log('');
    console.log(`Режим: ${shouldApply ? 'APPLY=1, характеристики будут записаны' : 'dry-run, база не меняется'}`);
    console.log('------------------------------------------------');
    console.log(`CSV файл: ${csvPath}`);
    console.log(`CSV строк всего: ${rows.length}`);
    console.log(`Родительских строк без SKU: ${parentRows.length}`);
    console.log(`Строк с SKU: ${rowsWithSku.length}`);
    console.log(`Найдено товаров в Strapi: ${found.length}`);
    console.log(`Не найдено товаров в Strapi: ${missing.length}`);

    console.log('');
    console.log('Разбивка по типам');
    console.log('-----------------');

    for (const [type, count] of [...typeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
      console.log(`${type}: ${count}`);
    }

    if (missing.length > 0) {
      console.log('');
      console.log('Не найдены');
      console.log('----------');

      for (const row of missing) {
        console.log(`❌ ${normalizeSku(row.SKU)} | ${cleanText(row.Title)}`);
      }
    }

    if (possibleExtraProducts.length > 0) {
      console.log('');
      console.log('Возможные товары в Strapi, которых нет в CSV');
      console.log('--------------------------------------------');

      for (const product of possibleExtraProducts) {
        console.log(`⚠️ id=${product.id} | code=${product.code} | ${product.name}`);
      }
    }

    const itemsToPrint = found.slice(0, printLimit);

    console.log('');
    console.log(`Что будет записано — показаны первые ${itemsToPrint.length} из ${found.length}`);
    console.log('------------------');

    for (const item of itemsToPrint) {
      console.log('');
      console.log(`✅ ${normalizeSku(item.row.SKU)} | ${cleanText(item.row.Title)}`);
      console.log(`Strapi: id=${item.product.id} | ${item.product.name}`);
      console.log(`Текущих характеристик: ${(item.product.specifications ?? []).length}`);

      if (item.parentRow) {
        console.log(`Parent: ${cleanText(item.parentRow.Title)}`);
      }

      for (const spec of item.specifications) {
        console.log(`  ${specificationNamesById.get(spec.specification)} — ${spec.value}`);
      }
    }

    if (!shouldApply) {
      console.log('');
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи после проверки на текущей базе:');
      console.log(`APPLY=1 CSV_FILE=${csvFile} node scripts/import-tilda-knives-peelers-graters-specs.js`);
      return;
    }

    let updatedCount = 0;

    for (const item of found) {
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
