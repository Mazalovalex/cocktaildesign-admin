'use strict';

/**
 * Полный reset системы характеристик Cocktail Design.
 *
 * По умолчанию работает в dry-run режиме:
 *   npm run reset:spec-system
 *
 * Для реальной записи:
 *   APPLY=1 npm run reset:spec-system
 *
 * Скрипт трогает только:
 *  - типы характеристик;
 *  - шаблоны характеристик;
 *  - связи категорий с шаблонами;
 *  - связи товаров с шаблонами;
 *  - заполненные component-характеристики товаров.
 *
 * Скрипт НЕ трогает:
 *  - товары;
 *  - категории;
 *  - цены;
 *  - фото;
 *  - описания;
 *  - SEO;
 *  - варианты;
 *  - остатки.
 */

const SHOULD_APPLY = process.env.APPLY === '1';

const TYPE_UID = 'api::specification-type.specification-type';
const TEMPLATE_UID = 'api::specification-template.specification-template';
const CATEGORY_UID = 'api::moysklad-category.moysklad-category';
const PRODUCT_UID = 'api::moysklad-product.moysklad-product';

const ACTIVE_SPECIFICATION_TYPES = [
  {
    name: 'Тип товара',
    group: 'base',
    exampleValue: 'Стрейнер',
    isFilterable: true,
  },
  {
    name: 'Тип',
    group: 'base',
    exampleValue: 'Хоторн стрейнер',
    isFilterable: true,
  },
  {
    name: 'Назначение',
    group: 'usage',
    exampleValue: 'Для подачи коктейлей',
    isFilterable: false,
  },
  {
    name: 'Материал',
    group: 'materials',
    exampleValue: 'Нержавеющая сталь',
    isFilterable: true,
  },
  {
    name: 'Марка стали',
    group: 'materials',
    exampleValue: 'AISI 304',
    isFilterable: true,
  },
  {
    name: 'Цвет / покрытие',
    group: 'materials',
    exampleValue: 'Серебро',
    isFilterable: true,
  },
  {
    name: 'Объем',
    group: 'sizes',
    exampleValue: '500 мл',
    isFilterable: true,
  },
  {
    name: 'Габариты',
    group: 'sizes',
    exampleValue: '1200×600×900 мм',
    isFilterable: false,
  },
  {
    name: 'Длина',
    group: 'sizes',
    exampleValue: '40 см',
    isFilterable: false,
  },
  {
    name: 'Ширина',
    group: 'sizes',
    exampleValue: '30 см',
    isFilterable: false,
  },
  {
    name: 'Высота',
    group: 'sizes',
    exampleValue: '15 см',
    isFilterable: false,
  },
  {
    name: 'Диаметр',
    group: 'sizes',
    exampleValue: '100 мм',
    isFilterable: false,
  },
  {
    name: 'Вес',
    group: 'sizes',
    exampleValue: '250 г',
    isFilterable: false,
  },
  {
    name: 'Количество в упаковке',
    group: 'equipment',
    exampleValue: '10 шт',
    isFilterable: false,
  },
  {
    name: 'Комплектация',
    group: 'equipment',
    exampleValue: 'Гейзер, пипетка',
    isFilterable: false,
  },
  {
    name: 'Совместимость',
    group: 'usage',
    exampleValue: 'Подходит для бутылок 0.7 л',
    isFilterable: false,
  },
  {
    name: 'Особенности',
    group: 'base',
    exampleValue: 'Лазерная резка; ручная шлифовка',
    isFilterable: false,
  },
  {
    name: 'Уход',
    group: 'usage',
    exampleValue: 'Можно мыть в ПММ',
    isFilterable: false,
  },

  {
    name: 'Состав',
    group: 'food',
    exampleValue: 'Сахар, лимонная кислота',
    isFilterable: false,
  },
  {
    name: 'Вкус и аромат',
    group: 'food',
    exampleValue: 'Цитрус, травы',
    isFilterable: false,
  },
  {
    name: 'Способ применения',
    group: 'food',
    exampleValue: 'Добавить 1–2 капли в коктейль',
    isFilterable: false,
  },
  {
    name: 'Условия хранения',
    group: 'storage',
    exampleValue: 'Хранить в сухом прохладном месте',
    isFilterable: false,
  },
  {
    name: 'Срок годности',
    group: 'storage',
    exampleValue: '12 месяцев',
    isFilterable: false,
  },

  {
    name: 'Производитель',
    group: 'technical',
    exampleValue: 'Hoshizaki',
    isFilterable: true,
  },
  {
    name: 'Модель',
    group: 'technical',
    exampleValue: 'IM-240DNE',
    isFilterable: false,
  },
  {
    name: 'Мощность',
    group: 'technical',
    exampleValue: '350 Вт',
    isFilterable: false,
  },
  {
    name: 'Напряжение',
    group: 'technical',
    exampleValue: '220 В',
    isFilterable: false,
  },
  {
    name: 'Производительность',
    group: 'technical',
    exampleValue: '240 кг/сутки',
    isFilterable: false,
  },
  {
    name: 'Тип охлаждения',
    group: 'technical',
    exampleValue: 'Воздушное',
    isFilterable: false,
  },
  {
    name: 'Хладагент',
    group: 'technical',
    exampleValue: 'R134a',
    isFilterable: false,
  },
  {
    name: 'Температурный режим',
    group: 'technical',
    exampleValue: '+2…+8 °C',
    isFilterable: false,
  },
  {
    name: 'Тип льда',
    group: 'technical',
    exampleValue: 'Кубик',
    isFilterable: false,
  },
  {
    name: 'Размер льда',
    group: 'technical',
    exampleValue: '28×28×32 мм',
    isFilterable: false,
  },
  {
    name: 'Гарантия',
    group: 'technical',
    exampleValue: '12 месяцев',
    isFilterable: false,
  },

  {
    name: 'Толщина металла',
    group: 'construction',
    exampleValue: '1.5 мм',
    isFilterable: false,
  },
  {
    name: 'Борт',
    group: 'construction',
    exampleValue: '50 мм',
    isFilterable: false,
  },
  {
    name: 'Снос ног',
    group: 'construction',
    exampleValue: '70 мм',
    isFilterable: false,
  },
  {
    name: 'Регулировка по высоте',
    group: 'construction',
    exampleValue: '±25 мм',
    isFilterable: false,
  },
];

const SPECIFICATION_TEMPLATES = [
  {
    name: 'Шейкеры',
    code: 'shakers',
    description: 'Базовый шаблон для шейкеров.',
    sortOrder: 10,
    items: [
      ['Тип товара', true],
      ['Тип', true],
      ['Материал', true],
      ['Марка стали', false],
      ['Объем', true],
      ['Цвет / покрытие', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Стрейнеры',
    code: 'strainers',
    description: 'Базовый шаблон для стрейнеров.',
    sortOrder: 20,
    items: [
      ['Тип товара', true],
      ['Тип', true],
      ['Материал', true],
      ['Марка стали', false],
      ['Диаметр', false],
      ['Цвет / покрытие', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Джиггеры и мерники',
    code: 'jiggers-and-measures',
    description: 'Базовый шаблон для джиггеров, мерников и мерной посуды.',
    sortOrder: 30,
    items: [
      ['Тип товара', true],
      ['Тип', false],
      ['Материал', true],
      ['Марка стали', false],
      ['Объем', true],
      ['Цвет / покрытие', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Барные ложки',
    code: 'bar-spoons',
    description: 'Базовый шаблон для барных ложек.',
    sortOrder: 40,
    items: [
      ['Тип товара', true],
      ['Материал', true],
      ['Марка стали', false],
      ['Длина', true],
      ['Цвет / покрытие', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Смесительные стаканы',
    code: 'mixing-glasses',
    description: 'Базовый шаблон для смесительных стаканов.',
    sortOrder: 50,
    items: [
      ['Тип товара', true],
      ['Материал', true],
      ['Объем', true],
      ['Габариты', false],
      ['Цвет / покрытие', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Мадлеры и сквизеры',
    code: 'muddlers-and-squeezers',
    description: 'Базовый шаблон для мадлеров и сквизеров.',
    sortOrder: 60,
    items: [
      ['Тип товара', true],
      ['Материал', true],
      ['Длина', false],
      ['Габариты', false],
      ['Цвет / покрытие', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Щипцы и пинцеты',
    code: 'tongs-and-tweezers',
    description: 'Базовый шаблон для щипцов и пинцетов.',
    sortOrder: 70,
    items: [
      ['Тип товара', true],
      ['Материал', true],
      ['Марка стали', false],
      ['Длина', false],
      ['Цвет / покрытие', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Барные зажигалки',
    code: 'bar-lighters',
    description: 'Базовый шаблон для барных зажигалок и горелок.',
    sortOrder: 80,
    items: [
      ['Тип товара', true],
      ['Материал', false],
      ['Цвет / покрытие', false],
      ['Габариты', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Ножи, пиллеры, терки',
    code: 'knives-peelers-graters',
    description: 'Базовый шаблон для ножей, пиллеров и терок.',
    sortOrder: 90,
    items: [
      ['Тип товара', true],
      ['Тип', false],
      ['Материал', true],
      ['Марка стали', false],
      ['Длина', false],
      ['Цвет / покрытие', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Нарзанники и открывашки',
    code: 'wine-openers-and-bottle-openers',
    description: 'Базовый шаблон для нарзанников, открывашек и спидопенеров.',
    sortOrder: 100,
    items: [
      ['Тип товара', true],
      ['Материал', true],
      ['Цвет / покрытие', false],
      ['Габариты', false],
      ['Комплектация', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Пищевой декор',
    code: 'food-decor',
    description: 'Базовый шаблон для пищевого декора, ягод, пудр и красителей.',
    sortOrder: 110,
    items: [
      ['Тип товара', true],
      ['Состав', false],
      ['Вкус и аромат', false],
      ['Объем', false],
      ['Способ применения', false],
      ['Условия хранения', false],
      ['Срок годности', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Подача и сервировка',
    code: 'serving',
    description: 'Базовый шаблон для подачи и сервировки.',
    sortOrder: 120,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Цвет / покрытие', false],
      ['Габариты', false],
      ['Количество в упаковке', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Кондитерский инвентарь',
    code: 'pastry-tools',
    description: 'Базовый шаблон для кондитерского инвентаря.',
    sortOrder: 130,
    items: [
      ['Тип товара', true],
      ['Материал', false],
      ['Габариты', false],
      ['Диаметр', false],
      ['Количество в упаковке', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Бариста',
    code: 'barista',
    description: 'Базовый шаблон для товаров бариста.',
    sortOrder: 140,
    items: [
      ['Тип товара', true],
      ['Материал', false],
      ['Объем', false],
      ['Диаметр', false],
      ['Габариты', false],
      ['Цвет / покрытие', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Винные аксессуары',
    code: 'wine-accessories',
    description: 'Базовый шаблон для винных аксессуаров.',
    sortOrder: 150,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Цвет / покрытие', false],
      ['Габариты', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Аксессуары',
    code: 'accessories',
    description: 'Базовый шаблон для аксессуаров.',
    sortOrder: 160,
    items: [
      ['Тип товара', true],
      ['Материал', false],
      ['Цвет / покрытие', false],
      ['Габариты', false],
      ['Комплектация', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Молекулярная кухня',
    code: 'molecular',
    description: 'Базовый шаблон для молекулярной кухни, кислот и текстур.',
    sortOrder: 170,
    items: [
      ['Тип товара', true],
      ['Состав', false],
      ['Объем', false],
      ['Вес', false],
      ['Способ применения', false],
      ['Условия хранения', false],
      ['Срок годности', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Организация и хранение',
    code: 'storage-organization',
    description: 'Базовый шаблон для хранения, органайзеров, баночек и диспенсеров.',
    sortOrder: 180,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Объем', false],
      ['Габариты', false],
      ['Количество в упаковке', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Бокалы',
    code: 'glasses',
    description: 'Базовый шаблон для бокалов.',
    sortOrder: 190,
    items: [
      ['Тип товара', true],
      ['Материал', false],
      ['Объем', true],
      ['Диаметр', false],
      ['Высота', false],
      ['Цвет / покрытие', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Бутылочки для биттера',
    code: 'bitter-bottles',
    description: 'Базовый шаблон для дропперов, атомайзеров и бутылочек для биттера.',
    sortOrder: 200,
    items: [
      ['Тип товара', true],
      ['Материал', false],
      ['Объем', true],
      ['Цвет / покрытие', false],
      ['Комплектация', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Инструменты для льда',
    code: 'ice-tools',
    description: 'Базовый шаблон для инструментов и форм для льда.',
    sortOrder: 210,
    items: [
      ['Тип товара', true],
      ['Тип', false],
      ['Материал', false],
      ['Марка стали', false],
      ['Габариты', false],
      ['Диаметр', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
  {
    name: 'Оборудование',
    code: 'equipment',
    description: 'Базовый шаблон для оборудования.',
    sortOrder: 220,
    items: [
      ['Тип товара', true],
      ['Производитель', false],
      ['Модель', false],
      ['Мощность', false],
      ['Напряжение', false],
      ['Производительность', false],
      ['Габариты', false],
      ['Гарантия', false],
    ],
  },
  {
    name: 'Весы и измерительные приборы',
    code: 'scales-and-measuring-devices',
    description: 'Базовый шаблон для весов и измерительных приборов.',
    sortOrder: 230,
    items: [
      ['Тип товара', true],
      ['Тип', false],
      ['Производитель', false],
      ['Модель', false],
      ['Габариты', false],
      ['Вес', false],
      ['Особенности', false],
      ['Гарантия', false],
    ],
  },
  {
    name: 'Льдогенераторы',
    code: 'ice-machines',
    description: 'Базовый шаблон для льдогенераторов.',
    sortOrder: 240,
    items: [
      ['Тип товара', true],
      ['Производитель', true],
      ['Модель', false],
      ['Производительность', false],
      ['Тип льда', false],
      ['Тип охлаждения', false],
      ['Габариты', false],
      ['Гарантия', false],
    ],
  },
  {
    name: 'Барные модули',
    code: 'bar-modules',
    description: 'Базовый шаблон для барных модулей и станций.',
    sortOrder: 250,
    items: [
      ['Тип товара', true],
      ['Материал', true],
      ['Марка стали', false],
      ['Габариты', true],
      ['Толщина металла', false],
      ['Комплектация', false],
      ['Регулировка по высоте', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Наборы',
    code: 'sets',
    description: 'Базовый шаблон для наборов и готовых решений.',
    sortOrder: 260,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Количество в упаковке', false],
      ['Комплектация', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Сертификаты и подарки',
    code: 'certificates-and-gifts',
    description: 'Базовый шаблон для сертификатов и подарков.',
    sortOrder: 270,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Комплектация', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Технологии для коктейлей',
    code: 'cocktail-technologies',
    description: 'Базовый шаблон для технологий и специнструментов для коктейлей.',
    sortOrder: 280,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Объем', false],
      ['Габариты', false],
      ['Способ применения', false],
      ['Комплектация', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Полезные мелочи для бара',
    code: 'useful-bar-accessories',
    description: 'Базовый шаблон для универсальных барных мелочей.',
    sortOrder: 290,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Габариты', false],
      ['Количество в упаковке', false],
      ['Совместимость', false],
      ['Особенности', false],
      ['Уход', false],
    ],
  },
];

const CATEGORY_TEMPLATE_MAPPINGS = [
  ['Аксессуары', 'Аксессуары'],
  ['Бокалы', 'Бокалы'],
  ['Бутылочки для биттера', 'Бутылочки для биттера'],
  ['Все для бариста', 'Бариста'],
  ['Все для вина', 'Винные аксессуары'],
  ['Все для кондитера', 'Кондитерский инвентарь'],
  ['Все для подачи', 'Подача и сервировка'],
  ['Инструменты для льда', 'Инструменты для льда'],
  ['Наборы и готовые решения', 'Наборы'],
  ['Оборудование', 'Оборудование'],
  ['Организация и хранение', 'Организация и хранение'],
  ['Пищевые добавки и ингридиены', 'Молекулярная кухня'],
  ['Полезные мелочи для бара', 'Полезные мелочи для бара'],
  ['Сертификаты и подарки', 'Сертификаты и подарки'],
  ['Серьги, подвески', 'Аксессуары'],
  ['Технологии для коктейлей', 'Технологии для коктейлей'],

  ['Барные зажигалки', 'Барные зажигалки'],
  ['Барные ложки', 'Барные ложки'],
  ['Джиггеры и мерники', 'Джиггеры и мерники'],
  ['Мадлеры и сквизеры', 'Мадлеры и сквизеры'],
  ['Нарзанники, открывашки, спидопенеры', 'Нарзанники и открывашки'],
  ['Ножи, пиллеры, терки', 'Ножи, пиллеры, терки'],
  ['Смесительные стаканы', 'Смесительные стаканы'],
  ['Стрейнеры', 'Стрейнеры'],
  ['Шейкеры', 'Шейкеры'],
  ['Щипцы и пинцеты', 'Щипцы и пинцеты'],

  ['Американский стиль', 'Джиггеры и мерники'],
  ['Мерники', 'Джиггеры и мерники'],
  ['Односторонние', 'Джиггеры и мерники'],
  ['Японский стиль', 'Джиггеры и мерники'],

  ['Арт стрейнер', 'Стрейнеры'],
  ['Джулеп стрейнер', 'Стрейнеры'],
  ['Файн стрейнер', 'Стрейнеры'],
  ['Хоторн Стрейнер', 'Стрейнеры'],

  ['Бостон', 'Шейкеры'],
  ['Кобблер', 'Шейкеры'],
  ['Паризиан', 'Шейкеры'],

  ['Коврики', 'Кондитерский инвентарь'],
  ['Кондитерские мелочи', 'Кондитерский инвентарь'],
  ['Кондитерские формы', 'Кондитерский инвентарь'],
  ['Лопатки и шпатели', 'Кондитерский инвентарь'],

  ['Для гарниша', 'Подача и сервировка'],
  ['Инвентарь и девайсы', 'Подача и сервировка'],
  ['Костеры, подставки, подносы', 'Подача и сервировка'],
  ['Трубочки', 'Подача и сервировка'],
  ['Шпажки', 'Подача и сервировка'],
  ['Ягоды и пудры', 'Пищевой декор'],

  ['Клише и оттиски', 'Инструменты для льда'],
  ['Пики и ножи для льда', 'Инструменты для льда'],
  ['Совки', 'Инструменты для льда'],
  ['Формы для льда', 'Инструменты для льда'],
  ['Щипцы', 'Щипцы и пинцеты'],

  ['Барные модули', 'Барные модули'],
  ['Весы и измерительные приборы', 'Весы и измерительные приборы'],
  ['Вспомогательное оборудование', 'Оборудование'],
  ['Льдогенераторы Hoshizaki', 'Льдогенераторы'],

  ['Баночки для гарнишей', 'Организация и хранение'],
  ['Диспенсеры', 'Организация и хранение'],
  ['Емкости для сыпучих продуктов', 'Организация и хранение'],
  ['Органайзеры', 'Организация и хранение'],

  ['Кислоты и текстуры', 'Молекулярная кухня'],
  ['Парфюмы для коктейлей', 'Технологии для коктейлей'],
  ['Пенообразователи', 'Молекулярная кухня'],
  ['Пищевые красители', 'Пищевой декор'],
];

function getSortOrder(index) {
  return (index + 1) * 10;
}

function printMode() {
  console.log(`Режим: ${SHOULD_APPLY ? 'APPLY=1, изменения будут записаны' : 'dry-run, без записи в базу'}`);
  console.log('');
}

async function getExistingData() {
  const [types, templates, categories, products] = await Promise.all([
    strapi.db.query(TYPE_UID).findMany({
      select: ['id', 'documentId', 'name'],
      limit: 10000,
    }),
    strapi.db.query(TEMPLATE_UID).findMany({
      select: ['id', 'documentId', 'name'],
      limit: 10000,
    }),
    strapi.db.query(CATEGORY_UID).findMany({
      select: ['id', 'name', 'pathName'],
      populate: {
        defaultSpecificationTemplate: {
          select: ['id', 'name'],
        },
      },
      limit: 10000,
    }),
    strapi.db.query(PRODUCT_UID).findMany({
      select: ['id', 'name'],
      populate: {
        category: {
          select: ['id', 'name'],
          populate: {
            defaultSpecificationTemplate: {
              select: ['id', 'name'],
            },
          },
        },
        specificationTemplate: {
          select: ['id', 'name'],
        },
        specifications: {
          populate: {
            specification: {
              select: ['id', 'name'],
            },
          },
        },
      },
      limit: 10000,
    }),
  ]);

  return {
    types,
    templates,
    categories,
    products,
  };
}

function analyzeData({ types, templates, categories, products }) {
  const categoryMappingsByName = new Map(CATEGORY_TEMPLATE_MAPPINGS);
  const templateNames = new Set(SPECIFICATION_TEMPLATES.map((template) => template.name));

  const categoriesWithTemplate = categories.filter((category) => category.defaultSpecificationTemplate);
  const productsWithTemplate = products.filter((product) => product.specificationTemplate);
  const productsWithSpecifications = products.filter((product) => {
    return Array.isArray(product.specifications) && product.specifications.length > 0;
  });

  const mappedCategories = categories.filter((category) => {
    const templateName = categoryMappingsByName.get(category.name);
    return templateName && templateNames.has(templateName);
  });

  const mappedCategoryIds = new Set(mappedCategories.map((category) => category.id));
  const productsReadyForTemplate = products.filter((product) => {
    return product.category && mappedCategoryIds.has(product.category.id);
  });

  const unmappedCategoriesWithProducts = categories
    .filter((category) => !mappedCategoryIds.has(category.id))
    .map((category) => {
      const count = products.filter((product) => product.category?.id === category.id).length;

      return {
        id: category.id,
        name: category.name,
        pathName: category.pathName,
        count,
      };
    })
    .filter((category) => category.count > 0);

  return {
    categoriesWithTemplate,
    productsWithTemplate,
    productsWithSpecifications,
    mappedCategories,
    productsReadyForTemplate,
    unmappedCategoriesWithProducts,
  };
}

function printPlan(existingData, analysis) {
  console.log('План reset системы характеристик');
  console.log('--------------------------------');
  console.log(`Существующих типов характеристик: ${existingData.types.length}`);
  console.log(`Существующих шаблонов характеристик: ${existingData.templates.length}`);
  console.log(`Категорий с привязанным шаблоном: ${analysis.categoriesWithTemplate.length}`);
  console.log(`Товаров с привязанным шаблоном: ${analysis.productsWithTemplate.length}`);
  console.log(`Товаров с заполненными характеристиками: ${analysis.productsWithSpecifications.length}`);
  console.log('');

  console.log('Будет создано заново');
  console.log('--------------------');
  console.log(`Типов характеристик: ${ACTIVE_SPECIFICATION_TYPES.length}`);
  console.log(`Шаблонов характеристик: ${SPECIFICATION_TEMPLATES.length}`);
  console.log(`Категорий будет привязано к шаблонам: ${analysis.mappedCategories.length}`);
  console.log(`Товаров будет привязано к шаблонам: ${analysis.productsReadyForTemplate.length}`);
  console.log('');

  if (analysis.unmappedCategoriesWithProducts.length > 0) {
    console.log('Категории с товарами, которые останутся без шаблона');
    console.log('--------------------------------------------------');

    for (const category of analysis.unmappedCategoriesWithProducts) {
      console.log(`- id=${category.id} | ${category.name} | товаров: ${category.count} | ${category.pathName || ''}`);
    }

    console.log('');
  }

  if (analysis.productsWithSpecifications.length > 0) {
    console.log('Первые товары с заполненными характеристиками, которые будут очищены');
    console.log('------------------------------------------------------------------');

    for (const product of analysis.productsWithSpecifications.slice(0, 20)) {
      console.log(`- id=${product.id} | ${product.name}`);

      for (const item of product.specifications ?? []) {
        console.log(`  ${item.specification?.name || 'Без типа'}: ${item.value || 'пусто'}`);
      }
    }

    console.log('');
  }
}

async function safeDeleteDocument(uid, entry) {
  if (entry.documentId) {
    await strapi.documents(uid).delete({
      documentId: entry.documentId,
    });

    return;
  }

  await strapi.db.query(uid).delete({
    where: {
      id: entry.id,
    },
  });
}

async function clearProductSpecificationData(products) {
  for (const product of products) {
    await strapi.db.query(PRODUCT_UID).update({
      where: {
        id: product.id,
      },
      data: {
        specifications: [],
        specificationTemplate: null,
      },
    });
  }

  console.log(`Очищены характеристики и шаблоны у товаров: ${products.length}`);
}

async function clearCategoryTemplates(categories) {
  for (const category of categories) {
    await strapi.db.query(CATEGORY_UID).update({
      where: {
        id: category.id,
      },
      data: {
        defaultSpecificationTemplate: null,
      },
    });
  }

  console.log(`Очищены шаблоны у категорий: ${categories.length}`);
}

async function deleteExistingTemplates(templates) {
  for (const template of templates) {
    await safeDeleteDocument(TEMPLATE_UID, template);
  }

  console.log(`Удалены старые шаблоны характеристик: ${templates.length}`);
}

async function deleteExistingTypes(types) {
  for (const type of types) {
    await safeDeleteDocument(TYPE_UID, type);
  }

  console.log(`Удалены старые типы характеристик: ${types.length}`);
}

async function createSpecificationTypes() {
  const createdTypes = new Map();
  const documents = strapi.documents(TYPE_UID);

  for (const [index, type] of ACTIVE_SPECIFICATION_TYPES.entries()) {
    const created = await documents.create({
      data: {
        name: type.name,
        label: type.name,
        group: type.group,
        hint: '',
        exampleValue: type.exampleValue,
        sortOrder: getSortOrder(index),
        isFilterable: type.isFilterable,
        isVisible: true,
        isActive: true,
      },
    });

    createdTypes.set(type.name, created);
  }

  console.log(`Созданы типы характеристик: ${createdTypes.size}`);

  return createdTypes;
}

function buildTemplateItems(template, createdTypes) {
  return template.items.map(([typeName, isRequired], index) => {
    const type = createdTypes.get(typeName);

    if (!type) {
      throw new Error(`Не найден тип характеристики для шаблона "${template.name}": ${typeName}`);
    }

    return {
      specification: type.documentId || String(type.id),
      isRequired,
      sortOrder: getSortOrder(index),
    };
  });
}

async function createSpecificationTemplates(createdTypes) {
  const createdTemplates = new Map();
  const documents = strapi.documents(TEMPLATE_UID);

  for (const template of SPECIFICATION_TEMPLATES) {
    const created = await documents.create({
      data: {
        name: template.name,
        code: template.code,
        description: template.description,
        items: buildTemplateItems(template, createdTypes),
        sortOrder: template.sortOrder,
        isActive: true,
      },
    });

    createdTemplates.set(template.name, created);
  }

  console.log(`Созданы шаблоны характеристик: ${createdTemplates.size}`);

  return createdTemplates;
}

async function assignTemplatesToCategories(categories, createdTemplates) {
  let updatedCount = 0;
  const categoryMappingsByName = new Map(CATEGORY_TEMPLATE_MAPPINGS);

  for (const category of categories) {
    const templateName = categoryMappingsByName.get(category.name);

    if (!templateName) {
      continue;
    }

    const template = createdTemplates.get(templateName);

    if (!template) {
      throw new Error(`Не найден шаблон "${templateName}" для категории "${category.name}"`);
    }

    await strapi.db.query(CATEGORY_UID).update({
      where: {
        id: category.id,
      },
      data: {
        defaultSpecificationTemplate: template.id,
      },
    });

    updatedCount += 1;
  }

  console.log(`Категории привязаны к шаблонам: ${updatedCount}`);
}

async function assignTemplatesToProducts() {
  const products = await strapi.db.query(PRODUCT_UID).findMany({
    select: ['id', 'name'],
    populate: {
      category: {
        select: ['id', 'name'],
        populate: {
          defaultSpecificationTemplate: {
            select: ['id', 'name'],
          },
        },
      },
    },
    limit: 10000,
  });

  let updatedCount = 0;
  const skippedProducts = [];

  for (const product of products) {
    const template = product.category?.defaultSpecificationTemplate;

    if (!template) {
      skippedProducts.push(product);
      continue;
    }

    await strapi.db.query(PRODUCT_UID).update({
      where: {
        id: product.id,
      },
      data: {
        specificationTemplate: template.id,
      },
    });

    updatedCount += 1;
  }

  console.log(`Товары привязаны к шаблонам: ${updatedCount}`);

  if (skippedProducts.length > 0) {
    console.log('');
    console.log(`Товары без шаблона категории: ${skippedProducts.length}`);

    for (const product of skippedProducts.slice(0, 20)) {
      console.log(`- id=${product.id} | ${product.name} | категория: ${product.category?.name || 'без категории'}`);
    }
  }
}

async function resetSpecificationSystem(existingData) {
  await clearProductSpecificationData(existingData.products);
  await clearCategoryTemplates(existingData.categories);
  await deleteExistingTemplates(existingData.templates);
  await deleteExistingTypes(existingData.types);

  const createdTypes = await createSpecificationTypes();
  const createdTemplates = await createSpecificationTemplates(createdTypes);

  await assignTemplatesToCategories(existingData.categories, createdTemplates);
  await assignTemplatesToProducts();

  console.log('');
  console.log('Готово: система характеристик пересобрана.');
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    printMode();

    const existingData = await getExistingData();
    const analysis = analyzeData(existingData);

    printPlan(existingData, analysis);

    if (!SHOULD_APPLY) {
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для реального применения: APPLY=1 npm run reset:spec-system');
      return;
    }

    await resetSpecificationSystem(existingData);
  } finally {
    await app.destroy();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
