'use strict';

/**
 * Импорт характеристик для категории "Смесительные стаканы".
 *
 * По умолчанию работает в dry-run режиме и базу не меняет.
 *
 * Dry-run:
 * CSV_FILE=imports/tilda-mixing-glasses.csv node scripts/import-tilda-mixing-glasses-specs.js
 *
 * Запись в базу:
 * APPLY=1 CSV_FILE=imports/tilda-mixing-glasses.csv node scripts/import-tilda-mixing-glasses-specs.js
 */

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';

const DEFAULT_CSV_FILE = 'imports/tilda-mixing-glasses.csv';

const SPEC_LABELS = [
  'Тип товара',
  'Тип',
  'Материал',
  'Объем',
  'Особенности',
];

function normalizeSku(value) {
  return String(value ?? '')
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/С/g, 'C')
    .replace(/с/g, 'c');
}

function cleanHeader(value) {
  return String(value ?? '')
    .trim()
    .replace(/\uFEFF/g, '');
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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
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
        index += 1;
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

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);

    if (row.some((value) => String(value).trim() !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

function csvRowsToObjects(rows) {
  const [headerRow, ...bodyRows] = rows;

  if (!headerRow) {
    return [];
  }

  const headers = headerRow.map(cleanHeader);

  return bodyRows.map((cells) => {
    const row = {};

    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });

    return row;
  });
}

function getTitle(row) {
  return cleanText(row.Title);
}

function getRowSource(row) {
  return [
    row.SKU,
    row.Title,
    row.Category,
    row.Mark,
    row.Brand,
  ]
    .map(cleanText)
    .join(' ')
    .toLowerCase();
}

function normalizeVolumeValue(value, unit) {
  const normalizedValue = String(value ?? '').replace(',', '.');
  const normalizedUnit = String(unit ?? '').toLowerCase();

  if (normalizedUnit === 'л' || normalizedUnit === 'l') {
    return `${normalizedValue.replace('.', ',')} л`;
  }

  return `${normalizedValue.replace('.', ',')} мл`;
}

function getVolume(row) {
  const title = getTitle(row).toLowerCase();

  const volumeMatch = title.match(/(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l)(?=$|[\s.,;:)])/u);

  if (!volumeMatch) {
    return null;
  }

  return normalizeVolumeValue(volumeMatch[1], volumeMatch[2]);
}

function getMaterial(row) {
  const sku = normalizeSku(row.SKU);
  const title = getTitle(row).toLowerCase();

  const steelSkus = new Set([
    'MixBrdLvs',
    'MixDbl',
    'MixBrd',
    'MixBrd800',
    'MixAngl500',
    'MixAngl800',
    'MixChpln500',
    'MixChpln800',
    'MixDblPl',
  ]);

  if (
    steelSkus.has(sku) ||
    title.includes('стальной') ||
    title.includes('двухслойный') ||
    title.includes('полированный')
  ) {
    return 'Нержавеющая сталь';
  }

  return 'Стекло';
}

function getMixingGlassType(row) {
  const title = getTitle(row).toLowerCase();
  const material = getMaterial(row);

  if (title.includes('на ножке')) {
    return 'На ножке';
  }

  if (title.includes('двухслойный')) {
    return 'Двухслойный';
  }

  if (material === 'Нержавеющая сталь') {
    return 'Стальной';
  }

  return 'Стеклянный';
}

function addFeature(features, value) {
  const normalizedValue = cleanText(value);

  if (!normalizedValue) {
    return;
  }

  if (!features.includes(normalizedValue)) {
    features.push(normalizedValue);
  }
}

function getFeatures(row) {
  const title = getTitle(row).toLowerCase();
  const material = getMaterial(row);
  const features = [];

  if (material === 'Нержавеющая сталь') {
    addFeature(features, 'Стальной корпус');
  }

  if (material === 'Стекло') {
    addFeature(features, 'Стеклянный корпус');
    addFeature(features, 'Носик для аккуратного слива');
  }

  if (title.includes('двухслойный')) {
    addFeature(features, 'Двухслойная конструкция');
  }

  if (title.includes('полированный')) {
    addFeature(features, 'Полированная поверхность');
  }

  if (title.includes('на ножке')) {
    addFeature(features, 'На ножке');
  }

  if (title.includes('без рисунков') || title.includes('без рисунка')) {
    addFeature(features, 'Без рисунка');
  }

  if (title.includes('leaves')) {
    addFeature(features, title.includes('гравиров') ? 'Гравировка Leaves' : 'Дизайн Leaves');
  }

  if (title.includes('birdy')) {
    addFeature(features, 'Дизайн Birdy');
  }

  if (title.includes('grid')) {
    addFeature(features, 'Геометрический узор');
  }

  if (title.includes('geo')) {
    addFeature(features, 'Геометрический узор');
  }

  if (title.includes('angel')) {
    addFeature(features, 'Дизайн Angel');
  }

  if (title.includes('chaplin')) {
    addFeature(features, 'Дизайн Chaplin');
  }

  if (title.includes('dent')) {
    addFeature(features, 'Рельефная поверхность');
  }

  if (title.includes('fragments') || title.includes('fragment')) {
    addFeature(features, 'Рельефный узор');
  }

  if (title.includes('lines')) {
    addFeature(features, 'Рельефные линии');
  }

  if (title.includes('sun') || title.includes('солнце')) {
    addFeature(features, 'Узор Sun');
  }

  if (title.includes('rays') || title.includes('лучи')) {
    addFeature(features, 'Узор Rays');
  }

  if (title.includes('гравиров') && !features.some((feature) => feature.includes('Гравировка'))) {
    addFeature(features, 'Гравировка по поверхности');
  }

  return features.join('; ');
}

function resolveSpecificationUid() {
  const productContentType = strapi.contentTypes[PRODUCT_UID];
  const specificationsAttribute = productContentType?.attributes?.specifications;
  const componentUid = specificationsAttribute?.component;
  const component = componentUid ? strapi.components[componentUid] : null;
  const targetUid = component?.attributes?.specification?.target;

  if (targetUid) {
    return targetUid;
  }

  const candidates = Object.entries(strapi.contentTypes)
    .filter(([uid, contentType]) => {
      return (
        contentType.kind === 'collectionType' &&
        contentType.attributes?.name &&
        uid.includes('spec') &&
        !uid.includes('template')
      );
    })
    .map(([uid]) => uid);

  const preferredCandidate =
    candidates.find((uid) => uid.includes('product-specification')) ??
    candidates.find((uid) => uid.includes('specification')) ??
    candidates[0];

  if (!preferredCandidate) {
    throw new Error('Не удалось определить UID справочника характеристик.');
  }

  return preferredCandidate;
}

async function ensureSpecifications(labels) {
  const specificationUid = resolveSpecificationUid();

  const existingSpecifications = await strapi.db.query(specificationUid).findMany({
    select: ['id', 'name'],
    limit: 1000,
  });

  const specificationsByName = new Map(
    existingSpecifications.map((specification) => [specification.name, specification])
  );

  for (const label of labels) {
    if (specificationsByName.has(label)) {
      continue;
    }

    const createdSpecification = await strapi.db.query(specificationUid).create({
      data: {
        name: label,
      },
    });

    specificationsByName.set(label, {
      id: createdSpecification.id,
      name: createdSpecification.name,
    });
  }

  return specificationsByName;
}

function makeSpecification(specificationsByName, label, value) {
  const cleanedValue = cleanText(value);

  if (!cleanedValue) {
    return null;
  }

  const specification = specificationsByName.get(label);

  if (!specification) {
    throw new Error(`Не найдена характеристика "${label}".`);
  }

  return {
    specification: specification.id,
    value: cleanedValue,
  };
}

function buildProductSpecifications(row, specificationsByName) {
  const specs = [
    makeSpecification(specificationsByName, 'Тип товара', 'Смесительный стакан'),
    makeSpecification(specificationsByName, 'Тип', getMixingGlassType(row)),
    makeSpecification(specificationsByName, 'Материал', getMaterial(row)),
    makeSpecification(specificationsByName, 'Объем', getVolume(row)),
    makeSpecification(specificationsByName, 'Особенности', getFeatures(row)),
  ];

  return specs.filter(Boolean);
}

function getSpecificationNameById(specificationsByName) {
  const namesById = new Map();

  for (const specification of specificationsByName.values()) {
    namesById.set(specification.id, specification.name);
  }

  return namesById;
}



function normalizeSpecificationsForWrite(specifications) {
  return specifications.map((item) => {
    const specificationId =
      item.specificationId ??
      item.specification?.id ??
      item.specification;

    if (!specificationId || typeof specificationId === 'object') {
      const label = item.specification?.name ?? item.label ?? item.value ?? 'без названия';
      throw new Error(`Не удалось подготовить характеристику к записи: ${label}`);
    }

    return {
      specification: {
        connect: [specificationId],
      },
      value: item.value,
    };
  });
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
  const csvRows = parseCsv(csvText);
  const rows = csvRowsToObjects(csvRows);

  const rowsWithSku = rows.filter((row) => normalizeSku(row.SKU));

  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    const specificationsByName = await ensureSpecifications(SPEC_LABELS);
    const specificationNamesById = getSpecificationNameById(specificationsByName);

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
            specification: true,
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
        specifications: buildProductSpecifications(row, specificationsByName),
      });
    }

    const typeCounts = new Map();

    for (const item of found) {
      const typeSpec = item.specifications.find((spec) => {
        return specificationNamesById.get(spec.specification) === 'Тип';
      });

      const typeName = typeSpec?.value ?? 'Без типа';
      typeCounts.set(typeName, (typeCounts.get(typeName) ?? 0) + 1);
    }

    console.log('');
    console.log(shouldApply ? 'Режим: APPLY=1, характеристики будут записаны' : 'Режим: dry-run, база не меняется');
    console.log('------------------------------------------------');
    console.log(`CSV файл: ${csvPath}`);
    console.log(`CSV строк всего: ${rows.length}`);
    console.log(`Строк с SKU: ${rowsWithSku.length}`);
    console.log(`Найдено товаров в Strapi: ${found.length}`);
    console.log(`Не найдено товаров в Strapi: ${missing.length}`);

    console.log('');
    console.log('Разбивка по типам');
    console.log('-----------------');

    [...typeCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'ru'))
      .forEach(([typeName, count]) => {
        console.log(`${typeName}: ${count}`);
      });

    if (missing.length > 0) {
      console.log('');
      console.log('Не найдены в Strapi');
      console.log('-------------------');

      for (const row of missing) {
        console.log(`❌ ${normalizeSku(row.SKU)} | ${getTitle(row)}`);
      }
    }

    const visibleItems = printLimit > 0 ? found.slice(0, printLimit) : found;

    console.log('');
    console.log(`Что будет записано — показаны первые ${visibleItems.length} из ${found.length}`);
    console.log('------------------');

    for (const item of visibleItems) {
      const sku = normalizeSku(item.row.SKU);
      const title = getTitle(item.row);
      const currentSpecsCount = item.product.specifications?.length ?? 0;

      console.log('');
      console.log(`✅ ${sku} | ${title}`);
      console.log(`Strapi: id=${item.product.id} | ${item.product.name}`);
      console.log(`Текущих характеристик: ${currentSpecsCount}`);

      for (const spec of item.specifications) {
        const specName = specificationNamesById.get(spec.specification) ?? 'Без типа';
        console.log(`  ${specName} — ${spec.value}`);
      }
    }

    if (!shouldApply) {
      console.log('');
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи после проверки на текущей базе:');
      console.log(`APPLY=1 CSV_FILE=${csvFile} node scripts/import-tilda-mixing-glasses-specs.js`);
      return;
    }

    let updatedCount = 0;

    for (const item of found) {
      await strapi.db.query(PRODUCT_UID).update({
        where: {
          id: item.product.id,
        },
        data: {
          specifications: normalizeSpecificationsForWrite(item.specifications),
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
