'use strict';

/**
 * Только читающий аудит остатков папки Sample Sale в МойСклад.
 *
 * — не пишет в МойСклад;
 * — не подключается к базе Strapi;
 * — не создаёт / не обновляет / не удаляет товары;
 * — не запускает основную синхронизацию.
 *
 * Запуск из каталога backend:
 *   node ./scripts/audit-sample-sale-stock.js
 *
 * Нужна переменная окружения MOYSKLAD_ACCESS_TOKEN.
 */

const path = require('path');

function safeErrorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message.slice(0, 300);
  }

  return 'unknown error';
}

function countBy(items, predicate) {
  let count = 0;

  for (const item of items) {
    if (predicate(item)) {
      count += 1;
    }
  }

  return count;
}

function buildTypeCounts(items) {
  const counts = {
    product: 0,
    bundle: 0,
    variant: 0,
    other: 0,
  };

  for (const item of items) {
    if (item.type === 'product') {
      counts.product += 1;
    } else if (item.type === 'bundle') {
      counts.bundle += 1;
    } else if (item.type === 'variant') {
      counts.variant += 1;
    } else {
      counts.other += 1;
    }
  }

  return counts;
}

function buildMoyskladIdStats(items) {
  const seen = new Map();

  for (const item of items) {
    seen.set(item.moyskladId, (seen.get(item.moyskladId) ?? 0) + 1);
  }

  let duplicates = 0;

  for (const count of seen.values()) {
    if (count > 1) {
      duplicates += count - 1;
    }
  }

  return {
    uniqueIds: seen.size,
    duplicateIds: duplicates,
  };
}

function printReport(folderId, items) {
  const typeCounts = buildTypeCounts(items);
  const idStats = buildMoyskladIdStats(items);

  const stockGt0 = countBy(items, (item) => item.stock !== null && item.stock > 0);
  const stockEq0 = countBy(items, (item) => item.stock !== null && item.stock === 0);
  const stockLt0 = countBy(items, (item) => item.stock !== null && item.stock < 0);
  const stockNull = countBy(items, (item) => item.stock === null);

  const quantityGt0 = countBy(items, (item) => item.quantity !== null && item.quantity > 0);
  const quantityEq0 = countBy(items, (item) => item.quantity !== null && item.quantity === 0);
  const quantityLt0 = countBy(items, (item) => item.quantity !== null && item.quantity < 0);
  const quantityNull = countBy(items, (item) => item.quantity === null);

  const archivedTrue = countBy(items, (item) => item.archived === true);
  const variantsCountGt0 = countBy(
    items,
    (item) => item.variantsCount !== null && item.variantsCount > 0,
  );
  const imagesCountGt0 = countBy(
    items,
    (item) => item.imagesCount !== null && item.imagesCount > 0,
  );

  console.log('');
  console.log('=== Sample Sale stock audit ===');
  console.log(`folderId: ${folderId}`);
  console.log(`total: ${items.length}`);
  console.log(`product: ${typeCounts.product}`);
  console.log(`bundle: ${typeCounts.bundle}`);
  console.log(`variant: ${typeCounts.variant}`);
  console.log(`other types: ${typeCounts.other}`);
  console.log(`stock > 0: ${stockGt0}`);
  console.log(`stock = 0: ${stockEq0}`);
  console.log(`stock < 0: ${stockLt0}`);
  console.log(`stock null/missing: ${stockNull}`);
  console.log(`quantity > 0: ${quantityGt0}`);
  console.log(`quantity = 0: ${quantityEq0}`);
  console.log(`quantity < 0: ${quantityLt0}`);
  console.log(`quantity null/missing: ${quantityNull}`);
  console.log(`archived = true: ${archivedTrue}`);
  console.log(`variantsCount > 0: ${variantsCountGt0}`);
  console.log(`imagesCount > 0: ${imagesCountGt0}`);
  console.log(`unique moyskladId: ${idStats.uniqueIds}`);
  console.log(`duplicate moyskladId rows: ${idStats.duplicateIds}`);
  console.log('');
  console.log('First 10 items with stock > 0:');

  const firstInStock = items.filter((item) => item.stock !== null && item.stock > 0).slice(0, 10);

  if (firstInStock.length === 0) {
    console.log('(none)');
  } else {
    for (const item of firstInStock) {
      console.log(
        `- ${item.moyskladId} | ${item.name ?? '(no name)'} | stock=${item.stock} | quantity=${item.quantity} | reserve=${item.reserve}`,
      );
    }
  }

  console.log('');
}

async function main() {
  // compileStrapi компилирует TS-утилиты в dist без createStrapi().load(),
  // поэтому к базе Strapi не подключаемся.
  const { compileStrapi } = require('@strapi/strapi');

  await compileStrapi();

  const modulePath = path.join(
    __dirname,
    '..',
    'dist',
    'src',
    'utils',
    'moysklad-sample-sale',
  );

  const sampleSaleModule = require(modulePath);
  const { SAMPLE_SALE_FOLDER_ID, fetchSampleSaleAssortment } = sampleSaleModule;

  if (typeof fetchSampleSaleAssortment !== 'function') {
    throw new Error('Не удалось загрузить fetchSampleSaleAssortment из moysklad-sample-sale');
  }

  if (typeof SAMPLE_SALE_FOLDER_ID !== 'string' || !SAMPLE_SALE_FOLDER_ID) {
    throw new Error('Не удалось загрузить SAMPLE_SALE_FOLDER_ID из moysklad-sample-sale');
  }

  console.log('Загрузка ассортимента Sample Sale из МойСклад...');
  const items = await fetchSampleSaleAssortment();
  printReport(SAMPLE_SALE_FOLDER_ID, items);
}

main().catch((error) => {
  console.error(`Ошибка: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
