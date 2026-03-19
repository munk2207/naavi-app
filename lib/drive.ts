/**
 * Google Drive integration
 *
 * On-demand search — called when Robert asks about a document or person.
 * Uses the search-google-drive Edge Function which reads the stored
 * Google refresh token server-side (no token management in the app).
 */

import { supabase } from './supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  parentFolderName?: string; // set when file came from inside a matched folder
}

// ─── Search Drive files ────────────────────────────────────────────────────────

export async function searchDriveFiles(query: string): Promise<DriveFile[]> {
  if (!supabase || !query.trim()) return [];

  try {
    const { data, error } = await supabase.functions.invoke('search-google-drive', {
      body: { query },
    });
    if (error) { console.error('[Drive] Search failed:', error); return []; }
    return data?.files ?? [];
  } catch (err) {
    console.error('[Drive] Search failed:', err);
    return [];
  }
}

// ─── Send a Drive file as email attachment ────────────────────────────────────

export async function sendDriveFileAsEmail(opts: {
  fileId: string;
  fileName: string;
  mimeType: string;
  to: string;
  subject?: string;
  message?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Not configured' };

  try {
    const { data, error } = await supabase.functions.invoke('send-drive-file', {
      body: opts,
    });
    if (error) return { success: false, error: error.message ?? 'Send failed' };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ─── Save a note to Drive as a Google Doc ────────────────────────────────────

export async function saveToDrive(opts: {
  title: string;
  content: string;
}): Promise<{ success: boolean; fileId?: string; webViewLink?: string; error?: string }> {
  if (!supabase) return { success: false, error: 'Not configured' };

  try {
    const { data, error } = await supabase.functions.invoke('save-to-drive', {
      body: opts,
    });
    if (error) return { success: false, error: error.message ?? 'Save failed' };
    if (data?.error) return { success: false, error: String(data.error) };
    return { success: true, fileId: data?.fileId, webViewLink: data?.webViewLink };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ─── Format Drive results for context injection ────────────────────────────────

export function formatDriveResults(files: DriveFile[], query: string): string {
  if (files.length === 0) return '';

  const lines = [`\nDrive documents related to "${query}" (${files.length}):`];
  files.slice(0, 5).forEach(file => {
    const type = friendlyType(file.mimeType);
    const modified = new Date(file.modifiedTime).toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    lines.push(`- ${file.name} (${type}, last modified ${modified}) — ${file.webViewLink}`);
  });
  return lines.join('\n');
}

function friendlyType(mimeType: string): string {
  const types: Record<string, string> = {
    'application/vnd.google-apps.document':     'Google Doc',
    'application/vnd.google-apps.spreadsheet':  'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.folder':       'Folder',
    'application/pdf':                          'PDF',
    'application/msword':                       'Word doc',
    'text/plain':                               'Text file',
  };
  return types[mimeType] ?? 'File';
}

// ─── Detect document queries ───────────────────────────────────────────────────

/**
 * Returns a search term if the message is asking about a document or file.
 * Examples:
 * "Find the contract with Acme"
 * "Do I have any notes on the Ottawa project?"
 * "Show me documents about insurance"
 */
export function extractDriveQuery(message: string): string | null {
  const patterns = [
    // "show/find [all/my] documents related/relating to X"
    /(?:show|find|search|get|pull up|look for)(?:\s+(?:all|my|your))?\s+(?:documents?|docs?|files?|notes?|contracts?|reports?)\s+(?:relat(?:ed|ing) to|refer(?:ring)? to|about|on|for|with|called|named)?\s*(.+)/i,
    // "documents related/relating/referring to X" / "files about X"
    /(?:documents?|docs?|files?|notes?|contracts?|reports?)\s+(?:relat(?:ed|ing) to|refer(?:ring)? to|about|on|for|with|called|named)\s+(.+)/i,
    // "find X in my/your drive" / "search drive for X"
    /(?:find|search|look for)\s+(.+?)\s+in\s+(?:my\s+|your\s+)?(?:drive|google drive|documents?|files?)/i,
    /(?:search|check)\s+(?:my\s+|your\s+)?(?:drive|google drive)\s+(?:for|about)\s+(.+)/i,
    // "search X in drive" (no possessive)
    /(?:find|search|look for)\s+(.+?)\s+in\s+(?:the\s+)?drive/i,
    // "do I have anything on X" / "anything saved about X"
    /(?:do i have|is there)\s+(?:anything|something)\s+(?:on|about|for|related to)\s+(.+)/i,
    /anything\s+(?:saved|filed|written|documented)\s+(?:on|about|for)\s+(.+)/i,
    // "open/read the document about X"
    /(?:open|read|show me)\s+(?:the\s+)?(?:document|doc|file|notes?)\s+(?:about|on|for|called|named)?\s*(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}
