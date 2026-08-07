'use strict';

/**
 * Безопасный seed Single Type «Мобильная навигация».
 *
 * По умолчанию — dry-run (без записи).
 * Запись только явно: node ./scripts/setup-mobile-navigation.js --write
 *
 * Не запускается из cron / webhook / bootstrap.
 * Картинки (homeImage / menuImage) не заполняются.
 */

const fs = require('fs');

const UID = 'api::mobile-navigation.mobile-navigation';

const SEED_ITEMS = [
  {
    title: 'Каталог',
    href: '/catalog',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'О нас',
    href: '/about',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'Знания',
    href: '/knowledge',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'Реквизиты',
    href: '/legal/requisites',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'Брендинг',
    href: '/branding',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'Контакты',
    href: '/contacts',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'Доставка',
    href: '/shipping',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'Оплата',
    href: '/payment-methods',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'Новинки',
    href: '/catalog/collection/novinki',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'Уценка',
    href: '/catalog/collection/utsenka',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'Система скидок',
    href: '/discounts',
    showInHome: true,
    showInMenu: true,
    isActive: true,
  },
  {
    title: 'Товары со скидкой',
    href: '/catalog/collection/sale',
    showInHome: false,
    showInMenu: true,
    isActive: true,
  },
];

const ITEMS_POPULATE = {
  items: {
    populate: {
      homeImage: true,
      menuImage: true,
    },
  },
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let dryRunFlag = false;
  let writeFlag = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRunFlag = true;
      continue;
    }

    if (arg === '--write') {
      writeFlag = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  if (dryRunFlag && writeFlag) {
    throw new Error('Нельзя одновременно передавать --dry-run и --write.');
  }

  const writeEnabled = writeFlag === true;
  const mode = writeEnabled ? 'write' : 'dry-run';

  return { mode, writeEnabled };
}

function safeErrorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message.slice(0, 500);
  }

  return 'unknown error';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getItems(doc) {
  if (!doc || !Array.isArray(doc.items)) {
    return [];
  }

  return doc.items;
}

function isMediaEmpty(media) {
  if (media == null) {
    return true;
  }

  if (Array.isArray(media)) {
    return media.length === 0;
  }

  if (typeof media === 'object') {
    return !(media.id || media.documentId || media.url);
  }

  return false;
}

function summarizeItems(items) {
  return items.map((item, index) => ({
    index: index + 1,
    title: item?.title ?? null,
    href: item?.href ?? null,
    showInHome: item?.showInHome ?? null,
    showInMenu: item?.showInMenu ?? null,
    isActive: item?.isActive ?? null,
    homeImageEmpty: isMediaEmpty(item?.homeImage),
    menuImageEmpty: isMediaEmpty(item?.menuImage),
  }));
}

function printItemsTable(items, label) {
  console.log('');
  console.log(label);
  console.log('-------------------------');

  if (items.length === 0) {
    console.log('(пусто)');
    return;
  }

  for (const row of summarizeItems(items)) {
    console.log(
      `${row.index}. ${row.title} | ${row.href} | home=${row.showInHome} menu=${row.showInMenu} active=${row.isActive}`,
    );
  }
}

function backupPath() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `/tmp/cocktaildesign-mobile-navigation-backup-${ts}.json`;
}

function saveBackup(payload) {
  const path = backupPath();
  fs.writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// Document Service (Strapi 5)
// ---------------------------------------------------------------------------

async function findDraft(app) {
  return app.documents(UID).findFirst({
    status: 'draft',
    populate: ITEMS_POPULATE,
  });
}

async function findPublished(app) {
  return app.documents(UID).findFirst({
    status: 'published',
    populate: ITEMS_POPULATE,
  });
}

async function loadState(app) {
  const draft = await findDraft(app);
  const published = await findPublished(app);

  const draftItems = getItems(draft);
  const publishedItems = getItems(published);

  const documentId = draft?.documentId ?? published?.documentId ?? null;
  const exists = documentId !== null;
  const hasData = draftItems.length > 0 || publishedItems.length > 0;
  const writeSafe = !hasData;

  return {
    draft,
    published,
    draftItems,
    publishedItems,
    documentId,
    exists,
    hasData,
    writeSafe,
  };
}

async function createPublished(app, items) {
  return app.documents(UID).create({
    data: { items },
    status: 'published',
  });
}

async function updatePublished(app, documentId, items) {
  return app.documents(UID).update({
    documentId,
    data: { items },
    status: 'published',
  });
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

function assertPublishedSeed(doc) {
  const errors = [];

  if (!doc) {
    errors.push('published-документ не найден после записи');
    return errors;
  }

  if (!doc.publishedAt) {
    errors.push('publishedAt пустой — документ не опубликован');
  }

  const items = getItems(doc);

  if (items.length !== SEED_ITEMS.length) {
    errors.push(`items.length: ожидалось ${SEED_ITEMS.length}, получено ${items.length}`);
  }

  const max = Math.min(items.length, SEED_ITEMS.length);

  for (let i = 0; i < max; i += 1) {
    const actual = items[i];
    const expected = SEED_ITEMS[i];
    const n = i + 1;

    if (actual?.title !== expected.title) {
      errors.push(`#${n} title: ожидалось «${expected.title}», получено «${actual?.title}»`);
    }

    if (actual?.href !== expected.href) {
      errors.push(`#${n} href: ожидалось «${expected.href}», получено «${actual?.href}»`);
    }

    if (Boolean(actual?.showInHome) !== Boolean(expected.showInHome)) {
      errors.push(
        `#${n} showInHome: ожидалось ${expected.showInHome}, получено ${actual?.showInHome}`,
      );
    }

    if (Boolean(actual?.showInMenu) !== Boolean(expected.showInMenu)) {
      errors.push(
        `#${n} showInMenu: ожидалось ${expected.showInMenu}, получено ${actual?.showInMenu}`,
      );
    }

    if (Boolean(actual?.isActive) !== Boolean(expected.isActive)) {
      errors.push(`#${n} isActive: ожидалось ${expected.isActive}, получено ${actual?.isActive}`);
    }

    if (!isMediaEmpty(actual?.homeImage)) {
      errors.push(`#${n} homeImage должен быть пустым`);
    }

    if (!isMediaEmpty(actual?.menuImage)) {
      errors.push(`#${n} menuImage должен быть пустым`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

function printDryRun(state) {
  console.log('');
  console.log('Setup Mobile Navigation (dry-run)');
  console.log('---------------------------------');
  console.log(`Документ (draft): ${state.draft?.documentId ? 'найден' : 'не найден'}`);
  console.log(`Документ (published): ${state.published?.documentId ? 'найден' : 'не найден'}`);

  if (state.documentId) {
    console.log(`documentId: ${state.documentId}`);
  }

  printItemsTable(state.draftItems, 'Текущие items (draft)');
  printItemsTable(state.publishedItems, 'Текущие items (published)');

  console.log('');
  console.log('Будет создано (порядок):');
  for (let i = 0; i < SEED_ITEMS.length; i += 1) {
    const item = SEED_ITEMS[i];
    console.log(
      `${i + 1}. ${item.title} | ${item.href} | home=${item.showInHome} menu=${item.showInMenu} active=${item.isActive}`,
    );
  }

  console.log('');
  console.log(`Картинки homeImage/menuImage: не заполняются`);
  console.log(`Запись безопасна: ${state.writeSafe ? 'да' : 'нет'}`);

  if (!state.writeSafe) {
    console.log(
      'Причина: мобильная навигация уже содержит данные (draft и/или published items не пустые).',
    );
    console.log('--write будет отклонён, чтобы не перезаписать изменения из админки.');
  } else if (!state.exists) {
    console.log('Действие при --write: create + publish (status: published)');
  } else {
    console.log('Действие при --write: update пустого документа + publish (status: published)');
  }

  console.log('');
  console.log('Для записи: node ./scripts/setup-mobile-navigation.js --write');
}

async function runWrite(app, state) {
  if (!state.writeSafe) {
    console.log('');
    console.log('Мобильная навигация уже содержит данные.');
    console.log('Автоматическая запись отменена, чтобы не перезаписать');
    console.log('изменения из админки.');
    return { aborted: true };
  }

  const backupFile = saveBackup({
    uid: UID,
    savedAt: new Date().toISOString(),
    documentId: state.documentId,
    draft: state.draft,
    published: state.published,
  });

  console.log(`Backup: ${backupFile}`);

  let documentId = state.documentId;

  if (!state.exists) {
    const created = await createPublished(app, SEED_ITEMS);
    documentId = created?.documentId ?? null;

    if (!documentId) {
      throw new Error('create Mobile Navigation: нет documentId в ответе.');
    }

    console.log(`Создано и опубликовано, documentId=${documentId}`);
  } else {
    await updatePublished(app, documentId, SEED_ITEMS);
    console.log(`Обновлено и опубликовано, documentId=${documentId}`);
  }

  const published = await findPublished(app);
  const errors = assertPublishedSeed(published);

  if (errors.length > 0) {
    console.error('');
    console.error('ERROR: verify не прошёл:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return { aborted: false, ok: false };
  }

  printItemsTable(getItems(published), 'Verify OK — published items');
  console.log(`publishedAt: ${published.publishedAt}`);
  console.log('Операция завершена успешно');

  return { aborted: false, ok: true };
}

async function run(app, options) {
  const state = await loadState(app);

  console.log(`mode: ${options.mode}`);
  console.log(`UID: ${UID}`);

  if (!options.writeEnabled) {
    printDryRun(state);
    return;
  }

  console.log('');
  console.log('Setup Mobile Navigation (write)');
  console.log('--------------------------------');
  await runWrite(app, state);
}

async function main() {
  let app = null;

  try {
    const options = parseArgs(process.argv.slice(2));
    const { createStrapi, compileStrapi } = require('@strapi/strapi');

    const appContext = await compileStrapi();
    app = await createStrapi(appContext).load();
    app.log.level = 'error';

    await run(app, options);
  } catch (error) {
    console.error('');
    console.error(`Ошибка setup Mobile Navigation: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    if (app) {
      await app.destroy();
    }
  }

  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
}

main();
