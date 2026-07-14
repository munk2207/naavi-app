/**
 * Voice-Managed Lists
 *
 * Each list is a Google Doc on Drive. The `lists` table in Supabase
 * maps list names to Drive file IDs. Items are stored as plain text
 * lines in the Google Doc.
 */

import { supabase } from './supabase';
import { invokeWithTimeout, queryWithTimeout, getSessionWithTimeout } from './invokeWithTimeout';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ListRecord {
  id: string;
  name: string;
  category: string;
  drive_file_id: string;
  web_view_link: string | null;
  enabled?: boolean;
}

export interface ListResult {
  success: boolean;
  list?: ListRecord;
  items?: string[];
  error?: string;
  /** true when LIST_CREATE found a disabled list and re-enabled it instead of creating a new one */
  reactivated?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  if (!supabase) return null;
  const session = await getSessionWithTimeout();
  return session?.user?.id ?? null;
}

// Only finds ENABLED lists. Used by LIST_ADD / LIST_REMOVE / LIST_READ and
// the createList duplicate-check. Disabled lists are invisible to these ops.
async function findListByName(userId: string, name: string): Promise<ListRecord | null> {
  if (!supabase) return null;
  const { data, error } = await queryWithTimeout(
    supabase
      .from('lists')
      .select('id, name, category, drive_file_id, web_view_link')
      .eq('user_id', userId)
      .eq('enabled', true)
      .ilike('name', name)
      .maybeSingle(),
    15_000,
    'select-list-by-name',
  );
  if (error) { console.error('[Lists] Lookup failed:', error.message); return null; }
  return data;
}

// Find a DISABLED list with the given name. Used only by createList to
// detect soft-deleted dupes and re-enable them instead of creating a new row.
async function findDisabledListByName(userId: string, name: string): Promise<ListRecord | null> {
  if (!supabase) return null;
  const { data, error } = await queryWithTimeout(
    supabase
      .from('lists')
      .select('id, name, category, drive_file_id, web_view_link')
      .eq('user_id', userId)
      .eq('enabled', false)
      .ilike('name', name)
      .maybeSingle(),
    15_000,
    'select-disabled-list-by-name',
  );
  if (error) { console.error('[Lists] Disabled lookup failed:', error.message); return null; }
  return data;
}

async function readDriveFile(fileId: string): Promise<string> {
  if (!supabase) return '';
  const { data, error } = await invokeWithTimeout('read-drive-file', {
    body: { fileId },
  }, 30_000);
  if (error) { console.error('[Lists] Read Drive failed:', error); return ''; }
  return data?.content ?? '';
}

async function updateDriveFile(fileId: string, content: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await invokeWithTimeout('update-drive-file', {
    body: { fileId, content },
  }, 30_000);
  if (error) { console.error('[Lists] Update Drive failed:', error); return false; }
  return data?.success ?? false;
}

// ─── Create a new list ──────────────────────────────────────────────────────

export async function createList(name: string, category: string = 'other'): Promise<ListResult> {
  const userId = await getUserId();
  if (!userId || !supabase) return { success: false, error: 'No user session' };

  // Check if enabled list already exists
  const existing = await findListByName(userId, name);
  if (existing) return { success: true, list: existing };

  // Check for a DISABLED list with the same name (soft-delete parity with action_rules).
  // Re-enable in-place so list_connections (attachments) and Drive Doc contents are
  // preserved. This matches the alert lifecycle: grayed-out → re-enable on request.
  const disabledDupe = await findDisabledListByName(userId, name);
  if (disabledDupe) {
    const { error: reEnableErr } = await queryWithTimeout(
      supabase.from('lists').update({ enabled: true }).eq('id', disabledDupe.id),
      15_000,
      'reactivate-list-by-name',
    );
    if (reEnableErr) {
      console.error('[Lists] Re-enable failed:', reEnableErr.message);
      return { success: false, error: reEnableErr.message };
    }
    console.log(`[Lists] Re-enabled disabled list "${name}" (${disabledDupe.id})`);
    return { success: true, list: { ...disabledDupe, enabled: true }, reactivated: true };
  }

  // Create a Google Doc via save-to-drive. category='list' routes the new
  // Doc into MyNaavi/Lists/ instead of the MyNaavi root; save-to-drive
  // deliberately does NOT also create a documents row for lists because
  // the lists table + lists adapter already cover them in Global Search.
  const { data, error } = await invokeWithTimeout('save-to-drive', {
    body: { title: name, content: '', category: 'list' },
  }, 60_000);
  if (error || !data?.fileId) {
    return { success: false, error: error?.message ?? 'Failed to create Drive doc' };
  }

  const webViewLink = data.webViewLink ?? `https://docs.google.com/document/d/${data.fileId}/edit`;

  // Save mapping to lists table
  const { error: insertError } = await queryWithTimeout(
    supabase.from('lists').insert({
      user_id: userId,
      name,
      category,
      drive_file_id: data.fileId,
      web_view_link: webViewLink,
    }),
    15_000,
    'insert-list',
  );
  if (insertError) {
    console.error('[Lists] Insert failed:', insertError.message);
    return { success: false, error: insertError.message };
  }

  // Also insert into naavi_notes so the list shows in Drive Notes tab
  await queryWithTimeout(
    supabase.from('naavi_notes').insert({
      user_id: userId,
      title: name,
      web_view_link: webViewLink,
    }),
    15_000,
    'insert-naavi-note-for-list',
  ).then(({ error: notesErr }) => {
    if (notesErr) console.error('[Lists] naavi_notes insert failed:', notesErr.message);
  });

  console.log(`[Lists] Created "${name}" — ${data.fileId}`);
  return {
    success: true,
    list: { id: '', name, category, drive_file_id: data.fileId, web_view_link: webViewLink },
  };
}

// ─── Add items to a list ────────────────────────────────────────────────────

export async function addToList(listName: string, items: string[]): Promise<ListResult> {
  const userId = await getUserId();
  if (!userId) return { success: false, error: 'No user session' };

  const list = await findListByName(userId, listName);
  if (!list) return { success: false, error: `List "${listName}" not found` };

  // Read current content
  const current = await readDriveFile(list.drive_file_id);
  const lines = current.split('\n').filter(l => l.trim());

  // Add new items (skip the title line if present)
  for (const item of items) {
    if (item.trim()) lines.push(item.trim());
  }

  // Write back — first line is the list name, then items
  const newContent = lines.join('\n') + '\n';
  const ok = await updateDriveFile(list.drive_file_id, newContent);
  if (!ok) return { success: false, error: 'Failed to update Drive doc' };

  // Update timestamp
  if (supabase) {
    await queryWithTimeout(
      supabase.from('lists').update({ updated_at: new Date().toISOString() }).eq('id', list.id),
      15_000,
      'update-list-touch-add',
    );
  }

  console.log(`[Lists] Added ${items.length} items to "${listName}"`);
  return { success: true, list, items };
}

// ─── Remove items from a list ───────────────────────────────────────────────

export async function removeFromList(listName: string, items: string[]): Promise<ListResult> {
  const userId = await getUserId();
  if (!userId) return { success: false, error: 'No user session' };

  const list = await findListByName(userId, listName);
  if (!list) return { success: false, error: `List "${listName}" not found` };

  // Read current content
  const current = await readDriveFile(list.drive_file_id);
  let lines = current.split('\n').filter(l => l.trim());

  // Remove matching items (case-insensitive)
  const removeSet = new Set(items.map(i => i.trim().toLowerCase()));
  lines = lines.filter(l => !removeSet.has(l.trim().toLowerCase()));

  const newContent = lines.join('\n') + '\n';
  const ok = await updateDriveFile(list.drive_file_id, newContent);
  if (!ok) return { success: false, error: 'Failed to update Drive doc' };

  if (supabase) {
    await queryWithTimeout(
      supabase.from('lists').update({ updated_at: new Date().toISOString() }).eq('id', list.id),
      15_000,
      'update-list-touch-remove',
    );
  }

  console.log(`[Lists] Removed ${items.length} items from "${listName}"`);
  return { success: true, list };
}

// ─── Read a list ────────────────────────────────────────────────────────────

export async function readList(listName: string): Promise<ListResult> {
  const userId = await getUserId();
  if (!userId) return { success: false, error: 'No user session' };

  const list = await findListByName(userId, listName);
  if (!list) return { success: false, error: `List "${listName}" not found` };

  const items = await readListItemsByFileId(list.drive_file_id, listName);
  console.log(`[Lists] Read "${listName}" — ${items.length} items`);
  return { success: true, list, items };
}

/** Read a list's items directly by Drive file ID — bypasses the
 *  enabled-only name lookup findListByName does, so it works for disabled
 *  lists too (list-detail screen needs this: it already has the list row,
 *  including drive_file_id, from a by-ID fetch with no enabled filter). */
export async function readListItemsByFileId(driveFileId: string, listName: string): Promise<string[]> {
  const content = await readDriveFile(driveFileId);
  // Parse items — skip the first line only if it matches the list name (legacy lists had title as content)
  const allLines = content.split('\n').filter(l => l.trim());
  const firstLineIsTitle = allLines.length > 0 && allLines[0].toLowerCase().trim() === listName.toLowerCase().trim();
  return firstLineIsTitle ? allLines.slice(1) : allLines;
}

// ─── Get all lists for the user ─────────────────────────────────────────────

export async function getAllLists(): Promise<ListRecord[]> {
  const userId = await getUserId();
  if (!userId || !supabase) return [];

  const { data, error } = await queryWithTimeout(
    supabase
      .from('lists')
      .select('id, name, category, drive_file_id, web_view_link')
      .eq('user_id', userId)
      .eq('enabled', true)
      .order('created_at', { ascending: true }),
    15_000,
    'select-all-lists',
  );

  if (error) { console.error('[Lists] Fetch all failed:', error.message); return []; }
  return data ?? [];
}

// ─── Soft-disable / Reactivate ───────────────────────────────────────────────

/** Soft-disable a list (enabled=false). Drive Doc and connections preserved.
 *  Routed through the manage-list Edge Function (Rule 2 — single write entry point). */
export async function disableList(listId: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'No Supabase client' };
  const { data, error } = await invokeWithTimeout('manage-list', {
    body: { type: 'DISABLE_LIST', list_id: listId },
  }, 15_000);
  if (error || !data?.success) {
    const msg = error?.message ?? data?.error ?? 'manage-list DISABLE_LIST failed';
    console.error('[Lists] Disable failed:', msg);
    return { success: false, error: msg };
  }
  console.log(`[Lists] Disabled list ${listId}`);
  return { success: true };
}

/** Re-enable a previously disabled list (enabled=true).
 *  Routed through the manage-list Edge Function (Rule 2 — single write entry point). */
export async function reactivateList(listId: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'No Supabase client' };
  const { data, error } = await invokeWithTimeout('manage-list', {
    body: { type: 'REACTIVATE_LIST', list_id: listId },
  }, 15_000);
  if (error || !data?.success) {
    const msg = error?.message ?? data?.error ?? 'manage-list REACTIVATE_LIST failed';
    console.error('[Lists] Reactivate failed:', msg);
    return { success: false, error: msg };
  }
  console.log(`[Lists] Reactivated list ${listId}`);
  return { success: true };
}
