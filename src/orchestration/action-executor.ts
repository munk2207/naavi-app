/**
 * AI Orchestration Layer — Action Executor
 *
 * Takes the validated list of actions from the parser and
 * carries each one out — setting reminders, updating the profile,
 * preparing message drafts, logging concerns.
 *
 * Plain English: if the parser is the "translator", this is the
 * "hands" — it actually does the things Claude decided to do.
 *
 * Note: In the mobile app, these will call Expo APIs directly.
 * Right now they are stubbed with clear interfaces so we can
 * wire them to real APIs when the Expo project is initialised.
 */

import type {
  NaaviAction,
  SetReminderAction,
  UpdateProfileAction,
  DraftMessageAction,
  FetchDetailAction,
  LogConcernAction,
  SetEmailAlertAction,
  ClaudeResponse,
} from './types';

// ─── Execution result ─────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  action: NaaviAction;
  error?: string;
}

export interface ExecutionSummary {
  results: ExecutionResult[];
  allSucceeded: boolean;
  failedActions: NaaviAction[];
}

// ─── Main executor ────────────────────────────────────────────────────────────

/**
 * Executes all actions in a ClaudeResponse in sequence.
 * SPEAK actions are excluded here — the calling layer handles speech output.
 * Returns a summary of what succeeded and what failed.
 */
export async function executeActions(response: ClaudeResponse): Promise<ExecutionSummary> {
  const nonSpeakActions = response.actions.filter(a => a.type !== 'SPEAK');

  const results = await Promise.allSettled(
    nonSpeakActions.map(action => executeSingleAction(action))
  );

  const executionResults: ExecutionResult[] = results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error('[ActionExecutor] Action failed:', nonSpeakActions[i], result.reason);
      return {
        success: false,
        action: nonSpeakActions[i],
        error: result.reason?.message ?? 'Unknown error',
      };
    }
  });

  const failedActions = executionResults
    .filter(r => !r.success)
    .map(r => r.action);

  return {
    results: executionResults,
    allSucceeded: failedActions.length === 0,
    failedActions,
  };
}

// ─── Individual action handlers ───────────────────────────────────────────────

async function executeSingleAction(action: NaaviAction): Promise<ExecutionResult> {
  try {
    switch (action.type) {
      case 'SPEAK':
        // Handled by the calling layer — not executed here
        return { success: true, action };

      case 'SET_REMINDER':
        await setReminder(action);
        return { success: true, action };

      case 'UPDATE_PROFILE':
        await updateProfile(action);
        return { success: true, action };

      case 'DRAFT_MESSAGE':
        await draftMessage(action);
        return { success: true, action };

      case 'FETCH_DETAIL':
        await fetchDetail(action);
        return { success: true, action };

      case 'LOG_CONCERN':
        await logConcern(action);
        return { success: true, action };

      case 'SET_EMAIL_ALERT':
        await setEmailAlert(action);
        return { success: true, action };

      default:
        return { success: false, action, error: 'Unknown action type' };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, action, error };
  }
}

// ─── Action implementations ───────────────────────────────────────────────────

/**
 * Schedules a local push notification on Robert's device.
 *
 * In the Expo app this will use:
 *   import * as Notifications from 'expo-notifications';
 *   await Notifications.scheduleNotificationAsync({ ... });
 */
async function setReminder(action: SetReminderAction): Promise<void> {
  const triggerDate = new Date(action.datetime);

  if (isNaN(triggerDate.getTime())) {
    throw new Error(`Invalid datetime for reminder: ${action.datetime}`);
  }

  if (triggerDate < new Date()) {
    throw new Error(`Reminder datetime is in the past: ${action.datetime}`);
  }

  // TODO (Phase 7): Replace with Expo Notifications
  // await Notifications.scheduleNotificationAsync({
  //   content: { title: 'Naavi', body: action.title, data: { source: action.source } },
  //   trigger: { date: triggerDate },
  // });

  console.log('[ActionExecutor] SET_REMINDER:', {
    title: action.title,
    at: triggerDate.toISOString(),
    notes: action.notes,
  });
}

/**
 * Writes a field update to Robert's Cognitive Profile in SQLite.
 *
 * In the Expo app this will use:
 *   import * as SQLite from 'expo-sqlite';
 *   db.runAsync('UPDATE cognitive_profile SET ? = ? WHERE id = 1', [field, value]);
 */
async function updateProfile(action: UpdateProfileAction): Promise<void> {
  // TODO (Phase 7): Replace with Expo SQLite write
  // const db = await SQLite.openDatabaseAsync('naavi.db');
  // await db.runAsync(
  //   'INSERT OR REPLACE INTO profile_updates (field, value, reason, updated_at) VALUES (?, ?, ?, ?)',
  //   [action.field, JSON.stringify(action.value), action.reason, new Date().toISOString()]
  // );

  console.log('[ActionExecutor] UPDATE_PROFILE:', {
    field: action.field,
    value: action.value,
    reason: action.reason,
  });
}

/**
 * Saves a message draft to SQLite for Robert to review.
 * Naavi never sends messages without Robert seeing them first.
 *
 * In the Expo app this will open a review screen.
 */
async function draftMessage(action: DraftMessageAction): Promise<void> {
  // TODO (Phase 7): Save to SQLite drafts table, trigger review screen
  // await db.runAsync(
  //   'INSERT INTO message_drafts (to, subject, body, channel, created_at) VALUES (?, ?, ?, ?, ?)',
  //   [action.to, action.subject, action.body, action.channel, new Date().toISOString()]
  // );

  console.log('[ActionExecutor] DRAFT_MESSAGE:', {
    to: action.to,
    subject: action.subject,
    channel: action.channel,
  });
}

/**
 * Triggers a deeper fetch from a specific integration adapter.
 * Used when Claude needs more detail than the morning snapshot provides.
 */
async function fetchDetail(action: FetchDetailAction): Promise<void> {
  // TODO (Phase 7): Call the relevant adapter's fetchById() method
  // const adapter = IntegrationOrchestrator.getAdapter(action.integration);
  // await adapter.fetchById(action.resourceId);

  console.log('[ActionExecutor] FETCH_DETAIL:', {
    integration: action.integration,
    resourceId: action.resourceId,
    reason: action.reason,
  });
}

/**
 * Logs a concern to the Cognitive Profile's pattern tracking.
 * High-severity concerns will surface in the next morning brief.
 *
 * Examples of what gets logged:
 * - Robert mentioned pain twice this week (health, medium)
 * - Robert has not contacted his daughter in 3 weeks (social, medium)
 * - Robert asked about the same appointment twice (cognitive, low)
 */
async function logConcern(action: LogConcernAction): Promise<void> {
  // TODO (Phase 7): Write to SQLite concerns table
  // await db.runAsync(
  //   'INSERT INTO concerns (category, note, severity, logged_at) VALUES (?, ?, ?, ?)',
  //   [action.category, action.note, action.severity, new Date().toISOString()]
  // );

  console.log('[ActionExecutor] LOG_CONCERN:', {
    category: action.category,
    severity: action.severity,
    note: action.note,
  });

  if (action.severity === 'high') {
    // TODO (Phase 7): Escalate high-severity concerns to a daily digest
    console.warn('[ActionExecutor] HIGH SEVERITY concern logged — will surface in next brief');
  }
}

/**
 * Saves an email watch rule to Supabase so check-email-alerts can match
 * incoming emails and SMS Robert when a rule fires.
 *
 * Calls the naavi-chat Edge Function's Supabase client indirectly — in the
 * mobile app this will call the Supabase JS client directly with the user's
 * auth session.
 */
async function setEmailAlert(action: SetEmailAlertAction): Promise<void> {
  // The Supabase URL and anon key are injected at build time via env vars.
  // In the Expo app: import Constants from 'expo-constants' and read from
  // Constants.expoConfig.extra.supabaseUrl / supabaseAnonKey.
  const supabaseUrl  = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey  = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!supabaseUrl || !supabaseKey) {
    console.warn('[ActionExecutor] SET_EMAIL_ALERT: Supabase env vars not set — rule not saved');
    return;
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/email_watch_rules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      from_name:       action.fromName       ?? null,
      from_email:      action.fromEmail      ?? null,
      subject_keyword: action.subjectKeyword ?? null,
      phone_number:    action.phoneNumber,
      label:           action.label,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to save email watch rule: ${res.status} ${text}`);
  }

  console.log('[ActionExecutor] SET_EMAIL_ALERT saved:', action.label);
}
