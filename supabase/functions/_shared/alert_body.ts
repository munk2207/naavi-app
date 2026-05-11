/**
 * Shared helper: builds the final message body for an alert rule.
 *
 * Combines FOUR sources of content (in order):
 *   1. action_config.body — the base message text (required).
 *   2. action_config.tasks — string[] of inline one-off tasks, if set (legacy).
 *   3. action_config.list_name — name of a user's existing list (legacy);
 *      the handler calls manage-list (LIST_READ) to fetch current items.
 *   4. list_connections — F1a (Wael 2026-05-11): if a ruleId is passed and
 *      a list_connections row exists for this rule, the connected list's
 *      items are appended. Replaces #2 and #3 going forward — once F1a
 *      mobile ships, new alerts use connection rows only and #2/#3 are
 *      retired by the orchestrator. Until then, all four paths can fire
 *      additively without conflict.
 *
 * Used by:
 *   - evaluate-rules/fireAction (cron-bound trigger fires)
 *   - report-location-event/fireLocationAction (geofence fires)
 *
 * Output is a single string suitable for SMS (kept compact; newlines ok for
 * email and push, Twilio handles them fine in SMS too).
 */

interface ActionConfig {
  body?:      string;
  tasks?:     string[];
  list_name?: string;
}

interface ConnectedListItems {
  listName: string;
  items:    string[];
}

/**
 * Fetch the current items of a user's named list via manage-list LIST_READ.
 * Returns empty array on any failure — callers should treat absence as "no list items to include."
 */
async function fetchListItems(
  listName: string,
  userId:   string,
  supabaseUrl: string,
  interFnKey:  string,
): Promise<string[]> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/manage-list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
      body: JSON.stringify({ type: 'LIST_READ', listName, user_id: userId }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.success) return [];
    const items = Array.isArray(data.items) ? data.items : [];
    return items.map((x: unknown) => String(x).trim()).filter(Boolean);
  } catch (err) {
    console.error(`[alert_body] list fetch failed for "${listName}":`, err);
    return [];
  }
}

/**
 * F1a — fetch the list connected to this action_rule (if any) and read its
 * items via manage-list LIST_READ. Returns null if no connection exists,
 * the underlying list is missing, or any lookup fails. RLS-bypass via the
 * service-role key (the list_connections table denies anon writes; reads
 * require either the row owner's JWT or service_role).
 */
async function fetchConnectedListForRule(
  ruleId: string,
  userId: string,
  supabaseUrl: string,
  interFnKey: string,
): Promise<ConnectedListItems | null> {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) return null;
  try {
    const connRes = await fetch(
      `${supabaseUrl}/rest/v1/list_connections`
        + `?entity_type=eq.action_rule`
        + `&entity_id=eq.${encodeURIComponent(ruleId)}`
        + `&select=list_id`
        + `&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!connRes.ok) return null;
    const connRows = await connRes.json();
    const listId = Array.isArray(connRows) && connRows[0]?.list_id;
    if (!listId) return null;

    const listRes = await fetch(
      `${supabaseUrl}/rest/v1/lists?id=eq.${encodeURIComponent(listId)}&select=name&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!listRes.ok) return null;
    const listRows = await listRes.json();
    const listName = Array.isArray(listRows) && String(listRows[0]?.name ?? '').trim();
    if (!listName) return null;

    const items = await fetchListItems(listName, userId, supabaseUrl, interFnKey);
    return { listName, items };
  } catch (err) {
    console.error(`[alert_body] connected-list lookup failed for rule ${ruleId}:`, err);
    return null;
  }
}

/**
 * Build the final alert body.
 *
 * @param actionConfig — body / tasks / list_name from the action_rule row.
 * @param userId       — user owning the rule (for manage-list LIST_READ).
 * @param supabaseUrl  — env URL.
 * @param interFnKey   — anon key for fetch-based inter-function calls.
 * @param ruleId       — F1a (optional, Wael 2026-05-11): action_rule id; if
 *                       passed, alert_body looks up any connected list via
 *                       list_connections and appends its items. Callers that
 *                       don't pass it (legacy or non-rule call sites) skip
 *                       the new path silently — backwards-compatible.
 */
export async function buildAlertBody(
  actionConfig: ActionConfig,
  userId: string,
  supabaseUrl: string,
  interFnKey: string,
  ruleId?: string,
): Promise<string> {
  const baseBody = String(actionConfig.body ?? '').trim();
  const tasks = Array.isArray(actionConfig.tasks) ? actionConfig.tasks.filter(Boolean) : [];
  const listName = String(actionConfig.list_name ?? '').trim();

  const parts: string[] = [];
  if (baseBody) parts.push(baseBody);

  if (tasks.length > 0) {
    parts.push(`To do: ${tasks.join(', ')}.`);
  }

  if (listName) {
    const items = await fetchListItems(listName, userId, supabaseUrl, interFnKey);
    if (items.length > 0) {
      parts.push(`${capitalize(listName)} list: ${items.join(', ')}.`);
    } else {
      parts.push(`Your ${listName} list is empty.`);
    }
  }

  // F1a — connected list via list_connections. Additive to #2/#3 so legacy
  // alerts keep working during the transition.
  if (ruleId) {
    const connected = await fetchConnectedListForRule(ruleId, userId, supabaseUrl, interFnKey);
    if (connected) {
      if (connected.items.length > 0) {
        parts.push(`${capitalize(connected.listName)} list: ${connected.items.join(', ')}.`);
      } else {
        parts.push(`Your ${connected.listName} list is empty.`);
      }
    }
  }

  return parts.join(' ').trim();
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
