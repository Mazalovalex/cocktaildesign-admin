'use strict';

// Обновляет подписи Content Manager. По умолчанию только показывает изменения.

const fs = require('fs');

const MODELS = [
  {
    kind: 'content-type',
    uid: 'api::catalog-collection.catalog-collection',
    fields: {
      selectionMode: {
        label: 'Режим подборки',
        description:
          'Выберите, откуда брать товары: вручную, из категории, со скидкой или из новинок.',
      },
      noveltyDays: {
        label: 'Период новинок на сайте',
        description: 'Укажите срок в днях. Например: 100.',
      },
      noveltyBadgeColor: {
        label: 'Цвет бейджа «Новинка»',
        description: 'Укажите HEX-код. Например: #2EAE4A.',
      },
      products: {
        label: 'Товары',
        description: 'Добавьте товары вручную.',
      },
      sourceCategory: {
        label: 'Категория',
        description: 'Выберите категорию-источник.',
      },
    },
  },
  {
    kind: 'content-type',
    uid: 'api::moysklad-product.moysklad-product',
    fields: {
      searchText: {
        label: 'Поисковый текст',
        description: 'Заполняется автоматически.',
        editable: false,
      },
      searchCodes: {
        label: 'Поисковые артикулы',
        description: 'Заполняются автоматически.',
        editable: false,
      },
      badges: {
        label: 'Бейджи',
        description: 'Выберите бейджи для карточки. Например: «Хит».',
      },
    },
  },
  {
    kind: 'content-type',
    uid: 'api::product-badge.product-badge',
    fields: {
      label: {
        label: 'Текст бейджа',
        description: 'До 30 знаков. Например: «Хит».',
      },
      backgroundColor: {
        label: 'Цвет фона',
        description: 'Укажите HEX-код. Например: #0F172A.',
      },
      textColor: {
        label: 'Цвет текста',
        description: 'Укажите HEX-код. Например: #FFFFFF.',
      },
    },
  },
  {
    kind: 'component',
    uid: 'catalog.product-badge-assignment',
    fields: {
      badge: {
        label: 'Бейдж',
        description: 'Выберите готовый бейдж. Например: «Хит».',
      },
    },
  },
];

function parseArgs(argv) {
  let dryRun = false;
  let write = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--write') {
      write = true;
      continue;
    }
    throw new Error(`Неизвестный аргумент: ${arg}`);
  }

  if (dryRun && write) {
    throw new Error('Нельзя одновременно передавать --dry-run и --write.');
  }

  return { writeEnabled: write === true };
}

function errMsg(error) {
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown error';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getService(app, modelDef) {
  if (modelDef.kind === 'content-type') {
    const service = app.plugin('content-manager').service('content-types');
    return { service, model: service.findContentType(modelDef.uid) };
  }

  const service = app.plugin('content-manager').service('components');
  return { service, model: service.findComponent(modelDef.uid) };
}

async function loadCurrent(app, modelDef) {
  const { service, model } = getService(app, modelDef);

  if (!model) {
    throw new Error(`Модель не найдена: ${modelDef.uid}`);
  }

  const currentConfig = await service.findConfiguration(model);

  if (!currentConfig) {
    throw new Error(`Конфигурация не найдена: ${modelDef.uid}`);
  }

  if (!currentConfig.metadatas || typeof currentConfig.metadatas !== 'object') {
    throw new Error(`metadatas отсутствуют или некорректны: ${modelDef.uid}`);
  }

  for (const fieldName of Object.keys(modelDef.fields)) {
    if (!currentConfig.metadatas[fieldName]) {
      throw new Error(`metadata поля "${fieldName}" не найдена: ${modelDef.uid}`);
    }
  }

  return { service, model, currentConfig };
}

function readEdit(metadatas, fieldName) {
  const edit = metadatas[fieldName]?.edit ?? {};
  return {
    label: edit.label ?? null,
    description: edit.description ?? null,
    editable: edit.editable,
  };
}

function mergeField(meta, patch) {
  const edit = { ...(meta.edit ?? {}) };

  if (patch.label !== undefined) edit.label = patch.label;
  if (patch.description !== undefined) edit.description = patch.description;
  if (patch.editable !== undefined) edit.editable = patch.editable;

  return { ...meta, edit };
}

function buildNextConfig(currentConfig, fieldHints) {
  const next = {
    settings: clone(currentConfig.settings),
    metadatas: clone(currentConfig.metadatas),
    layouts: clone(currentConfig.layouts),
  };

  if (currentConfig.options !== undefined) {
    next.options = clone(currentConfig.options);
  }

  for (const [fieldName, patch] of Object.entries(fieldHints)) {
    next.metadatas[fieldName] = mergeField(next.metadatas[fieldName], patch);
  }

  return next;
}

function isChanged(current, patch) {
  if (patch.label !== undefined && current.label !== patch.label) return true;
  if (patch.description !== undefined && current.description !== patch.description) return true;
  if (patch.editable !== undefined && current.editable !== patch.editable) return true;
  return false;
}

function verifyEdits(metadatas, fieldHints, uid) {
  for (const [fieldName, patch] of Object.entries(fieldHints)) {
    const actual = readEdit(metadatas, fieldName);

    if (patch.label !== undefined && actual.label !== patch.label) {
      throw new Error(`Проверка не прошла: ${uid}.${fieldName}.label`);
    }
    if (patch.description !== undefined && actual.description !== patch.description) {
      throw new Error(`Проверка не прошла: ${uid}.${fieldName}.description`);
    }
    if (patch.editable !== undefined && actual.editable !== patch.editable) {
      throw new Error(`Проверка не прошла: ${uid}.${fieldName}.editable`);
    }
  }
}

function printChange(uid, fieldName, current, patch, changed) {
  const tag = changed ? 'CHANGED' : 'UNCHANGED';
  console.log(`[${tag}] ${uid} / ${fieldName}`);
  console.log(`  было: ${current.label ?? fieldName}`);
  console.log(`  станет: ${patch.label ?? current.label ?? fieldName}`);

  if (patch.editable !== undefined && current.editable !== patch.editable) {
    console.log(`  editable: ${current.editable} → ${patch.editable}`);
  }
}

function backupPath() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `/tmp/cocktaildesign-content-manager-hints-backup-${ts}.json`;
}

function saveBackup(entries) {
  const path = backupPath();
  const payload = entries.map(({ modelDef, currentConfig }) => {
    const item = {
      uid: modelDef.uid,
      type: modelDef.kind === 'content-type' ? 'content-type' : 'component',
      settings: currentConfig.settings,
      metadatas: currentConfig.metadatas,
      layouts: currentConfig.layouts,
    };

    if (currentConfig.options !== undefined) {
      item.options = currentConfig.options;
    }

    return item;
  });

  fs.writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path;
}

async function writeModel(entry) {
  const { service, model, modelDef, nextConfig } = entry;

  await service.updateConfiguration(model, nextConfig);

  const after = await service.findConfiguration(model);
  verifyEdits(after.metadatas, modelDef.fields, modelDef.uid);
}

async function run(app, writeEnabled) {
  const stats = {
    models: 0,
    fields: 0,
    changed: 0,
    unchanged: 0,
    written: 0,
    errors: 0,
  };

  const entries = [];

  for (const modelDef of MODELS) {
    try {
      const loaded = await loadCurrent(app, modelDef);
      let hasChanges = false;

      for (const [fieldName, patch] of Object.entries(modelDef.fields)) {
        const current = readEdit(loaded.currentConfig.metadatas, fieldName);
        const changed = isChanged(current, patch);

        if (changed) hasChanges = true;

        stats.fields += 1;
        if (changed) stats.changed += 1;
        else stats.unchanged += 1;

        printChange(modelDef.uid, fieldName, current, patch, changed);
      }

      entries.push({
        ...loaded,
        modelDef,
        hasChanges,
        nextConfig: hasChanges ? buildNextConfig(loaded.currentConfig, modelDef.fields) : null,
      });

      stats.models += 1;
    } catch (error) {
      stats.errors += 1;
      console.error(`Ошибка ${modelDef.uid}: ${errMsg(error)}`);
    }
  }

  if (writeEnabled && stats.errors === 0) {
    const toWrite = entries.filter((entry) => entry.hasChanges);

    if (toWrite.length > 0) {
      const path = saveBackup(entries);
      console.log(`Backup: ${path}`);

      for (const entry of toWrite) {
        try {
          await writeModel(entry);
          stats.written += 1;
          console.log(`Записано: ${entry.modelDef.uid}`);
        } catch (error) {
          stats.errors += 1;
          console.error(`Ошибка записи ${entry.modelDef.uid}: ${errMsg(error)}`);
        }
      }
    }
  }

  console.log('');
  console.log(`Моделей: ${stats.models}`);
  console.log(`Полей: ${stats.fields}`);
  console.log(`Изменится: ${stats.changed}`);
  console.log(`Без изменений: ${stats.unchanged}`);
  console.log(`Записано моделей: ${writeEnabled ? stats.written : 0}`);
  console.log(`Ошибок: ${stats.errors}`);

  if (stats.errors > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  let app = null;

  try {
    const { writeEnabled } = parseArgs(process.argv.slice(2));
    const { createStrapi, compileStrapi } = require('@strapi/strapi');

    const appContext = await compileStrapi();
    app = await createStrapi(appContext).load();
    app.log.level = 'error';

    await run(app, writeEnabled);
  } catch (error) {
    console.error(`Ошибка: ${errMsg(error)}`);
    process.exitCode = 1;
  } finally {
    if (app) {
      await app.destroy();
    }
  }
}

main().catch((error) => {
  console.error(`Ошибка завершения: ${errMsg(error)}`);
  process.exitCode = 1;
});
