'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';

const DEFAULT_CSV_FILE = 'imports/tilda-muddlers-squeezers.csv';

const SPEC_ORDER = [
  'Тип товара',
  'Тип',
  'Материал',
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

function normalizeNumber(value) {
  return String(value ?? '')
    .trim()
    .replace(',', '.');
}

function normalizeLengthValue(value, unit) {
  const normalizedValue = normalizeNumber(value).replace('.', ',');
  const normalizedUnit = String(unit ?? '').toLowerCase().replace('.', '');

  return `${normalizedValue} ${normalizedUnit}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(cleanText).filter(Boolean))];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
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
      cell = '';

      if (row.some((value) => String(value).trim())) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += char;
  }

  if (cell || row.length > 0) {
    row.push(cell);

    if (row.some((value) => String(value).trim())) {
      rows.push(row);
    }
  }

  return rows;
}

function rowsToObjects(parsedRows) {
  const [headers, ...dataRows] = parsedRows;

  return dataRows.map((row) => {
    const item = {};

    headers.forEach((header, index) => {
      item[header] = row[index] ?? '';
    });

    return item;
  });
}

function getRowSource(row) {
  return [
    row.Title,
    row.Description,
    row.Text,
    row['SEO title'],
    row['SEO descr'],
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(' ');
}

function getProductKind(row) {
  const title = cleanText(row.Title).toLowerCase();

  if (title.includes('сквизер')) {
    return 'Сквизер';
  }

  return 'Мадлер';
}

function getType(row) {
  const title = cleanText(row.Title).toLowerCase();

  if (title.includes('сквизер')) {
    if (title.includes('лимон')) {
      return 'Сквизер для лимона';
    }

    if (title.includes('лайм')) {
      return 'Сквизер для лайма';
    }

    if (title.includes('ручной')) {
      return 'Ручной сквизер';
    }

    return 'Сквизер';
  }

  if (title.includes('мадлер-бур') || title.includes('бур')) {
    return 'Мадлер-бур';
  }

  if (title.includes('цельнометаллическ')) {
    return 'Цельнометаллический мадлер';
  }

  if (title.includes('удлин')) {
    return 'Удлиненный мадлер';
  }

  return 'Мадлер';
}

function getMaterial(row) {
  const source = getRowSource(row).toLowerCase();

  if (
    source.includes('нержав') ||
    source.includes('сталь') ||
    source.includes('цельнометаллическ')
  ) {
    return 'Нержавеющая сталь';
  }

  if (source.includes('алюмин')) {
    return 'Алюминий';
  }

  if (source.includes('пластик')) {
    return 'Пластик';
  }

  if (source.includes('дерев')) {
    return 'Дерево';
  }

  return null;
}

function getLength(row) {
  const title = cleanText(row.Title);
  const source = getRowSource(row);

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

function addFeature(features, value) {
  const cleanedValue = cleanText(value);

  if (!cleanedValue || features.includes(cleanedValue)) {
    return;
  }

  features.push(cleanedValue);
}

function getFeatures(row) {
  const title = cleanText(row.Title).toLowerCase();
  const source = getRowSource(row).toLowerCase();
  const features = [];

  if (title.includes('сквизер')) {
    addFeature(features, 'Для выжимания цитрусовых');
    addFeature(features, 'Ручная конструкция');

    if (title.includes('лимон')) {
      addFeature(features, 'Для лимона');
    }

    if (title.includes('лайм')) {
      addFeature(features, 'Для лайма');
    }

    return features.join('; ');
  }

  addFeature(features, 'Для разминания ингредиентов');

  if (title.includes('slim')) {
    addFeature(features, 'Тонкий профиль');
  }

  if (title.includes('classic')) {
    addFeature(features, 'Классическая форма');
  }

  if (title.includes('бур')) {
    addFeature(features, 'Наконечник-бур');
  }

  if (title.includes('цельнометаллическ') || source.includes('цельнометаллическ')) {
    addFeature(features, 'Цельнометаллическая конструкция');
  }

  if (title.includes('удлин')) {
    addFeature(features, 'Удлиненная конструкция');
  }

  if (title.includes('big')) {
    addFeature(features, 'Увеличенный размер');
  }

  if (title.includes('fat')) {
    addFeature(features, 'Массивная форма');
  }

  return features.join('; ');
}

function getSpecificationUid() {
  const productContentType = strapi.contentType(PRODUCT_UID);
  const specificationsAttribute = productContentType?.attributes?.specifications;

  if (specificationsAttribute?.target) {
    return specificationsAttribute.target;
  }

  const componentUid = specificationsAttribute?.component;
  const component = componentUid ? strapi.components[componentUid] : null;
  const specificationAttribute = component?.attributes?.specification;

  if (specificationAttribute?.target) {
    return specificationAttribute.target;
  }

  console.dir(
    {
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

function buildSpecifications(row, specTypeByName) {
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

  add('Тип товара', getProductKind(row));
  add('Тип', getType(row));
  add('Материал', getMaterial(row));
  add('Длина', getLength(row));
  add('Особенности', getFeatures(row));

  const orderedSpecifications = [];

  for (const name of SPEC_ORDER) {
    const value = valuesByName.get(name);

    if (value) {
      orderedSpecifications.push(value);
    }
  }

  return orderedSpecifications;
}

function getSpecificationNameById(specTypeByName) {
  const namesById = new Map();

  for (const specType of specTypeByName.values()) {
    namesById.set(specType.id, specType.name);
  }

  return namesById;
}

async function main() {
  const csvFile = process.env.CSV_FILE || DEFAULT_CSV_FILE;
  const csvPath = path.resolve(process.cwd(), csvFile);
  const shouldApply = process.env.APPLY === '1';
  const printLimit = Number(process.env.PRINT_LIMIT ?? 40);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV файл не найден: ${csvPath}`);
  }

  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const rows = rowsToObjects(parseCsv(csvText));
  const rowsWithSku = rows.filter((row) => normalizeSku(row.SKU));

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

      found.push({
        row,
        product,
        specifications: buildSpecifications(row, specTypeByName),
      });
    }

    const typeCounts = new Map();

    for (const item of found) {
      const typeSpecification = item.specifications.find((specification) => {
        return specificationNamesById.get(specification.specification) === 'Тип';
      });

      const type = typeSpecification?.value ?? 'Без типа';
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }

    console.log('');
    console.log(shouldApply ? 'Режим: APPLY=1, характеристики будут записаны' : 'Режим: dry-run, база не меняется');
    console.log('------------------------------------------------');
    console.log(`CSV файл: ${csvPath}`);
    console.log(`CSV строк всего: ${rows.length}`);
    console.log(`Строк с SKU: ${rowsWithSku.length}`);
    console.log(`Найдено товаров в Strapi: ${found.length}`);
    console.log(`Не найдено товаров в Strapi: ${missing.length}`);

    if (missing.length > 0) {
      console.log('');
      console.log('Не найдены в Strapi');
      console.log('-------------------');

      for (const row of missing) {
        console.log(`❌ ${normalizeSku(row.SKU)} | ${cleanText(row.Title)}`);
      }
    }

    console.log('');
    console.log('Разбивка по типам');
    console.log('-----------------');

    for (const [type, count] of [...typeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
      console.log(`${type}: ${count}`);
    }

    console.log('');
    console.log(`Что будет записано — показаны первые ${Math.min(printLimit, found.length)} из ${found.length}`);
    console.log('------------------');

    for (const item of found.slice(0, printLimit)) {
      console.log('');
      console.log(`✅ ${normalizeSku(item.row.SKU)} | ${cleanText(item.row.Title)}`);
      console.log(`Strapi: id=${item.product.id} | ${item.product.name}`);
      console.log(`Текущих характеристик: ${item.product.specifications?.length ?? 0}`);

      for (const specification of item.specifications) {
        const name = specificationNamesById.get(specification.specification) ?? `spec:${specification.specification}`;
        console.log(`  ${name} — ${specification.value}`);
      }
    }

    if (!shouldApply) {
      console.log('');
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи после проверки на текущей базе:');
      console.log(`APPLY=1 CSV_FILE=${csvFile} node scripts/import-tilda-muddlers-squeezers-specs.js`);
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
