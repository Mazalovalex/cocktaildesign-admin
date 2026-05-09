'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const SPECIFICATION_TYPE_UID = 'api::specification-type.specification-type';

const CSV_FILE = path.resolve(process.env.CSV_FILE || 'imports/tilda-kobbler.csv');
const APPLY = process.env.APPLY === '1';

const REQUIRED_SPECIFICATION_TYPES = [
  'Тип товара',
  'Тип',
  'Материал',
  'Объем',
  'Цвет / покрытие',
  'Особенности',
  'Уход',
];

function normalizeSpace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeSku(value) {
  return normalizeSpace(value)
    .replace(/\uFEFF/g, '')
    .replace(/С/g, 'C')
    .replace(/с/g, 'c');
}

function unique(items) {
  const result = [];
  const seen = new Set();

  for (const item of items) {
    const value = normalizeSpace(item);
    const key = value.toLowerCase();

    if (!value || seen.has(key)) continue;

    seen.add(key);
    result.push(value);
  }

  return result;
}

function capitalizeFirst(value) {
  const text = normalizeSpace(value);
  if (!text) return '';

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  const text = content.replace(/^\uFEFF/, '');

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

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => normalizeSpace(header).replace(/^"|"$/g, ''));

  return rows.slice(1).map((values) => {
    const item = {};

    headers.forEach((header, index) => {
      item[header] = values[index] ?? '';
    });

    return item;
  });
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/#nbsp;/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function htmlToText(value) {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/Как получить скидку\?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitDescriptionAndOldSpecs(text) {
  const cleanText = htmlToText(text);
  const marker = cleanText.match(/характеристики\s*:/i);

  if (!marker || typeof marker.index !== 'number') {
    return {
      description: cleanText,
      oldSpecsText: '',
    };
  }

  return {
    description: cleanText.slice(0, marker.index).trim(),
    oldSpecsText: cleanText.slice(marker.index + marker[0].length).trim(),
  };
}

function getVolume(source) {
  const match = source.match(/(\d{2,4})(?:\s*\/\s*(\d{2,4}))?\s*мл\.?/i);

  if (!match) {
    return null;
  }

  if (match[2]) {
    return `${match[1]} / ${match[2]} мл`;
  }

  return `${match[1]} мл`;
}

function getMaterial(source) {
  const lower = source.toLowerCase();

  const hasGlass = lower.includes('стекл');
  const hasSteel = lower.includes('сталь') || lower.includes('нержавеющ');

  if (hasGlass && hasSteel) return 'Стекло; нержавеющая сталь';
  if (hasGlass) return 'Стекло';
  if (hasSteel) return 'Нержавеющая сталь';

  return null;
}

function getColor(source) {
  const explicitColor = source.match(/цвет\s*:\s*([^•\n\r.;]+)/i);

  if (explicitColor?.[1]) {
    return capitalizeFirst(explicitColor[1]);
  }

  const lower = source.toLowerCase();

  if (lower.includes('серебро') || lower.includes('серебря')) return 'Серебро';
  if (lower.includes('золото') || lower.includes('золот')) return 'Золото';
  if (lower.includes('медь') || lower.includes('медн')) return 'Медь';
  if (lower.includes('черный') || lower.includes('чёрный') || lower.includes('black')) return 'Черный';

  return null;
}

function getQuotedPattern(source) {
  const match = source.match(/["«]([^"»]+)["»]/);

  if (!match?.[1]) {
    return null;
  }

  return normalizeSpace(match[1]);
}

function buildFeatures(source) {
  const lower = source.toLowerCase();
  const features = [];

  if (lower.includes('европейск')) {
    features.push('классический европейский формат');
  }

  if (lower.includes('японск')) {
    features.push('японский стиль');
  }

  if (lower.includes('толст')) {
    features.push('толстые стенки');
  }

  if (lower.includes('плотн') && lower.includes('сталь')) {
    features.push('плотная сталь');
  }

  if (lower.includes('хорошо сидит в руке')) {
    features.push('удобная посадка в руке');
  }

  if (lower.includes('birdy')) {
    features.push('реплика классического кобблера Birdy');
  }

  if (lower.includes('yukiwa')) {
    features.push('реплика классического кобблера Yukiwa');
  }

  if (lower.includes('erik lorincz')) {
    features.push('прототип Erik Lorincz');
  }

  if (lower.includes('гравиров')) {
    const pattern = getQuotedPattern(source);

    features.push(pattern ? `гравировка ${pattern}` : 'гравировка по поверхности');
  }

  if (lower.includes('паттерн') || lower.includes('оригинальный узор')) {
    features.push('оригинальный узор');
  }

  if (lower.includes('плетен') || lower.includes('плетён')) {
    features.push('плетеный узор');
  }

  if (lower.includes('ангел')) {
    features.push('изображение ангела');
  }

  if (lower.includes('чаплин') || lower.includes('chaplin')) {
    features.push('изображение Charlie Chaplin');
  }

  if (lower.includes('термопечат')) {
    features.push('термопечать');
  }

  if (lower.includes('силиконов') && lower.includes('проклад')) {
    features.push('силиконовая прокладка от протечек');
  }

  if (lower.includes('малого объема') || lower.includes('малого объёма') || lower.includes('мини ')) {
    features.push('малый объем');
  }

  if (lower.includes('эмаль')) {
    features.push('покраска эмалью');
  }

  return unique(features).map(capitalizeFirst);
}

function getCare(source) {
  const lower = source.toLowerCase();
  const care = [];

  if (lower.includes('посудомоеч')) {
    care.push('не мыть в посудомоечной машине');
  }

  if (lower.includes('жесткую губку') || lower.includes('жёсткую губку')) {
    care.push('не использовать жесткую губку');
  }

  return unique(care).map(capitalizeFirst);
}

function buildKobblerSpecifications(row, parentRow) {
  const title = normalizeSpace(row.Title);
  const parentTitle = normalizeSpace(parentRow?.Title);

  const ownText = normalizeSpace(row.Text);
  const parentText = normalizeSpace(parentRow?.Text);
  const textForParsing = ownText || parentText;

  const { description, oldSpecsText } = splitDescriptionAndOldSpecs(textForParsing);

  const source = normalizeSpace(`${title} ${parentTitle} ${description} ${oldSpecsText}`);

  const material = getMaterial(source);
  const volume = getVolume(source);
  const color = getColor(source);
  const features = buildFeatures(source);
  const care = getCare(source);

  const specs = [
    { label: 'Тип товара', value: 'Шейкер' },
    { label: 'Тип', value: 'Кобблер' },
  ];

  if (material) specs.push({ label: 'Материал', value: material });
  if (volume) specs.push({ label: 'Объем', value: volume });
  if (color) specs.push({ label: 'Цвет / покрытие', value: color });
  if (features.length > 0) specs.push({ label: 'Особенности', value: features.join('; ') });
  if (care.length > 0) specs.push({ label: 'Уход', value: care.join('; ') });

  return {
    description,
    specs,
  };
}

function buildRowsByTildaUid(rows) {
  const rowsByTildaUid = new Map();

  for (const row of rows) {
    const tildaUid = normalizeSpace(row['Tilda UID']);

    if (tildaUid) {
      rowsByTildaUid.set(tildaUid, row);
    }
  }

  return rowsByTildaUid;
}

function getParentRow(row, rowsByTildaUid) {
  const parentUid = normalizeSpace(row['Parent UID']);

  if (!parentUid) {
    return null;
  }

  return rowsByTildaUid.get(parentUid) ?? null;
}

async function main() {
  if (!fs.existsSync(CSV_FILE)) {
    throw new Error(`CSV файл не найден: ${CSV_FILE}`);
  }

  const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
  const rows = parseCsv(csvContent);
  const rowsByTildaUid = buildRowsByTildaUid(rows);
  const rowsWithSku = rows.filter((row) => normalizeSku(row.SKU));

  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    const specificationTypes = await strapi.db.query(SPECIFICATION_TYPE_UID).findMany({
      select: ['id', 'name'],
      limit: 1000,
    });

    const specificationTypeByName = new Map(specificationTypes.map((type) => [type.name, type]));

    const missingTypes = REQUIRED_SPECIFICATION_TYPES.filter((name) => !specificationTypeByName.has(name));

    if (missingTypes.length > 0) {
      throw new Error(`Не найдены типы характеристик: ${missingTypes.join(', ')}`);
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

      if (!code) continue;

      productByCode.set(code, product);
    }

    const preparedItems = [];

    for (const row of rowsWithSku) {
      const rawSku = normalizeSpace(row.SKU);
      const sku = normalizeSku(rawSku);
      const title = normalizeSpace(row.Title);
      const parentRow = getParentRow(row, rowsByTildaUid);
      const product = productByCode.get(sku) ?? null;
      const result = buildKobblerSpecifications(row, parentRow);

      preparedItems.push({
        sku,
        rawSku,
        title,
        product,
        specs: result.specs,
      });
    }

    const matchedItems = preparedItems.filter((item) => item.product);
    const missingItems = preparedItems.filter((item) => !item.product);

    console.log('');
    console.log(APPLY ? 'Режим: APPLY=1, характеристики будут записаны' : 'Режим: dry-run, база не меняется');
    console.log('------------------------------------------------');
    console.log(`CSV файл: ${CSV_FILE}`);
    console.log(`CSV строк всего: ${rows.length}`);
    console.log(`Строк с SKU: ${rowsWithSku.length}`);
    console.log(`Найдено товаров в Strapi: ${matchedItems.length}`);
    console.log(`Не найдено товаров в Strapi: ${missingItems.length}`);
    console.log('');

    if (missingItems.length > 0) {
      console.log('Не найдено в Strapi');
      console.log('-------------------');

      for (const item of missingItems) {
        console.log(`- ${item.rawSku} → normalized=${item.sku} | ${item.title}`);
      }

      console.log('');
    }

    console.log('Что будет записано');
    console.log('------------------');

    for (const item of preparedItems) {
      const status = item.product ? '✅' : '❌';
      const oldSpecsCount = item.product?.specifications?.length ?? 0;

      console.log('');
      console.log(`${status} ${item.rawSku} | ${item.title}`);

      if (item.product) {
        console.log(`Strapi: id=${item.product.id} | ${item.product.name}`);
        console.log(`Текущих характеристик: ${oldSpecsCount}`);
      }

      for (const spec of item.specs) {
        console.log(`  ${spec.label} — ${spec.value}`);
      }
    }

    if (!APPLY) {
      console.log('');
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи после проверки на текущей базе:');
      console.log('APPLY=1 CSV_FILE=imports/tilda-kobbler.csv node scripts/import-tilda-kobbler-specs.js');
      return;
    }

    let updatedCount = 0;

    for (const item of matchedItems) {
      const specifications = item.specs.map((spec) => {
        const specificationType = specificationTypeByName.get(spec.label);

        if (!specificationType) {
          throw new Error(`Не найден тип характеристики: ${spec.label}`);
        }

        return {
          specification: specificationType.id,
          value: spec.value,
        };
      });

      await strapi.entityService.update(PRODUCT_UID, item.product.id, {
        data: {
          specifications,
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
