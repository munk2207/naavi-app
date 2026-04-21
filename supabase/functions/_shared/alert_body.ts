/**
 * Shared helper: builds the final message body for an alert rule.
 *
 * Combines three sources of content:
 *   1. action_config.body — the base message text (required).
 *   2. action_config.tasks — string[] of inline one-off tasks, if set.
 *   3. action_config.list_name — name of a user's existing list; if set,
 *      the handler calls manage-list (LIST_READ) to fetch current items.
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
 * Build the final alert body.
 */
export async function buildAlertBody(
  actionConfig: ActionConfig,
  userId: string,
  supabaseUrl: string,
  interFnKey: string,
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

  return parts.join(' ').trim();
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
