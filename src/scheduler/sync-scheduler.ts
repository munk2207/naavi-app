/**
 * Naavi — Sync Scheduler
 *
 * Registers and manages all background sync tasks using:
 *   - expo-background-fetch  : routine periodic syncs (calendar, weather, FHIR)
 *   - expo-task-manager      : named task registry
 *   - expo-notifications     : silent 07:00 trigger for morning pre-sync
 *
 * IMPORTANT: This file registers tasks at the module level.
 * It must be imported in the app's root entry point (App.tsx) before
 * any navigation or UI renders — that is how Expo TaskManager works.
 *
 * Usage:
 *   import { SyncScheduler } from './src/scheduler/sync-scheduler';
 *   const scheduler = new SyncScheduler(orchestrator);
 *   await scheduler.register();   // Call once on app start
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import type { IntegrationOrchestrator, } from '../integrations/index';
import type { IntegrationId } from '../../schema/integrations';
import { SYNC_SCHEDULE } from '../integrations/index';
import { MorningBriefCache } from './morning-brief-cache';

// ─────────────────────────────────────────────────────────────────────────────
// TASK NAMES — string constants used to register and identify background tasks
// ─────────────────────────────────────────────────────────────────────────────

export const TASK = {
  CALENDAR_SYNC:       'naavi.sync.calendar',
  WEATHER_SYNC:        'naavi.sync.weather',
  HEALTH_PORTAL_SYNC:  'naavi.sync.health_portal',
  ECOBEE_SYNC:         'naavi.sync.ecobee',
  MORNING_PRESYNC:     'naavi.morning.presync',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// RETRY STATE
// Tracked in memory for the current app session.
// Resets on app restart — that is intentional.
// ─────────────────────────────────────────────────────────────────────────────

interface RetryState {
  attempts: number;
  next_retry_at: number;    // Unix timestamp ms
  last_error?: string;
}

const retryState = new Map<IntegrationId, RetryState>();

const RETRY_DELAYS_MS = [
  2  * 60 * 1000,   // 2 minutes
  4  * 60 * 1000,   // 4 minutes
  8  * 60 * 1000,   // 8 minutes
];
const MAX_ATTEMPTS = 4;

// ─────────────────────────────────────────────────────────────────────────────
// TASK DEFINITIONS
// TaskManager.defineTask must be called at the module level — not inside a
// function or class method. This is an Expo constraint.
// The orchestrator is injected via a module-level reference set before tasks run.
// ─────────────────────────────────────────────────────────────────────────────

// Module-level reference — set by SyncScheduler.register()
let _orchestrator: IntegrationOrchestrator | null = null;
let _briefCache: MorningBriefCache | null = null;

TaskManager.defineTask(TASK.CALENDAR_SYNC, async () => {
  return runSyncTask('google_calendar');
});

TaskManager.defineTask(TASK.WEATHER_SYNC, async () => {
  return runSyncTask('weather');
});

TaskManager.defineTask(TASK.HEALTH_PORTAL_SYNC, async () => {
  return runSyncTask('myChart');
});

TaskManager.defineTask(TASK.ECOBEE_SYNC, async () => {
  return runSyncTask('ecobee');
});

// Morning pre-sync — triggered by silent notification at 07:00
TaskManager.defineTask(TASK.MORNING_PRESYNC, async () => {
  if (!_orchestrator || !_briefCache) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }

  try {
    // Sequential: most important first
    await _orchestrator.morningSyncPriority();
    await _briefCache.assemble();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CORE SYNC RUNNER
// Called by each task definition above. Handles retry logic.
// ─────────────────────────────────────────────────────────────────────────────

async function runSyncTask(
  integrationId: IntegrationId,
): Promise<BackgroundFetch.BackgroundFetchResult> {
  if (!_orchestrator) return BackgroundFetch.BackgroundFetchResult.Failed;

  const state = retryState.get(integrationId);

  // If we are in a retry backoff window, skip this run
  if (state && state.attempts >= MAX_ATTEMPTS) {
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }
  if (state && Date.now() < state.next_retry_at) {
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }

  const result = await _orchestrator.syncOne(integrationId);

  if (result.success) {
    retryState.delete(integrationId);   // Clear retry state on success
    return BackgroundFetch.BackgroundFetchResult.NewData;
  }

  // Update retry state
  const currentAttempts = (state?.attempts ?? 0) + 1;
  const delayMs = RETRY_DELAYS_MS[Math.min(currentAttempts - 1, RETRY_DELAYS_MS.length - 1)];

  retryState.set(integrationId, {
    attempts: currentAttempts,
    next_retry_at: Date.now() + delayMs,
    last_error: result.error?.message,
  });

  return BackgroundFetch.BackgroundFetchResult.Failed;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC SCHEDULER CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class SyncScheduler {
  private orchestrator: IntegrationOrchestrator;
  private briefCache: MorningBriefCache;

  constructor(orchestrator: IntegrationOrchestrator, briefCache: MorningBriefCache) {
    this.orchestrator = orchestrator;
    this.briefCache = briefCache;

    // Inject into module-level references for TaskManager
    _orchestrator = orchestrator;
    _briefCache = briefCache;
  }

  /**
   * Register all background tasks and schedule the morning notification.
   * Call once on app start, after permissions are granted.
   */
  async register(): Promise<void> {
    await this.registerBackgroundFetchTasks();
    await this.scheduleMorningTrigger();
  }

  /**
   * Unregister all tasks. Call when Robert logs out or disconnects all integrations.
   */
  async unregister(): Promise<void> {
    const tasks = Object.values(TASK);
    await Promise.all(
      tasks.map(task =>
        TaskManager.isTaskRegisteredAsync(task).then(registered => {
          if (registered) return BackgroundFetch.unregisterTaskAsync(task);
        })
      )
    );
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  /**
   * Run an immediate sync of all integrations.
   * Called manually when Robert first connects an integration,
   * or when the app is opened after a long gap.
   */
  async runImmediateSync(): Promise<void> {
    await this.orchestrator.syncAll();
  }

  /**
   * Returns a diagnostic summary of task registration and retry state.
   * Useful for a settings/debug screen.
   */
  async getDiagnostics(): Promise<SchedulerDiagnostics> {
    const taskStatuses = await Promise.all(
      Object.entries(TASK).map(async ([name, taskName]) => ({
        name,
        taskName,
        registered: await TaskManager.isTaskRegisteredAsync(taskName),
      }))
    );

    const retries: Record<string, RetryState> = {};
    retryState.forEach((state, id) => { retries[id] = state; });

    return {
      tasks: taskStatuses,
      retry_states: retries,
      morning_notification_scheduled: await this.isMorningNotificationScheduled(),
    };
  }

  // ── Private: register Background Fetch tasks ──────────────────────────────

  private async registerBackgroundFetchTasks(): Promise<void> {
    // Map each task name to its integration and schedule interval
    const taskMap: Array<{ task: string; integrationId: IntegrationId }> = [
      { task: TASK.CALENDAR_SYNC,      integrationId: 'google_calendar' },
      { task: TASK.WEATHER_SYNC,       integrationId: 'weather' },
      { task: TASK.HEALTH_PORTAL_SYNC, integrationId: 'myChart' },
      { task: TASK.ECOBEE_SYNC,        integrationId: 'ecobee' },
    ];

    for (const { task, integrationId } of taskMap) {
      const intervalMinutes = SYNC_SCHEDULE[integrationId];
      if (!intervalMinutes) continue;    // null = on-demand only, skip

      const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(task);
      if (alreadyRegistered) continue;   // Do not re-register on every app open

      await BackgroundFetch.registerTaskAsync(task, {
        minimumInterval: intervalMinutes * 60,   // Expo expects seconds
        stopOnTerminate: false,                  // Continue after app is closed
        startOnBoot: true,                       // Resume after phone restart
      });
    }
  }

  // ── Private: morning trigger via silent notification ──────────────────────

  /**
   * Schedules a repeating silent notification at 07:00 every day.
   * The notification is not shown to Robert — it fires the MORNING_PRESYNC task.
   *
   * Why a notification instead of BackgroundFetch?
   * BackgroundFetch timing is approximate (OS-controlled). For the one sync
   * that must happen at a specific time, a scheduled notification is more reliable.
   */
  private async scheduleMorningTrigger(): Promise<void> {
    // Cancel any existing morning trigger before rescheduling
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const existing = scheduled.find(n => n.content.data?.['task'] === TASK.MORNING_PRESYNC);
    if (existing) return;    // Already scheduled — no action needed

    await Notifications.scheduleNotificationAsync({
      content: {
        title: '',                  // Silent — Robert never sees this
        body: '',
        data: { task: TASK.MORNING_PRESYNC },
        sound: false,
        badge: 0,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        hour: 7,
        minute: 0,
        repeats: true,              // Every day at 07:00
      },
    });
  }

  private async isMorningNotificationScheduled(): Promise<boolean> {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.some(n => n.content.data?.['task'] === TASK.MORNING_PRESYNC);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION HANDLER
// When the silent 07:00 notification fires, trigger the morning pre-sync task.
// Register this handler in App.tsx alongside the scheduler.
// ─────────────────────────────────────────────────────────────────────────────

export function registerMorningNotificationHandler(): void {
  Notifications.addNotificationReceivedListener(notification => {
    const task = notification.request.content.data?.['task'];
    if (task === TASK.MORNING_PRESYNC && _orchestrator && _briefCache) {
      // Fire and forget — this runs in the background
      _orchestrator.morningSyncPriority()
        .then(() => _briefCache!.assemble())
        .catch(() => {
          // Swallow — brief assembles with whatever data is available
        });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface SchedulerDiagnostics {
  tasks: Array<{
    name: string;
    taskName: string;
    registered: boolean;
  }>;
  retry_states: Record<string, RetryState>;
  morning_notification_scheduled: boolean;
}
