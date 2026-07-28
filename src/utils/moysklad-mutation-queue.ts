// backend/src/utils/moysklad-mutation-queue.ts

import { randomUUID } from "crypto";
import type { MoySkladSyncKind } from "./moysklad-sync-state";

export type MoySkladWebhookEvent = {
  action?: string;
  meta?: {
    href?: string;
    type?: string;
  };
};

type MoySkladWebhookJobStatus = "pending" | "processing" | "failed";

export type MoySkladWebhookJob = {
  id: string;
  createdAt: string;
  status: MoySkladWebhookJobStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  events: MoySkladWebhookEvent[];
};

type MoySkladWebhookQueueState = {
  jobs: MoySkladWebhookJob[];
};

type MoySkladFullSyncKind = Exclude<MoySkladSyncKind, "webhook">;

const WEBHOOK_QUEUE_STORE = {
  type: "plugin",
  name: "moysklad",
  key: "webhookQueue",
} as const;

const MAX_INCOMPLETE_WEBHOOK_JOBS = 1000;

const RETRY_DELAY_MS = [5_000, 15_000, 60_000, 180_000] as const;

const DRAIN_RECOVERY_DELAY_MS = 5_000;

let mutationChain: Promise<void> = Promise.resolve();
let mutationTaskSerial = 0;

let webhookStoreMutex: Promise<void> = Promise.resolve();

let drainRunning = false;
let retryTimer: NodeJS.Timeout | null = null;
let drainStopped = false;

let reservedFullSyncKind: MoySkladFullSyncKind | null = null;

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

function withWebhookStoreLock<T>(task: () => Promise<T>): Promise<T> {
  const run = webhookStoreMutex.then(task, task);
  webhookStoreMutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readWebhookQueueState(): Promise<MoySkladWebhookQueueState> {
  const stored = (await strapi.store(WEBHOOK_QUEUE_STORE).get()) as unknown;
  if (!stored || typeof stored !== "object") {
    return { jobs: [] };
  }
  const jobs = (stored as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) {
    return { jobs: [] };
  }
  return { jobs: jobs as MoySkladWebhookJob[] };
}

async function writeWebhookQueueState(state: MoySkladWebhookQueueState): Promise<void> {
  await strapi.store(WEBHOOK_QUEUE_STORE).set({ value: state });
}

function countIncompleteJobs(jobs: MoySkladWebhookJob[]): number {
  return jobs.length;
}

function getFirstUnfinishedJob(jobs: MoySkladWebhookJob[]): MoySkladWebhookJob | null {
  const sorted = [...jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return sorted.find((job) => job.status !== "failed") ?? null;
}

function pickNextJob(jobs: MoySkladWebhookJob[]): MoySkladWebhookJob | null {
  const job = getFirstUnfinishedJob(jobs);
  if (!job) return null;

  if (job.status !== "pending") return null;

  if (job.nextAttemptAt) {
    const nextMs = Date.parse(job.nextAttemptAt);
    if (!Number.isNaN(nextMs) && nextMs > Date.now()) {
      return null;
    }
  }

  return job;
}

function msUntilFirstPendingRetry(jobs: MoySkladWebhookJob[]): number | null {
  const job = getFirstUnfinishedJob(jobs);
  if (!job) return null;
  if (job.status !== "pending") return null;
  if (!job.nextAttemptAt) return null;

  const nextMs = Date.parse(job.nextAttemptAt);
  if (Number.isNaN(nextMs)) return null;

  const delay = nextMs - Date.now();
  if (delay <= 0) return null;

  return delay;
}

export function enqueueMoySkladMutation<T>(kind: MoySkladSyncKind, task: () => Promise<T>): Promise<T> {
  const taskSerial = ++mutationTaskSerial;

  const run = mutationChain.then(
    async () => {
      strapi.log.info(`[moysklad-mutation] task #${taskSerial} start kind=${kind}`);
      return task();
    },
    async () => {
      strapi.log.info(`[moysklad-mutation] task #${taskSerial} start kind=${kind}`);
      return task();
    },
  );

  mutationChain = run.then(
    () => undefined,
    () => undefined,
  );

  return run
    .then((result) => {
      strapi.log.info(`[moysklad-mutation] task #${taskSerial} done kind=${kind}`);
      return result;
    })
    .catch((err) => {
      strapi.log.error(`[moysklad-mutation] task #${taskSerial} failed kind=${kind}: ${safeErrorMessage(err)}`);
      throw err;
    });
}

export function enqueueMoySkladFullSync<T>(kind: MoySkladFullSyncKind, task: () => Promise<T>): Promise<T> {
  if (reservedFullSyncKind !== null) {
    throw new Error(`Sync lock is already acquired by "${reservedFullSyncKind}"`);
  }

  reservedFullSyncKind = kind;

  return enqueueMoySkladMutation(kind, task).finally(() => {
    if (reservedFullSyncKind === kind) {
      reservedFullSyncKind = null;
    }
  });
}

export async function persistMoySkladWebhookBatch(events: MoySkladWebhookEvent[]): Promise<string> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  await withWebhookStoreLock(async () => {
    const state = await readWebhookQueueState();

    if (countIncompleteJobs(state.jobs) >= MAX_INCOMPLETE_WEBHOOK_JOBS) {
      throw new Error("moysklad_webhook_queue_full");
    }

    const job: MoySkladWebhookJob = {
      id,
      createdAt,
      status: "pending",
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      events,
    };

    state.jobs.push(job);
    await writeWebhookQueueState(state);
  });

  strapi.log.info(`[moysklad-webhook-queue] persisted batch id=${id} events=${events.length}`);
  return id;
}

async function removeWebhookJob(jobId: string): Promise<void> {
  await withWebhookStoreLock(async () => {
    const state = await readWebhookQueueState();
    state.jobs = state.jobs.filter((j) => j.id !== jobId);
    await writeWebhookQueueState(state);
  });
}

async function markWebhookJobProcessing(jobId: string): Promise<MoySkladWebhookJob | null> {
  return withWebhookStoreLock(async () => {
    const state = await readWebhookQueueState();
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return null;

    job.status = "processing";
    await writeWebhookQueueState(state);
    return { ...job };
  });
}

async function markWebhookJobFailedAttempt(jobId: string, err: unknown): Promise<void> {
  await withWebhookStoreLock(async () => {
    const state = await readWebhookQueueState();
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;

    job.attempts += 1;
    job.lastError = safeErrorMessage(err);

    if (job.attempts < 5) {
      job.status = "pending";
      const delayMs = RETRY_DELAY_MS[job.attempts - 1] ?? RETRY_DELAY_MS[RETRY_DELAY_MS.length - 1];
      job.nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
      strapi.log.warn(
        `[moysklad-webhook-queue] job ${jobId} retry scheduled attempts=${job.attempts} delayMs=${delayMs}`,
      );
    } else {
      job.status = "failed";
      job.nextAttemptAt = null;
      strapi.log.error(`[moysklad-webhook-queue] job ${jobId} failed permanently attempts=${job.attempts}`);
    }

    await writeWebhookQueueState(state);
  });
}

async function recoverProcessingJobsAfterDrainError(error: unknown): Promise<void> {
  await withWebhookStoreLock(async () => {
    const state = await readWebhookQueueState();
    let changed = false;

    for (const job of state.jobs) {
      if (job.status !== "processing") continue;

      job.status = "pending";
      job.nextAttemptAt = new Date(Date.now() + DRAIN_RECOVERY_DELAY_MS).toISOString();
      job.lastError = safeErrorMessage(error);
      changed = true;
    }

    if (changed) {
      await writeWebhookQueueState(state);
    }
  });
}

async function drainWebhookQueueOnce(): Promise<boolean> {
  if (drainStopped) return false;

  const state = await withWebhookStoreLock(async () => readWebhookQueueState());
  const next = pickNextJob(state.jobs);
  if (!next) return false;

  const job = await markWebhookJobProcessing(next.id);
  if (!job) return false;

  strapi.log.info(`[moysklad-webhook-queue] processing job id=${job.id} events=${job.events.length}`);

  try {
    await enqueueMoySkladMutation("webhook", async () => {
      await strapi.service("api::moysklad-webhook.moysklad-webhook").processBatch(job.events);
    });
  } catch (err) {
    await markWebhookJobFailedAttempt(job.id, err);

    const updated = await withWebhookStoreLock(async () => readWebhookQueueState());
    const updatedJob = updated.jobs.find((j) => j.id === job.id);
    if (updatedJob?.status === "failed") {
      return true;
    }

    return false;
  }

  await removeWebhookJob(job.id);
  strapi.log.info(`[moysklad-webhook-queue] job completed id=${job.id}`);
  return true;
}

function scheduleDrainRecovery(originalError: unknown): void {
  if (drainStopped || retryTimer) {
    return;
  }

  retryTimer = setTimeout(() => {
    retryTimer = null;

    void recoverProcessingJobsAfterDrainError(originalError)
      .then(() => {
        scheduleMoySkladWebhookDrain();
      })
      .catch((recoveryError) => {
        strapi.log.error(
          `[moysklad-webhook-queue] drain recovery failed: ${safeErrorMessage(recoveryError)}`,
        );

        scheduleDrainRecovery(originalError);
      });
  }, DRAIN_RECOVERY_DELAY_MS);
}

async function runWebhookDrainLoop(): Promise<void> {
  if (drainStopped) return;

  drainRunning = true;

  try {
    let progressed = true;
    while (progressed && !drainStopped) {
      progressed = await drainWebhookQueueOnce();
    }

    const state = await withWebhookStoreLock(async () => readWebhookQueueState());
    const delayMs = msUntilFirstPendingRetry(state.jobs);

    if (delayMs !== null && !drainStopped && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        scheduleMoySkladWebhookDrain();
      }, delayMs);
    }
  } finally {
    drainRunning = false;
  }

  if (!drainStopped) {
    const state = await withWebhookStoreLock(async () => readWebhookQueueState());
    if (pickNextJob(state.jobs)) {
      scheduleMoySkladWebhookDrain();
    }
  }
}

export function scheduleMoySkladWebhookDrain(): void {
  if (drainStopped || drainRunning) {
    return;
  }

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  void runWebhookDrainLoop().catch((error) => {
    strapi.log.error(`[moysklad-webhook-queue] drain failed: ${safeErrorMessage(error)}`);

    scheduleDrainRecovery(error);
  });
}

export async function recoverMoySkladWebhookQueueAfterRestart(): Promise<void> {
  drainStopped = false;

  await withWebhookStoreLock(async () => {
    const state = await readWebhookQueueState();
    let recovered = 0;

    for (const job of state.jobs) {
      if (job.status === "processing") {
        job.status = "pending";
        job.nextAttemptAt = null;
        recovered += 1;
      }
    }

    if (recovered > 0) {
      await writeWebhookQueueState(state);
      strapi.log.info(`[moysklad-webhook-queue] recovered ${recovered} processing job(s) after restart`);
    }
  });
}

export function stopMoySkladWebhookQueue(): void {
  drainStopped = true;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}
