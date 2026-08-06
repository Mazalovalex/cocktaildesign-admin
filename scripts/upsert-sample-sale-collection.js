'use strict';

/**
 * Идемпотентный upsert подборки «Уценка» (slug=utsenka).
 * По умолчанию dry-run. Запись: node ./scripts/upsert-sample-sale-collection.js --write
 */

const COLLECTION_UID = 'api::catalog-collection.catalog-collection';
const CATEGORY_UID = 'api::moysklad-category.moysklad-category';
const SAMPLE_SALE_MOYSKLAD_ID = 'b4121850-6ab7-11ef-0a80-01fa00116171';
const NOVINKI_SLUG = 'novinki';
const UTSENKA_SLUG = 'utsenka';
const TARGET_TITLE = 'Уценка';
const TARGET_SELECTION_MODE = 'category';
const UTSENKA_FIELDS = [
  'documentId', 'title', 'slug', 'description', 'sortOrder',
  'selectionMode', 'isHiddenInMenu', 'publishedAt',
];

function parseArgs(argv) {
  let dryRunFlag = false;
  let writeFlag = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRunFlag = true;
    else if (arg === '--write') writeFlag = true;
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (dryRunFlag && writeFlag) {
    throw new Error('Нельзя одновременно передавать --dry-run и --write.');
  }
  return { writeEnabled: writeFlag === true, mode: writeFlag ? 'write' : 'dry-run' };
}

function safeErrorMessage(error) {
  return error instanceof Error && typeof error.message === 'string'
    ? error.message.slice(0, 500)
    : 'unknown error';
}

function sortOrderOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function relationId(relation) {
  if (typeof relation === 'number' && Number.isFinite(relation)) return relation;
  if (relation && typeof relation === 'object') {
    if (typeof relation.id === 'number') return relation.id;
    if (typeof relation.id === 'string' && /^\d+$/.test(relation.id)) return Number(relation.id);
  }
  return null;
}

function relationDocumentId(relation) {
  if (typeof relation === 'string' && relation.trim()) return relation.trim();
  if (relation && typeof relation === 'object' && typeof relation.documentId === 'string') {
    return relation.documentId;
  }
  return null;
}

function sourceCategoryMatches(relation, category) {
  return (
    relationId(relation) === category.id ||
    (Boolean(category.documentId) && relationDocumentId(relation) === category.documentId)
  );
}

async function findSampleSaleCategory(app) {
  return app.db.query(CATEGORY_UID).findOne({
    where: { moyskladId: SAMPLE_SALE_MOYSKLAD_ID },
    select: ['id', 'documentId', 'moyskladId', 'name', 'slug'],
  });
}

async function findBySlugStatus(app, slug, status) {
  const rows = await app.documents(COLLECTION_UID).findMany({
    filters: { slug },
    status,
    fields: UTSENKA_FIELDS,
    populate: { sourceCategory: true },
    limit: 100,
  });
  return Array.isArray(rows) ? rows : [];
}

/** draft + published по slug=utsenka, дедуп по documentId. */
async function resolveUtsenka(app) {
  const [draftRows, publishedRows] = await Promise.all([
    findBySlugStatus(app, UTSENKA_SLUG, 'draft'),
    findBySlugStatus(app, UTSENKA_SLUG, 'published'),
  ]);

  const byId = new Map();
  for (const [row, kind] of [
    ...draftRows.map((r) => [r, 'draft']),
    ...publishedRows.map((r) => [r, 'published']),
  ]) {
    const documentId = str(row?.documentId);
    if (!documentId) throw new Error(`Подборка utsenka (${kind}) без documentId.`);
    const entry = byId.get(documentId) || { documentId, draft: null, published: null };
    entry[kind] = row;
    byId.set(documentId, entry);
  }

  const unique = [...byId.values()];
  if (unique.length > 1) {
    throw new Error(
      `Найдено больше одного documentId для slug=${UTSENKA_SLUG}: ${unique
        .map((u) => u.documentId)
        .join(', ')}. Запись запрещена.`,
    );
  }
  if (unique.length === 0) return null;

  const item = unique[0];
  return {
    documentId: item.documentId,
    record: item.published || item.draft,
    isPublished: Boolean(item.published && item.published.publishedAt),
  };
}

async function assertSingleUtsenkaDocumentId(app, expectedDocumentId) {
  const resolved = await resolveUtsenka(app);
  if (!resolved) {
    throw new Error(`slug=${UTSENKA_SLUG} не найден ни в draft, ни в published.`);
  }
  if (resolved.documentId !== expectedDocumentId) {
    throw new Error(
      `documentId slug=${UTSENKA_SLUG}: expected=${expectedDocumentId}, got=${resolved.documentId}`,
    );
  }
}

async function findPublishedCollections(app) {
  const rows = await app.documents(COLLECTION_UID).findMany({
    status: 'published',
    fields: ['documentId', 'title', 'slug', 'sortOrder'],
    limit: 1000,
  });
  return Array.isArray(rows) ? rows : [];
}

async function findPublishedByDocumentId(app, documentId) {
  return app.documents(COLLECTION_UID).findOne({
    documentId,
    status: 'published',
    fields: UTSENKA_FIELDS,
    populate: { sourceCategory: true },
  });
}

function buildReorderPlan(collections, novinki, utsenkaRecord) {
  const novinkiSort = sortOrderOf(novinki.sortOrder);
  const targetSortOrder = novinkiSort + 1;
  const action = utsenkaRecord ? 'update' : 'create';
  const currentSortOrder = utsenkaRecord ? sortOrderOf(utsenkaRecord.sortOrder) : null;

  if (utsenkaRecord && currentSortOrder === targetSortOrder) {
    return { action, targetSortOrder, currentSortOrder, shifts: [], needsReorder: false };
  }

  if (!utsenkaRecord) {
    const shifts = collections
      .filter((item) => sortOrderOf(item.sortOrder) >= targetSortOrder)
      .map((item) => ({
        documentId: item.documentId,
        slug: str(item.slug),
        from: sortOrderOf(item.sortOrder),
        to: sortOrderOf(item.sortOrder) + 1,
      }));
    return { action: 'create', targetSortOrder, currentSortOrder: null, shifts, needsReorder: shifts.length > 0 };
  }

  const others = collections
    .filter((item) => str(item.slug) !== UTSENKA_SLUG)
    .slice()
    .sort((a, b) => {
      const diff = sortOrderOf(a.sortOrder) - sortOrderOf(b.sortOrder);
      return diff !== 0 ? diff : str(a.slug).localeCompare(str(b.slug), 'ru');
    });

  const novinkiIndex = others.findIndex((item) => str(item.slug) === NOVINKI_SLUG);
  if (novinkiIndex < 0) throw new Error('«Новинки» пропали из списка при расчёте порядка.');

  const shifts = [];
  others.slice(novinkiIndex + 1).forEach((item, i) => {
    const from = sortOrderOf(item.sortOrder);
    const to = novinkiSort + 2 + i;
    if (from !== to) shifts.push({ documentId: item.documentId, slug: str(item.slug), from, to });
  });

  return {
    action: 'update',
    targetSortOrder,
    currentSortOrder,
    shifts,
    needsReorder: currentSortOrder !== targetSortOrder || shifts.length > 0,
  };
}

function buildPayload(categoryId, targetSortOrder) {
  return {
    title: TARGET_TITLE,
    slug: UTSENKA_SLUG,
    description: null,
    selectionMode: TARGET_SELECTION_MODE,
    sourceCategory: categoryId,
    isHiddenInMenu: true,
    sortOrder: targetSortOrder,
  };
}

function isAlreadyConfigured(utsenka, category, targetSortOrder) {
  const r = utsenka?.record;
  if (!utsenka?.isPublished || !r) return false;
  return (
    str(r.title) === TARGET_TITLE &&
    str(r.slug) === UTSENKA_SLUG &&
    r.description == null &&
    r.selectionMode === TARGET_SELECTION_MODE &&
    sourceCategoryMatches(r.sourceCategory, category) &&
    r.isHiddenInMenu === true &&
    sortOrderOf(r.sortOrder) === targetSortOrder &&
    Boolean(r.publishedAt)
  );
}

function assertUtsenkaResult(saved, category, targetSortOrder) {
  if (!saved) throw new Error('«Уценка» не найдена после записи (published).');
  const errors = [];
  if (str(saved.title) !== TARGET_TITLE) errors.push(`title=${String(saved.title)}`);
  if (str(saved.slug) !== UTSENKA_SLUG) errors.push(`slug=${String(saved.slug)}`);
  if (saved.description != null) errors.push(`description=${JSON.stringify(saved.description)}`);
  if (saved.selectionMode !== TARGET_SELECTION_MODE) errors.push(`selectionMode=${String(saved.selectionMode)}`);
  if (!sourceCategoryMatches(saved.sourceCategory, category)) {
    errors.push(`sourceCategory id=${String(relationId(saved.sourceCategory))}`);
  }
  if (saved.isHiddenInMenu !== true) errors.push(`isHiddenInMenu=${String(saved.isHiddenInMenu)}`);
  if (sortOrderOf(saved.sortOrder) !== targetSortOrder) errors.push(`sortOrder=${String(saved.sortOrder)}`);
  if (!saved.publishedAt) errors.push('publishedAt пустой');
  if (errors.length) throw new Error(`Проверка не прошла:\n- ${errors.join('\n- ')}`);
}

function printResult(saved) {
  console.log('RESULT: passed');
  console.log(JSON.stringify({
    documentId: saved.documentId,
    title: saved.title,
    slug: saved.slug,
    selectionMode: saved.selectionMode,
    sourceCategoryId: relationId(saved.sourceCategory),
    isHiddenInMenu: saved.isHiddenInMenu,
    sortOrder: saved.sortOrder,
    publishedAt: saved.publishedAt,
  }, null, 2));
}

function printDryRun(report) {
  console.log('');
  console.log('Upsert «Уценка» (dry-run)');
  console.log('-------------------------');
  console.log(`Категория Sample Sale найдена: ${report.categoryFound ? 'да' : 'нет'}`);
  console.log(`Strapi id категории: ${report.categoryId ?? '(нет)'}`);
  console.log(`Подборка «Новинки» найдена (published): ${report.novinkiFound ? 'да' : 'нет'}`);
  console.log(`sortOrder «Новинок»: ${report.novinkiSortOrder}`);
  console.log(`«Уценка» существует: ${report.utsenkaExists ? 'да' : 'нет'}`);
  if (report.utsenkaDocumentId) {
    console.log(`documentId «Уценки»: ${report.utsenkaDocumentId}`);
    console.log(`«Уценка» опубликована: ${report.utsenkaPublished ? 'да' : 'нет'}`);
  }
  console.log(`Действие: ${report.action}`);
  console.log(`Текущий sortOrder «Уценки»: ${report.currentSortOrder ?? '(нет)'}`);
  console.log(`Целевой sortOrder «Уценки»: ${report.targetSortOrder}`);
  console.log(`Запись потребуется: ${report.needsWrite ? 'да' : 'нет'}`);
  if (!report.shifts.length) console.log('Сдвиги sortOrder: нет');
  else {
    console.log('Сдвиги sortOrder:');
    for (const s of report.shifts) console.log(`  - ${s.slug}: ${s.from} → ${s.to}`);
  }
  console.log('Итоговый payload:');
  console.log(JSON.stringify(report.payload, null, 2));
  console.log('');
  console.log('База не изменена (dry-run).');
  console.log('Для записи: node ./scripts/upsert-sample-sale-collection.js --write');
}

async function applyShifts(app, shifts) {
  const ordered = shifts.slice().sort((a, b) => b.to - a.to || b.from - a.from);
  for (const shift of ordered) {
    if (!shift.documentId) throw new Error(`Сдвиг без documentId: ${shift.slug}`);
    await app.documents(COLLECTION_UID).update({
      documentId: shift.documentId,
      data: { sortOrder: shift.to },
      status: 'published',
    });
  }
}

function writeData(payload, categoryDocumentId) {
  return {
    title: payload.title,
    slug: payload.slug,
    description: payload.description,
    selectionMode: payload.selectionMode,
    isHiddenInMenu: payload.isHiddenInMenu,
    sortOrder: payload.sortOrder,
    sourceCategory: { set: [categoryDocumentId] },
  };
}

async function run(app, options) {
  const category = await findSampleSaleCategory(app);
  if (!category || typeof category.id !== 'number') {
    throw new Error(`Категория Sample Sale не найдена по moyskladId=${SAMPLE_SALE_MOYSKLAD_ID}`);
  }
  if (!category.documentId) throw new Error('У категории Sample Sale отсутствует documentId.');

  const collections = await findPublishedCollections(app);
  const novinki = collections.find((item) => str(item.slug) === NOVINKI_SLUG) ?? null;
  if (!novinki) {
    throw new Error(`«Новинки» не найдены в published (slug=${NOVINKI_SLUG}).`);
  }
  if (!novinki.documentId) throw new Error('У «Новинок» отсутствует documentId.');

  const utsenka = await resolveUtsenka(app);
  const plan = buildReorderPlan(collections, novinki, utsenka?.record ?? null);
  const payload = buildPayload(category.id, plan.targetSortOrder);
  const alreadyConfigured =
    Boolean(utsenka) && !plan.needsReorder && isAlreadyConfigured(utsenka, category, plan.targetSortOrder);
  const needsWrite = !alreadyConfigured;
  const action = alreadyConfigured ? 'noop' : plan.action;

  const report = {
    categoryFound: true,
    categoryId: category.id,
    novinkiFound: true,
    novinkiSortOrder: sortOrderOf(novinki.sortOrder),
    utsenkaExists: Boolean(utsenka),
    utsenkaDocumentId: utsenka?.documentId ?? null,
    utsenkaPublished: Boolean(utsenka?.isPublished),
    action,
    currentSortOrder: plan.currentSortOrder,
    targetSortOrder: plan.targetSortOrder,
    shifts: plan.shifts,
    needsWrite,
    payload,
  };

  if (!options.writeEnabled) {
    printDryRun(report);
    return;
  }

  if (!needsWrite) {
    console.log('Подборка уже настроена, запись не требуется');
    const saved = await findPublishedByDocumentId(app, utsenka.documentId);
    assertUtsenkaResult(saved, category, plan.targetSortOrder);
    await assertSingleUtsenkaDocumentId(app, utsenka.documentId);
    printResult(saved);
    return;
  }

  // Транзакция: сдвиги + create/update + проверка. Document Service участвует через ALS.
  const writtenDocumentId = await app.db.transaction(async () => {
    if (plan.needsReorder && plan.shifts.length > 0) {
      await applyShifts(app, plan.shifts);
      console.log(`Сдвинуто подборок: ${plan.shifts.length}`);
    } else {
      console.log('Сдвиги sortOrder не требуются');
    }

    const data = writeData(payload, category.documentId);
    let documentId;

    if (plan.action === 'create') {
      const created = await app.documents(COLLECTION_UID).create({ data, status: 'published' });
      documentId = created?.documentId ?? null;
      if (!documentId) throw new Error('create «Уценка»: нет documentId в ответе.');
      console.log(`Создана «Уценка», documentId=${documentId}`);
    } else {
      documentId = utsenka?.documentId ?? null;
      if (!documentId) throw new Error('update «Уценка»: нет documentId.');
      await app.documents(COLLECTION_UID).update({ documentId, data, status: 'published' });
      console.log(`Обновлена «Уценка», documentId=${documentId}`);
    }

    const saved = await findPublishedByDocumentId(app, documentId);
    assertUtsenkaResult(saved, category, plan.targetSortOrder);
    await assertSingleUtsenkaDocumentId(app, documentId);
    return documentId;
  });

  const saved = await findPublishedByDocumentId(app, writtenDocumentId);
  assertUtsenkaResult(saved, category, plan.targetSortOrder);
  printResult(saved);
}

async function main() {
  let app = null;
  try {
    const options = parseArgs(process.argv.slice(2));
    const { createStrapi, compileStrapi } = require('@strapi/strapi');
    const appContext = await compileStrapi();
    app = await createStrapi(appContext).load();
    app.log.level = 'error';
    console.log(`mode: ${options.mode}`);
    await run(app, options);
  } catch (error) {
    console.error('');
    console.error(`Ошибка upsert «Уценка»: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    if (app) await app.destroy();
  }
  if (process.exitCode && process.exitCode !== 0) process.exit(process.exitCode);
}

main();
