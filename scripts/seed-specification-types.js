'use strict';

const SPECIFICATION_TYPE_UID = 'api::specification-type.specification-type';

const SPECIFICATION_TYPES = [
  {
    name: 'Тип товара',
    label: 'Тип товара',
    group: 'base',
    hint: 'Главный вид товара: Шейкер, Стрейнер, Джиггер, Бокал, Барный модуль.',
    exampleValue: 'Шейкер',
    sortOrder: 10,
  },
  {
    name: 'Тип',
    label: 'Тип',
    group: 'base',
    hint: 'Подтип товара внутри категории.',
    exampleValue: 'Бостон',
    sortOrder: 20,
  },
  {
    name: 'Назначение',
    label: 'Назначение',
    group: 'usage',
    hint: 'Для чего используется товар.',
    exampleValue: 'Для коктейлей',
    sortOrder: 30,
  },
  {
    name: 'Материал',
    label: 'Материал',
    group: 'materials',
    hint: 'Основной материал товара.',
    exampleValue: 'Нержавеющая сталь',
    sortOrder: 40,
  },
  {
    name: 'Марка стали',
    label: 'Марка стали',
    group: 'materials',
    hint: 'Марка стали, если известна.',
    exampleValue: 'AISI 304',
    sortOrder: 50,
  },
  {
    name: 'Цвет / покрытие',
    label: 'Цвет / покрытие',
    group: 'materials',
    hint: 'Цвет или тип покрытия.',
    exampleValue: 'Сталь',
    sortOrder: 60,
  },
  {
    name: 'Объем',
    label: 'Объем',
    group: 'sizes',
    hint: 'Объем товара или частей товара.',
    exampleValue: '820 / 550 мл',
    sortOrder: 70,
  },
  {
    name: 'Габариты',
    label: 'Габариты',
    group: 'sizes',
    hint: 'Размеры товара в формате ширина × глубина × высота.',
    exampleValue: '1200 × 700 × 900 мм',
    sortOrder: 80,
  },
  {
    name: 'Длина',
    label: 'Длина',
    group: 'sizes',
    hint: 'Длина товара.',
    exampleValue: '40 см',
    sortOrder: 90,
  },
  {
    name: 'Ширина',
    label: 'Ширина',
    group: 'sizes',
    hint: 'Ширина товара.',
    exampleValue: '25 см',
    sortOrder: 100,
  },
  {
    name: 'Высота',
    label: 'Высота',
    group: 'sizes',
    hint: 'Высота товара.',
    exampleValue: '16,7 см',
    sortOrder: 110,
  },
  {
    name: 'Диаметр',
    label: 'Диаметр',
    group: 'sizes',
    hint: 'Диаметр товара или рабочей части.',
    exampleValue: '100 мм',
    sortOrder: 120,
  },
  {
    name: 'Вес',
    label: 'Вес',
    group: 'sizes',
    hint: 'Вес товара.',
    exampleValue: '250 г',
    sortOrder: 130,
  },
  {
    name: 'Количество в упаковке',
    label: 'Количество в упаковке',
    group: 'equipment',
    hint: 'Количество единиц или предметов в комплекте.',
    exampleValue: '1 шт.',
    sortOrder: 140,
  },
  {
    name: 'Комплектация',
    label: 'Комплектация',
    group: 'equipment',
    hint: 'Что входит в комплект.',
    exampleValue: 'Шейкер; джиггер; стрейнер',
    sortOrder: 150,
  },
  {
    name: 'Совместимость',
    label: 'Совместимость',
    group: 'usage',
    hint: 'С чем совместим товар.',
    exampleValue: 'Для гастроёмкостей GN 1/3',
    sortOrder: 160,
  },
  {
    name: 'Особенности',
    label: 'Особенности',
    group: 'base',
    hint: 'Частные детали товара через точку с запятой.',
    exampleValue: 'С утяжелителями; толстые стенки; гравировка Skull',
    sortOrder: 170,
  },
  {
    name: 'Уход',
    label: 'Уход',
    group: 'usage',
    hint: 'Рекомендации по уходу.',
    exampleValue: 'Не мыть в посудомоечной машине',
    sortOrder: 180,
  },
  {
    name: 'Состав',
    label: 'Состав',
    group: 'food',
    hint: 'Состав пищевого товара, декора или ингредиента.',
    exampleValue: 'Сахар; глюкозный сироп; ароматизатор',
    sortOrder: 190,
  },
  {
    name: 'Вкус и аромат',
    label: 'Вкус и аромат',
    group: 'food',
    hint: 'Вкусовой и ароматический профиль.',
    exampleValue: 'Цитрус; ваниль; пряности',
    sortOrder: 200,
  },
  {
    name: 'Способ применения',
    label: 'Способ применения',
    group: 'food',
    hint: 'Как использовать товар.',
    exampleValue: 'Добавлять согласно рецептуре',
    sortOrder: 210,
  },
  {
    name: 'Условия хранения',
    label: 'Условия хранения',
    group: 'storage',
    hint: 'Как хранить товар.',
    exampleValue: 'Хранить в сухом прохладном месте',
    sortOrder: 220,
  },
  {
    name: 'Срок годности',
    label: 'Срок годности',
    group: 'storage',
    hint: 'Срок годности пищевого товара или ингредиента.',
    exampleValue: '12 месяцев',
    sortOrder: 230,
  },
  {
    name: 'Производитель',
    label: 'Производитель',
    group: 'technical',
    hint: 'Производитель оборудования или товара.',
    exampleValue: 'Hoshizaki',
    sortOrder: 240,
  },
  {
    name: 'Модель',
    label: 'Модель',
    group: 'technical',
    hint: 'Модель оборудования или товара.',
    exampleValue: 'IM-21CNE-HC',
    sortOrder: 250,
  },
  {
    name: 'Мощность',
    label: 'Мощность',
    group: 'technical',
    hint: 'Мощность оборудования.',
    exampleValue: '250 Вт',
    sortOrder: 260,
  },
  {
    name: 'Напряжение',
    label: 'Напряжение',
    group: 'technical',
    hint: 'Рабочее напряжение оборудования.',
    exampleValue: '220 В',
    sortOrder: 270,
  },
  {
    name: 'Производительность',
    label: 'Производительность',
    group: 'technical',
    hint: 'Производительность оборудования.',
    exampleValue: '25 кг/сутки',
    sortOrder: 280,
  },
  {
    name: 'Тип охлаждения',
    label: 'Тип охлаждения',
    group: 'technical',
    hint: 'Тип охлаждения оборудования.',
    exampleValue: 'Воздушное',
    sortOrder: 290,
  },
  {
    name: 'Хладагент',
    label: 'Хладагент',
    group: 'technical',
    hint: 'Тип хладагента.',
    exampleValue: 'R290',
    sortOrder: 300,
  },
  {
    name: 'Температурный режим',
    label: 'Температурный режим',
    group: 'technical',
    hint: 'Рабочий температурный диапазон.',
    exampleValue: 'от +2 до +8 °C',
    sortOrder: 310,
  },
  {
    name: 'Тип льда',
    label: 'Тип льда',
    group: 'technical',
    hint: 'Тип производимого льда.',
    exampleValue: 'Кубик',
    sortOrder: 320,
  },
  {
    name: 'Размер льда',
    label: 'Размер льда',
    group: 'technical',
    hint: 'Размер кубика, шара или другого типа льда.',
    exampleValue: '28 × 28 × 32 мм',
    sortOrder: 330,
  },
  {
    name: 'Гарантия',
    label: 'Гарантия',
    group: 'technical',
    hint: 'Гарантийный срок.',
    exampleValue: '12 месяцев',
    sortOrder: 340,
  },
  {
    name: 'Толщина металла',
    label: 'Толщина металла',
    group: 'construction',
    hint: 'Толщина металла для барных модулей и оборудования.',
    exampleValue: '1,5 мм',
    sortOrder: 350,
  },
  {
    name: 'Борт',
    label: 'Борт',
    group: 'construction',
    hint: 'Высота заднего или защитного борта.',
    exampleValue: '50 мм',
    sortOrder: 360,
  },
  {
    name: 'Снос ног',
    label: 'Снос ног',
    group: 'construction',
    hint: 'Отступ для ног со стороны бармена.',
    exampleValue: '70 мм',
    sortOrder: 370,
  },
  {
    name: 'Регулировка по высоте',
    label: 'Регулировка по высоте',
    group: 'construction',
    hint: 'Диапазон регулировки ножек или высоты.',
    exampleValue: '±25 мм',
    sortOrder: 380,
  },
];

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  try {
    let createdCount = 0;
    let updatedCount = 0;

    for (const item of SPECIFICATION_TYPES) {
      const existing = await strapi.db.query(SPECIFICATION_TYPE_UID).findOne({
        where: { name: item.name },
        select: ['id', 'name'],
      });

      const data = {
        ...item,
        unit: '',
        isFilterable: false,
        isVisible: true,
        isActive: true,
      };

      if (existing) {
        await strapi.db.query(SPECIFICATION_TYPE_UID).update({
          where: { id: existing.id },
          data,
        });

        updatedCount += 1;
      } else {
        await strapi.db.query(SPECIFICATION_TYPE_UID).create({
          data,
        });

        createdCount += 1;
      }
    }

    console.log('');
    console.log('Готово: типы характеристик обновлены');
    console.log('------------------------------------');
    console.log(`Создано: ${createdCount}`);
    console.log(`Обновлено: ${updatedCount}`);
    console.log(`Всего в словаре: ${SPECIFICATION_TYPES.length}`);
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
