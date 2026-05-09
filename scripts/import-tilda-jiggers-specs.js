'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const SPECIFICATION_TYPE_UID = 'api::specification-type.specification-type';

const DEFAULT_CSV_FILE = 'imports/tilda-jiggers.csv';
const CSV_FILE = process.env.CSV_FILE || DEFAULT_CSV_FILE;
const APPLY = process.env.APPLY === '1';
const PRINT_LIMIT = Number(process.env.PRINT_LIMIT || 60);

const SKIPPED_SKUS = new Set([
  'SpMsrg', // Ложки мерные на связке — сейчас не импортируем
]);

const SKU_FALLBACKS = {
  'JigV30\\45Si': 'JigV30\\45Sil',
  'JigVwc25/40': 'JigV25\\40',
};

const REQUIRED_SPEC_TYPES = [
  'Тип товара',
  'Тип',
  'Материал',
  'Цвет / покрытие',
  'Объем',
  'Высота',
  'Диаметр',
  'Вес',
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

function resolveProductSku(sku) {
  return SKU_FALLBACKS[sku] ?? sku;
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
  return String(value)
    .replace(',', '.')
    .replace(/\.$/, '');
}

function normalizeVolumeText(value) {
  return String(value)
    .replace(/\s+/g, '')
    .replace(/\\/g, '/')
    .replace(/\.$/, '');
}

function normalizeDimensionValue(value, unit) {
  const number = String(value).replace('.', ',');
  return `${number} ${unit}`;
}

function getEffectiveValue(row, parentRow, key) {
  return row[key] || parentRow?.[key] || '';
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

function shouldSkipRow(row, parentRow) {
  const sku = normalizeSku(row.SKU);
  const category = cleanText(getEffectiveValue(row, parentRow, 'Category')).toLowerCase();
  const title = cleanText(row.Title).toLowerCase();

  return (
    SKIPPED_SKUS.has(sku) ||
    category.includes('мерные ложки') ||
    title.includes('ложки мерные') ||
    title.includes('мерная ложка')
  );
}

function hasLeafCategory(row, parentRow, leafName) {
  const category = cleanText(getEffectiveValue(row, parentRow, 'Category')).toLowerCase();
  const normalizedLeafName = leafName.toLowerCase();

  return category
    .split(';')
    .map((item) => item.trim())
    .some((item) => {
      if (item === normalizedLeafName) {
        return true;
      }

      return item.endsWith(`>>>${normalizedLeafName}`);
    });
}

function isMeasuringProduct(row, parentRow) {
  const title = cleanText(row.Title).toLowerCase();

  return (
    hasLeafCategory(row, parentRow, 'мерники') ||
    title.includes('мензурка') ||
    title.includes('мерный кувшин') ||
    title.includes('мерный стакан') ||
    title.includes('емкость для налива') ||
    title.includes('ёмкость для налива')
  );
}

function getJiggerType(row, parentRow) {
  const source = getRowSource(row, parentRow).toLowerCase();
  const title = cleanText(row.Title).toLowerCase();
  const sku = normalizeSku(row.SKU);

  if (isMeasuringProduct(row, parentRow)) {
    return 'Мерник';
  }

  if (hasLeafCategory(row, parentRow, 'односторонние') || title.includes('односторонний')) {
    return 'Односторонний';
  }

  if (
    hasLeafCategory(row, parentRow, 'американский стиль') ||
    title.includes('amerika') ||
    sku.startsWith('JigAV')
  ) {
    return 'Американский стиль';
  }

  if (hasLeafCategory(row, parentRow, 'японский стиль')) {
    return 'Японский стиль';
  }

  if (source.includes('u-тип') || source.includes('u-образ')) {
    return 'Американский стиль';
  }

  return 'Японский стиль';
}

function getProductType(row, parentRow) {
  if (isMeasuringProduct(row, parentRow)) {
    return 'Мерник';
  }

  return 'Джиггер';
}

function getMaterial(source) {
  const lower = source.toLowerCase();

  if (lower.includes('полипроп')) return 'Полипропилен';
  if (lower.includes('пластик') || lower.includes('прозрачного пластика')) return 'Пластик';
  if (lower.includes('стекло') || lower.includes('стеклян')) return 'Стекло';
  if (lower.includes('нержав') || lower.includes('сталь')) return 'Нержавеющая сталь';

  return 'Нержавеющая сталь';
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

  if (titleColor && /серебр|золот|черн|чёрн|прозрач/i.test(lowerTitle)) {
    return titleColor;
  }

  if (/Sil$/i.test(sku) || /Si$/i.test(sku)) return 'Серебро';
  if (/(Gold|Gld)$/i.test(sku)) return 'Золото';
  if (/Bl$/i.test(sku)) return 'Черный';

  return null;
}

function getColorFromText(value) {
  const lower = String(value).toLowerCase();

  if (lower.includes('серебрист') || lower.includes('серебро') || lower.includes('серебря')) return 'Серебро';
  if (lower.includes('золото') || lower.includes('золот')) return 'Золото';
  if (lower.includes('черный') || lower.includes('чёрный') || lower.includes('black')) return 'Черный';
  if (lower.includes('прозрач')) return 'Прозрачный';

  return null;
}

function getVolumeFromTitle(row) {
  const title = cleanText(row.Title);
  const titleMatch = title.match(/([0-9]+(?:[,.][0-9]+)?(?:\s*[\\\/]\s*[0-9]+(?:[,.][0-9]+)?){0,3})\s*(мл|л)\.?/i);

  if (!titleMatch?.[1] || !titleMatch?.[2]) {
    return null;
  }

  return `${normalizeVolumeText(titleMatch[1])} ${titleMatch[2].toLowerCase()}`;
}

function getVolume(source, row) {
  const titleVolume = getVolumeFromTitle(row);

  if (titleVolume) {
    return titleVolume;
  }

  const patterns = [
    /(?:^|[•\n]\s*)Об[ъь]ем\s*:?\s*([0-9]+(?:[,.][0-9]+)?(?:\s*[\\\/]\s*[0-9]+(?:[,.][0-9]+)?){0,8})\s*(мл|л)\.?/i,
    /(?:^|[•\n]\s*)Емкость\s*:?\s*([0-9]+(?:[,.][0-9]+)?(?:\s*[\\\/]\s*[0-9]+(?:[,.][0-9]+)?){0,8})\s*(мл|л)\.?/i,
    /(?:^|[•\n]\s*)Ёмкость\s*:?\s*([0-9]+(?:[,.][0-9]+)?(?:\s*[\\\/]\s*[0-9]+(?:[,.][0-9]+)?){0,8})\s*(мл|л)\.?/i,
    /(?:^|[•\n]\s*)Деления\s+([0-9]+(?:[,.][0-9]+)?(?:\s*[\\\/]\s*[0-9]+(?:[,.][0-9]+)?){1,8})\s*(мл)\.?/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1] && match?.[2]) {
      return `${normalizeVolumeText(match[1])} ${match[2].toLowerCase()}`;
    }
  }

  const title = cleanText(row.Title);
  const titleMatch = title.match(/([0-9]+(?:[,.][0-9]+)?(?:\s*[\\\/]\s*[0-9]+(?:[,.][0-9]+)?){0,3})\s*(мл|л)\.?/i);

  if (titleMatch?.[1] && titleMatch?.[2]) {
    return `${normalizeVolumeText(titleMatch[1])} ${titleMatch[2].toLowerCase()}`;
  }

  return null;
}

function getHeight(source) {
  const match = source.match(/(?:^|[•\n]\s*)Высота\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*(см|мм)\.?/i);

  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return normalizeDimensionValue(normalizeNumber(match[1]), match[2]);
}

function getDiameter(source) {
  const match = source.match(/(?:^|[•\n]\s*)Диаметр\s*:?\s*([0-9]+(?:[,.][0-9]+)?(?:\s*[\\\/]\s*[0-9]+(?:[,.][0-9]+)?)?)\s*(см|мм)\.?/i);

  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return `${String(match[1]).replace('.', ',').replace(/\s+/g, '')} ${match[2]}`;
}

function getWeight(source) {
  const match = source.match(/(?:^|[•\n]\s*)Вес\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*(гр|г)\.?/i);

  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return `${String(match[1]).replace('.', ',')} г`;
}

function getQuotedPattern(source) {
  const quoted = source.match(/["«“](.+?)["»”]/);

  if (quoted?.[1]) {
    return normalizeSpace(quoted[1]);
  }

  return null;
}

function buildFeatures(row, parentRow, type) {
  const source = getRowSource(row, parentRow);
  const lower = source.toLowerCase();
  const title = cleanText(row.Title).toLowerCase();
  const features = [];

  if (type === 'Японский стиль' && (lower.includes('v-тип') || lower.includes('v-образ'))) {
    features.push('V-образная форма');
  }

  if (type === 'Американский стиль' && (lower.includes('u-тип') || lower.includes('u-образ'))) {
    features.push('U-образная форма');
  }

  if (lower.includes('с соединительным кольцом')) features.push('С соединительным кольцом');
  if (lower.includes('без соединительного кольца') || lower.includes('без кольца')) features.push('Без соединительного кольца');

  if (lower.includes('с ручкой') || title.includes('с ручкой')) features.push('С ручкой');
  if (lower.includes('без ручки')) features.push('Без ручки');

  if (lower.includes('насечк') || lower.includes('риски') || lower.includes('деления')) {
    features.push('Внутренняя разметка');
  }

  if (lower.includes('дополнительные насечки') || lower.includes('доп. насечки') || lower.includes('доп насечки')) {
    features.push('Дополнительные насечки');
  }

  if (lower.includes('без дополнительных насечек') || lower.includes('не имеет насечек') || lower.includes('без насечек')) {
    features.push('Без дополнительных насечек');
  }

  if (lower.includes('тонкую талию') || lower.includes('узкой талии')) features.push('Тонкая талия');
  if (lower.includes('толстые стенки') || lower.includes('толстыми стенками')) features.push('Толстые стенки');
  if (lower.includes('тонкие стенки') || lower.includes('тонкими стенками')) features.push('Тонкие стенки');
  if (lower.includes('утяжелен') || lower.includes('тяжелый') || lower.includes('тяжёлый')) features.push('Утяжеленная конструкция');
  if (lower.includes('легкий') || lower.includes('лёгкий') || lower.includes('легкая') || lower.includes('лёгкая')) features.push('Легкая конструкция');
  if (lower.includes('компактный')) features.push('Компактная форма');
  if (lower.includes('полированная поверхность')) features.push('Полированная поверхность');
  if (lower.includes('прозрачн')) features.push('Прозрачный корпус');
  if (lower.includes('восьмиугольн')) features.push('Восьмиугольная форма');
  if (lower.includes('цилиндрическ')) features.push('Цилиндрическая форма');
  if (lower.includes('широкий') || lower.includes('широкого конуса')) features.push('Широкая форма');

  if (lower.includes('гравиров')) {
    const pattern = getQuotedPattern(source);
    features.push(pattern ? `Гравировка ${pattern}` : 'Гравировка по поверхности');
  }

  if (lower.includes('реплика')) features.push('Реплика прототипа');
  if (lower.includes('винтаж')) features.push('Винтажный стиль');
  if (lower.includes('двумя носиками') || lower.includes('два противоположных носика')) features.push('Два носика');
  if (lower.includes('шкалу') || lower.includes('шкала')) features.push('Мерная шкала');
  if (lower.includes('гост')) features.push('ГОСТ');
  if (lower.includes('для премиксов') || lower.includes('премикс')) features.push('Для премиксов');
  if (lower.includes('для инвентаризаций') || lower.includes('инвентаризац')) features.push('Для инвентаризации');
  if (lower.includes('не впитывает запахи') || lower.includes('не выпитывает запахи')) features.push('Не впитывает запахи');

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

function buildJiggerSpecifications(row, parentRow, specTypeByName) {
  const source = getRowSource(row, parentRow);
  const productType = getProductType(row, parentRow);
  const type = getJiggerType(row, parentRow);

  const specs = [
    makeSpec('Тип товара', productType, specTypeByName),
    makeSpec('Тип', type, specTypeByName),
    makeSpec('Материал', getMaterial(source), specTypeByName),
  ];

  const volume = getVolume(source, row);
  const color = getColor(row);
  const height = getHeight(source);
  const diameter = getDiameter(source);
  const weight = getWeight(source);
  const features = buildFeatures(row, parentRow, type);
  const care = getCare(source);

  if (volume) specs.push(makeSpec('Объем', volume, specTypeByName));
  if (color) specs.push(makeSpec('Цвет / покрытие', color, specTypeByName));
  if (height) specs.push(makeSpec('Высота', height, specTypeByName));
  if (diameter) specs.push(makeSpec('Диаметр', diameter, specTypeByName));
  if (weight) specs.push(makeSpec('Вес', weight, specTypeByName));
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
  const skippedRows = [];
  const rowsForImport = [];

  for (const row of productRows) {
    const parentUid = normalizeSpace(row['Parent UID']);
    const parentRow = parentUid ? parentByUid.get(parentUid) : null;

    if (shouldSkipRow(row, parentRow)) {
      skippedRows.push(row);
    } else {
      rowsForImport.push({ row, parentRow });
    }
  }

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

    for (const { row, parentRow } of rowsForImport) {
      const sku = normalizeSku(row.SKU);
      const productSku = resolveProductSku(sku);
      const product = productByCode.get(productSku);

      if (!product) {
        missingProducts.push({
          sku,
          productSku,
          title: normalizeSpace(row.Title),
        });
        continue;
      }

      const specifications = buildJiggerSpecifications(row, parentRow, specTypeByName);

      items.push({
        sku,
        productSku,
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
    console.log(`Пропущено товаров: ${skippedRows.length}`);
    console.log(`К импорту: ${rowsForImport.length}`);
    console.log(`Найдено товаров в Strapi: ${items.length}`);
    console.log(`Не найдено товаров в Strapi: ${missingProducts.length}`);
    console.log('');
    console.log('Разбивка по типам');
    console.log('-----------------');

    for (const [type, count] of Array.from(typeCounters.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
      console.log(`${type}: ${count}`);
    }

    if (skippedRows.length > 0) {
      console.log('');
      console.log('Пропущены');
      console.log('---------');

      for (const row of skippedRows) {
        console.log(`⏭️ ${normalizeSku(row.SKU)} | ${normalizeSpace(row.Title)}`);
      }
    }

    if (missingProducts.length > 0) {
      console.log('');
      console.log('Не найдены товары');
      console.log('-----------------');

      for (const item of missingProducts) {
        const suffix = item.productSku !== item.sku ? ` → искали как ${item.productSku}` : '';
        console.log(`❌ ${item.sku}${suffix} | ${item.title}`);
      }
    }

    console.log('');
    console.log(`Что будет записано${items.length > PRINT_LIMIT ? ` — показаны первые ${PRINT_LIMIT} из ${items.length}` : ''}`);
    console.log('------------------');

    for (const item of items.slice(0, PRINT_LIMIT)) {
      const title = normalizeSpace(item.row.Title);
      const currentSpecs = item.product.specifications ?? [];
      const skuNote = item.productSku !== item.sku ? ` → Strapi SKU ${item.productSku}` : '';

      console.log('');
      console.log(`✅ ${item.sku}${skuNote} | ${title}`);
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
      console.log('APPLY=1 CSV_FILE=imports/tilda-jiggers.csv node scripts/import-tilda-jiggers-specs.js');
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
