/**
 * search-google-drive Edge Function
 *
 * Called on-demand when Robert asks about a document or person.
 * Uses the stored Google refresh token to search Drive and return
 * matching file names, types, and links.
 *
 * Unlike calendar/gmail sync, this is NOT a cron job — it runs
 * only when a search is needed, authenticated via user JWT.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getNewAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Verify user JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  // Parse query from request body
  const body = await req.json().catch(() => ({}));
  const query: string = body.query ?? '';
  if (!query.trim()) {
    return new Response(JSON.stringify({ files: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Identify user + get refresh token in one query via RLS.
  // PostgREST accepts the user JWT (same path as DB queries in the app).
  // This avoids auth.getUser() which goes to the Auth server separately.
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ files: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: tokenRow, error: tokenError } = await adminClient
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .single();

  if (tokenError || !tokenRow?.refresh_token) {
    console.log('[search-google-drive] No token found for user:', user.id);
    return new Response(JSON.stringify({ files: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  console.log('[search-google-drive] Token found for user:', user.id);

  try {
    const accessToken = await getNewAccessToken(tokenRow.refresh_token);

    // Search Drive — match file name only (fullText search is very slow)
    const safeQuery = query.replace(/'/g, "\\'");
    const driveQuery = `name contains '${safeQuery}' and trashed = false`;
    const fields = 'files(id,name,mimeType,modifiedTime,webViewLink)';

    console.log('[search-google-drive] Searching Drive for:', query);

    const driveController = new AbortController();
    const driveTimer = setTimeout(() => driveController.abort(), 10000);

    let driveRes: Response;
    try {
      driveRes = await fetch(
        `${DRIVE_API}/files?q=${encodeURIComponent(driveQuery)}&fields=${encodeURIComponent(fields)}&pageSize=10&orderBy=modifiedTime desc`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: driveController.signal }
      );
    } catch (e) {
      clearTimeout(driveTimer);
      console.error('[search-google-drive] Drive search timed out or failed:', e instanceof Error ? e.message : e);
      return new Response(JSON.stringify({ files: [], error: 'Drive search timed out' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    clearTimeout(driveTimer);

    if (!driveRes.ok) {
      const err = await driveRes.text();
      console.error('[search-google-drive] Drive API error:', driveRes.status, err);
      return new Response(JSON.stringify({ files: [], error: `Drive API ${driveRes.status}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const driveData = await driveRes.json();
    const topResults: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string; parentFolderName?: string }[] = driveData.files ?? [];

    const FOLDER_MIME = 'application/vnd.google-apps.folder';

    // For each folder in the results, fetch its contents
    const folders = topResults.filter(f => f.mimeType === FOLDER_MIME);
    const folderChildren: typeof topResults = [];

    // Limit to first 3 folders and apply a 5-second timeout per fetch to avoid hanging
    await Promise.all(folders.slice(0, 3).map(async (folder) => {
      const childQuery = `'${folder.id}' in parents and trashed = false`;
      const childFields = 'files(id,name,mimeType,modifiedTime,webViewLink)';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const childRes = await fetch(
          `${DRIVE_API}/files?q=${encodeURIComponent(childQuery)}&fields=${encodeURIComponent(childFields)}&pageSize=20&orderBy=modifiedTime desc`,
          { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal }
        );
        clearTimeout(timer);
        if (!childRes.ok) return;
        const childData = await childRes.json();
        const children = (childData.files ?? []).map((f: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string }) => ({
          ...f,
          parentFolderName: folder.name,
        }));
        folderChildren.push(...children);
        console.log(`[search-google-drive] Folder "${folder.name}" has ${children.length} items`);
      } catch (e) {
        console.warn(`[search-google-drive] Folder "${folder.name}" fetch skipped:`, e instanceof Error ? e.message : e);
      }
    }));

    // Combine: top results first, then folder contents (deduplicated by id)
    const seenIds = new Set(topResults.map(f => f.id));
    const newChildren = folderChildren.filter(f => !seenIds.has(f.id));
    const files = [...topResults, ...newChildren];

    console.log(`[search-google-drive] Total: ${files.length} items (${topResults.length} direct + ${newChildren.length} from folders) for query: "${query}"`);

    return new Response(JSON.stringify({ files }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[search-google-drive] Error:', msg);
    return new Response(JSON.stringify({ files: [], error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
