'use strict';

/**
 * Изолированный импорт ОДНОГО товара из папки Sample Sale.
 *
 * По умолчанию — dry-run (только чтение).
 * Запись в Strapi только с --write.
 *
 * Поведение:
 * - новый товар + stock > 0 → syncOneFromWebhook + moyskladStock/isOutOfStock;
 * - существующий товар → только moyskladStock/isOutOfStock (без полной синхронизации);
 * - новый товар + stock <= 0/null → skip до любых записей.
 *
 * Примеры:
 *   node ./scripts/import-sample-sale-product.js --ms-id=<UUID>
 *   node ./scripts/import-sample-sale-product.js --ms-id=<UUID> --write
 */

const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const CATEGORY_UID = 'api::moysklad-category.moysklad-category';

// UUID-подобный ID МойСклад (не строгий RFC4122 version/variant).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CREATE_SYNC_FIELDS = [
  'type',
  'name',
  'displayTitle',
  'description',
  'moyskladId',
  'href',
  'code',
  'updated',
  'category',
  'price',
  'priceOld',
  'uom',
  'weight',
  'volume',
  'publishedAt',
  'slug',
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let msId = null;
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

    if (arg.startsWith('--ms-id=')) {
      msId = arg.slice('--ms-id='.length).trim();
      continue;
    }

    throw new Error(`Неизвестный аргумент: ${arg}`);
  }

  if (!msId) {
    throw new Error('Обязателен аргумент --ms-id=<UUID>');
  }

  if (!UUID_RE.test(msId)) {
    throw new Error(`Некорректный --ms-id=${msId}. Ожидается UUID.`);
  }

  if (dryRunFlag && writeFlag) {
    throw new Error('Нельзя одновременно передавать --dry-run и --write.');
  }

  const writeEnabled = writeFlag === true;

  return {
    msId,
    writeEnabled,
    mode: writeEnabled ? 'write' : 'dry-run',
  };
}

function safeErrorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message.slice(0, 300);
  }

  return 'unknown error';
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function sortIds(ids) {
  return [...ids].map(String).sort((a, b) => a.localeCompare(b));
}

function sameIdLists(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

function pickIdFromHref(href) {
  if (typeof href !== 'string' || !href) {
    return null;
  }

  const clean = href.split('?')[0]?.split('#')[0];
  if (!clean) {
    return null;
  }

  const parts = clean.split('/');
  const last = parts[parts.length - 1];

  return last ? last : null;
}

// ---------------------------------------------------------------------------
// Strapi snapshots
// ---------------------------------------------------------------------------

function emptyProductSnapshot() {
  return {
    exists: false,
    id: null,
    moyskladId: null,
    slug: null,
    description: null,
    displayTitle: null,
    isHiddenOnSite: null,
    categoryId: null,
    imageCount: 0,
    imageIds: [],
    badgeAssignmentIds: [],
    badgeIds: [],
  };
}

async function loadProductSnapshot(app, moyskladId) {
  const row = await app.db.query(PRODUCT_UID).findOne({
    where: { moyskladId },
    select: [
      'id',
      'moyskladId',
      'slug',
      'description',
      'displayTitle',
      'isHiddenOnSite',
    ],
    populate: {
      image: { select: ['id'] },
      category: { select: ['id'] },
      // Компонент badges: id назначения + relation badge.id
      badges: {
        populate: {
          badge: {
            select: ['id'],
          },
        },
      },
    },
  });

  if (!row) {
    return emptyProductSnapshot();
  }

  const images = Array.isArray(row.image) ? row.image : [];
  const imageIds = sortIds(
    images
      .map((image) => image?.id)
      .filter((id) => id !== null && id !== undefined),
  );

  const badges = Array.isArray(row.badges) ? row.badges : [];
  const badgeAssignmentIds = sortIds(
    badges
      .map((assignment) => assignment?.id)
      .filter((id) => id !== null && id !== undefined),
  );
  const badgeIds = sortIds(
    badges
      .map((assignment) => assignment?.badge?.id)
      .filter((id) => id !== null && id !== undefined),
  );

  return {
    exists: true,
    id: row.id,
    moyskladId: row.moyskladId ?? null,
    slug: row.slug ?? null,
    description: row.description ?? null,
    displayTitle: row.displayTitle ?? null,
    isHiddenOnSite: row.isHiddenOnSite ?? null,
    categoryId: row.category?.id ?? null,
    imageCount: imageIds.length,
    imageIds,
    badgeAssignmentIds,
    badgeIds,
  };
}

function compareManualFields(before, after) {
  const imageIdsUnchanged = sameIdLists(before.imageIds, after.imageIds);
  const badgesUnchanged =
    sameIdLists(before.badgeAssignmentIds, after.badgeAssignmentIds) &&
    sameIdLists(before.badgeIds, after.badgeIds);
  const isHiddenOnSiteUnchanged = before.isHiddenOnSite === after.isHiddenOnSite;
  const slugUnchanged = before.slug === after.slug;
  const categoryUnchanged = before.categoryId === after.categoryId;
  const descriptionUnchanged = before.description === after.description;
  const displayTitleUnchanged = before.displayTitle === after.displayTitle;

  return {
    imageIdsUnchanged,
    badgesUnchanged,
    isHiddenOnSiteUnchanged,
    slugUnchanged,
    categoryUnchanged,
    descriptionUnchanged,
    displayTitleUnchanged,
  };
}

async function findSampleSaleCategory(app, folderId) {
  return app.db.query(CATEGORY_UID).findOne({
    where: { moyskladId: folderId },
    select: ['id', 'moyskladId', 'name', 'slug', 'isHiddenInMenu'],
  });
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function buildPlan(assortmentItem, existingProduct) {
  const stock = assortmentItem.stock;
  const isOutOfStock = stock === null || stock <= 0;
  const exists = existingProduct.exists === true;

  if (!exists && (stock === null || stock <= 0)) {
    return {
      action: 'skip',
      reason:
        stock === null
          ? 'new product with null stock — create forbidden'
          : `new product with stock=${stock} — create forbidden`,
      plannedIsOutOfStock: null,
      fieldsToWrite: [],
      existingProductFullSync: false,
    };
  }

  if (!exists && stock > 0) {
    return {
      action: 'create',
      reason: 'new product with stock > 0',
      plannedIsOutOfStock: false,
      fieldsToWrite: [...CREATE_SYNC_FIELDS, 'moyskladStock', 'isOutOfStock'],
      existingProductFullSync: false,
    };
  }

  return {
    action: 'update',
    reason: isOutOfStock
      ? 'existing product — stock fields only, mark out of stock'
      : 'existing product — stock fields only, mark in stock',
    plannedIsOutOfStock: isOutOfStock,
    fieldsToWrite: ['moyskladStock', 'isOutOfStock'],
    existingProductFullSync: false,
  };
}

function printDryRunReport(params) {
  const { msId, assortmentItem, categoryExists, productExists, plan } = params;

  console.log('');
  console.log('=== Sample Sale single-product import ===');
  console.log('mode: dry-run');
  console.log(`moyskladId: ${msId}`);
  console.log(`name: ${assortmentItem.name ?? '(no name)'}`);
  console.log(`folderId: ${assortmentItem.productFolderId}`);
  console.log(`type: ${assortmentItem.type}`);
  console.log(`archived: ${String(assortmentItem.archived)}`);
  console.log(`stock: ${String(assortmentItem.stock)}`);
  console.log(`quantity: ${String(assortmentItem.quantity)}`);
  console.log(`reserve: ${String(assortmentItem.reserve)}`);
  console.log(`existing category: ${yesNo(categoryExists)}`);
  console.log(`existing product: ${yesNo(productExists)}`);
  console.log(`planned action: ${plan.action}`);
  console.log(`planned isOutOfStock: ${String(plan.plannedIsOutOfStock)}`);
  console.log(`plan reason: ${plan.reason}`);
  console.log(
    `fields to write: ${plan.fieldsToWrite.length > 0 ? plan.fieldsToWrite.join(', ') : '(none)'}`,
  );
  console.log(`existing product full sync: ${yesNo(plan.existingProductFullSync)}`);
  console.log('image in update payload: no');
  console.log('badges in update payload: no');
  console.log('isHiddenOnSite in update payload: no');
  console.log('');
}

function printWriteReport(params) {
  const {
    categoryStatus,
    productStatus,
    productId,
    moyskladStock,
    isOutOfStock,
    before,
    after,
    checks,
    success,
  } = params;

  console.log('');
  console.log('=== Sample Sale single-product import ===');
  console.log('mode: write');
  console.log(`category: ${categoryStatus}`);
  console.log(`product: ${productStatus}`);
  console.log(`Strapi product id: ${productId ?? '(none)'}`);
  console.log(`moyskladStock: ${String(moyskladStock)}`);
  console.log(`isOutOfStock: ${String(isOutOfStock)}`);
  console.log(`image count before: ${before.imageCount}`);
  console.log(`image count after: ${after.imageCount}`);
  console.log(`image IDs unchanged: ${yesNo(checks.imageIdsUnchanged)}`);
  console.log(`badges unchanged: ${yesNo(checks.badgesUnchanged)}`);
  console.log(`isHiddenOnSite unchanged: ${yesNo(checks.isHiddenOnSiteUnchanged)}`);
  console.log(`slug unchanged: ${yesNo(checks.slugUnchanged)}`);
  console.log(`category unchanged: ${yesNo(checks.categoryUnchanged)}`);
  console.log(`description unchanged: ${yesNo(checks.descriptionUnchanged)}`);
  console.log(`displayTitle unchanged: ${yesNo(checks.displayTitleUnchanged)}`);
  console.log(`result: ${success ? 'success' : 'error'}`);
  console.log('');
}

function allManualChecksPassed(checks) {
  return (
    checks.imageIdsUnchanged &&
    checks.badgesUnchanged &&
    checks.isHiddenOnSiteUnchanged &&
    checks.slugUnchanged &&
    checks.categoryUnchanged &&
    checks.descriptionUnchanged &&
    checks.displayTitleUnchanged
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertAssortmentItemValid(item, msId, folderId) {
  if (!item) {
    throw new Error(
      `Товар ${msId} не найден в ассортименте Sample Sale (filter by folder id).`,
    );
  }

  if (item.moyskladId !== msId) {
    throw new Error(`moyskladId mismatch: expected ${msId}, got ${item.moyskladId}`);
  }

  if (item.productFolderId !== folderId) {
    throw new Error(
      `productFolderId mismatch: expected ${folderId}, got ${String(item.productFolderId)}`,
    );
  }

  if (item.type !== 'product') {
    throw new Error(`Ожидался type=product, получено type=${String(item.type)}`);
  }

  if (item.archived === true) {
    throw new Error(`Товар ${msId} archived=true — импорт запрещён`);
  }
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

async function ensureSampleSaleCategory(app, sampleSale) {
  const existing = await findSampleSaleCategory(app, sampleSale.SAMPLE_SALE_FOLDER_ID);

  if (existing) {
    return { category: existing, status: 'existing' };
  }

  const folder = await sampleSale.fetchSampleSaleFolder();

  // Точечный upsert категории через существующий сервис (без полного sync).
  // Родитель «Товары интернет-магазинов» не создаётся: его нет в Strapi → parent не ставится.
  await app.service('api::moysklad-category.moysklad-category').syncOneFromWebhook(folder);

  const created = await findSampleSaleCategory(app, sampleSale.SAMPLE_SALE_FOLDER_ID);

  if (!created) {
    throw new Error('Категория Sample Sale не появилась после syncOneFromWebhook');
  }

  // Скрыть из меню — отдельное ручное поле, sync его не трогает.
  if (created.isHiddenInMenu !== true) {
    await app.db.query(CATEGORY_UID).update({
      where: { id: created.id },
      data: { isHiddenInMenu: true },
    });
  }

  const refreshed = await findSampleSaleCategory(app, sampleSale.SAMPLE_SALE_FOLDER_ID);

  return { category: refreshed ?? created, status: 'created' };
}

async function writeStockFields(app, productId, stock, isOutOfStock) {
  // Только системные поля остатка. Ручные поля не передаём.
  await app.db.query(PRODUCT_UID).update({
    where: { id: productId },
    data: {
      moyskladStock: stock,
      isOutOfStock,
    },
  });
}

async function createNewProduct(app, sampleSale, msId, folderId, stock) {
  const { category, status: categoryStatus } = await ensureSampleSaleCategory(app, sampleSale);

  if (!category) {
    throw new Error('Категория Sample Sale отсутствует и не была создана');
  }

  console.log('Загрузка полного product из МойСклад...');
  const productEntity = await sampleSale.fetchMoySkladProductEntity(msId);
  const entityFolderId = pickIdFromHref(productEntity.productFolder?.meta?.href);

  if (entityFolderId !== folderId) {
    throw new Error(
      `product entity folder mismatch: expected ${folderId}, got ${String(entityFolderId)}`,
    );
  }

  // Полный точечный create только для нового товара.
  await app.service('api::moysklad-product.moysklad-product').syncOneFromWebhook(productEntity);

  const afterSync = await loadProductSnapshot(app, msId);

  if (!afterSync.exists || !afterSync.id) {
    throw new Error(`Товар ${msId} не найден в Strapi после syncOneFromWebhook`);
  }

  await writeStockFields(app, afterSync.id, stock, false);

  return { categoryStatus, productId: afterSync.id };
}

async function updateExistingStockOnly(app, productId, stock, isOutOfStock) {
  await writeStockFields(app, productId, stock, isOutOfStock);
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function run(app, options, sampleSale) {
  const { msId, writeEnabled, mode } = options;
  const folderId = sampleSale.SAMPLE_SALE_FOLDER_ID;

  console.log(`mode: ${mode}`);
  console.log(`ms-id: ${msId}`);
  console.log('Загрузка товара из ассортимента Sample Sale...');

  const assortmentItem = await sampleSale.fetchSampleSaleAssortmentItemById(msId);
  assertAssortmentItemValid(assortmentItem, msId, folderId);

  const before = await loadProductSnapshot(app, msId);
  const categoryBefore = await findSampleSaleCategory(app, folderId);
  const plan = buildPlan(assortmentItem, before);

  if (!writeEnabled) {
    printDryRunReport({
      msId,
      assortmentItem,
      categoryExists: Boolean(categoryBefore),
      productExists: before.exists,
      plan,
    });

    if (plan.action === 'skip') {
      console.log('category plan: not-created (skip before any writes)');
    } else if (!categoryBefore) {
      console.log('category plan: will create Sample Sale category with isHiddenInMenu=true');
    } else {
      console.log('category plan: reuse existing (no overwrite of manual fields)');
    }

    console.log('');
    return;
  }

  // ---- write mode ----
  // SKIP до любых записей: не создаём категорию и не трогаем товар.
  if (plan.action === 'skip') {
    const emptyChecks = {
      imageIdsUnchanged: true,
      badgesUnchanged: true,
      isHiddenOnSiteUnchanged: true,
      slugUnchanged: true,
      categoryUnchanged: true,
      descriptionUnchanged: true,
      displayTitleUnchanged: true,
    };

    printWriteReport({
      categoryStatus: 'not-created',
      productStatus: 'skipped',
      productId: null,
      moyskladStock: assortmentItem.stock,
      isOutOfStock: plan.plannedIsOutOfStock,
      before,
      after: before,
      checks: emptyChecks,
      success: true,
    });
    console.log(`skip reason: ${plan.reason}`);
    return;
  }

  const plannedIsOutOfStock = sampleSale.resolveSampleSaleIsOutOfStock(assortmentItem.stock);

  if (plan.action === 'update') {
    // Существующий товар: только остатки, без syncOneFromWebhook и без GET product entity.
    if (!before.id) {
      throw new Error(`Неожиданно: update без Strapi id для ${msId}`);
    }

    await updateExistingStockOnly(
      app,
      before.id,
      assortmentItem.stock,
      plannedIsOutOfStock,
    );

    const after = await loadProductSnapshot(app, msId);
    const checks = compareManualFields(before, after);
    const success = allManualChecksPassed(checks);

    printWriteReport({
      categoryStatus: categoryBefore ? 'existing' : 'not-created',
      productStatus: 'updated',
      productId: after.id,
      moyskladStock: assortmentItem.stock,
      isOutOfStock: plannedIsOutOfStock,
      before,
      after,
      checks,
      success,
    });

    if (!success) {
      console.error('Ошибка: неожиданное изменение ручных полей после update остатков.');
      console.error(`image IDs before: ${before.imageIds.join(',') || '(none)'}`);
      console.error(`image IDs after: ${after.imageIds.join(',') || '(none)'}`);
      console.error(
        `badge assignment IDs before: ${before.badgeAssignmentIds.join(',') || '(none)'}`,
      );
      console.error(
        `badge assignment IDs after: ${after.badgeAssignmentIds.join(',') || '(none)'}`,
      );
      console.error(`badge IDs before: ${before.badgeIds.join(',') || '(none)'}`);
      console.error(`badge IDs after: ${after.badgeIds.join(',') || '(none)'}`);
      process.exitCode = 1;
    }

    return;
  }

  // create: категория → GET product → syncOneFromWebhook → stock fields
  const { categoryStatus, productId } = await createNewProduct(
    app,
    sampleSale,
    msId,
    folderId,
    assortmentItem.stock,
  );

  const after = await loadProductSnapshot(app, msId);

  // Для create ручные поля появляются впервые — контролируем, что image/badges пусты
  // и не появились лишние media-связи из синка.
  const checks = {
    imageIdsUnchanged: sameIdLists(before.imageIds, after.imageIds),
    badgesUnchanged:
      sameIdLists(before.badgeAssignmentIds, after.badgeAssignmentIds) &&
      sameIdLists(before.badgeIds, after.badgeIds),
    isHiddenOnSiteUnchanged: true,
    slugUnchanged: true,
    categoryUnchanged: true,
    descriptionUnchanged: true,
    displayTitleUnchanged: true,
  };

  const success = checks.imageIdsUnchanged && checks.badgesUnchanged;

  printWriteReport({
    categoryStatus,
    productStatus: 'created',
    productId: productId ?? after.id,
    moyskladStock: assortmentItem.stock,
    isOutOfStock: false,
    before,
    after,
    checks,
    success,
  });

  if (!success) {
    console.error('Ошибка: неожиданные image/badges после create.');
    console.error(`image IDs after: ${after.imageIds.join(',') || '(none)'}`);
    console.error(`badge IDs after: ${after.badgeIds.join(',') || '(none)'}`);
    process.exitCode = 1;
  }
}

async function main() {
  let app = null;

  try {
    // parseArgs до загрузки Strapi — ошибка CLI не поднимает приложение.
    const options = parseArgs(process.argv.slice(2));
    const { createStrapi, compileStrapi } = require('@strapi/strapi');

    const appContext = await compileStrapi();

    const utilPath = path.join(__dirname, '..', 'dist', 'src', 'utils', 'moysklad-sample-sale');
    const sampleSale = require(utilPath);

    if (typeof sampleSale.fetchSampleSaleAssortmentItemById !== 'function') {
      throw new Error('Не удалось загрузить fetchSampleSaleAssortmentItemById');
    }

    if (typeof sampleSale.fetchSampleSaleFolder !== 'function') {
      throw new Error('Не удалось загрузить fetchSampleSaleFolder');
    }

    if (typeof sampleSale.fetchMoySkladProductEntity !== 'function') {
      throw new Error('Не удалось загрузить fetchMoySkladProductEntity');
    }

    if (typeof sampleSale.resolveSampleSaleIsOutOfStock !== 'function') {
      throw new Error('Не удалось загрузить resolveSampleSaleIsOutOfStock');
    }

    // load() без listen/start — HTTP-сервер не запускается.
    app = await createStrapi(appContext).load();
    app.log.level = 'error';

    await run(app, options, sampleSale);
  } catch (error) {
    console.error(`Ошибка: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    if (app) {
      await app.destroy();
    }
  }
}

main().catch((error) => {
  console.error(`Ошибка завершения: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
