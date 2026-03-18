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
}

// ─── Search Drive files ────────────────────────────────────────────────────────

export async function searchDriveFiles(query: string): Promise<DriveFile[]> {
  if (!supabase || !query.trim()) return [];

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return [];

    const res = await fetch(`${SUPABASE_URL}/functions/v1/search-google-drive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data.files ?? [];
  } catch (err) {
    console.error('[Drive] Search failed:', err);
    return [];
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
    /(?:find|search|look for|do i have|show me|pull up|get me)\s+(?:the\s+)?(?:document|doc|file|notes?|contract|report|spreadsheet|slides?|presentation)\s+(?:about|on|for|with|called|named)?\s+(.+)/i,
    /(?:document|doc|file|notes?|contract|report)\s+(?:about|on|for|with|called|named)\s+(.+)/i,
    /(?:anything|something)\s+(?:written|documented|saved|filed)\s+(?:about|on|for)\s+(.+)/i,
    /(?:open|read)\s+(?:the\s+)?(?:document|doc|file|notes?)\s+(?:about|on|for|called|named)?\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}
