'use strict';

/**
 * Локальный one-off backfill дат создания МойСклад.
 *
 * Заполняет:
 * - moysklad-variant.moyskladCreatedAt
 * - moysklad-product.moyskladCreatedAt (product + bundle)
 * - moysklad-product.moyskladNoveltyAt
 *
 * Не запускается из cron / webhook / bootstrap.
 * По умолчанию — dry-run (без записи). Для записи нужен --write.
 *
 * Примеры:
 *   npm run backfill:moysklad-novelty -- --limit=5
 *   npm run backfill:moysklad-novelty -- --write --limit=5
 *   npm run backfill:moysklad-novelty -- --write
 */

const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';
const VARIANT_UID = 'api::moysklad-variant.moysklad-variant';

const PAGE_SIZE = 200;
const PROGRESS_EVERY = 25;
const DEFAULT_CONCURRENCY = 2;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let dryRunFlag = false;
  let writeFlag = false;
  let limit = null;
  let concurrency = DEFAULT_CONCURRENCY;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRunFlag = true;
      continue;
    }

    if (arg === '--write') {
      writeFlag = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const raw = arg.slice('--limit='.length);
      const value = Number(raw);

      if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
        throw new Error(`Некорректный --limit=${raw}. Нужно целое число >= 1.`);
      }

      limit = value;
      continue;
    }

    if (arg.startsWith('--concurrency=')) {
      const raw = arg.slice('--concurrency='.length);
      const value = Number(raw);

      if (
        !Number.isFinite(value) ||
        !Number.isInteger(value) ||
        value < MIN_CONCURRENCY ||
        value > MAX_CONCURRENCY
      ) {
        throw new Error(
          `Некорректный --concurrency=${raw}. Допустимо от ${MIN_CONCURRENCY} до ${MAX_CONCURRENCY}.`,
        );
      }

      concurrency = value;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  if (dryRunFlag && writeFlag) {
    throw new Error('Нельзя одновременно передавать --dry-run и --write.');
  }

  // Без --write запись запрещена (поведение как dry-run)
  const writeEnabled = writeFlag === true;
  const mode = writeEnabled ? 'write' : 'dry-run';

  return { mode, writeEnabled, limit, concurrency };
}

function safeErrorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message.slice(0, 300);
  }

  return 'unknown error';
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function maxIsoDate(dates) {
  let best = null;
  let bestMs = null;

  for (const value of dates) {
    if (!isValidIsoDate(value)) {
      continue;
    }

    const ms = Date.parse(value);

    if (bestMs === null || ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }

  return best;
}

/**
 * Не уменьшаем уже сохранённую noveltyAt.
 * Возвращает дату для записи или null, если обновление не нужно.
 */
function resolveNoveltyUpdate(existingNoveltyAt, computedNoveltyAt) {
  if (!isValidIsoDate(computedNoveltyAt)) {
    return null;
  }

  if (!isValidIsoDate(existingNoveltyAt)) {
    return computedNoveltyAt;
  }

  const existingMs = Date.parse(existingNoveltyAt);
  const computedMs = Date.parse(computedNoveltyAt);

  if (computedMs > existingMs) {
    return computedNoveltyAt;
  }

  return null;
}

function formatMoyskladId(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Параллельность: простые группы
// ---------------------------------------------------------------------------

async function runInGroups(items, concurrency, worker) {
  for (let i = 0; i < items.length; i += concurrency) {
    const group = items.slice(i, i + concurrency);
    await Promise.all(group.map((item, groupIndex) => worker(item, i + groupIndex)));
  }
}

// ---------------------------------------------------------------------------
// Выборка ID страницами (без limit 100000)
// ---------------------------------------------------------------------------

async function collectIdsByNullCreatedAt(uid, maxLimit) {
  const ids = [];
  let offset = 0;

  while (true) {
    if (maxLimit !== null && ids.length >= maxLimit) {
      break;
    }

    const take =
      maxLimit !== null ? Math.min(PAGE_SIZE, maxLimit - ids.length) : PAGE_SIZE;

    const rows = await strapi.db.query(uid).findMany({
      where: {
        moyskladCreatedAt: { $null: true },
      },
      select: ['id'],
      orderBy: { id: 'asc' },
      limit: take,
      offset,
    });

    if (!Array.isArray(rows) || rows.length === 0) {
      break;
    }

    for (const row of rows) {
      ids.push(row.id);
    }

    offset += rows.length;

    if (rows.length < take) {
      break;
    }
  }

  return ids;
}

async function collectAllProductIds() {
  const ids = [];
  let offset = 0;

  while (true) {
    const rows = await strapi.db.query(PRODUCT_UID).findMany({
      select: ['id'],
      orderBy: { id: 'asc' },
      limit: PAGE_SIZE,
      offset,
    });

    if (!Array.isArray(rows) || rows.length === 0) {
      break;
    }

    for (const row of rows) {
      ids.push(row.id);
    }

    offset += rows.length;

    if (rows.length < PAGE_SIZE) {
      break;
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Основная логика
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('');
  console.log('Backfill дат создания МойСклад');
  console.log('------------------------------');
  console.log(`Режим: ${options.mode}`);
  console.log(`Concurrency: ${options.concurrency}`);
  console.log(`Лимит: ${options.limit === null ? 'без лимита' : options.limit}`);
  console.log('');

  const startedAt = Date.now();

  const stats = {
    variantsFound: 0,
    variantsResolved: 0,
    variantsUnresolved: 0,
    variantsErrors: 0,
    productsFound: 0,
    bundlesFound: 0,
    productsResolved: 0,
    bundlesResolved: 0,
    productsBundlesUnresolved: 0,
    productsBundlesErrors: 0,
    noveltyProductsCalculated: 0,
    noveltyBundlesCalculated: 0,
    dbUpdatesPlanned: 0,
    dbUpdates: 0,
  };

  // Даты, полученные в этом запуске (нужны для dry-run novelty и немедленного пересчёта)
  const variantCreatedOverlay = new Map(); // variantId -> iso
  const productCreatedOverlay = new Map(); // productId -> iso
  const variantParentByVariantId = new Map(); // variantId -> productId
  const affectedProductIds = new Set();

  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  let app = null;

  try {
    const appContext = await compileStrapi();

    // Helper компилируется вместе с приложением — берём из dist после compileStrapi
    const auditModulePath = path.join(
      __dirname,
      '..',
      'dist',
      'src',
      'utils',
      'moysklad-audit',
    );
    const { fetchMoySkladEntityCreatedAt } = require(auditModulePath);

    if (typeof fetchMoySkladEntityCreatedAt !== 'function') {
      throw new Error('Не удалось загрузить fetchMoySkladEntityCreatedAt из moysklad-audit');
    }

    app = await createStrapi(appContext).load();
    app.log.level = 'error';

    // ------------------------------------------------------------------
    // 1) Модификации без moyskladCreatedAt
    // ------------------------------------------------------------------

    const variantIds = await collectIdsByNullCreatedAt(VARIANT_UID, options.limit);
    stats.variantsFound = variantIds.length;

    console.log(`Найдено модификаций без даты: ${variantIds.length}`);

    let variantsProcessed = 0;

    await runInGroups(variantIds, options.concurrency, async (variantId) => {
      let moyskladIdForError = 'unknown';

      try {
        const variant = await strapi.db.query(VARIANT_UID).findOne({
          where: { id: variantId },
          select: ['id', 'moyskladId', 'moyskladCreatedAt'],
          populate: {
            product: {
              select: ['id', 'moyskladId', 'type'],
            },
          },
        });

        if (!variant) {
          stats.variantsUnresolved += 1;
          return;
        }

        moyskladIdForError = formatMoyskladId(variant.moyskladId);

        if (variant.product?.id) {
          affectedProductIds.add(variant.product.id);
          variantParentByVariantId.set(variant.id, variant.product.id);
        }

        // Уже заполнено другим процессом / повторный проход
        if (variant.moyskladCreatedAt) {
          if (isValidIsoDate(variant.moyskladCreatedAt)) {
            variantCreatedOverlay.set(variant.id, variant.moyskladCreatedAt);
          }
          return;
        }

        const moyskladId =
          typeof variant.moyskladId === 'string' ? variant.moyskladId.trim() : '';

        if (!moyskladId) {
          stats.variantsUnresolved += 1;
          console.log(`variant id=${variant.id}: пустой moyskladId — пропуск`);
          return;
        }

        moyskladIdForError = moyskladId;

        const createdAt = await fetchMoySkladEntityCreatedAt('variant', moyskladId);

        if (!isValidIsoDate(createdAt)) {
          stats.variantsUnresolved += 1;
          console.log(`variant ${moyskladId}: create moment не найден или невалиден`);
          return;
        }

        variantCreatedOverlay.set(variant.id, createdAt);
        stats.variantsResolved += 1;
        stats.dbUpdatesPlanned += 1;

        if (options.writeEnabled) {
          await strapi.db.query(VARIANT_UID).update({
            where: { id: variant.id },
            data: {
              moyskladCreatedAt: createdAt,
            },
          });
          stats.dbUpdates += 1;
        }
      } catch (error) {
        stats.variantsErrors += 1;
        console.log(
          `variant error moyskladId=${moyskladIdForError} strapiId=${variantId}: ${safeErrorMessage(error)}`,
        );
      } finally {
        variantsProcessed += 1;

        if (
          variantsProcessed % PROGRESS_EVERY === 0 ||
          variantsProcessed === variantIds.length
        ) {
          console.log(
            `Progress variants: ${variantsProcessed}/${variantIds.length}`,
          );
        }
      }
    });

    // ------------------------------------------------------------------
    // 2) Товары и комплекты без moyskladCreatedAt
    // ------------------------------------------------------------------

    const productIdsMissingCreatedAt = await collectIdsByNullCreatedAt(
      PRODUCT_UID,
      options.limit,
    );

    console.log(
      `Найдено товаров/комплектов без даты: ${productIdsMissingCreatedAt.length}`,
    );

    let productsProcessed = 0;

    await runInGroups(
      productIdsMissingCreatedAt,
      options.concurrency,
      async (productId) => {
        let moyskladIdForError = 'unknown';
        let entityKindForError = 'product';

        try {
          const product = await strapi.db.query(PRODUCT_UID).findOne({
            where: { id: productId },
            select: ['id', 'moyskladId', 'type', 'moyskladCreatedAt'],
          });

          if (!product) {
            stats.productsBundlesUnresolved += 1;
            return;
          }

          affectedProductIds.add(product.id);

          const entityKind = product.type === 'bundle' ? 'bundle' : 'product';
          entityKindForError = entityKind;
          moyskladIdForError = formatMoyskladId(product.moyskladId);

          if (entityKind === 'bundle') {
            stats.bundlesFound += 1;
          } else {
            stats.productsFound += 1;
          }

          if (product.moyskladCreatedAt) {
            if (isValidIsoDate(product.moyskladCreatedAt)) {
              productCreatedOverlay.set(product.id, product.moyskladCreatedAt);
            }
            return;
          }

          const moyskladId =
            typeof product.moyskladId === 'string' ? product.moyskladId.trim() : '';

          if (!moyskladId) {
            stats.productsBundlesUnresolved += 1;
            console.log(`${entityKind} id=${product.id}: пустой moyskladId — пропуск`);
            return;
          }

          moyskladIdForError = moyskladId;

          const createdAt = await fetchMoySkladEntityCreatedAt(entityKind, moyskladId);

          if (!isValidIsoDate(createdAt)) {
            stats.productsBundlesUnresolved += 1;
            console.log(
              `${entityKind} ${moyskladId}: create moment не найден или невалиден`,
            );
            return;
          }

          productCreatedOverlay.set(product.id, createdAt);

          if (entityKind === 'bundle') {
            stats.bundlesResolved += 1;
          } else {
            stats.productsResolved += 1;
          }

          stats.dbUpdatesPlanned += 1;

          if (options.writeEnabled) {
            await strapi.db.query(PRODUCT_UID).update({
              where: { id: product.id },
              data: {
                moyskladCreatedAt: createdAt,
              },
            });
            stats.dbUpdates += 1;
          }
        } catch (error) {
          stats.productsBundlesErrors += 1;
          console.log(
            `${entityKindForError} error moyskladId=${moyskladIdForError} strapiId=${productId}: ${safeErrorMessage(error)}`,
          );
        } finally {
          productsProcessed += 1;

          if (
            productsProcessed % PROGRESS_EVERY === 0 ||
            productsProcessed === productIdsMissingCreatedAt.length
          ) {
            console.log(
              `Progress products/bundles: ${productsProcessed}/${productIdsMissingCreatedAt.length}`,
            );
          }
        }
      },
    );

    // ------------------------------------------------------------------
    // 3) Пересчёт moyskladNoveltyAt
    //
    // Полный запуск: все карточки.
    // С --limit: все уникальные затронутые карточки из affectedProductIds.
    // ------------------------------------------------------------------

    console.log('');
    console.log('Пересчёт moyskladNoveltyAt...');

    // Собираем max(variant.createdAt) по parent product id
    const variantMaxByProductId = new Map();

    // 3a) Из overlay текущего запуска
    for (const [variantId, createdAt] of variantCreatedOverlay.entries()) {
      const parentId = variantParentByVariantId.get(variantId);
      if (!parentId || !isValidIsoDate(createdAt)) {
        continue;
      }

      const current = variantMaxByProductId.get(parentId) ?? null;
      variantMaxByProductId.set(parentId, maxIsoDate([current, createdAt]));
    }

    // 3b) Из БД — варианты, у которых дата уже есть
    {
      let offset = 0;

      while (true) {
        const rows = await strapi.db.query(VARIANT_UID).findMany({
          where: {
            moyskladCreatedAt: { $notNull: true },
          },
          select: ['id', 'moyskladCreatedAt'],
          populate: {
            product: {
              select: ['id'],
            },
          },
          orderBy: { id: 'asc' },
          limit: PAGE_SIZE,
          offset,
        });

        if (!Array.isArray(rows) || rows.length === 0) {
          break;
        }

        for (const row of rows) {
          const parentId = row.product?.id;
          if (!parentId) {
            continue;
          }

          // Overlay важнее БД для той же variant
          const createdAt = variantCreatedOverlay.has(row.id)
            ? variantCreatedOverlay.get(row.id)
            : row.moyskladCreatedAt;

          if (!isValidIsoDate(createdAt)) {
            continue;
          }

          const current = variantMaxByProductId.get(parentId) ?? null;
          variantMaxByProductId.set(parentId, maxIsoDate([current, createdAt]));
        }

        offset += rows.length;

        if (rows.length < PAGE_SIZE) {
          break;
        }
      }
    }

    const productIdsForNovelty =
      options.limit === null
        ? await collectAllProductIds()
        : Array.from(affectedProductIds).sort((a, b) => a - b);

    let noveltyProcessed = 0;

    await runInGroups(
      productIdsForNovelty,
      options.concurrency,
      async (productId) => {
        try {
          const product = await strapi.db.query(PRODUCT_UID).findOne({
            where: { id: productId },
            select: [
              'id',
              'type',
              'moyskladCreatedAt',
              'moyskladNoveltyAt',
            ],
          });

          if (!product) {
            return;
          }

          const entityKind = product.type === 'bundle' ? 'bundle' : 'product';

          const createdAt = productCreatedOverlay.has(product.id)
            ? productCreatedOverlay.get(product.id)
            : product.moyskladCreatedAt;

          let computedNoveltyAt = null;

          if (entityKind === 'bundle') {
            computedNoveltyAt = isValidIsoDate(createdAt) ? createdAt : null;
          } else {
            const variantMax = variantMaxByProductId.get(product.id) ?? null;
            computedNoveltyAt = maxIsoDate([createdAt, variantMax]);
          }

          if (!isValidIsoDate(computedNoveltyAt)) {
            return;
          }

          if (entityKind === 'bundle') {
            stats.noveltyBundlesCalculated += 1;
          } else {
            stats.noveltyProductsCalculated += 1;
          }

          const nextNoveltyAt = resolveNoveltyUpdate(
            product.moyskladNoveltyAt,
            computedNoveltyAt,
          );

          if (!nextNoveltyAt) {
            return;
          }

          stats.dbUpdatesPlanned += 1;

          if (options.writeEnabled) {
            await strapi.db.query(PRODUCT_UID).update({
              where: { id: product.id },
              data: {
                moyskladNoveltyAt: nextNoveltyAt,
              },
            });
            stats.dbUpdates += 1;
          }
        } catch (error) {
          console.log(
            `novelty error strapiId=${productId}: ${safeErrorMessage(error)}`,
          );
        } finally {
          noveltyProcessed += 1;

          if (
            noveltyProcessed % PROGRESS_EVERY === 0 ||
            noveltyProcessed === productIdsForNovelty.length
          ) {
            console.log(
              `Progress novelty: ${noveltyProcessed}/${productIdsForNovelty.length}`,
            );
          }
        }
      },
    );

    const elapsedMs = Date.now() - startedAt;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);

    console.log('');
    console.log('Итог backfill');
    console.log('-------------');
    console.log(`Режим: ${options.mode}`);
    console.log(`Concurrency: ${options.concurrency}`);
    console.log(`Лимит: ${options.limit === null ? 'без лимита' : options.limit}`);
    console.log(`Найдено модификаций без даты: ${stats.variantsFound}`);
    console.log(`Получено дат модификаций: ${stats.variantsResolved}`);
    console.log(`Не разрешено модификаций: ${stats.variantsUnresolved}`);
    console.log(`Ошибок модификаций: ${stats.variantsErrors}`);
    console.log(`Найдено товаров без даты: ${stats.productsFound}`);
    console.log(`Найдено комплектов без даты: ${stats.bundlesFound}`);
    console.log(`Получено дат товаров: ${stats.productsResolved}`);
    console.log(`Получено дат комплектов: ${stats.bundlesResolved}`);
    console.log(
      `Не разрешено товаров/комплектов: ${stats.productsBundlesUnresolved}`,
    );
    console.log(`Ошибок товаров/комплектов: ${stats.productsBundlesErrors}`);
    console.log(
      `Карточек product с рассчитанным noveltyAt: ${stats.noveltyProductsCalculated}`,
    );
    console.log(
      `Карточек bundle с рассчитанным noveltyAt: ${stats.noveltyBundlesCalculated}`,
    );
    console.log(`Запланировано обновлений базы: ${stats.dbUpdatesPlanned}`);
    console.log(`Фактически выполнено обновлений базы: ${stats.dbUpdates}`);
    console.log(`Общее время выполнения: ${elapsedSec} сек`);
    console.log('');

    if (!options.writeEnabled) {
      console.log('Dry-run завершён. Записи в базу не было.');
      console.log('Для записи добавьте флаг --write.');
    }
  } finally {
    if (app) {
      await app.destroy();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
