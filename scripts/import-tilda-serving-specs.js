'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const SPECIFICATION_TYPE_UID = 'api::specification-type.specification-type';

const CSV_FILE = process.env.CSV_FILE || 'imports/tilda-serving.csv';
const APPLY = process.env.APPLY === '1';
const PRINT_LIMIT = Number(process.env.PRINT_LIMIT || 80);

const SKU_ALIASES = {
  CstAutB: 'CstAutBr',
  PeakBb50: 'PeakBb',
  'PeakCircle-1': 'PeakCircle',
  PiroWht: 'Piro',
};

const EXCLUDE_FROM_THIS_BLOCK = new Set([
  'Cloche26',
  'FBCart',
  'FBIsp',
  'FBMini',
  'FBblFub',
  'MlcCvr',
  'MlcLctn',
  'Sbox',
  'SgunBig',
  'SmkGrvty',
  'CndBlst150',
  'Zstr15',
]);

const MANUAL_SERVER_PRODUCTS = [
  {
    code: 'DoskSlt',
    title: 'Доска сервировочная, сланец, 30х15см',
    category: 'ВСЕ ДЛЯ ПОДАЧИ;костеры, подставки, подносы',
  },
  {
    code: 'LeafBig10Red',
    title: 'Листья скелетированные большие 10 шт./уп. 17-22см. Красные',
    category: 'ВСЕ ДЛЯ ПОДАЧИ;для гарниша',
  },
  {
    code: 'LeafBig10Wh',
    title: 'Листья скелетированные большие 10 шт./уп. 17-22см. Белые',
    category: 'ВСЕ ДЛЯ ПОДАЧИ;для гарниша',
  },
  {
    code: 'PwdrMng',
    title: 'Tasty Powder Манго 150 мл.',
    category: 'ВСЕ ДЛЯ ПОДАЧИ;ягоды и пудры',
  },
  {
    code: 'Scissors',
    title: 'Ножницы Фигурные Зиг-Заг',
    category: 'ВСЕ ДЛЯ ПОДАЧИ;инвентарь и девайсы',
  },
  {
    code: 'ScissorsDrct',
    title: 'Ножницы прямые',
    category: 'ВСЕ ДЛЯ ПОДАЧИ;инвентарь и девайсы',
  },
  {
    code: 'ScissorsMulti',
    title: 'Многофункциональные ножницы',
    category: 'ВСЕ ДЛЯ ПОДАЧИ;инвентарь и девайсы',
  },
  {
    code: 'ScissorsWave',
    title: 'Ножницы фигурные Волна',
    category: 'ВСЕ ДЛЯ ПОДАЧИ;инвентарь и девайсы',
  },
];

const SPEC_NAMES = [
  'Тип товара',
  'Тип',
  'Назначение',
  'Материал',
  'Цвет / покрытие',
  'Объем',
  'Габариты',
  'Длина',
  'Вес',
  'Количество в упаковке',
  'Комплектация',
  'Производитель',
  'Модель',
  'Вкус и аромат',
  'Особенности',
];

function clean(value) {
  return String(value ?? '').trim().replace(/\uFEFF/g, '');
}

function normalizeSku(value) {
  return clean(value).replace(/С/g, 'C').replace(/с/g, 'c');
}

function resolveSku(value) {
  const sku = normalizeSku(value);
  return SKU_ALIASES[sku] || sku;
}

function parseCsv(text, delimiter = ';') {
  const rows = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (char === delimiter && !insideQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }

      row.push(cell);
      rows.push(row);
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

  const [headers, ...dataRows] = rows;

  if (!headers) {
    return [];
  }

  return dataRows
    .filter((dataRow) => dataRow.some((value) => clean(value)))
    .map((dataRow) => {
      const item = {};

      headers.forEach((header, index) => {
        item[clean(header)] = clean(dataRow[index]);
      });

      return item;
    });
}

function getCategory(row) {
  return clean(row.Category || row.category);
}

function getTitle(row) {
  return clean(row.Title || row.title || row.name);
}

function getLowerTitle(row) {
  return getTitle(row).toLowerCase().replace(/ё/g, 'е');
}

function getLowerCategory(row) {
  return getCategory(row).toLowerCase().replace(/ё/g, 'е');
}

function addSpec(specs, name, value) {
  const cleanValue = clean(value);

  if (!cleanValue) {
    return;
  }

  if (specs.some((item) => item.name === name)) {
    return;
  }

  specs.push({ name, value: cleanValue });
}

function addFeature(features, value) {
  const cleanValue = clean(value);

  if (!cleanValue) {
    return;
  }

  if (!features.includes(cleanValue)) {
    features.push(cleanValue);
  }
}

function extractLength(title) {
  if (/(\d+(?:[,.]\d+)?)\s*[-–—]\s*(\d+(?:[,.]\d+)?)\s*см/i.test(title)) {
    return '';
  }

  const meterMatch = title.match(/(\d+(?:[,.]\d+)?)\s*м\b/i);

  if (meterMatch) {
    return `${meterMatch[1].replace('.', ',')} м`;
  }

  const match = title.match(/(\d+(?:[,.]\d+)?)\s*см/i);
  return match ? `${match[1].replace('.', ',')} см` : '';
}

function extractDimensions(title) {
  const rangeMatch = title.match(/(\d+(?:[,.]\d+)?)\s*[-–—]\s*(\d+(?:[,.]\d+)?)\s*см/i);

  if (rangeMatch) {
    return `${rangeMatch[1].replace('.', ',')}–${rangeMatch[2].replace('.', ',')} см`;
  }

  const mmSlashMatch = title.match(/(\d+(?:[,.]\d+)?)\s*\/\s*(\d+(?:[,.]\d+)?)\s*мм/i);

  if (mmSlashMatch) {
    return `${mmSlashMatch[1].replace('.', ',')}/${mmSlashMatch[2].replace('.', ',')} мм`;
  }

  const match = title.match(/(\d+(?:[,.]\d+)?)\s*[xх*]\s*(\d+(?:[,.]\d+)?)(?:\s*[xх*]\s*(\d+(?:[,.]\d+)?))?\s*см/i);

  if (!match) {
    return '';
  }

  const values = [match[1], match[2], match[3]]
    .filter(Boolean)
    .map((value) => value.replace('.', ','));

  return `${values.join('×')} см`;
}

function extractVolume(title) {
  const match = title.match(/(\d+(?:[,.]\d+)?)\s*мл/i);
  return match ? `${match[1].replace('.', ',')} мл` : '';
}

function extractWeight(title) {
  const match = title.match(/(\d+(?:[,.]\d+)?)\s*(?:мг|гр|г)\b/i);

  if (!match) {
    return '';
  }

  const unitMatch = match[0].match(/(мг|гр|г)/i);
  const unit = unitMatch ? unitMatch[1].toLowerCase().replace('гр', 'г') : 'г';

  return `${match[1].replace('.', ',')} ${unit}`;
}

function extractQuantity(title) {
  const match = title.match(/(\d+)\s*(?:шт|штук)/i);
  return match ? `${match[1]} шт.` : '';
}

function detectColor(title) {
  const colors = [
    ['бордовый', 'Бордовый'],
    ['бордовая', 'Бордовый'],
    ['бурый', 'Бурый'],
    ['бурая', 'Бурый'],
    ['бурые', 'Бурый'],
    ['прозрачный', 'Прозрачный'],
    ['прозрачная', 'Прозрачный'],
    ['прозрачные', 'Прозрачный'],
    ['серебристый', 'Серебро'],
    ['серебристая', 'Серебро'],
    ['серебристые', 'Серебро'],
    ['черный', 'Черный'],
    ['черная', 'Черный'],
    ['черные', 'Черный'],
    ['белый', 'Белый'],
    ['белая', 'Белый'],
    ['белые', 'Белый'],
    ['красный', 'Красный'],
    ['красная', 'Красный'],
    ['красные', 'Красный'],
    ['синий', 'Синий'],
    ['синяя', 'Синий'],
    ['синие', 'Синий'],
    ['голубой', 'Голубой'],
    ['голубая', 'Голубой'],
    ['желтый', 'Желтый'],
    ['желтая', 'Желтый'],
    ['желтые', 'Желтый'],
    ['зеленый', 'Зеленый'],
    ['зеленая', 'Зеленый'],
    ['фиолетовый', 'Фиолетовый'],
    ['фиолетовая', 'Фиолетовый'],
    ['розовый', 'Розовый'],
    ['розовая', 'Розовый'],
    ['бежевый', 'Бежевый'],
    ['бежевая', 'Бежевый'],
    ['коричневый', 'Коричневый'],
    ['коричневая', 'Коричневый'],
    ['бурые', 'Бурый'],
    ['прозрачные', 'Прозрачный'],
    ['прозрачная', 'Прозрачный'],
    ['медь', 'Медь'],
    ['медный', 'Медь'],
    ['медная', 'Медь'],
    ['латунь', 'Латунь'],
    ['золото', 'Золото'],
    ['золотой', 'Золото'],
    ['серебро', 'Серебро'],
    ['серебряный', 'Серебро'],
    ['разноцвет', 'Разноцветный'],
    ['микс', 'Микс'],
  ];

  const lower = title.toLowerCase().replace(/ё/g, 'е');

  const found = colors.find(([needle]) => lower.includes(needle));

  return found ? found[1] : '';
}

function detectMaterial(title) {
  const lower = title.toLowerCase().replace(/ё/g, 'е');

  if (lower.includes('солом')) return 'Солома';
  if (lower.includes('металлическая') || lower.includes('металлический') || lower.includes('металлические')) return 'Нержавеющая сталь';
  if (lower.includes('кожан')) return 'Кожа';
  if (lower.includes('сланец')) return 'Сланец';
  if (lower.includes('бамбук')) return 'Бамбук';
  if (lower.includes('дерев') || lower.includes('щепа')) return 'Дерево';
  if (lower.includes('стальная') || lower.includes('стальной') || lower.includes('стальные')) return 'Нержавеющая сталь';
  if (lower.includes('металлическ') || lower.includes('металл')) return 'Металл';
  if (lower.includes('бумаж')) return 'Бумага';
  if (lower.includes('пластик')) return 'Пластик';
  if (lower.includes('латун')) return 'Латунь';
  if (lower.includes('медь') || lower.includes('медн')) return 'Медь';

  return '';
}

function detectFlavor(title) {
  const lower = title.toLowerCase().replace(/ё/g, 'е');

  const flavors = [
    ['клюква', 'Клюква'],
    ['клубника', 'Клубника'],
    ['малина', 'Малина'],
    ['ежевика', 'Ежевика'],
    ['черника', 'Черника'],
    ['манго', 'Манго'],
    ['груша', 'Груша'],
  ];

  const found = flavors.find(([needle]) => lower.includes(needle));

  return found ? found[1] : '';
}

function buildSpecs(row) {
  const specs = [];
  const features = [];

  const title = getTitle(row);
  const lowerTitle = getLowerTitle(row);
  const lowerCategory = getLowerCategory(row);

  const color = detectColor(title);
  const material = detectMaterial(title);
  const volume = extractVolume(title);
  const weight = extractWeight(title);
  const dimensions = extractDimensions(title);
  const length = extractLength(title);
  const quantity = extractQuantity(title);
  const flavor = detectFlavor(title);

  if (lowerTitle.includes('стиррер') || lowerTitle.includes('stirrer')) {
    addSpec(specs, 'Тип товара', 'Стиррер');
    addSpec(specs, 'Тип', 'Стиррер');
    addSpec(specs, 'Назначение', 'Для перемешивания и подачи напитков');
    addSpec(specs, 'Материал', material);
    addSpec(specs, 'Цвет / покрытие', color);
    addSpec(specs, 'Длина', length);
    addSpec(specs, 'Количество в упаковке', quantity);

    if (lowerTitle.includes('плоским наконечником')) addFeature(features, 'Плоский наконечник');
  } else if (lowerCategory.includes('ягоды') || lowerTitle.includes('tasty powder') || lowerTitle.includes('crispy piece') || lowerTitle.includes('eco garnish') || lowerTitle.includes('ботанические гарниши')) {
    addSpec(specs, 'Тип товара', 'Декор для подачи');

    if (lowerTitle.includes('tasty powder')) {
      addSpec(specs, 'Тип', 'Пудра для декора');
      addSpec(specs, 'Модель', 'Tasty Powder');
      addFeature(features, 'Пудра для оформления напитков');
    } else if (lowerTitle.includes('crispy piece')) {
      addSpec(specs, 'Тип', 'Crispy Piece');
      addFeature(features, 'Хрустящий декор');
    } else if (lowerTitle.includes('eco garnish')) {
      addSpec(specs, 'Тип', 'Eco Garnish');
      addFeature(features, 'Ботанический декор');
    } else if (lowerTitle.includes('ботанические гарниши')) {
      addSpec(specs, 'Тип', 'Ботанические гарниши');
      addSpec(specs, 'Модель', 'Flowers');
      addFeature(features, lowerTitle.includes('объемные') ? 'Объемный формат' : 'Плоский формат');
    } else {
      addSpec(specs, 'Тип', 'Декор для подачи');
    }

    addSpec(specs, 'Назначение', 'Для декора коктейлей и подачи напитков');
    addSpec(specs, 'Объем', volume);
    addSpec(specs, 'Вес', weight);
    addSpec(specs, 'Цвет / покрытие', color);
    addSpec(specs, 'Вкус и аромат', flavor);
  } else if (lowerCategory.includes('трубочки') || lowerTitle.includes('трубочк')) {
    addSpec(specs, 'Тип товара', 'Трубочка');

    if (lowerTitle.includes('стиррер') || lowerTitle.includes('stirrer')) {
      addSpec(specs, 'Тип', 'Стиррер');
      addSpec(specs, 'Назначение', 'Для перемешивания и подачи напитков');
    } else {
      addSpec(specs, 'Тип', lowerTitle.includes('с изгибом') ? 'Трубочка с изгибом' : 'Трубочка');
      addSpec(specs, 'Назначение', 'Для подачи напитков');
    }

    addSpec(specs, 'Материал', material);
    addSpec(specs, 'Цвет / покрытие', color);
    addSpec(specs, 'Длина', length);
    addSpec(specs, 'Количество в упаковке', quantity);

    if (lowerTitle.includes('широк')) addFeature(features, 'Широкий формат');
    if (lowerTitle.includes('с изгибом')) addFeature(features, 'Изгиб для удобной подачи');
  } else if (lowerCategory.includes('костеры') || lowerTitle.includes('костер') || lowerTitle.includes('подставк') || lowerTitle.includes('поднос') || lowerTitle.includes('доска сервировочная')) {
    if (lowerTitle.includes('ложка')) {
      addSpec(specs, 'Тип товара', 'Ложка для подачи');
      addSpec(specs, 'Тип', 'Ложка для подачи');
      addSpec(specs, 'Назначение', 'Для гарниша и сервировки');
    } else if (lowerTitle.includes('поднос')) {
      addSpec(specs, 'Тип товара', 'Поднос');
      addSpec(specs, 'Тип', 'Поднос для подачи');
      addSpec(specs, 'Назначение', 'Для сервировки и подачи');
    } else if (lowerTitle.includes('доска')) {
      addSpec(specs, 'Тип товара', 'Сервировочная доска');
      addSpec(specs, 'Тип', 'Доска для подачи');
      addSpec(specs, 'Назначение', 'Для сервировки и подачи');
    } else {
      addSpec(specs, 'Тип товара', 'Костер');
      addSpec(specs, 'Тип', lowerTitle.includes('мини') ? 'Мини-костер' : 'Костер для подачи');
      addSpec(specs, 'Назначение', 'Для подачи бокалов и сервировки');
    }

    addSpec(specs, 'Материал', material);
    addSpec(specs, 'Цвет / покрытие', color);
    addSpec(specs, 'Габариты', dimensions);
    addSpec(specs, 'Длина', length);
    addSpec(specs, 'Количество в упаковке', quantity);

    if (lowerTitle.includes('подсвет')) addFeature(features, 'Подсветка');
    if (lowerTitle.includes('квадрат')) addFeature(features, 'Квадратная форма');
    if (lowerTitle.includes('октагон')) addFeature(features, 'Форма октагон');
    if (lowerTitle.includes('прошив')) addFeature(features, 'Декоративная прошивка');
  } else if (lowerCategory.includes('шпажки') || lowerTitle.includes('пика') || lowerTitle.includes('шпажк')) {
    addSpec(specs, 'Тип товара', 'Шпажка');

    if (lowerTitle.includes('пика')) {
      addSpec(specs, 'Тип', lowerTitle.includes('фигурная') ? 'Фигурная пика' : 'Пика');
    } else {
      addSpec(specs, 'Тип', 'Шпажка');
    }

    addSpec(specs, 'Назначение', 'Для гарниша и подачи коктейлей');
    addSpec(specs, 'Материал', material || (lowerTitle.includes('пика') ? 'Нержавеющая сталь' : ''));
    addSpec(specs, 'Цвет / покрытие', color);
    addSpec(specs, 'Длина', length);
    addSpec(specs, 'Количество в упаковке', quantity);

    if (lowerTitle.includes('by natashka')) {
      addSpec(specs, 'Производитель', 'Natashka');
      addFeature(features, 'Дизайнерская шпажка');
    }

    if (lowerTitle.includes('фигурная')) addFeature(features, 'Фигурный декоративный элемент');
  } else if (lowerCategory.includes('для гарниша') || lowerTitle.includes('гарниш') || lowerTitle.includes('лист') || lowerTitle.includes('ложка') || lowerTitle.includes('вилка') || lowerTitle.includes('палочка для меда') || lowerTitle.includes('пиробумага') || lowerTitle.includes('пирошнур') || lowerTitle.includes('сушен')) {
    if (lowerTitle.includes('пирошнур')) {
      addSpec(specs, 'Тип товара', 'Пирошнур');
      addSpec(specs, 'Тип', 'Пирошнур для коктейлей');
      addSpec(specs, 'Назначение', 'Для декоративной подачи коктейлей');

      if (!length) addSpec(specs, 'Длина', '1 м');
    } else if (lowerTitle.includes('сушен')) {
      addSpec(specs, 'Тип товара', 'Декор для подачи');
      addSpec(specs, 'Тип', 'Сушеные цветы');
      addSpec(specs, 'Назначение', 'Для гарниша и декора подачи');
    } else if (lowerTitle.includes('стальная вата')) {
      addSpec(specs, 'Тип товара', 'Стальная вата');
      addSpec(specs, 'Тип', 'Расходный материал');
      addSpec(specs, 'Назначение', 'Для барной подачи и декоративных эффектов');
    } else if (lowerTitle.includes('лист')) {
      addSpec(specs, 'Тип товара', 'Декор для подачи');
      addSpec(specs, 'Тип', 'Скелетированные листья');
      addSpec(specs, 'Назначение', 'Для гарниша и декора подачи');
    } else if (lowerTitle.includes('пиробумага')) {
      addSpec(specs, 'Тип товара', 'Пиробумага');
      addSpec(specs, 'Тип', 'Пиробумага для коктейлей');
      addSpec(specs, 'Назначение', 'Для декоративной подачи коктейлей');
    } else if (lowerTitle.includes('палочка для меда')) {
      addSpec(specs, 'Тип товара', 'Палочка для меда');
      addSpec(specs, 'Тип', 'Палочка для гарниша');
      addSpec(specs, 'Назначение', 'Для подачи меда и гарниша');
    } else if (lowerTitle.includes('вилка')) {
      addSpec(specs, 'Тип товара', 'Вилка для гарниша');
      addSpec(specs, 'Тип', 'Миниатюрная вилка');
      addSpec(specs, 'Назначение', 'Для гарниша и подачи');
    } else if (lowerTitle.includes('ложка')) {
      addSpec(specs, 'Тип товара', 'Ложка для гарниша');
      addSpec(specs, 'Тип', 'Ложка для подачи');
      addSpec(specs, 'Назначение', 'Для гарниша и сервировки');
    } else {
      addSpec(specs, 'Тип товара', 'Инвентарь для гарниша');
      addSpec(specs, 'Тип', 'Инвентарь для подачи');
      addSpec(specs, 'Назначение', 'Для гарниша и декора подачи');
    }

    addSpec(specs, 'Материал', material);
    addSpec(specs, 'Цвет / покрытие', color);
    addSpec(specs, 'Объем', volume);
    addSpec(specs, 'Вес', weight);
    addSpec(specs, 'Габариты', dimensions);
    addSpec(specs, 'Длина', length);
    addSpec(specs, 'Количество в упаковке', quantity);

    if (lowerTitle.includes('плоские')) addFeature(features, 'Плоский формат');
    if (lowerTitle.includes('объемные')) addFeature(features, 'Объемный формат');
    if (lowerTitle.includes('большие')) addFeature(features, 'Большой размер');
    if (lowerTitle.includes('малые')) addFeature(features, 'Малый размер');
  } else {
    if (lowerTitle.includes('ножниц')) {
      addSpec(specs, 'Тип товара', 'Ножницы');
      addSpec(specs, 'Тип', lowerTitle.includes('фигур') ? 'Фигурные ножницы' : 'Ножницы');
      addSpec(specs, 'Назначение', 'Для подготовки гарниша и декоративных элементов');
    } else if (lowerTitle.includes('нож-выемка') || lowerTitle.includes('карбовоч')) {
      addSpec(specs, 'Тип товара', 'Нож');
      addSpec(specs, 'Тип', lowerTitle.includes('карбовоч') ? 'Карбовочный нож' : 'Нож-выемка');
      addSpec(specs, 'Назначение', 'Для карвинга и подготовки гарниша');
    } else if (lowerTitle.includes('дырокол')) {
      addSpec(specs, 'Тип товара', 'Фигурный дырокол');
      addSpec(specs, 'Тип', 'Инструмент для гарниша');
      addSpec(specs, 'Назначение', 'Для вырубки декоративных элементов');
    } else if (lowerTitle.includes('окуриватель')) {
      addSpec(specs, 'Тип товара', 'Окуриватель');
      addSpec(specs, 'Тип', 'Инвентарь для окуривания');
      addSpec(specs, 'Назначение', 'Для ароматизации и эффектной подачи коктейлей');
    } else if (lowerTitle.includes('щепа')) {
      addSpec(specs, 'Тип товара', 'Щепа для окуривания');
      addSpec(specs, 'Тип', 'Расходный материал для окуривания');
      addSpec(specs, 'Назначение', 'Для ароматизации коктейлей дымом');
    } else if (lowerTitle.includes('стальная вата')) {
      addSpec(specs, 'Тип товара', 'Стальная вата');
      addSpec(specs, 'Тип', 'Расходный материал');
      addSpec(specs, 'Назначение', 'Для барной подачи и декоративных эффектов');
    } else if (lowerTitle.includes('прищепк')) {
      addSpec(specs, 'Тип товара', 'Прищепки');
      addSpec(specs, 'Тип', 'Барные прищепки');
      addSpec(specs, 'Назначение', 'Для крепления декора и гарниша');
    } else {
      addSpec(specs, 'Тип товара', 'Инвентарь для подачи');
      addSpec(specs, 'Тип', 'Барный инвентарь');
      addSpec(specs, 'Назначение', 'Для подачи и оформления напитков');
    }

    addSpec(specs, 'Материал', material);
    addSpec(specs, 'Цвет / покрытие', color);
    addSpec(specs, 'Объем', volume);
    addSpec(specs, 'Вес', weight);
    addSpec(specs, 'Габариты', dimensions);
    addSpec(specs, 'Длина', length);
    addSpec(specs, 'Количество в упаковке', quantity);
  }

  if (lowerTitle.includes('cocktail design')) {
    addSpec(specs, 'Производитель', 'Cocktail Design');
  }

  if (features.length > 0) {
    addSpec(specs, 'Особенности', features.join('; '));
  }

  return specs;
}

function readCsvRows(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const text = fs.readFileSync(absolutePath, 'utf8');

  return parseCsv(text);
}

function buildImportRows(csvRows) {
  const result = [];
  const usedCodes = new Set();

  for (const row of csvRows) {
    const rawSku = normalizeSku(row.SKU);

    if (!rawSku) {
      continue;
    }

    if (EXCLUDE_FROM_THIS_BLOCK.has(rawSku)) {
      continue;
    }

    const code = resolveSku(rawSku);

    if (usedCodes.has(code)) {
      continue;
    }

    usedCodes.add(code);

    result.push({
      source: rawSku === code ? 'csv' : `alias:${rawSku}`,
      code,
      rawSku,
      title: getTitle(row),
      category: getCategory(row),
      specs: buildSpecs(row),
    });
  }

  for (const manualProduct of MANUAL_SERVER_PRODUCTS) {
    if (usedCodes.has(manualProduct.code)) {
      continue;
    }

    usedCodes.add(manualProduct.code);

    result.push({
      source: 'manual-server',
      code: manualProduct.code,
      rawSku: manualProduct.code,
      title: manualProduct.title,
      category: manualProduct.category,
      specs: buildSpecs({
        SKU: manualProduct.code,
        Title: manualProduct.title,
        Category: manualProduct.category,
      }),
    });
  }

  return result;
}

async function ensureSpecificationTypes(strapi, names) {
  const specQuery = strapi.db.query(SPECIFICATION_TYPE_UID);
  const map = new Map();

  const existing = await specQuery.findMany({
    where: {
      name: {
        $in: names,
      },
    },
    select: ['id', 'name'],
    limit: 1000,
  });

  for (const item of existing) {
    map.set(item.name, item.id);
  }

  for (const name of names) {
    if (map.has(name)) {
      continue;
    }

    const created = await strapi.entityService.create(SPECIFICATION_TYPE_UID, {
      data: {
        name,
      },
    });

    map.set(name, created.id);
  }

  return map;
}

function toStrapiSpecifications(specs, specTypeIds) {
  return specs.map((item) => ({
    specification: specTypeIds.get(item.name),
    value: item.value,
  }));
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  try {
    const csvPath = path.resolve(process.cwd(), CSV_FILE);
    const csvRows = readCsvRows(CSV_FILE);
    const importRows = buildImportRows(csvRows);

    const codes = importRows.map((item) => item.code);

    const products = await strapi.db.query(PRODUCT_UID).findMany({
      where: {
        code: {
          $in: codes,
        },
      },
      select: ['id', 'name', 'code'],
      populate: {
        specifications: {
          populate: {
            specification: true,
          },
        },
        category: {
          select: ['id', 'name', 'slug'],
        },
      },
      limit: 1000,
    });

    const productByCode = new Map(products.map((product) => [product.code, product]));

    const found = [];
    const missing = [];

    for (const item of importRows) {
      const product = productByCode.get(item.code);

      if (!product) {
        missing.push(item);
        continue;
      }

      found.push({
        ...item,
        product,
      });
    }

    const specTypeIds = await ensureSpecificationTypes(strapi, SPEC_NAMES);

    const typeBreakdown = new Map();

    for (const item of found) {
      const typeSpec = item.specs.find((spec) => spec.name === 'Тип');
      const type = typeSpec?.value || 'Без типа';

      typeBreakdown.set(type, (typeBreakdown.get(type) || 0) + 1);
    }

    console.log(APPLY ? 'Режим: APPLY=1, характеристики будут записаны' : 'Режим: dry-run, база не меняется');
    console.log('------------------------------------------------');
    console.log(`CSV файл: ${csvPath}`);
    console.log(`CSV строк всего: ${csvRows.length}`);
    console.log(`Итоговый набор импорта: ${importRows.length}`);
    console.log(`Найдено товаров в Strapi: ${found.length}`);
    console.log(`Не найдено товаров в Strapi: ${missing.length}`);

    console.log('');
    console.log('Разбивка по типам');
    console.log('-----------------');

    for (const [type, count] of [...typeBreakdown.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
      console.log(`${type}: ${count}`);
    }

    if (missing.length > 0) {
      console.log('');
      console.log('Не найдено в Strapi');
      console.log('-------------------');

      for (const item of missing) {
        console.log(`❌ ${item.code} | ${item.title} | source=${item.source}`);
      }
    }

    console.log('');
    console.log(`Что будет записано — показаны первые ${Math.min(PRINT_LIMIT, found.length)} из ${found.length}`);
    console.log('------------------');

    for (const item of found.slice(0, PRINT_LIMIT)) {
      const currentSpecs = Array.isArray(item.product.specifications) ? item.product.specifications : [];

      console.log('');
      console.log(`✅ ${item.code} | ${item.title}`);
      console.log(`Strapi: id=${item.product.id} | ${item.product.name}`);
      console.log(`Категория: ${item.product.category?.name ?? '-'}`);
      console.log(`Источник: ${item.source}`);
      console.log(`Текущих характеристик: ${currentSpecs.length}`);

      for (const spec of item.specs) {
        console.log(`  ${spec.name} — ${spec.value}`);
      }
    }

    if (!APPLY) {
      console.log('');
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи после проверки на текущей базе:');
      console.log(`APPLY=1 CSV_FILE=${CSV_FILE} node scripts/import-tilda-serving-specs.js`);
      return;
    }

    if (missing.length > 0) {
      throw new Error(`Импорт остановлен: не найдено товаров в Strapi: ${missing.length}`);
    }

    let updatedCount = 0;

    for (const item of found) {
      await strapi.entityService.update(PRODUCT_UID, item.product.id, {
        data: {
          specifications: toStrapiSpecifications(item.specs, specTypeIds),
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
