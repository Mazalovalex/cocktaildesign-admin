'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const SPEC_TYPE_UID = 'api::specification-type.specification-type';

const CSV_FILE = process.env.CSV_FILE || 'imports/tilda-confectioner.csv';
const SERVER_CODES_PATH = process.env.SERVER_CODES_PATH || '/tmp/category-server-products.tsv';
const APPLY = process.env.APPLY === '1';
const PRINT_LIMIT = Number(process.env.PRINT_LIMIT || 80);

const APPROVED_SPEC_NAMES = [
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
];

const SKU_ALIASES = {};

const EXCLUDE_FROM_THIS_BLOCK = new Set([]);

const MANUAL_SERVER_ITEMS = [];

const TARGET_PARENT_CODES = new Set([
  'MldBrnch',
  'MldCndy',
  'MldCrcl',
  'MldFlr',
  'MldFlwrHD',
  'MldGmtr',
  'MldHex',
  'MldLarge',
  'MldLf',
  'MldNtre',
  'MldOthr',
  'MldSprl',
  'MldThr',
  'PstrBg100',
  'SlkShvl',
  'SlKv30/40',
  'SptlScrpr',
  'Whsk',
]);

const MOLD_PARENT_CODES = [
  'MldFlwrHD',
  'MldBrnch',
  'MldLarge',
  'MldCndy',
  'MldCrcl',
  'MldGmtr',
  'MldHex',
  'MldNtre',
  'MldOthr',
  'MldSprl',
  'MldFlr',
  'MldLf',
];

function getParentProductCode(value) {
  const code = normalizeSku(value);

  for (const parentCode of MOLD_PARENT_CODES) {
    const pattern = new RegExp(`^${parentCode}\\d+$`);

    if (pattern.test(code)) {
      return parentCode;
    }
  }

  if (code.startsWith('MldThr')) return 'MldThr';

  if (code === 'PstrBgS100') return 'PstrBg100';
  if (code === 'PstrBgM100') return 'PstrBg100';
  if (code === 'PstrBgB100') return 'PstrBg100';
  if (code === 'PstrBgB') return 'PstrBg100';

  if (code === 'SlKvWh') return 'SlKv30/40';
  if (code === 'SlKvBl') return 'SlKv30/40';
  if (code === 'SlKvBg') return 'SlKv30/40';
  if (code === 'SlKvGrey') return 'SlKv30/40';

  if (code === 'SlkShvlS') return 'SlkShvl';
  if (code === 'SlkShvlM') return 'SlkShvl';
  if (code === 'SlkShvlB') return 'SlkShvl';

  if (code === 'SptlScrprSq') return 'SptlScrpr';
  if (code === 'SptlScrprOv') return 'SptlScrpr';

  if (code === 'WhskS') return 'Whsk';
  if (code === 'WhskB') return 'Whsk';

  return code;
}

function mergeTextParts(...parts) {
  const result = [];

  for (const part of parts) {
    const value = clean(part);

    if (!value) continue;
    if (result.includes(value)) continue;

    result.push(value);
  }

  return result.join(' ');
}

function clean(value) {
  return String(value ?? '').trim().replace(/\uFEFF/g, '');
}

function normalizeSpaces(value) {
  return clean(value).replace(/\s+/g, ' ');
}

function normalizeSku(value) {
  return clean(value)
    .replace(/С/g, 'C')
    .replace(/с/g, 'c');
}

function normalizeKey(value) {
  return normalizeSpaces(value).toLowerCase().replace(/ё/g, 'е');
}

function normalizeSize(value) {
  return clean(value)
    .replace(/\*/g, '×')
    .replace(/x/gi, '×')
    .replace(/\s*×\s*/g, '×')
    .replace(/-/g, '–')
    .replace(/\s+/g, ' ');
}

function stripHtml(value) {
  return clean(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function addSpec(specs, name, value) {
  const normalizedName = clean(name);
  const normalizedValue = normalizeSpaces(value);

  if (!normalizedName || !normalizedValue) return;

  const forbiddenValues = [
    '-',
    '—',
    'нет данных',
    'неизвестно',
    'undefined',
    'null',
    'NaN',
  ];

  if (forbiddenValues.includes(normalizedValue)) return;
  if (/размеры\s*:\s*указаны\s+на\s+фото/i.test(normalizedValue)) return;
  if (/как получить скидку/i.test(normalizedValue)) return;

  if (!APPROVED_SPEC_NAMES.includes(normalizedName)) {
    throw new Error(`Запрещённая характеристика: ${normalizedName}`);
  }

  const existing = specs.find((item) => item.name === normalizedName);

  if (existing) {
    existing.value = normalizedValue;
    return;
  }

  specs.push({
    name: normalizedName,
    value: normalizedValue,
  });
}

function addFeature(features, value) {
  const normalizedValue = normalizeSpaces(value);

  if (!normalizedValue) return;
  if (/размеры\s*:\s*указаны\s+на\s+фото/i.test(normalizedValue)) return;
  if (/как получить скидку/i.test(normalizedValue)) return;

  if (!features.includes(normalizedValue)) {
    features.push(normalizedValue);
  }
}

function splitCsvLineAware(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }

      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  return rows;
}

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delimiter = firstLine.includes(';') ? ';' : ',';

  const table = splitCsvLineAware(text, delimiter).filter((row) =>
    row.some((cell) => clean(cell))
  );

  if (!table.length) return [];

  const headers = table.shift().map(clean);

  return table.map((row) => {
    const item = {};

    for (let index = 0; index < headers.length; index += 1) {
      item[headers[index]] = clean(row[index]);
    }

    return item;
  });
}

function readServerCodes(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.split('\t')[0])
    .map(clean)
    .filter((code) => code && code !== '-');
}

function getSku(row) {
  return normalizeSku(row.SKU || row.Sku || row.sku);
}

function getTitle(row) {
  return clean(row.Title || row.title || row.Name || row.name);
}

function getParentUid(row) {
  return clean(row['Parent UID'] || row.ParentUID || row.parent_uid || row['Parent uid']);
}

function getUid(row) {
  return clean(row['Tilda UID'] || row.UID || row.uid || row['External ID'] || row.ExternalId);
}

function parseEdition(rawValue) {
  const raw = clean(rawValue);

  if (!raw || raw.startsWith('product_options:')) {
    return { name: '', value: '' };
  }

  const [namePart, ...valueParts] = raw.split(':');

  const name = clean(namePart);
  const value = clean(valueParts.join(':'))
    .replace(/\s*#[0-9a-f]{3,8}$/i, '')
    .trim();

  return { name, value };
}

function getInheritedValue(row, parentsByUid, fieldName) {
  const ownValue = clean(row[fieldName]);

  if (ownValue) return ownValue;

  const parent = parentsByUid.get(getParentUid(row));

  if (!parent) return '';

  return clean(parent[fieldName]);
}

function getConfectionerCategory(value) {
  const category = clean(value);

  const parts = category
    .split(';')
    .map(clean)
    .filter(Boolean);

  const confectionerPath = parts.find((part) =>
    part.startsWith('ВСЕ ДЛЯ КОНДИТЕРА>>>')
  );

  if (confectionerPath) {
    return clean(confectionerPath.split('>>>').pop());
  }

  if (parts.includes('ВСЕ ДЛЯ КОНДИТЕРА')) {
    return 'ВСЕ ДЛЯ КОНДИТЕРА';
  }

  return clean(parts[parts.length - 1] || category);
}

function detectColor(title, edition) {
  if (edition.name === 'Выбор цвета' && edition.value) {
    return edition.value;
  }

  const lower = normalizeKey(title);

  const rules = [
    ['черн', 'Черный'],
    ['бел', 'Белый'],
    ['серый', 'Серый'],
    ['беж', 'Бежевый'],
    ['корич', 'Коричневый'],
    ['фиолет', 'Фиолетовый'],
    ['сирен', 'Сиреневый'],
    ['розов', 'Розовый'],
    ['красн', 'Красный'],
    ['син', 'Синий'],
    ['голуб', 'Голубой'],
    ['зелен', 'Зеленый'],
    ['желт', 'Желтый'],
  ];

  for (const [needle, color] of rules) {
    if (lower.includes(needle)) return color;
  }

  return '';
}

function detectDimensionsFromText(value) {
  const normalized = normalizeSize(stripHtml(value));

  if (/размеры\s*:\s*указаны\s+на\s+фото/i.test(normalized)) {
    return '';
  }

  const patterns = [
    /размер(?:ы)?[^\d]{0,20}(\d+(?:[,.]\d+)?)\s*×\s*(\d+(?:[,.]\d+)?)(?:\s*×\s*(\d+(?:[,.]\d+)?))?\s*(см|мм)?/i,
    /(\d+(?:[,.]\d+)?)\s*×\s*(\d+(?:[,.]\d+)?)(?:\s*×\s*(\d+(?:[,.]\d+)?))?\s*(см|мм)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (!match) continue;

    const unit = match[4] || 'см';

    const parts = [match[1], match[2], match[3]]
      .filter(Boolean)
      .map((part) => part.replace('.', ','));

    return `${parts.join('×')} ${unit}`;
  }

  return '';
}

function detectDimensions(title, text) {
  const fromTitle = detectDimensionsFromText(title);

  if (fromTitle) return fromTitle;

  return detectDimensionsFromText(text);
}

function detectModel(title, edition) {
  if (edition.name === 'Модель' && edition.value) return edition.value;
  if (edition.name === 'Выбор формы' && edition.value) return edition.value;
  if (edition.name === 'Выбор размера' && edition.value) return edition.value;

  const dashMatch = clean(title).match(/\s[-–]\s(.+)$/);

  if (dashMatch) return clean(dashMatch[1]);

  return '';
}

function getVariantValue(edition, fallbackTitle) {
  if (edition.value) return edition.value;

  const match = clean(fallbackTitle).match(/\s[-–]\s(.+)$/);

  return match ? clean(match[1]) : '';
}

function buildMatSpecs(item) {
  const specs = [];
  const features = [];

  const title = item.title;
  const text = item.text;
  const lower = normalizeKey(`${title} ${text}`);
  const color = detectColor(title, item.edition);
  const dimensions = detectDimensions(title, text);

  addSpec(specs, 'Тип товара', 'Кондитерский коврик');

  if (lower.includes('тефлон')) {
    addSpec(specs, 'Тип', 'Тефлоновый коврик');
    addSpec(specs, 'Материал', 'Тефлон');
  } else {
    addSpec(specs, 'Тип', 'Силиконовый коврик');
    addSpec(specs, 'Материал', 'Силикон');
  }

  addSpec(specs, 'Назначение', 'Для выпечки, декора и кондитерских работ');
  addSpec(specs, 'Габариты', dimensions);
  addSpec(specs, 'Цвет / покрытие', color);

  if (lower.includes('перфор')) addFeature(features, 'Перфорированная поверхность');
  if (lower.includes('размет')) addFeature(features, 'С разметкой');
  if (lower.includes('антипригар')) addFeature(features, 'Антипригарная поверхность');

  addSpec(specs, 'Особенности', features.join('; '));

  return specs;
}

function buildMoldSpecs(item) {
  const specs = [];
  const features = [];

  const title = item.title;
  const text = item.text;
  const lower = normalizeKey(`${title} ${text}`);
  const dimensions = detectDimensions(title, text);
  const model = detectModel(title, item.edition);

  if (lower.includes('вайнер')) {
    addSpec(specs, 'Тип товара', 'Вайнер');
    addSpec(specs, 'Тип', 'Силиконовый вайнер');
    addSpec(specs, 'Назначение', 'Для создания текстуры и декоративных элементов');
    addSpec(specs, 'Материал', 'Силикон');

    if (lower.includes('3 пар')) {
      addSpec(specs, 'Комплектация', '3 пары');
    } else if (lower.includes('1 пар')) {
      addSpec(specs, 'Комплектация', '1 пара');
    }

    addSpec(specs, 'Габариты', dimensions);

    addFeature(features, 'Текстура листа');
    addFeature(features, 'Двусторонняя форма');

    addSpec(specs, 'Особенности', features.join('; '));

    return specs;
  }

  addSpec(specs, 'Тип товара', 'Кондитерская форма');
  addSpec(specs, 'Тип', 'Силиконовая форма');
  addSpec(specs, 'Назначение', 'Для приготовления декора, гарниров и кондитерских элементов');
  addSpec(specs, 'Материал', 'Силикон');
  addSpec(specs, 'Модель', model);
  addSpec(specs, 'Габариты', dimensions);

  if (lower.includes('сквозн')) addFeature(features, 'Сквозная форма');
  if (lower.includes('толщина 2мм') || lower.includes('толщина 2 мм')) {
    addFeature(features, 'Толщина 2 мм');
  }
  if (lower.includes('антипригар')) addFeature(features, 'Антипригарный материал');
  if (lower.includes('жаропроч')) addFeature(features, 'Жаропрочный материал');
  if (lower.includes('морозостой')) addFeature(features, 'Морозостойкий материал');

  addSpec(specs, 'Особенности', features.join('; '));

  return specs;
}

function buildSpatulaSpecs(item) {
  const specs = [];
  const features = [];

  const title = item.title;
  const text = item.text;
  const lower = normalizeKey(`${title} ${text}`);
  const variant = getVariantValue(item.edition, title);
  const variantKey = normalizeKey(variant);

  if (lower.includes('кисточк')) {
    addSpec(specs, 'Тип товара', 'Кисточка');
    addSpec(specs, 'Тип', 'Силиконовая кисточка');
    addSpec(specs, 'Назначение', 'Для смазывания и кондитерских работ');
    addSpec(specs, 'Материал', 'Пластик, силикон');
    addSpec(specs, 'Габариты', '21,2×7 см');
    addSpec(specs, 'Длина', '21,2 см');

    addFeature(features, 'Выдерживает температуру от -50 до 250 °C');

    addSpec(specs, 'Особенности', features.join('; '));

    return specs;
  }

  if (lower.includes('шпатель-скребок')) {
    addSpec(specs, 'Тип товара', 'Шпатель');
    addSpec(specs, 'Тип', 'Шпатель-скребок');
    addSpec(specs, 'Назначение', 'Для работы с кремом, мастикой, марципаном и айсингом');
    addSpec(specs, 'Материал', 'Полипропилен');
    addSpec(specs, 'Модель', variant);

    if (variantKey.includes('трапец')) {
      addSpec(specs, 'Габариты', '13,5×9,5 см');
    } else if (variantKey.includes('овал')) {
      addSpec(specs, 'Габариты', '16×10,5 см');
    }

    addFeature(features, 'Можно использовать как скребок');

    addSpec(specs, 'Особенности', features.join('; '));

    return specs;
  }

  if (lower.includes('палетка')) {
    addSpec(specs, 'Тип товара', 'Лопатка');
    addSpec(specs, 'Тип', 'Лопатка-палетка');
    addSpec(specs, 'Назначение', 'Для работы с кремами, мягкими смесями и снятия гарниров');
    addSpec(specs, 'Материал', 'Пластик, сталь');
    addSpec(specs, 'Габариты', '27×3 см');
    addSpec(specs, 'Длина', '27 см');

    addFeature(features, 'Изогнутая форма');
    addFeature(features, 'Рабочая часть 10 см');

    addSpec(specs, 'Особенности', features.join('; '));

    return specs;
  }

  addSpec(specs, 'Тип товара', 'Лопатка');
  addSpec(specs, 'Тип', 'Силиконовая лопатка');
  addSpec(specs, 'Назначение', 'Для кондитерских и кулинарных работ');
  addSpec(specs, 'Материал', 'Пластик, силикон');
  addSpec(specs, 'Модель', variant);

  if (variantKey.includes('мал')) {
    addSpec(specs, 'Длина', '22 см');
    addFeature(features, 'Рабочая часть 6,5×3 см');
  } else if (variantKey.includes('сред')) {
    addSpec(specs, 'Длина', '25,5 см');
    addFeature(features, 'Рабочая часть 9×5 см');
  } else if (variantKey.includes('больш')) {
    addSpec(specs, 'Длина', '25,5 см');
    addFeature(features, 'Рабочая часть 8,5×6 см');
  }

  addFeature(features, 'Выдерживает температуру от -50 до 250 °C');

  addSpec(specs, 'Особенности', features.join('; '));

  return specs;
}

function buildSmallToolsSpecs(item) {
  const specs = [];
  const features = [];

  const title = item.title;
  const lower = normalizeKey(`${title} ${item.text}`);
  const variant = getVariantValue(item.edition, title);
  const variantKey = normalizeKey(variant);

  if (lower.includes('венчик')) {
    addSpec(specs, 'Тип товара', 'Венчик');
    addSpec(specs, 'Тип', 'Кондитерский венчик');
    addSpec(specs, 'Назначение', 'Для взбивания и смешивания ингредиентов');
    addSpec(specs, 'Материал', 'Нержавеющая сталь');
    addSpec(specs, 'Модель', variant);

    if (variantKey.includes('мал')) {
      addSpec(specs, 'Длина', '18,5 см');
      addFeature(features, 'Рабочая часть 10,5×5 см');
    } else if (variantKey.includes('больш')) {
      addSpec(specs, 'Длина', '28 см');
      addFeature(features, 'Рабочая часть 18×7 см');
    }

    addSpec(specs, 'Особенности', features.join('; '));

    return specs;
  }

  if (lower.includes('кондитерский мешок')) {
    addSpec(specs, 'Тип товара', 'Кондитерский мешок');
    addSpec(specs, 'Тип', 'Одноразовый кондитерский мешок');
    addSpec(specs, 'Назначение', 'Для крема, теста и кондитерских смесей');
    addSpec(specs, 'Материал', 'ПЭТ, полиэтилен');
    addSpec(specs, 'Модель', variant || (lower.includes('больш') ? 'Большой' : ''));

    if (item.code === 'PstrBgB') {
      addSpec(specs, 'Количество в упаковке', '10 шт.');
      addSpec(specs, 'Габариты', '35×23 см');
    } else {
      addSpec(specs, 'Количество в упаковке', '100 шт.');

      if (variantKey.includes('мал')) {
        addSpec(specs, 'Габариты', '25×16 см');
      } else if (variantKey.includes('сред')) {
        addSpec(specs, 'Габариты', '30×20 см');
      } else if (variantKey.includes('больш')) {
        addSpec(specs, 'Габариты', '35×23 см');
      }
    }

    addFeature(features, 'Можно обрезать под насадку');
    addFeature(features, 'Одноразовый');

    addSpec(specs, 'Особенности', features.join('; '));

    return specs;
  }

  if (lower.includes('плунжер')) {
    addSpec(specs, 'Тип товара', 'Плунжер');
    addSpec(specs, 'Тип', 'Плунжер с насадками');
    addSpec(specs, 'Назначение', 'Для работы с мастикой и тестом');
    addSpec(specs, 'Материал', 'Пластик, сталь');
    addSpec(specs, 'Комплектация', '8 насадок');

    addFeature(features, 'Быстросменные насадки');
    addFeature(features, 'Размер формы 3,7 см');

    addSpec(specs, 'Особенности', features.join('; '));

    return specs;
  }

  if (lower.includes('миска')) {
    addSpec(specs, 'Тип товара', 'Миска');
    addSpec(specs, 'Тип', lower.includes('наклон') ? 'Миска с наклоном' : 'Миска');
    addSpec(specs, 'Назначение', 'Для смешивания, пересыпания и хранения ингредиентов');
    addSpec(specs, 'Материал', 'Нержавеющая сталь');

    if (item.code === 'BwlTlt') {
      addSpec(specs, 'Габариты', '14×8 см');
    } else if (item.code === 'BwlSm') {
      addSpec(specs, 'Габариты', '14×5,5 см');
    }

    return specs;
  }

  if (lower.includes('кисточк')) {
    return buildSpatulaSpecs(item);
  }

  addSpec(specs, 'Тип товара', 'Кондитерский инвентарь');
  addSpec(specs, 'Назначение', 'Для кондитерских работ');
  addSpec(specs, 'Габариты', detectDimensions(title, item.text));

  return specs;
}

function buildSpecs(item) {
  const category = normalizeKey(item.categoryGroup || item.category);
  const lower = normalizeKey(`${item.title} ${item.text}`);

  if (
    category.includes('кондитерские мелочи') ||
    lower.includes('плунжер') ||
    lower.includes('венчик') ||
    lower.includes('кондитерский мешок') ||
    lower.includes('миска')
  ) {
    return buildSmallToolsSpecs(item);
  }

  if (category.includes('коврик') || lower.includes('коврик')) {
    return buildMatSpecs(item);
  }

  if (
    category.includes('лопат') ||
    category.includes('шпател') ||
    lower.includes('лопат') ||
    lower.includes('шпатель') ||
    lower.includes('кисточк')
  ) {
    return buildSpatulaSpecs(item);
  }

  if (
    category.includes('форм') ||
    lower.includes('форма') ||
    lower.includes('молд') ||
    lower.includes('вайнер')
  ) {
    return buildMoldSpecs(item);
  }

  return buildSmallToolsSpecs(item);
}


function normalizeParentSpecs(item, specs) {
  if (item.code === 'PstrBg100') {
    return specs.filter((spec) => spec.name !== 'Модель');
  }

  if (item.code === 'SlKv30/40') {
    return specs
      .map((spec) => {
        if (spec.name !== 'Особенности') return spec;

        const features = spec.value
          .split(';')
          .map((value) => normalizeSpaces(value))
          .filter((value) => value && value !== 'С разметкой');

        return {
          ...spec,
          value: features.join('; '),
        };
      })
      .filter((spec) => spec.value);
  }

  return specs;
}

function buildItemsFromCsv(rows) {
  const parentsByUid = new Map();

  for (const row of rows) {
    if (!getSku(row)) {
      const uid = getUid(row);

      if (uid) {
        parentsByUid.set(uid, row);
      }
    }
  }

  const groupedItems = new Map();

  function addGroupedItem(item) {
    const parentCode = getParentProductCode(item.code);

    if (!TARGET_PARENT_CODES.has(parentCode)) {
      return;
    }

    const existing = groupedItems.get(parentCode);

    if (!existing) {
      groupedItems.set(parentCode, {
        code: parentCode,
        rawSku: item.rawSku,
        rawSkus: [item.rawSku],
        title: item.title,
        category: item.category,
        categoryGroup: item.categoryGroup,
        text: item.text,
        edition: '',
        source: item.source,
      });

      return;
    }

    existing.rawSkus.push(item.rawSku);
    existing.text = mergeTextParts(existing.text, item.text);

    if (!existing.category && item.category) {
      existing.category = item.category;
    }

    if (!existing.categoryGroup && item.categoryGroup) {
      existing.categoryGroup = item.categoryGroup;
    }

    if (!existing.title && item.title) {
      existing.title = item.title;
    }

    if (!existing.source.includes(item.source)) {
      existing.source = `${existing.source}, ${item.source}`;
    }
  }

  for (const row of rows) {
    const rawSku = getSku(row);

    if (!rawSku) continue;
    if (EXCLUDE_FROM_THIS_BLOCK.has(rawSku)) continue;

    const aliasedCode = SKU_ALIASES[rawSku] || rawSku;
    const parentCode = getParentProductCode(aliasedCode);

    if (!TARGET_PARENT_CODES.has(parentCode)) {
      continue;
    }

    const parentUid = clean(row['Parent UID']);
    const parentRow = parentUid ? parentsByUid.get(parentUid) : null;

    const inheritedCategory = parentRow ? clean(parentRow.Category) : getInheritedValue(row, parentsByUid, 'Category');
    const inheritedText = parentRow ? clean(parentRow.Text) : getInheritedValue(row, parentsByUid, 'Text');
    const inheritedTitle = parentRow ? getTitle(parentRow) : getTitle(row);

    const categoryGroup = getConfectionerCategory(inheritedCategory);

    addGroupedItem({
      code: parentCode,
      rawSku,
      title: inheritedTitle,
      category: inheritedCategory,
      categoryGroup,
      text: inheritedText,
      edition: '',
      source: SKU_ALIASES[rawSku] ? `alias:${rawSku}` : 'csv-parent-group',
    });
  }

  for (const manual of MANUAL_SERVER_ITEMS) {
    const rawSku = normalizeSku(manual.code);
    const aliasedCode = SKU_ALIASES[rawSku] || rawSku;
    const parentCode = getParentProductCode(aliasedCode);

    if (!TARGET_PARENT_CODES.has(parentCode)) {
      continue;
    }

    addGroupedItem({
      code: parentCode,
      rawSku,
      title: manual.title,
      category: manual.category,
      categoryGroup: manual.category,
      text: manual.text || '',
      edition: '',
      source: 'manual-parent-group',
    });
  }

  return [...groupedItems.values()]
    .map((item) => ({
      ...item,
      source: `${item.source}; raw SKU: ${item.rawSkus.join(', ')}`,
      specs: normalizeParentSpecs(item, buildSpecs(item)),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}


function countCsvSku(rows) {
  return rows.filter((row) => getSku(row)).length;
}

function countParentRows(rows) {
  return rows.filter((row) => !getSku(row)).length;
}

function printCodeDiff(title, codes, itemByCode) {
  if (!codes.length) return;

  console.log('');
  console.log(title);
  console.log('----------------------------------------------');

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

function ensureNoBadSpecValues(items) {
  const badValues = ['undefined', 'null', 'NaN'];

  for (const item of items) {
    for (const spec of item.specs) {
      if (!spec.value) {
        throw new Error(`Пустая характеристика: ${item.code} | ${spec.name}`);
      }

      if (badValues.includes(spec.value)) {
        throw new Error(`Мусорная характеристика: ${item.code} | ${spec.name} — ${spec.value}`);
      }
    }
  }
}

async function main() {
  const csvPath = path.resolve(process.cwd(), CSV_FILE);
  const serverCodesPath = path.resolve(SERVER_CODES_PATH);

  const rows = parseCsv(csvPath);
  const finalItems = buildItemsFromCsv(rows);

  ensureNoBadSpecValues(finalItems);

  const finalByCode = new Map(finalItems.map((item) => [item.code, item]));
  const finalCodes = [...finalByCode.keys()].sort();

  const serverCodes = readServerCodes(serverCodesPath).sort();
  const serverCodeSet = new Set(serverCodes);
  const finalCodeSet = new Set(finalCodes);

  const missingOnServer = finalCodes.filter((code) => !serverCodeSet.has(code));
  const extraOnServer = serverCodes.filter((code) => !finalCodeSet.has(code));

  console.log(APPLY ? 'Режим: APPLY=1, база будет изменена' : 'Режим: dry-run, база не меняется');
  console.log('------------------------------------------------');
  console.log(`CSV файл: ${csvPath}`);
  console.log(`Server codes файл: ${serverCodesPath}`);
  console.log(`CSV строк всего: ${rows.length}`);
  console.log(`CSV строк с SKU: ${countCsvSku(rows)}`);
  console.log(`CSV строк без SKU / родителей: ${countParentRows(rows)}`);
  console.log(`Alias-замен: ${Object.keys(SKU_ALIASES).length}`);
  console.log(`Исключено из этого блока: ${EXCLUDE_FROM_THIS_BLOCK.size}`);
  console.log(`Добавлено вручную из серверной категории: ${MANUAL_SERVER_ITEMS.length}`);
  console.log(`Итоговый набор импорта: ${finalItems.length}`);
  console.log(`Серверная категория товаров: ${serverCodes.length}`);
  console.log(`Не хватает на сервере: ${missingOnServer.length}`);
  console.log(`Лишние на сервере относительно импорта: ${extraOnServer.length}`);

  printCodeDiff('Не хватает на сервере', missingOnServer, finalByCode);
  printCodeDiff('Лишние на сервере относительно импорта', extraOnServer, finalByCode);

  if (missingOnServer.length || extraOnServer.length) {
    throw new Error('Итоговый набор импорта не совпадает с серверной категорией. Импорт остановлен.');
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
      printCodeDiff(
        'Не найдено товаров в Strapi',
        missingProducts.map((item) => item.code),
        finalByCode
      );

      throw new Error('Есть товары, которые не найдены в Strapi. Импорт остановлен.');
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

      if (printed < PRINT_LIMIT) {
        console.log('');
        console.log(`✅ ${item.code} | ${item.title}`);
        console.log(`Strapi: id=${product.id} | ${product.name}`);
        console.log(`Категория Strapi: ${product.category?.name || '-'}`);
        console.log(`Группа импорта: ${item.categoryGroup || '-'}`);
        console.log(`Источник: ${item.source}`);
        console.log(`Текущих характеристик: ${currentSpecs.length}`);

        for (const spec of item.specs) {
          console.log(`  ${spec.name} — ${spec.value}`);
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
        `APPLY=1 CSV_FILE=${CSV_FILE} SERVER_CODES_PATH=${SERVER_CODES_PATH} node ${process.argv[1]}`
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
