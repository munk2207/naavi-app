/**
 * Voice-Managed Lists
 *
 * Each list is a Google Doc on Drive. The `lists` table in Supabase
 * maps list names to Drive file IDs. Items are stored as plain text
 * lines in the Google Doc.
 */

import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ListRecord {
  id: string;
  name: string;
  category: string;
  drive_file_id: string;
  web_view_link: string | null;
}

export interface ListResult {
  success: boolean;
  list?: ListRecord;
  items?: string[];
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

async function findListByName(userId: string, name: string): Promise<ListRecord | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('lists')
    .select('id, name, category, drive_file_id, web_view_link')
    .eq('user_id', userId)
    .ilike('name', name)
    .maybeSingle();
  if (error) { console.error('[Lists] Lookup failed:', error.message); return null; }
  return data;
}

async function readDriveFile(fileId: string): Promise<string> {
  if (!supabase) return '';
  const { data, error } = await supabase.functions.invoke('read-drive-file', {
    body: { fileId },
  });
  if (error) { console.error('[Lists] Read Drive failed:', error); return ''; }
  return data?.content ?? '';
}

async function updateDriveFile(fileId: string, content: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.functions.invoke('update-drive-file', {
    body: { fileId, content },
  });
  if (error) { console.error('[Lists] Update Drive failed:', error); return false; }
  return data?.success ?? false;
}

// ─── Create a new list ──────────────────────────────────────────────────────

export async function createList(name: string, category: string = 'other'): Promise<ListResult> {
  const userId = await getUserId();
  if (!userId || !supabase) return { success: false, error: 'No user session' };

  // Check if list already exists
  const existing = await findListByName(userId, name);
  if (existing) return { success: true, list: existing };

  // Create a Google Doc via save-to-drive. category='list' routes the new
  // Doc into MyNaavi/Lists/ instead of the MyNaavi root; save-to-drive
  // deliberately does NOT also create a documents row for lists because
  // the lists table + lists adapter already cover them in Global Search.
  const { data, error } = await supabase.functions.invoke('save-to-drive', {
    body: { title: name, content: '', category: 'list' },
  });
  if (error || !data?.fileId) {
    return { success: false, error: error?.message ?? 'Failed to create Drive doc' };
  }

  const webViewLink = data.webViewLink ?? `https://docs.google.com/document/d/${data.fileId}/edit`;

  // Save mapping to lists table
  const { error: insertError } = await supabase.from('lists').insert({
    user_id: userId,
    name,
    category,
    drive_file_id: data.fileId,
    web_view_link: webViewLink,
  });
  if (insertError) {
    console.error('[Lists] Insert failed:', insertError.message);
    return { success: false, error: insertError.message };
  }

  // Also insert into naavi_notes so the list shows in Drive Notes tab
  await supabase.from('naavi_notes').insert({
    user_id: userId,
    title: name,
    web_view_link: webViewLink,
  }).then(({ error: notesErr }) => {
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
    await supabase.from('lists').update({ updated_at: new Date().toISOString() }).eq('id', list.id);
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
    await supabase.from('lists').update({ updated_at: new Date().toISOString() }).eq('id', list.id);
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

  const content = await readDriveFile(list.drive_file_id);
  // Parse items — skip the first line only if it matches the list name (legacy lists had title as content)
  const allLines = content.split('\n').filter(l => l.trim());
  const firstLineIsTitle = allLines.length > 0 && allLines[0].toLowerCase().trim() === listName.toLowerCase().trim();
  const items = firstLineIsTitle ? allLines.slice(1) : allLines;

  console.log(`[Lists] Read "${listName}" — ${items.length} items`);
  return { success: true, list, items };
}

// ─── Get all lists for the user ─────────────────────────────────────────────

export async function getAllLists(): Promise<ListRecord[]> {
  const userId = await getUserId();
  if (!userId || !supabase) return [];

  const { data, error } = await supabase
    .from('lists')
    .select('id, name, category, drive_file_id, web_view_link')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) { console.error('[Lists] Fetch all failed:', error.message); return []; }
  return data ?? [];
}
