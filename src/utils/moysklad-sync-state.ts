// src/utils/moysklad-sync-state.ts

type MoySkladSyncStatus = "idle" | "running" | "ok" | "error";

export type MoySkladSyncKind = "categories" | "products" | "webhook";

type MoySkladSyncLock = {
  isLocked: boolean;
  lockedAt: string | null; // ISO datetime
  lockedBy: MoySkladSyncKind | null;
};

export type MoySkladSyncState = {
  status: MoySkladSyncStatus;
  lastSyncAt: string | null;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastRunKind: MoySkladSyncKind | null;

  lastTotals: {
    categories?: number;
    products?: number;
  };

  lock: MoySkladSyncLock;
};

const STORE = {
  type: "plugin",
  name: "moysklad",
  key: "syncState",
} as const;

const LOCK_TTL_MS = 10 * 60 * 1000; // 10 минут

const DEFAULT_STATE: MoySkladSyncState = {
  status: "idle",
  lastSyncAt: null,
  lastOkAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  lastRunKind: null,
  lastTotals: {},
  lock: { isLocked: false, lockedAt: null, lockedBy: null },
};

function normalizeState(stored: unknown): MoySkladSyncState {
  const s = (stored ?? {}) as Partial<MoySkladSyncState>;

  return {
    ...DEFAULT_STATE,
    ...s,
    lastTotals: { ...DEFAULT_STATE.lastTotals, ...(s.lastTotals ?? {}) },
    lock: { ...DEFAULT_STATE.lock, ...(s.lock ?? {}) },
  };
}

export async function getMoySkladSyncState(): Promise<MoySkladSyncState> {
  const stored = (await strapi.store(STORE).get()) as unknown;
  return normalizeState(stored);
}

export async function setMoySkladSyncState(patch: Partial<MoySkladSyncState>) {
  const prev = await getMoySkladSyncState();

  const next: MoySkladSyncState = {
    ...prev,
    ...patch,
    lastTotals: { ...prev.lastTotals, ...(patch.lastTotals ?? {}) },
    lock: { ...prev.lock, ...(patch.lock ?? {}) },
  };

  await strapi.store(STORE).set({ value: next });
  return next;
}

function isLockExpired(lock: MoySkladSyncLock): boolean {
  if (!lock.isLocked) return true;
  if (!lock.lockedAt) return true;

  const lockedAtMs = Date.parse(lock.lockedAt);
  if (Number.isNaN(lockedAtMs)) return true;

  return Date.now() - lockedAtMs > LOCK_TTL_MS;
}

export async function acquireMoySkladSyncLock(kind: MoySkladSyncKind) {
  const state = await getMoySkladSyncState();

  const canSteal = isLockExpired(state.lock);
  if (state.lock.isLocked && !canSteal) {
    const by = state.lock.lockedBy ?? "unknown";
    throw new Error(`Sync lock is already acquired by "${by}"`);
  }

  const now = new Date().toISOString();
  return setMoySkladSyncState({
    lock: { isLocked: true, lockedAt: now, lockedBy: kind },
  });
}

export async function releaseMoySkladSyncLock(kind: MoySkladSyncKind) {
  const state = await getMoySkladSyncState();

  if (!state.lock.isLocked) return state;
  if (state.lock.lockedBy !== kind) return state;

  return setMoySkladSyncState({
    lock: { isLocked: false, lockedAt: null, lockedBy: null },
  });
}

export async function markSyncRunning(kind: MoySkladSyncKind) {
  const now = new Date().toISOString();
  return setMoySkladSyncState({
    status: "running",
    lastSyncAt: now,
    lastRunKind: kind,
    lastErrorMessage: null,
  });
}

export async function markSyncOk(kind: MoySkladSyncKind, totals?: MoySkladSyncState["lastTotals"]) {
  const now = new Date().toISOString();
  return setMoySkladSyncState({
    status: "ok",
    lastSyncAt: now,
    lastOkAt: now,
    lastRunKind: kind,
    lastErrorMessage: null,
    lastTotals: totals ?? {},
  });
}

export async function markSyncError(kind: MoySkladSyncKind, err: unknown) {
  const now = new Date().toISOString();
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";

  return setMoySkladSyncState({
    status: "error",
    lastSyncAt: now,
    lastErrorAt: now,
    lastRunKind: kind,
    lastErrorMessage: message,
  });
}
