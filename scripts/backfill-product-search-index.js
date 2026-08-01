'use strict';

/**
 * Локальный one-off backfill поискового индекса parent product.
 *
 * Заполняет:
 * - moysklad-product.searchText
 * - moysklad-product.searchCodes
 *
 * Не запускается из cron / webhook / bootstrap.
 * По умолчанию — dry-run (без записи). Для записи нужен --write.
 *
 * Примеры:
 *   npm run backfill:product-search-index
 *   npm run backfill:product-search-index -- --dry-run --limit=5
 *   npm run backfill:product-search-index -- --write --limit=5
 *   npm run backfill:product-search-index -- --write
 */

const path = require('path');

const PRODUCT_UID = 'api::moysklad-product.moysklad-product';

const DEFAULT_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 200;
const MAX_CHANGED_EXAMPLES = 5;
const SEARCH_TEXT_PREVIEW_LENGTH = 120;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let dryRunFlag = false;
  let writeFlag = false;
  let limit = null;
  let batchSize = DEFAULT_BATCH_SIZE;

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

    if (arg.startsWith('--batch-size=')) {
      const raw = arg.slice('--batch-size='.length);
      const value = Number(raw);

      if (
        !Number.isFinite(value) ||
        !Number.isInteger(value) ||
        value < MIN_BATCH_SIZE ||
        value > MAX_BATCH_SIZE
      ) {
        throw new Error(
          `Некорректный --batch-size=${raw}. Допустимо от ${MIN_BATCH_SIZE} до ${MAX_BATCH_SIZE}.`,
        );
      }

      batchSize = value;
      continue;
    }

    throw new Error(`Неизвестный аргумент: ${arg}`);
  }

  if (dryRunFlag && writeFlag) {
    throw new Error('Нельзя одновременно передавать --dry-run и --write.');
  }

  const writeEnabled = writeFlag === true;
  const mode = writeEnabled ? 'write' : 'dry-run';

  return { mode, writeEnabled, limit, batchSize };
}

function safeErrorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message.slice(0, 300);
  }

  return 'unknown error';
}

function truncate(value, maxLength = SEARCH_TEXT_PREVIEW_LENGTH) {
  const text = typeof value === 'string' ? value : String(value ?? '');

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}…`;
}

function formatProductName(product) {
  if (typeof product?.name === 'string' && product.name.trim()) {
    return product.name.trim();
  }

  return '(без названия)';
}

function formatLimit(limit) {
  return limit === null ? 'all' : String(limit);
}

// ---------------------------------------------------------------------------
// Основная логика
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('');
  console.log(`Режим: ${options.writeEnabled ? 'WRITE' : 'DRY-RUN'}`);
  console.log(`Batch size: ${options.batchSize}`);
  console.log(`Limit: ${formatLimit(options.limit)}`);
  console.log('');

  const stats = {
    scanned: 0,
    changed: 0,
    unchanged: 0,
    written: 0,
    failed: 0,
  };

  const changedExamples = [];

  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  let app = null;

  try {
    const appContext = await compileStrapi();

    const utilPath = path.join(__dirname, '..', 'dist', 'src', 'utils', 'product-search-index');
    const { buildProductSearchFields } = require(utilPath);

    if (typeof buildProductSearchFields !== 'function') {
      throw new Error('Не удалось загрузить buildProductSearchFields из product-search-index');
    }

    app = await createStrapi(appContext).load();
    app.log.level = 'error';

    let offset = 0;

    while (true) {
      if (options.limit !== null && stats.scanned >= options.limit) {
        break;
      }

      const remaining =
        options.limit === null ? options.batchSize : options.limit - stats.scanned;

      const currentBatchSize = Math.min(options.batchSize, remaining);

      if (currentBatchSize <= 0) {
        break;
      }

      const rows = await app.db.query(PRODUCT_UID).findMany({
        select: ['id', 'name', 'code', 'type', 'searchText', 'searchCodes'],
        populate: {
          variants: {
            select: ['id', 'name', 'code'],
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { id: 'asc' },
        limit: currentBatchSize,
        offset,
      });

      if (!Array.isArray(rows) || rows.length === 0) {
        break;
      }

      for (const product of rows) {
        if (options.limit !== null && stats.scanned >= options.limit) {
          break;
        }

        try {
          stats.scanned += 1;

          const next = buildProductSearchFields({
            name: product.name,
            code: product.code,
            variants: (product.variants ?? []).map((variant) => ({
              name: variant.name,
              code: variant.code,
            })),
          });

          const currentSearchText = product.searchText ?? '';
          const currentSearchCodes = product.searchCodes ?? '';

          if (
            currentSearchText === next.searchText &&
            currentSearchCodes === next.searchCodes
          ) {
            stats.unchanged += 1;
            continue;
          }

          stats.changed += 1;

          if (changedExamples.length < MAX_CHANGED_EXAMPLES) {
            changedExamples.push({
              id: product.id,
              type: product.type ?? null,
              name: formatProductName(product),
              code: product.code ?? null,
              oldSearchText: currentSearchText,
              newSearchText: next.searchText,
              oldSearchCodes: currentSearchCodes,
              newSearchCodes: next.searchCodes,
            });
          }

          if (options.writeEnabled) {
            await app.db.query(PRODUCT_UID).update({
              where: { id: product.id },
              data: {
                searchText: next.searchText,
                searchCodes: next.searchCodes,
              },
            });

            stats.written += 1;
          }
        } catch (error) {
          stats.failed += 1;
          console.log(
            `Ошибка товара id=${product?.id ?? 'unknown'} name=${formatProductName(product)}: ${safeErrorMessage(error)}`,
          );
        }
      }

      offset += rows.length;
      console.log(`Обработано: ${stats.scanned}`);

      if (rows.length < currentBatchSize) {
        break;
      }

      if (options.limit !== null && stats.scanned >= options.limit) {
        break;
      }
    }

    console.log('');
    console.log('Итог backfill');
    console.log('-------------');
    console.log(`scanned: ${stats.scanned}`);
    console.log(`changed: ${stats.changed}`);
    console.log(`unchanged: ${stats.unchanged}`);
    console.log(`written: ${stats.written}`);
    console.log(`failed: ${stats.failed}`);
    console.log('');

    if (changedExamples.length > 0) {
      console.log(`Примеры изменений (первые ${changedExamples.length})`);
      console.log('-----------------------------------------------');

      for (const example of changedExamples) {
        console.log('');
        console.log(`id: ${example.id}`);
        console.log(`type: ${example.type ?? '(unknown)'}`);
        console.log(`name: ${example.name}`);
        console.log(`code: ${example.code ?? '(null)'}`);
        console.log(`старый searchText: ${truncate(example.oldSearchText)}`);
        console.log(`новый searchText: ${truncate(example.newSearchText)}`);
        console.log(`старый searchCodes: ${example.oldSearchCodes || '(пусто)'}`);
        console.log(`новый searchCodes: ${example.newSearchCodes || '(пусто)'}`);
      }

      console.log('');
    }

    if (!options.writeEnabled) {
      console.log('Изменения в базу не записывались.');
      console.log('Для записи используйте --write.');
    } else {
      console.log('Запись завершена.');
    }

    if (stats.failed > 0) {
      process.exitCode = 1;
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
