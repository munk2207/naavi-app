// B10o — shared location-alert readback suffix builder.
//
// Extracted 2026-07-21 from 5 independently-duplicated implementations in
// hooks/useOrchestrator.ts (see docs/B10O_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-07-21.md
// for the full inventory). The 2026-07-17 B10h/B10j fix patched 2 of those 5
// sites to name a third-party recipient/message; none named the self-task.
// This helper is the single place that logic now lives, so a future site
// gets it correctly for free instead of needing to be remembered again.
//
// Contract (docs/B10O_PHASE2_CHANGE_PLAN_2026-07-21.md):
// - Deterministic, side-effect free. Never mutates actionConfig. Never
//   accesses external state. Identical input -> identical output.
// - Precedence: self-task clause, then third-party clause. Neither present
//   -> empty string.
// - Never emits "undefined"/"null" literals or stray punctuation for absent
//   optional fields.

export interface AlertReadbackActionConfig {
  tasks?: string | string[];
  to_name?: string;
  to?: string;
  body?: string;
  task_actions?: Array<{ to_name?: string; body?: string }>;
}

function formatSelfTaskClause(actionConfig: AlertReadbackActionConfig): string {
  const raw = actionConfig.tasks;
  const taskList: string[] = Array.isArray(raw)
    ? raw.map((t) => String(t ?? '').trim()).filter(Boolean)
    : (raw ? [String(raw).trim()] : []).filter(Boolean);
  if (taskList.length === 0) return '';
  // "Note:" reads naturally whether the task text is a verb phrase ("feed
  // the cat") or a noun phrase ("shopping list") — "I'll remind you to
  // shopping list" doesn't. Matches the Alerts screen's own "NOTE" label
  // for this field, so the wording is consistent app-wide too.
  return ` Note: ${taskList.join(' and ')}.`;
}

/**
 * Third-party naming clause only (no self-task). Exists for the one call
 * site (hooks/useOrchestrator.ts's "merged into an existing alert" branch)
 * whose own headline already names the self-task in its own words ("Got it
 * — I've added X to your existing alert") — using the combined suffix there
 * would duplicate that mention, which the Phase 2 output invariants forbid.
 * Deviation from Phase 3's "no other exports" line, made necessary by that
 * same invariant; documented in the Phase 5 Evidence Package.
 */
export function formatThirdPartyClause(actionConfig: AlertReadbackActionConfig): string {
  const recipient = String(actionConfig.to_name || actionConfig.to || '').trim();
  const body = String(actionConfig.body ?? '').trim();
  if (recipient) {
    return body ? ` ${recipient} will get "${body}".` : ` ${recipient} will be notified.`;
  }
  const taskActions = Array.isArray(actionConfig.task_actions) ? actionConfig.task_actions : [];
  return taskActions
    .map((ta) => {
      const taName = String(ta?.to_name ?? '').trim();
      const taBody = String(ta?.body ?? '').trim();
      if (!taName) return '';
      return taBody ? ` ${taName} will get "${taBody}".` : ` ${taName} will be notified.`;
    })
    .filter(Boolean)
    .join('');
}

/**
 * Builds the self-task + third-party naming suffix for a location-alert
 * confirmation, per the precedence table in
 * docs/B10O_PHASE2_CHANGE_PLAN_2026-07-21.md. Callers append this to their
 * own mode-specific headline (e.g. "Alert set — one time you arrive at X.").
 */
export function buildAlertReadbackSuffix(actionConfig: AlertReadbackActionConfig): string {
  return formatSelfTaskClause(actionConfig) + formatThirdPartyClause(actionConfig);
}
