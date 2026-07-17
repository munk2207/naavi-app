/**
 * executeTaskActions — shared task_actions resolver + sender.
 *
 * Extracted from evaluate-rules/index.ts's F5c block (2026-06-15 original
 * ship, 2026-07-17 fail-closed fix) so report-location-event can execute
 * task_actions too (B10g — location-triggered alerts previously had zero
 * execution path for task_actions at all). Logic is unchanged from the
 * existing, already-tested F5c behavior — only variable access adapted to
 * this function's context-object signature (docs/B10G_PHASE3_TECHNICAL_REVIEW_2026-07-17.md §2).
 *
 * Fail-closed contract (proven necessary, docs/F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md):
 * a task_action resolves only when lookup-contact returns exactly one match.
 * Zero or multiple matches, or a to_name under 2 characters, are logged and
 * skipped — never guessed.
 */
export async function executeTaskActions(ctx: {
  config: Record<string, unknown>;
  rule: { id: string; user_id: string };
  userName: string | null;
  supabaseUrl: string;
  interFnKey: string;
}): Promise<void> {
  const { config, rule, userName, supabaseUrl, interFnKey } = ctx;

  const taskActions = Array.isArray((config as Record<string, unknown>).task_actions)
    ? ((config as Record<string, unknown>).task_actions as Array<Record<string, string>>)
    : Array.isArray((config as Record<string, unknown>).tasks)
      ? ((config as Record<string, unknown>).tasks as Array<Record<string, string>>)
      : [];
  if (taskActions.length === 0) return;

  // Resolve missing to_phone/to_email via lookup-contact for any task_action
  // that has only to_name. Uses the user's Google OAuth stored in user_tokens.
  const resolvedActions = await Promise.all(taskActions.map(async ta => {
    if ((ta.type === 'send_sms' && !ta.to_phone && ta.to_name) ||
        (ta.type === 'send_email' && !ta.to_email && ta.to_name)) {
      // F5c fix (2026-07-17) — defense-in-depth: a to_name this short can
      // never safely identify one contact. docs/F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md
      if (ta.to_name.trim().length < 2) {
        console.warn(`[task_actions] SKIPPED (name_too_short) to_name="${ta.to_name}"`);
        return ta;
      }
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/lookup-contact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
          body: JSON.stringify({ name: ta.to_name, user_id: rule.user_id }),
        });
        if (res.ok) {
          const data = await res.json() as { contacts?: Array<{ name?: string; phone?: string; email?: string }> };
          const matches = data.contacts ?? [];
          // F5c fix — the correctness guarantee: resolve only on exactly one
          // match. Zero or multiple matches must fail closed, never guess.
          if (matches.length === 1) {
            const best = matches[0];
            return {
              ...ta,
              to_phone: ta.to_phone || best.phone || '',
              to_email: ta.to_email || best.email || '',
              to_name:  ta.to_name  || best.name  || ta.to_name,
            };
          }
          if (matches.length === 0) {
            console.warn(`[task_actions] SKIPPED (zero_matches) to_name="${ta.to_name}"`);
          } else {
            console.warn(`[task_actions] SKIPPED (ambiguous_multiple_matches) to_name="${ta.to_name}" match_count=${matches.length}`);
          }
        }
      } catch (e) {
        console.warn(`[task_actions] contact lookup failed for "${ta.to_name}":`, e);
      }
    }
    return ta;
  }));

  const taskSends = resolvedActions.map(ta => {
    if (ta.type === 'send_sms' && ta.to_phone) {
      return fetch(`${supabaseUrl}/functions/v1/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
        body: JSON.stringify({
          to: ta.to_phone, body: ta.body, channel: 'sms',
          user_id: rule.user_id, recipient_name: ta.to_name,
          sender_name: userName || 'Naavi', source: 'alert_task',
        }),
      }).then(r => ({ ok: r.ok, label: `sms→${ta.to_name}` }))
        .catch(() => ({ ok: false, label: `sms→${ta.to_name}` }));
    }
    if (ta.type === 'send_email' && ta.to_email) {
      return fetch(`${supabaseUrl}/functions/v1/send-user-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
        body: JSON.stringify({
          user_id: rule.user_id,
          subject: `Message from ${userName || 'Naavi'}`,
          body: ta.body,
          to: ta.to_email,
        }),
      }).then(r => ({ ok: r.ok, label: `email→${ta.to_name}` }))
        .catch(() => ({ ok: false, label: `email→${ta.to_name}` }));
    }
    // Closes a prior silent-drop gap (CLAUDE.md Rule 21): any task_action
    // reaching here has no resolved destination and will never send.
    console.warn(`[task_actions] SKIPPED (no_resolved_destination) to_name="${ta.to_name}" type="${ta.type}"`);
    return null;
  }).filter((p): p is Promise<{ ok: boolean; label: string }> => p !== null);

  if (taskSends.length > 0) {
    const taskResults = await Promise.allSettled(taskSends);
    for (const r of taskResults) {
      if (r.status === 'fulfilled') {
        console.log(`[task_actions] ${r.value.label}: ${r.value.ok ? 'ok' : 'fail'}`);
      }
    }
  }
}
