'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const DEFAULT_CSV_FILE = 'imports/tilda-corkscrews-openers-speedopeners.csv';

const SPEC_ORDER = [
  'Тип товара',
  'Тип',
  'Назначение',
  'Материал',
  'Цвет / покрытие',
  'Комплектация',
  'Производитель',
  'Модель',
  'Особенности',
];

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === ';' && !insideQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);

  return result;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });

    return row;
  });
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSku(value) {
  return cleanText(value)
    .replace(/\uFEFF/g, '')
    .replace(/С/g, 'C')
    .replace(/с/g, 'c');
}

function unique(values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    const cleanedValue = cleanText(value);

    if (!cleanedValue || seen.has(cleanedValue)) {
      continue;
    }

    seen.add(cleanedValue);
    result.push(cleanedValue);
  }

  return result;
}

function buildParentByTildaUid(rows) {
  const parentByTildaUid = new Map();

  for (const row of rows) {
    const sku = normalizeSku(row.SKU);
    const tildaUid = cleanText(row['Tilda UID']);

    if (!sku && tildaUid) {
      parentByTildaUid.set(tildaUid, row);
    }
  }

  return parentByTildaUid;
}

function getParentRow(row, parentByTildaUid) {
  const parentUid = cleanText(row['Parent UID']);

  if (!parentUid) {
    return null;
  }

  return parentByTildaUid.get(parentUid) ?? null;
}

function getTitleSource(row, parentRow) {
  return unique([
    parentRow?.Title,
    row.Title,
  ]).join(' ');
}

function getProductType(row, parentRow) {
  const source = getTitleSource(row, parentRow).toLowerCase();

  if (source.includes('нарзанник')) {
    return 'Нарзанник';
  }

  return 'Открывашка';
}

function getType(row, parentRow) {
  const source = getTitleSource(row, parentRow).toLowerCase();

  if (source.includes('нарзанник') && source.includes('премиум')) {
    return 'Двухступенчатый нарзанник Премиум';
  }

  if (source.includes('нарзанник')) {
    return 'Двухступенчатый нарзанник';
  }

  if (source.includes('брелок')) {
    return 'Брелок-открывашка';
  }

  if (source.includes('speed-opener')) {
    return 'Speed-opener';
  }

  return 'Открывашка';
}

function getPurpose(row, parentRow) {
  const productType = getProductType(row, parentRow);

  if (productType === 'Нарзанник') {
    return 'Для открывания бутылок с пробкой';
  }

  return 'Для открывания бутылок';
}

function getMaterial(row, parentRow) {
  const source = getTitleSource(row, parentRow).toLowerCase();

  if (source.includes('нарзанник')) {
    return 'Металл';
  }

  if (source.includes('брелок')) {
    return 'Металл';
  }

  return 'Нержавеющая сталь';
}

function getColor(row, parentRow) {
  const source = getTitleSource(row, parentRow).toLowerCase();

  if (source.includes('черный') || source.includes('чёрный')) {
    return 'Черный';
  }

  if (source.includes('розовый')) {
    return 'Розовый';
  }

  if (source.includes('бордовый')) {
    return 'Бордовый';
  }

  if (source.includes('красный')) {
    return 'Красный';
  }

  return null;
}

function getComplectation(row, parentRow) {
  const source = getTitleSource(row, parentRow).toLowerCase();

  if (source.includes('чехл')) {
    return 'Чехол';
  }

  return null;
}

function getManufacturer(row, parentRow) {
  const source = getTitleSource(row, parentRow);

  if (/cocktail\s+design/i.test(source)) {
    return 'Cocktail Design';
  }

  return null;
}

function getModel(row, parentRow) {
  const source = getTitleSource(row, parentRow);

  const cocktailDesignMatch = source.match(/Cocktail\s+Design\s+(.+)$/i);

  if (cocktailDesignMatch?.[1]) {
    return cleanText(cocktailDesignMatch[1]);
  }

  const speedOpenerMatch = source.match(/Speed-opener\s+(.+)$/i);

  if (speedOpenerMatch?.[1]) {
    return cleanText(speedOpenerMatch[1]);
  }

  if (/премиум/i.test(source)) {
    return 'Премиум';
  }

  return null;
}

function getFeatures(row, parentRow) {
  const source = getTitleSource(row, parentRow);
  const sourceLower = source.toLowerCase();

  const features = [];

  if (sourceLower.includes('нарзанник')) {
    features.push('Двухступенчатая конструкция');
  }

  if (sourceLower.includes('премиум')) {
    features.push('Премиум-формат');
  }

  if (sourceLower.includes('чехл')) {
    features.push('Чехол в комплекте');
  }

  if (sourceLower.includes('металлический')) {
    features.push('Металлическая конструкция');
  }

  if (sourceLower.includes('speed-opener')) {
    features.push('Плоская барная открывашка');
    features.push('Формат speed-opener');
  }

  if (sourceLower.includes('пивных бутылок')) {
    features.push('Для пивных бутылок');
  }

  if (/cocktail\s+design/i.test(source)) {
    features.push('Фирменный дизайн Cocktail Design');
  }

  const model = getModel(row, parentRow);

  if (model && !['Премиум'].includes(model)) {
    features.push(`Дизайн ${model}`);
  }

  if (sourceLower.includes('брелок')) {
    features.push('Формат брелока');
    features.push('Компактная открывашка');
  }

  return unique(features).join('; ');
}

function makeSpecification(specTypeByName, name, value) {
  const normalizedValue = Array.isArray(value)
    ? unique(value).join('; ')
    : cleanText(value);

  if (!normalizedValue) {
    return null;
  }

  const specType = specTypeByName.get(name);

  if (!specType) {
    throw new Error(`Не найден тип характеристики: ${name}`);
  }

  return {
    specification: specType.id,
    value: normalizedValue,
  };
}

function buildSpecifications(row, parentRow, specTypeByName) {
  const specs = [
    makeSpecification(specTypeByName, 'Тип товара', getProductType(row, parentRow)),
    makeSpecification(specTypeByName, 'Тип', getType(row, parentRow)),
    makeSpecification(specTypeByName, 'Назначение', getPurpose(row, parentRow)),
    makeSpecification(specTypeByName, 'Материал', getMaterial(row, parentRow)),
    makeSpecification(specTypeByName, 'Цвет / покрытие', getColor(row, parentRow)),
    makeSpecification(specTypeByName, 'Комплектация', getComplectation(row, parentRow)),
    makeSpecification(specTypeByName, 'Производитель', getManufacturer(row, parentRow)),
    makeSpecification(specTypeByName, 'Модель', getModel(row, parentRow)),
    makeSpecification(specTypeByName, 'Особенности', getFeatures(row, parentRow)),
  ];

  return specs.filter(Boolean);
}

function getSpecificationUid() {
  const productContentType = strapi.contentTypes[PRODUCT_UID];
  const specificationAttribute = productContentType?.attributes?.specifications;
  const componentUid = specificationAttribute?.component;
  const component = componentUid ? strapi.components[componentUid] : null;
  const specificationRelation = component?.attributes?.specification;

  if (specificationRelation?.target) {
    return specificationRelation.target;
  }

  console.dir(
    {
      productContentTypeAttributes: productContentType?.attributes,
      specificationAttribute,
      componentUid,
      componentAttributes: component?.attributes,
    },
    { depth: 8 }
  );

  throw new Error('Не удалось определить UID характеристики товара.');
}

async function getSpecTypeByName(names) {
  const specificationUid = getSpecificationUid();

  const existingSpecTypes = await strapi.db.query(specificationUid).findMany({
    select: ['id', 'name'],
    where: {
      name: {
        $in: names,
      },
    },
    limit: 1000,
  });

  const specTypeByName = new Map();

  for (const specType of existingSpecTypes) {
    specTypeByName.set(specType.name, specType);
  }

  for (const name of names) {
    if (specTypeByName.has(name)) {
      continue;
    }

    const createdSpecType = await strapi.db.query(specificationUid).create({
      data: {
        name,
      },
    });

    specTypeByName.set(createdSpecType.name, createdSpecType);
  }

  return specTypeByName;
}

function getSpecificationNameById(specTypeByName) {
  const nameById = new Map();

  for (const specType of specTypeByName.values()) {
    nameById.set(specType.id, specType.name);
  }

  return nameById;
}

function isProbablySameGroup(product) {
  const code = normalizeSku(product.code);
  const name = cleanText(product.name).toLowerCase();

  return (
    code.startsWith('Narz') ||
    code.startsWith('Spd') ||
    code === 'KchOpen' ||
    name.includes('нарзанник') ||
    name.includes('speed-opener') ||
    name.includes('спидопенер') ||
    name.includes('открывашка')
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

  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCsv(csvText);
  const rowsWithSku = rows.filter((row) => normalizeSku(row.SKU));
  const parentRows = rows.filter((row) => !normalizeSku(row.SKU));
  const parentByTildaUid = buildParentByTildaUid(rows);
  const skus = [...new Set(rowsWithSku.map((row) => normalizeSku(row.SKU)))];

  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    const specTypeByName = await getSpecTypeByName(SPEC_ORDER);
    const specNameById = getSpecificationNameById(specTypeByName);

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

    const productByCode = new Map();

    for (const product of products) {
      productByCode.set(normalizeSku(product.code), product);
    }

    const allProducts = await strapi.db.query(PRODUCT_UID).findMany({
      select: ['id', 'name', 'code'],
      limit: 100000,
    });

    const csvSkuSet = new Set(skus);
    const possibleExtraProducts = allProducts
      .filter((product) => isProbablySameGroup(product))
      .filter((product) => !csvSkuSet.has(normalizeSku(product.code)));

    const found = [];
    const missing = [];

    for (const row of rowsWithSku) {
      const sku = normalizeSku(row.SKU);
      const product = productByCode.get(sku);
      const parentRow = getParentRow(row, parentByTildaUid);

      if (!product) {
        missing.push(row);
        continue;
      }

      found.push({
        row,
        parentRow,
        product,
        specifications: buildSpecifications(row, parentRow, specTypeByName),
      });
    }

    const typeCounts = new Map();

    for (const item of found) {
      const typeSpec = item.specifications.find((spec) => {
        return specNameById.get(spec.specification) === 'Тип';
      });

      const type = typeSpec?.value ?? 'Без типа';
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }

    console.log('');
    console.log(shouldApply ? 'Режим: APPLY=1, характеристики будут записаны' : 'Режим: dry-run, база не меняется');
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
      console.log('Не найдено');
      console.log('---------');

      for (const row of missing) {
        console.log(`❌ ${normalizeSku(row.SKU)} | ${row.Title}`);
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

    console.log('');
    console.log(`Что будет записано — показаны первые ${Math.min(printLimit, found.length)} из ${found.length}`);
    console.log('------------------');

    for (const item of found.slice(0, printLimit)) {
      console.log('');
      console.log(`✅ ${normalizeSku(item.row.SKU)} | ${cleanText(item.row.Title)}`);
      console.log(`Strapi: id=${item.product.id} | ${item.product.name}`);
      console.log(`Текущих характеристик: ${item.product.specifications?.length ?? 0}`);

      if (item.parentRow) {
        console.log(`Parent: ${cleanText(item.parentRow.Title)}`);
      }

      for (const specification of item.specifications) {
        const specName = specNameById.get(specification.specification) ?? `id=${specification.specification}`;
        console.log(`  ${specName} — ${specification.value}`);
      }
    }

    if (!shouldApply) {
      console.log('');
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи после проверки на текущей базе:');
      console.log(`APPLY=1 CSV_FILE=${csvFile} node scripts/import-tilda-corkscrews-openers-speedopeners-specs.js`);
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
