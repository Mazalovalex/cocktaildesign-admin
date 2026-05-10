'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const DEFAULT_CSV_FILE = 'imports/tilda-bar-lighters.csv';

const SPEC_ORDER = [
  'Тип товара',
  'Тип',
  'Назначение',
  'Производитель',
  'Модель',
  'Цвет / покрытие',
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

function getTitleSource(row) {
  return cleanText(row.Title);
}

function getProductKind() {
  return 'Барная зажигалка';
}

function getType(row) {
  const title = getTitleSource(row).toLowerCase();

  if (title.includes('турбо')) {
    return 'Газовая турбо-горелка';
  }

  if (title.includes('бытовая')) {
    return 'Газовая бытовая горелка';
  }

  if (title.includes('поворот')) {
    return 'Горелка с поворотом';
  }

  if (title.includes('горелк')) {
    return 'Газовая горелка';
  }

  return 'Барная зажигалка';
}

function getPurpose() {
  return 'Для розжига и карамелизации';
}

function getManufacturer(row) {
  const source = getRowSource(row).toLowerCase();

  if (source.includes('lubinski')) {
    return 'Lubinski';
  }

  return null;
}

function getModel(row) {
  const source = getRowSource(row).toLowerCase();

  if (source.includes('black gun') || source.includes('черный пистолет')) {
    return 'Black Gun';
  }

  return null;
}

function getColor(row) {
  const source = getRowSource(row).toLowerCase();

  if (source.includes('black gun') || source.includes('черный') || source.includes('чёрный')) {
    return 'Черный';
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
  const title = getTitleSource(row).toLowerCase();
  const source = getRowSource(row).toLowerCase();
  const features = [];

  addFeature(features, 'Газовая конструкция');

  if (title.includes('турбо')) {
    addFeature(features, 'Турбо-пламя');
  }

  if (title.includes('поворот')) {
    addFeature(features, 'Поворотная конструкция');
  }

  if (source.includes('lubinski')) {
    addFeature(features, 'Бренд Lubinski');
  }

  if (source.includes('black gun') || source.includes('черный пистолет')) {
    addFeature(features, 'Дизайн Black Gun');
  }

  if (title.includes('бытовая')) {
    addFeature(features, 'Бытовой формат');
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
  add('Назначение', getPurpose(row));
  add('Производитель', getManufacturer(row));
  add('Модель', getModel(row));
  add('Цвет / покрытие', getColor(row));
  add('Особенности', getFeatures(row));

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

function isBarLighterProduct(product) {
  const code = normalizeSku(product.code).toLowerCase();
  const name = cleanText(product.name).toLowerCase();

  return (
    code.startsWith('gas') ||
    name.includes('горелк') ||
    name.includes('зажигалк')
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

      const specifications = buildSpecifications(row, specTypeByName);

      found.push({
        row,
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
      .filter(isBarLighterProduct)
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

      for (const spec of item.specifications) {
        console.log(`  ${specificationNamesById.get(spec.specification)} — ${spec.value}`);
      }
    }

    if (!shouldApply) {
      console.log('');
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи после проверки на текущей базе:');
      console.log(`APPLY=1 CSV_FILE=${csvFile} node scripts/import-tilda-bar-lighters-specs.js`);
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
