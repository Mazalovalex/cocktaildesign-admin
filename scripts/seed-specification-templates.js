'use strict';

const TEMPLATES = [
  {
    name: 'Шейкеры',
    code: 'shejkery',
    description: 'Шаблон для шейкеров: кобблер, бостон, паризиан.',
    sortOrder: 10,
    items: [
      ['Тип товара', true],
      ['Тип шейкера', true],
      ['Назначение', false],
      ['Материал', true],
      ['Марка стали', false],
      ['Цвет / покрытие', false],
      ['Объем', true],
      ['Количество частей', false],
      ['Утяжелители', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Стрейнеры',
    code: 'strejnery',
    description: 'Шаблон для хоторн, арт, джулеп и файн стрейнеров.',
    sortOrder: 20,
    items: [
      ['Тип товара', true],
      ['Тип стрейнера', true],
      ['Назначение', false],
      ['Материал', true],
      ['Марка стали', false],
      ['Цвет / покрытие', false],
      ['Диаметр с пружиной', false],
      ['Диаметр рабочей части', false],
      ['Длина ручки', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Джиггеры и мерники',
    code: 'dzhiggery-i-merniki',
    description: 'Шаблон для джиггеров, мерников и мерных ложек.',
    sortOrder: 30,
    items: [
      ['Тип товара', true],
      ['Тип джиггера', true],
      ['Назначение', false],
      ['Материал', true],
      ['Марка стали', false],
      ['Цвет / покрытие', false],
      ['Форма', false],
      ['Объем', true],
      ['Объемы чаш', false],
      ['Насечки', false],
      ['Стандарт', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Барные ложки',
    code: 'barnye-lozhki',
    description: 'Шаблон для барных ложек.',
    sortOrder: 40,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', true],
      ['Марка стали', false],
      ['Цвет / покрытие', false],
      ['Длина', true],
      ['Форма ручки', false],
      ['Наконечник', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Смесительные стаканы',
    code: 'smesitelnye-stakany',
    description: 'Шаблон для смесительных стаканов.',
    sortOrder: 50,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', true],
      ['Объем', true],
      ['Комфортный рабочий объем', false],
      ['Максимальный объем', false],
      ['Высота', false],
      ['Диаметр', false],
      ['Вес', false],
      ['Наличие носика', false],
      ['Наличие ножки', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Мадлеры и сквизеры',
    code: 'madlery-i-skvizery',
    description: 'Шаблон для мадлеров и сквизеров.',
    sortOrder: 60,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', true],
      ['Цвет / покрытие', false],
      ['Длина', false],
      ['Диаметр рабочей части', false],
      ['Тип рабочей части', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Щипцы и пинцеты',
    code: 'shhipcy-i-pincety',
    description: 'Шаблон для щипцов и пинцетов.',
    sortOrder: 70,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', true],
      ['Цвет / покрытие', false],
      ['Длина', false],
      ['Форма носика', false],
      ['Наличие насечек', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Барные зажигалки',
    code: 'barnye-zazhigalki',
    description: 'Шаблон для барных зажигалок.',
    sortOrder: 80,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Цвет / покрытие', false],
      ['Габариты', false],
      ['Комплектация', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Ножи, пиллеры, терки',
    code: 'nozhi-pillery-terki',
    description: 'Шаблон для ножей, пиллеров и терок.',
    sortOrder: 90,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал лезвия', false],
      ['Материал ручки', false],
      ['Общая длина', false],
      ['Длина лезвия', false],
      ['Тип лезвия', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Нарзанники и открывашки',
    code: 'narzanniki-i-otkryvashki',
    description: 'Шаблон для нарзанников, открывашек и спидопенеров.',
    sortOrder: 100,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', true],
      ['Цвет / покрытие', false],
      ['Количество ступеней', false],
      ['Нож для фольги', false],
      ['Чехол в комплекте', false],
      ['Длина', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Пищевой декор',
    code: 'pishhevoj-dekor',
    description: 'Шаблон для ягод, пудр и пищевого декора.',
    sortOrder: 110,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Масса нетто', false],
      ['Состав', true],
      ['Вкус и аромат', false],
      ['Способ применения', false],
      ['Условия хранения', true],
      ['Температура хранения', false],
      ['Срок годности', true],
      ['Срок после вскрытия', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Подача и сервировка',
    code: 'podacha-i-servirovka',
    description: 'Шаблон для трубочек, шпажек, подставок, костеров, подносов и девайсов для подачи.',
    sortOrder: 120,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Цвет / покрытие', false],
      ['Длина', false],
      ['Диаметр', false],
      ['Габариты', false],
      ['Количество в упаковке', false],
      ['Многоразовое использование', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Кондитерский инвентарь',
    code: 'konditerskij-inventar',
    description: 'Шаблон для ковриков, шпателей, кондитерских форм и мелочей.',
    sortOrder: 130,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', true],
      ['Габариты', false],
      ['Количество секций', false],
      ['Размер ячейки', false],
      ['Температурный режим', false],
      ['Подходит для духовки', false],
      ['Подходит для морозилки', false],
      ['Подходит для ПММ', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Бариста',
    code: 'barista',
    description: 'Шаблон для товаров бариста.',
    sortOrder: 140,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', true],
      ['Объем', false],
      ['Диаметр', false],
      ['Совместимость', false],
      ['Наличие делений', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Винные аксессуары',
    code: 'vinnye-aksessuary',
    description: 'Шаблон для товаров категории всё для вина.',
    sortOrder: 150,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Цвет / покрытие', false],
      ['Объем', false],
      ['Габариты', false],
      ['Комплектация', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Аксессуары',
    code: 'aksessuary',
    description: 'Универсальный шаблон для аксессуаров.',
    sortOrder: 160,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Цвет / покрытие', false],
      ['Габариты', false],
      ['Комплектация', false],
      ['Уход', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Молекулярная кухня',
    code: 'molekulyarnaya-kuhnya',
    description: 'Шаблон для кислот, текстур и товаров молекулярной кухни.',
    sortOrder: 170,
    items: [
      ['Тип товара', true],
      ['Назначение', true],
      ['Масса нетто', false],
      ['Объем', false],
      ['Состав', true],
      ['Вкус и аромат', false],
      ['Способ применения', false],
      ['Условия хранения', true],
      ['Температура хранения', false],
      ['Срок годности', true],
      ['Срок после вскрытия', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Организация и хранение',
    code: 'organizaciya-i-hranenie',
    description: 'Шаблон для баночек, диспенсеров, органайзеров и емкостей.',
    sortOrder: 180,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', true],
      ['Объем', false],
      ['Количество секций', false],
      ['Тип крышки', false],
      ['Герметичность', false],
      ['Цвет / покрытие', false],
      ['Габариты', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Бокалы',
    code: 'bokaly',
    description: 'Шаблон для бокалов.',
    sortOrder: 190,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', true],
      ['Объем', true],
      ['Высота', false],
      ['Диаметр чаши', false],
      ['Наличие ножки', false],
      ['Подходит для ПММ', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Бутылочки для биттера',
    code: 'butylochki-dlya-bittera',
    description: 'Шаблон для бутылочек, дропперов и атомайзеров.',
    sortOrder: 200,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Объем', true],
      ['Материал колбы', false],
      ['Материал дозатора', false],
      ['Тип дозатора', false],
      ['Цвет / покрытие', false],
      ['Высота', false],
      ['Диаметр', false],
      ['Комплектация', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Инструменты для льда',
    code: 'instrumenty-dlya-lda',
    description: 'Шаблон для совков, форм, пиков, ножей, клише и оттисков для льда.',
    sortOrder: 210,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Длина', false],
      ['Ширина', false],
      ['Высота', false],
      ['Диаметр', false],
      ['Форма льда', false],
      ['Размер льда', false],
      ['Количество секций', false],
      ['Длина лезвия', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Оборудование',
    code: 'oborudovanie',
    description: 'Универсальный шаблон для оборудования.',
    sortOrder: 220,
    items: [
      ['Тип оборудования', true],
      ['Назначение', true],
      ['Производитель', false],
      ['Модель', false],
      ['Материал корпуса', false],
      ['Диапазон измерений', false],
      ['Точность', false],
      ['Питание', false],
      ['Мощность', false],
      ['Габариты', true],
      ['Вес', false],
      ['Комплектация', false],
      ['Гарантия', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Весы и измерительные приборы',
    code: 'vesy-i-izmeritelnye-pribory',
    description: 'Шаблон для весов и измерительных приборов.',
    sortOrder: 230,
    items: [
      ['Тип оборудования', true],
      ['Назначение', true],
      ['Производитель', false],
      ['Модель', false],
      ['Диапазон измерений', false],
      ['Точность', false],
      ['Питание', false],
      ['Габариты', false],
      ['Вес', false],
      ['Гарантия', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Льдогенераторы',
    code: 'ldogeneratory',
    description: 'Шаблон для льдогенераторов Hoshizaki.',
    sortOrder: 240,
    items: [
      ['Тип оборудования', true],
      ['Производитель', true],
      ['Модель', true],
      ['Тип льда', true],
      ['Производительность', true],
      ['Способ охлаждения', false],
      ['Хладагент', false],
      ['Питание', false],
      ['Мощность', false],
      ['Габариты', true],
      ['Вес', false],
      ['Гарантия', false],
      ['Срок доставки', false],
      ['Стоимость доставки', false],
    ],
  },
  {
    name: 'Барные модули',
    code: 'barnye-moduli',
    description: 'Шаблон для барных модулей и оборудования Barmade.',
    sortOrder: 250,
    items: [
      ['Тип оборудования', true],
      ['Назначение', true],
      ['Габариты', true],
      ['Ширина', false],
      ['Глубина', false],
      ['Высота', false],
      ['Материал', true],
      ['Марка стали', true],
      ['Толщина металла', true],
      ['Борт', false],
      ['Снос ног', false],
      ['Регулировка по высоте', false],
      ['Комплектация', true],
      ['Особенности', false],
    ],
  },
  {
    name: 'Наборы',
    code: 'nabory',
    description: 'Шаблон для наборов и готовых решений.',
    sortOrder: 260,
    items: [
      ['Тип набора', true],
      ['Назначение', false],
      ['Количество предметов', true],
      ['Состав набора', true],
      ['Материал', false],
      ['Цвет / покрытие', false],
      ['Уровень', false],
      ['Упаковка', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Сертификаты и подарки',
    code: 'sertifikaty-i-podarki',
    description: 'Шаблон для сертификатов и подарочных товаров.',
    sortOrder: 270,
    items: [
      ['Тип товара', true],
      ['Номинал', false],
      ['Формат', false],
      ['Срок действия', false],
      ['Комплектация', false],
      ['Назначение', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Технологии для коктейлей',
    code: 'tehnologii-dlya-koktejlej',
    description: 'Шаблон для технологических товаров и ингредиентов для коктейлей.',
    sortOrder: 280,
    items: [
      ['Тип товара', true],
      ['Назначение', true],
      ['Состав', false],
      ['Масса нетто', false],
      ['Объем', false],
      ['Способ применения', false],
      ['Условия хранения', false],
      ['Срок годности', false],
      ['Особенности', false],
    ],
  },
  {
    name: 'Полезные мелочи для бара',
    code: 'poleznye-melochi-dlya-bara',
    description: 'Универсальный шаблон для небольших барных аксессуаров.',
    sortOrder: 290,
    items: [
      ['Тип товара', true],
      ['Назначение', false],
      ['Материал', false],
      ['Цвет / покрытие', false],
      ['Габариты', false],
      ['Количество в упаковке', false],
      ['Комплектация', false],
      ['Особенности', false],
    ],
  },
];

function buildSlug(value) {
  return value
    .toLowerCase()
    .replace(/ё/g, 'e')
    .replace(/й/g, 'j')
    .replace(/ц/g, 'c')
    .replace(/у/g, 'u')
    .replace(/к/g, 'k')
    .replace(/е/g, 'e')
    .replace(/н/g, 'n')
    .replace(/г/g, 'g')
    .replace(/ш/g, 'sh')
    .replace(/щ/g, 'shh')
    .replace(/з/g, 'z')
    .replace(/х/g, 'h')
    .replace(/ъ/g, '')
    .replace(/ф/g, 'f')
    .replace(/ы/g, 'y')
    .replace(/в/g, 'v')
    .replace(/а/g, 'a')
    .replace(/п/g, 'p')
    .replace(/р/g, 'r')
    .replace(/о/g, 'o')
    .replace(/л/g, 'l')
    .replace(/д/g, 'd')
    .replace(/ж/g, 'zh')
    .replace(/э/g, 'e')
    .replace(/я/g, 'ya')
    .replace(/ч/g, 'ch')
    .replace(/с/g, 's')
    .replace(/м/g, 'm')
    .replace(/и/g, 'i')
    .replace(/т/g, 't')
    .replace(/ь/g, '')
    .replace(/б/g, 'b')
    .replace(/ю/g, 'yu')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getSpecificationByName(name) {
  const uid = 'api::specification-type.specification-type';

  const specification = await strapi.db.query(uid).findOne({
    where: { name },
  });

  if (!specification) {
    throw new Error(`Не найден тип характеристики: ${name}`);
  }

  return specification;
}

async function buildTemplateItems(items) {
  const result = [];

  for (let index = 0; index < items.length; index += 1) {
    const [name, isRequired] = items[index];
    const specification = await getSpecificationByName(name);

    result.push({
      specification: specification.documentId || String(specification.id),
      isRequired,
      sortOrder: (index + 1) * 10,
    });
  }

  return result;
}

async function upsertTemplate(template) {
  const uid = 'api::specification-template.specification-template';
  const documents = strapi.documents(uid);

  const existing = await documents.findFirst({
    filters: {
      name: {
        $eq: template.name,
      },
    },
  });

  const items = await buildTemplateItems(template.items);

  const data = {
    name: template.name,
    code: template.code || buildSlug(template.name),
    description: template.description,
    items,
    sortOrder: template.sortOrder,
    isActive: true,
  };

  if (existing) {
    await documents.update({
      documentId: existing.documentId,
      data,
    });

    console.log(`Обновлено: ${template.name}`);
    return;
  }

  await documents.create({ data });
  console.log(`Создано: ${template.name}`);
}

async function seedSpecificationTemplates() {
  for (const template of TEMPLATES) {
    await upsertTemplate(template);
  }
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    await seedSpecificationTemplates();
    console.log('Готово: шаблоны характеристик созданы/обновлены.');
  } finally {
    await app.destroy();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
