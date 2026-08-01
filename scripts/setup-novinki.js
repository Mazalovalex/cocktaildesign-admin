'use strict';

/**
 * Идемпотентный setup подборки «Новинки» и связи с Homepage.
 *
 * По умолчанию — dry-run (без записи).
 * Для записи: npm run setup:novinki -- --write
 *
 * Не запускается из cron / webhook / bootstrap.
 */

const COLLECTION_UID = 'api::catalog-collection.catalog-collection';
const HOMEPAGE_UID = 'api::homepage.homepage';

const TARGET_SLUG = 'novinki';

const TARGET_COLLECTION = {
  title: 'Новинки',
  slug: 'novinki',
  selectionMode: 'new',
  noveltyDays: 100,
  noveltyBadgeColor: '#2eae4a',
};

const COLLECTION_FIELDS = [
  'documentId',
  'title',
  'slug',
  'selectionMode',
  'noveltyDays',
  'noveltyBadgeColor',
];

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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function collectionFieldsMismatch(record) {
  if (!record) {
    return true;
  }

  return (
    normalizeString(record.title) !== TARGET_COLLECTION.title ||
    normalizeString(record.slug) !== TARGET_COLLECTION.slug ||
    record.selectionMode !== TARGET_COLLECTION.selectionMode ||
    Number(record.noveltyDays) !== TARGET_COLLECTION.noveltyDays ||
    normalizeString(record.noveltyBadgeColor).toLowerCase() !==
      TARGET_COLLECTION.noveltyBadgeColor.toLowerCase()
  );
}

function getRelationDocumentId(relation) {
  if (!relation) {
    return null;
  }

  if (typeof relation === 'string') {
    return relation;
  }

  if (typeof relation === 'object' && typeof relation.documentId === 'string') {
    return relation.documentId;
  }

  return null;
}

async function findCollectionDraft() {
  return strapi.documents(COLLECTION_UID).findFirst({
    filters: { slug: TARGET_SLUG },
    status: 'draft',
    fields: COLLECTION_FIELDS,
  });
}

async function findCollectionPublished() {
  return strapi.documents(COLLECTION_UID).findFirst({
    filters: { slug: TARGET_SLUG },
    status: 'published',
    fields: COLLECTION_FIELDS,
  });
}

async function findHomepageDraft() {
  return strapi.documents(HOMEPAGE_UID).findFirst({
    status: 'draft',
    fields: ['documentId'],
    populate: {
      collectionAfterKnowledge: {
        fields: ['documentId', 'slug'],
      },
    },
  });
}

async function findHomepagePublished() {
  return strapi.documents(HOMEPAGE_UID).findFirst({
    status: 'published',
    fields: ['documentId'],
    populate: {
      collectionAfterKnowledge: {
        fields: ['documentId', 'slug'],
      },
    },
  });
}

async function createCollection() {
  return strapi.documents(COLLECTION_UID).create({
    data: { ...TARGET_COLLECTION },
    status: 'published',
  });
}

async function updateCollection(documentId) {
  return strapi.documents(COLLECTION_UID).update({
    documentId,
    data: { ...TARGET_COLLECTION },
    status: 'published',
  });
}

async function updateHomepageRelation(homepageDocumentId, collectionDocumentId) {
  return strapi.documents(HOMEPAGE_UID).update({
    documentId: homepageDocumentId,
    data: {
      collectionAfterKnowledge: {
        connect: [collectionDocumentId],
      },
    },
    status: 'published',
  });
}

function analyzeCollection(draft, published) {
  const draftExists = Boolean(draft?.documentId);
  const publishedExists = Boolean(published?.documentId);

  const documentId = draft?.documentId ?? published?.documentId ?? null;

  const willCreate = !draftExists && !publishedExists;

  const willUpdate = draftExists && collectionFieldsMismatch(draft);

  const willPublish =
    (draftExists && (!publishedExists || collectionFieldsMismatch(published))) ||
    (!draftExists && publishedExists);

  return {
    draftExists,
    publishedExists,
    documentId,
    willCreate,
    willUpdate,
    willPublish,
    needsWrite: willCreate || willUpdate || willPublish,
  };
}

function analyzeHomepage(draftHomepage, publishedHomepage, collectionDocumentId) {
  const draftExists = Boolean(draftHomepage?.documentId);
  const publishedExists = Boolean(publishedHomepage?.documentId);

  const documentId = draftHomepage?.documentId ?? publishedHomepage?.documentId ?? null;

  const draftRelationDocumentId = draftExists
    ? getRelationDocumentId(draftHomepage.collectionAfterKnowledge)
    : null;

  const publishedRelationDocumentId = publishedExists
    ? getRelationDocumentId(publishedHomepage.collectionAfterKnowledge)
    : null;

  const draftRelationMismatch =
    draftExists &&
    Boolean(collectionDocumentId) &&
    draftRelationDocumentId !== collectionDocumentId;

  const publishedRelationMismatch =
    publishedExists &&
    Boolean(collectionDocumentId) &&
    publishedRelationDocumentId !== collectionDocumentId;

  const needsWrite =
    !draftExists ||
    !publishedExists ||
    draftRelationMismatch ||
    publishedRelationMismatch;

  return {
    draftExists,
    publishedExists,
    documentId,
    exists: documentId !== null,
    needsWrite,
  };
}

function homepageNeedsWriteAfterCollection(homepageState, collectionState, collectionDocumentId) {
  if (!homepageState.exists) {
    return false;
  }

  if (collectionState.willCreate) {
    return true;
  }

  const homepageStateWithCollection = analyzeHomepage(
    homepageState.draftHomepage,
    homepageState.publishedHomepage,
    collectionDocumentId,
  );

  return homepageStateWithCollection.needsWrite;
}

// ---------------------------------------------------------------------------
// Основная логика
// ---------------------------------------------------------------------------

async function runSetup(options) {
  const collectionDraft = await findCollectionDraft();
  const collectionPublished = await findCollectionPublished();
  const collectionState = analyzeCollection(collectionDraft, collectionPublished);

  const homepageDraft = await findHomepageDraft();
  const homepagePublished = await findHomepagePublished();

  const homepageState = {
    ...analyzeHomepage(homepageDraft, homepagePublished, collectionState.documentId),
    draftHomepage: homepageDraft,
    publishedHomepage: homepagePublished,
  };

  if (options.writeEnabled) {
    if (!homepageState.exists) {
      throw new Error(
        'Single Type Homepage не найден (нет ни draft, ни published). Создайте запись Homepage в Strapi вручную.',
      );
    }

    const homepageDocumentId = homepageState.documentId;
    let collectionDocumentId = collectionState.documentId;

    if (collectionState.willCreate) {
      const created = await createCollection();
      collectionDocumentId = created?.documentId ?? null;

      if (!collectionDocumentId) {
        throw new Error('Не удалось создать коллекцию «Новинки»: documentId отсутствует в ответе.');
      }

      console.log('Коллекция создана');
      console.log(`documentId: ${collectionDocumentId}`);
    } else if (collectionState.willUpdate || collectionState.willPublish) {
      const sourceDocumentId = collectionDraft?.documentId ?? collectionPublished?.documentId;

      if (!sourceDocumentId) {
        throw new Error('Не удалось определить documentId коллекции «Новинки» для обновления.');
      }

      const updated = await updateCollection(sourceDocumentId);
      collectionDocumentId = updated?.documentId ?? sourceDocumentId;

      if (collectionState.willUpdate && collectionState.willPublish) {
        console.log('Коллекция обновлена и опубликована');
      } else if (collectionState.willUpdate) {
        console.log('Коллекция обновлена');
      } else {
        console.log('Коллекция опубликована');
      }

      console.log(`documentId: ${collectionDocumentId}`);
    } else {
      console.log('Коллекция уже настроена');
      console.log(`documentId: ${collectionDocumentId}`);
    }

    const homepageStateAfterCollection = analyzeHomepage(
      homepageDraft,
      homepagePublished,
      collectionDocumentId,
    );

    if (homepageStateAfterCollection.needsWrite) {
      await updateHomepageRelation(homepageDocumentId, collectionDocumentId);
      console.log('Homepage: collectionAfterKnowledge обновлена и опубликована → novinki');
    } else {
      console.log('Homepage уже настроен: collectionAfterKnowledge → novinki');
    }

    console.log('Операция завершена успешно');
    return;
  }

  const homepageWillChange = homepageNeedsWriteAfterCollection(
    homepageState,
    collectionState,
    collectionState.documentId,
  );

  console.log('');
  console.log('Setup «Новинки» (dry-run)');
  console.log('-------------------------');
  console.log(
    `Коллекция slug="${TARGET_SLUG}" (draft): ${collectionState.draftExists ? 'найдена' : 'не найдена'}`,
  );
  console.log(
    `Коллекция slug="${TARGET_SLUG}" (published): ${collectionState.publishedExists ? 'найдена' : 'не найдена'}`,
  );

  if (collectionState.willCreate) {
    console.log('Действие с коллекцией: будет создана');
  } else {
    if (collectionState.willUpdate) {
      console.log('Действие с коллекцией: будет обновлена');
    }

    if (collectionState.willPublish) {
      console.log('Действие с коллекцией: будет опубликована');
    }

    if (!collectionState.willUpdate && !collectionState.willPublish) {
      console.log('Действие с коллекцией: изменений не требуется');
    }

    if (collectionState.documentId) {
      console.log(`documentId: ${collectionState.documentId}`);
    }
  }

  console.log(`Homepage (draft): ${homepageState.draftExists ? 'найдена' : 'не найдена'}`);
  console.log(`Homepage (published): ${homepageState.publishedExists ? 'найдена' : 'не найдена'}`);
  console.log(`Homepage как документ: ${homepageState.exists ? 'найден' : 'не найден'}`);

  if (!homepageState.exists) {
    console.log('collectionAfterKnowledge: изменение невозможно (Homepage отсутствует)');
  } else if (collectionState.willCreate) {
    console.log('После создания collectionAfterKnowledge будет установлена на новую коллекцию');
  } else if (homepageWillChange) {
    console.log('collectionAfterKnowledge: будет обновлена и опубликована → novinki');
  } else {
    console.log('collectionAfterKnowledge: изменений не требуется');
  }

  console.log('');
  console.log('Для записи запустите: npm run setup:novinki -- --write');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  let app = null;

  try {
    const appContext = await compileStrapi();
    app = await createStrapi(appContext).load();
    app.log.level = 'error';

    await runSetup(options);
  } catch (error) {
    console.error('');
    console.error(`Ошибка setup «Новинки»: ${safeErrorMessage(error)}`);
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
