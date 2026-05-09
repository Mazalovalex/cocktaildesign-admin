'use strict';

const SPECIFICATION_TYPES = [
  // Базовые
  {
    aliases: ['Тип', 'Тип товара'],
    name: 'Тип товара',
    label: 'Тип товара',
    unit: '',
    group: 'base',
    hint: 'Указать конкретный тип товара: шейкер, стрейнер, джиггер, бокал и т.д.',
    exampleValue: 'Стрейнер-хоторн',
    sortOrder: 10,
  },
  {
    aliases: ['Назначение'],
    name: 'Назначение',
    label: 'Назначение',
    unit: '',
    group: 'base',
    hint: 'Кратко описать, для чего используется товар.',
    exampleValue: 'Для фильтрации коктейлей',
    sortOrder: 20,
  },
  {
    aliases: ['Особенности'],
    name: 'Особенности',
    label: 'Особенности',
    unit: '',
    group: 'base',
    hint: 'Ключевые особенности товара через запятую.',
    exampleValue: 'Полностью ручная работа',
    sortOrder: 90,
  },

  // Материалы
  {
    aliases: ['Материал'],
    name: 'Материал',
    label: 'Материал',
    unit: '',
    group: 'materials',
    hint: 'Основной материал товара.',
    exampleValue: 'Нержавеющая сталь',
    sortOrder: 100,
  },
  {
    aliases: ['Марка стали'],
    name: 'Марка стали',
    label: 'Марка стали',
    unit: '',
    group: 'materials',
    hint: 'Указывать только марку стали.',
    exampleValue: 'AISI 304',
    sortOrder: 110,
  },
  {
    aliases: ['Цвет', 'Покрытие / цвет', 'Цвет / покрытие'],
    name: 'Цвет / покрытие',
    label: 'Цвет / покрытие',
    unit: '',
    group: 'materials',
    hint: 'Цвет или тип покрытия.',
    exampleValue: 'Сталь',
    sortOrder: 120,
  },

  // Размеры
  {
    aliases: ['Объем', 'Объем, мл', 'Объём', 'Объём, мл'],
    name: 'Объем',
    label: 'Объем',
    unit: 'мл',
    group: 'sizes',
    hint: 'Указывать только значение без “мл”.',
    exampleValue: '850 / 550',
    sortOrder: 200,
  },
  {
    aliases: ['Длина', 'Длина, см'],
    name: 'Длина',
    label: 'Длина',
    unit: 'см',
    group: 'sizes',
    hint: 'Указывать только число без “см”.',
    exampleValue: '13',
    sortOrder: 210,
  },
  {
    aliases: ['Ширина', 'Ширина, см'],
    name: 'Ширина',
    label: 'Ширина',
    unit: 'см',
    group: 'sizes',
    hint: 'Указывать только число без “см”.',
    exampleValue: '9',
    sortOrder: 220,
  },
  {
    aliases: ['Высота', 'Высота, см'],
    name: 'Высота',
    label: 'Высота',
    unit: 'см',
    group: 'sizes',
    hint: 'Указывать только число без “см”.',
    exampleValue: '2',
    sortOrder: 230,
  },
  {
    aliases: ['Диаметр', 'Диаметр, см'],
    name: 'Диаметр',
    label: 'Диаметр',
    unit: 'см',
    group: 'sizes',
    hint: 'Указывать только число без “см”.',
    exampleValue: '9',
    sortOrder: 240,
  },
  {
    aliases: ['Вес', 'Вес, г'],
    name: 'Вес',
    label: 'Вес',
    unit: 'г',
    group: 'sizes',
    hint: 'Указывать только число без “г”.',
    exampleValue: '120',
    sortOrder: 250,
  },
  {
    aliases: ['Размер', 'Размеры', 'Габариты'],
    name: 'Габариты',
    label: 'Габариты',
    unit: '',
    group: 'sizes',
    hint: 'Указывать полный размер с единицами, если размер составной.',
    exampleValue: '120 × 60 × 90 см',
    sortOrder: 260,
  },

  // Комплектация
  {
    aliases: ['Комплектация'],
    name: 'Комплектация',
    label: 'Комплектация',
    unit: '',
    group: 'equipment',
    hint: 'Что входит в комплект.',
    exampleValue: '1 шт.',
    sortOrder: 300,
  },
  {
    aliases: ['Количество в упаковке', 'Количество в упаковке, шт'],
    name: 'Количество в упаковке',
    label: 'Количество в упаковке',
    unit: 'шт',
    group: 'equipment',
    hint: 'Указывать только число без “шт”.',
    exampleValue: '100',
    sortOrder: 310,
  },

  // Эксплуатация
  {
    aliases: ['Подходит для ПММ'],
    name: 'Подходит для ПММ',
    label: 'Подходит для ПММ',
    unit: '',
    group: 'usage',
    hint: 'Писать Да или Нет.',
    exampleValue: 'Да',
    sortOrder: 400,
  },
  {
    aliases: ['Уход'],
    name: 'Уход',
    label: 'Уход',
    unit: '',
    group: 'usage',
    hint: 'Краткая рекомендация по уходу.',
    exampleValue: 'Мыть мягкой губкой, не использовать абразивы',
    sortOrder: 410,
  },

  // Стрейнеры
  {
    aliases: ['Тип стрейнера'],
    name: 'Тип стрейнера',
    label: 'Тип стрейнера',
    unit: '',
    group: 'category',
    hint: 'Хоторн, арт, джулеп, файн.',
    exampleValue: 'Хоторн',
    sortOrder: 500,
  },
  {
    aliases: ['Диаметр с пружиной', 'Диаметр с пружиной, см'],
    name: 'Диаметр с пружиной',
    label: 'Диаметр с пружиной',
    unit: 'см',
    group: 'category',
    hint: 'Указывать только число без “см”.',
    exampleValue: '9',
    sortOrder: 510,
  },
  {
    aliases: ['Длина ручки', 'Длина ручки, см'],
    name: 'Длина ручки',
    label: 'Длина ручки',
    unit: 'см',
    group: 'category',
    hint: 'Указывать только число без “см”.',
    exampleValue: '13',
    sortOrder: 520,
  },

  // Шейкеры
  {
    aliases: ['Тип шейкера'],
    name: 'Тип шейкера',
    label: 'Тип шейкера',
    unit: '',
    group: 'category',
    hint: 'Кобблер, бостон или паризиан.',
    exampleValue: 'Бостон',
    sortOrder: 600,
  },
  {
    aliases: ['Количество частей'],
    name: 'Количество частей',
    label: 'Количество частей',
    unit: '',
    group: 'construction',
    hint: 'Указать количество частей.',
    exampleValue: '2',
    sortOrder: 610,
  },
  {
    aliases: ['Утяжелители'],
    name: 'Утяжелители',
    label: 'Утяжелители',
    unit: '',
    group: 'construction',
    hint: 'Писать Да или Нет.',
    exampleValue: 'Да',
    sortOrder: 620,
  },

  // Пищевая информация
  {
    aliases: ['Состав'],
    name: 'Состав',
    label: 'Состав',
    unit: '',
    group: 'food',
    hint: 'Состав пищевого продукта.',
    exampleValue: 'Лимонная кислота',
    sortOrder: 700,
  },
  {
    aliases: ['Масса нетто'],
    name: 'Масса нетто',
    label: 'Масса нетто',
    unit: 'г',
    group: 'food',
    hint: 'Указывать только число без “г”.',
    exampleValue: '1000',
    sortOrder: 710,
  },
  {
    aliases: ['Условия хранения'],
    name: 'Условия хранения',
    label: 'Условия хранения',
    unit: '',
    group: 'storage',
    hint: 'Кратко указать условия хранения.',
    exampleValue: 'В сухом прохладном месте',
    sortOrder: 720,
  },
  {
    aliases: ['Срок годности'],
    name: 'Срок годности',
    label: 'Срок годности',
    unit: '',
    group: 'storage',
    hint: 'Указать срок годности.',
    exampleValue: '24 месяца',
    sortOrder: 730,
  },

  // Оборудование
  {
    aliases: ['Тип оборудования'],
    name: 'Тип оборудования',
    label: 'Тип оборудования',
    unit: '',
    group: 'technical',
    hint: 'Весы, льдогенератор, ринзер, барный модуль и т.д.',
    exampleValue: 'Льдогенератор',
    sortOrder: 800,
  },
  {
    aliases: ['Производитель'],
    name: 'Производитель',
    label: 'Производитель',
    unit: '',
    group: 'technical',
    hint: 'Название производителя.',
    exampleValue: 'Hoshizaki',
    sortOrder: 810,
  },
  {
    aliases: ['Модель'],
    name: 'Модель',
    label: 'Модель',
    unit: '',
    group: 'technical',
    hint: 'Модель оборудования.',
    exampleValue: 'IM-21CNE-HC',
    sortOrder: 820,
  },
  {
    aliases: ['Мощность'],
    name: 'Мощность',
    label: 'Мощность',
    unit: 'Вт',
    group: 'technical',
    hint: 'Указывать только число без “Вт”.',
    exampleValue: '220',
    sortOrder: 830,
  },
  {
    aliases: ['Гарантия'],
    name: 'Гарантия',
    label: 'Гарантия',
    unit: '',
    group: 'technical',
    hint: 'Указать срок гарантии.',
    exampleValue: '12 месяцев',
    sortOrder: 840,
  },
];

function normalizeData(item) {
  return {
    name: item.name,
    label: item.label,
    unit: item.unit,
    group: item.group,
    hint: item.hint,
    exampleValue: item.exampleValue,
    sortOrder: item.sortOrder,
    isFilterable: false,
    isVisible: true,
    isActive: true,
  };
}

async function upsertSpecificationType(item) {
  const uid = 'api::specification-type.specification-type';

  let existing = null;

  for (const alias of item.aliases) {
    existing = await strapi.db.query(uid).findOne({
      where: { name: alias },
    });

    if (existing) break;
  }

  const data = normalizeData(item);

  if (existing) {
    await strapi.db.query(uid).update({
      where: { id: existing.id },
      data,
    });

    console.log(`Обновлено: ${item.name}`);
    return;
  }

  await strapi.db.query(uid).create({ data });
  console.log(`Создано: ${item.name}`);
}

async function seedSpecificationTypes() {
  for (const item of SPECIFICATION_TYPES) {
    await upsertSpecificationType(item);
  }
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    await seedSpecificationTypes();
    console.log('Готово: типы характеристик созданы/обновлены.');
  } finally {
    await app.destroy();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
