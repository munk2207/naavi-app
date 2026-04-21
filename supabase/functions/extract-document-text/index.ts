/**
 * extract-document-text Edge Function — A3 Phase 1.
 *
 * Given a harvested PDF document (row in `documents` table), downloads its
 * binary from Drive and asks Claude Haiku to read the text layer and return
 * structured facts. Updates the row with extracted_summary + key fields.
 *
 * Phase 1 scope: PDFs only. DOCX/XLSX/images deferred. Scanned PDFs without
 * a text layer will return sparse or empty data — that's expected; real OCR
 * is step 8 (A3 Phase 2).
 *
 * Input: { user_id: string, drive_file_id: string }
 * Output: {
 *   ok: boolean,
 *   extracted?: { summary, amount_cents, currency, date, reference, expiry },
 *   error?: string,
 * }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_URL  = 'https://www.googleapis.com/drive/v3/files';
const VISION_IMAGES_URL = 'https://vision.googleapis.com/v1/images:annotate';
const VISION_FILES_URL  = 'https://vision.googleapis.com/v1/files:annotate';

// Claude PDF support caps around 32 MB of base64 payload. Real attachments
// rarely approach this (our harvest cap is 25 MB raw, ~33 MB base64). Leave
// a small margin.
const MAX_PDF_BYTES_FOR_EXTRACTION = 20 * 1024 * 1024;

// Vision `files:annotate` sync endpoint accepts PDFs up to 2 MB / 5 pages.
// Larger PDFs need the async batch endpoint (requires a GCS bucket) —
// deferred for a future phase.
const MAX_PDF_BYTES_FOR_VISION_SYNC = 2 * 1024 * 1024;

// Vision `images:annotate` supports images up to 20 MB. Our harvest cap is
// 25 MB but signature filter already removes small ones.
const MAX_IMAGE_BYTES_FOR_VISION = 20 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

async function getAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')     ?? '',
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const data = await res.json();
    return typeof data.access_token === 'string' ? data.access_token : null;
  } catch (err) {
    console.error('[extract-document-text] token refresh failed:', err);
    return null;
  }
}

// Convert Uint8Array to base64 in chunks so we don't blow the stack on large
// PDFs (btoa struggles with long argument lists when applied via apply).
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

// Call Google Cloud Vision to OCR a PDF file (sync endpoint, up to 2 MB /
// 5 pages) or an image. Returns the concatenated extracted text, or ''.
async function ocrWithVision(
  b64: string,
  mime: string,
  visionKey: string,
): Promise<string> {
  try {
    if (mime === 'application/pdf') {
      const res = await fetch(`${VISION_FILES_URL}?key=${encodeURIComponent(visionKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            inputConfig: { mimeType: 'application/pdf', content: b64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          }],
        }),
      });
      if (!res.ok) {
        console.error('[extract-document-text] Vision files:annotate failed:', res.status, await res.text());
        return '';
      }
      const data = await res.json();
      const responses = data?.responses?.[0]?.responses ?? [];
      return responses.map((r: any) => r?.fullTextAnnotation?.text ?? '').join('\n\n').trim();
    }

    if (IMAGE_MIME_TYPES.has(mime)) {
      const res = await fetch(`${VISION_IMAGES_URL}?key=${encodeURIComponent(visionKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: b64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          }],
        }),
      });
      if (!res.ok) {
        console.error('[extract-document-text] Vision images:annotate failed:', res.status, await res.text());
        return '';
      }
      const data = await res.json();
      return (data?.responses?.[0]?.fullTextAnnotation?.text ?? '').trim();
    }

    return '';
  } catch (err) {
    console.error('[extract-document-text] Vision OCR error:', err);
    return '';
  }
}

// Once we have OCR'd text, ask Claude Haiku to produce the same structured
// fields as the direct-PDF path so the downstream update is identical.
async function claudeExtractFromText(
  client: Anthropic,
  text: string,
  todayISO: string,
): Promise<any | null> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You're extracting structured facts from a document for a senior user. The raw text below came from OCR — expect some transcription noise. Today is ${todayISO} (America/Toronto).

Return ONE line of JSON. No markdown. No code fences.

{
  "summary": "<<one short sentence describing what this document is, under 140 chars>>",
  "document_type": "invoice" | "warranty" | "receipt" | "contract" | "medical" | "statement" | "tax" | "ticket" | "notice" | "calendar" | "other",
  "amount_cents": <<integer cents if a monetary total is present, else null>>,
  "currency": "<<USD|CAD|EUR|...>> or null",
  "date": "<<ISO 8601 date of the document itself or null>>",
  "reference": "<<primary identifier (invoice/policy/case/order number) or null>>",
  "expiry": "<<ISO 8601 expiry date or null, NOT the same as date>>"
}

Rules:
- amount_cents: "$12.50" → 1250. Use the DOCUMENT TOTAL — not any line item.
- date = when the document was issued; expiry = when it stops being valid.
- Do not fabricate a reference.
- If the OCR text is garbage or empty, return {"summary":"OCR text unusable","document_type":"other","amount_cents":null,"currency":null,"date":null,"reference":null,"expiry":null}.
- document_type meanings:
    invoice, receipt, warranty, contract, medical, statement, tax, ticket, notice, calendar, other
    (invoice = bill to pay; receipt = proof of payment; statement = monthly summary;
     notice = government/institutional letter; calendar = a grid or list of many dated events
     like a school year or sports season schedule; other = none of the above fit)

OCR TEXT:
${text.slice(0, 8000)}`,
      }],
    });
    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[extract-document-text] Haiku over OCR failed:', err);
    return null;
  }
}

// Upload the raw OCR text to Drive as a sidecar file next to the source
// image/PDF. Returns the new Drive file id. Uses multipart/related to
// inline the metadata + body in a single request.
async function uploadTextSidecar(
  accessToken: string,
  parentFolderId: string,
  fileName: string,
  content: string,
): Promise<string> {
  const boundary = `naavi${Date.now()}${Math.random().toString(16).slice(2)}`;
  const metadata = { name: fileName, parents: [parentFolderId], mimeType: 'text/plain' };
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const headBytes    = new TextEncoder().encode(head);
  const contentBytes = new TextEncoder().encode(content);
  const tailBytes    = new TextEncoder().encode(tail);
  const body = new Uint8Array(headBytes.length + contentBytes.length + tailBytes.length);
  body.set(headBytes, 0);
  body.set(contentBytes, headBytes.length);
  body.set(tailBytes, headBytes.length + contentBytes.length);

  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`Drive sidecar upload failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  try {
    await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error('[extract-document-text] sidecar delete failed:', err);
  }
}

const VALID_DOC_TYPES = [
  'invoice', 'warranty', 'receipt', 'contract', 'medical',
  'statement', 'tax', 'ticket', 'notice', 'calendar', 'other',
] as const;
type DocType = typeof VALID_DOC_TYPES[number];

function isValidDocType(v: unknown): v is DocType {
  return typeof v === 'string' && (VALID_DOC_TYPES as readonly string[]).includes(v);
}

// Find or create a named subfolder under `parentId`. Idempotent.
async function findOrCreateFolderUnder(
  accessToken: string,
  parentId: string,
  name: string,
): Promise<string> {
  const escaped = name.replace(/'/g, "\\'");
  const q = `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents`;
  const searchUrl = `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`;
  const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (Array.isArray(data.files) && data.files.length > 0) return data.files[0].id as string;
  }
  const createRes = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  if (!createRes.ok) throw new Error(`Failed to create folder ${name}: ${await createRes.text()}`);
  const data = await createRes.json();
  return data.id as string;
}

// Move a Drive file between parents. Preserves file id, content, shared links.
async function moveDriveFile(
  accessToken: string,
  fileId: string,
  oldParentId: string,
  newParentId: string,
): Promise<void> {
  const url = `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?addParents=${newParentId}&removeParents=${oldParentId}&fields=id`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Move file ${fileId} failed: ${res.status} ${await res.text()}`);
}

// Find the direct parent folder id of a Drive file. Returns null if none.
async function getParentFolderId(accessToken: string, fileId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=parents`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.parents) && data.parents.length > 0 ? data.parents[0] as string : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const { user_id, drive_file_id, reclassify = false } = await req.json();
    if (!user_id || !drive_file_id) {
      throw new Error('user_id and drive_file_id required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Load the document row
    const { data: doc, error: fetchErr } = await supabase
      .from('documents')
      .select('id, user_id, file_name, mime_type, size_bytes, drive_file_id, document_type, ocr_sidecar_drive_file_id')
      .eq('user_id', user_id)
      .eq('drive_file_id', drive_file_id)
      .maybeSingle();
    if (fetchErr || !doc) throw new Error(`document not found: ${fetchErr?.message ?? 'no row'}`);

    const isPdf = doc.mime_type === 'application/pdf';
    const isImage = IMAGE_MIME_TYPES.has(doc.mime_type ?? '');

    if (!isPdf && !isImage) {
      return new Response(JSON.stringify({ ok: false, reason: 'unsupported_mime' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const sizeLimit = isPdf ? MAX_PDF_BYTES_FOR_EXTRACTION : MAX_IMAGE_BYTES_FOR_VISION;
    if (typeof doc.size_bytes === 'number' && doc.size_bytes > sizeLimit) {
      await supabase
        .from('documents')
        .update({ extracted_at: new Date().toISOString(), extraction_error: 'too_large' })
        .eq('id', doc.id);
      return new Response(JSON.stringify({ ok: false, reason: 'too_large' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    // OAuth token for Drive
    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', user_id)
      .eq('provider', 'google')
      .maybeSingle();
    if (!tokenRow?.refresh_token) throw new Error('No Google refresh token for user');
    const accessToken = await getAccessToken(tokenRow.refresh_token);
    if (!accessToken) throw new Error('Could not refresh access token');

    // Download PDF binary from Drive (alt=media streams the raw bytes)
    const dlUrl = `${DRIVE_FILES_URL}/${encodeURIComponent(drive_file_id)}?alt=media`;
    const dlRes = await fetch(dlUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!dlRes.ok) throw new Error(`Drive download failed: ${dlRes.status} ${await dlRes.text()}`);
    const bytes = new Uint8Array(await dlRes.arrayBuffer());
    if (bytes.length === 0) throw new Error('PDF binary is empty');
    const b64 = bytesToBase64(bytes);

    // Anchor relative dates in the extractor against today.
    const todayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const y = todayParts.find(p => p.type === 'year')!.value;
    const m = todayParts.find(p => p.type === 'month')!.value;
    const d = todayParts.find(p => p.type === 'day')!.value;
    const todayISO = `${y}-${m}-${d}`;

    const client = new Anthropic({ apiKey });
    const visionKey = Deno.env.get('GOOGLE_VISION_API_KEY') ?? '';

    let parsed: any = null;
    let path: 'claude_pdf' | 'vision_ocr' = 'claude_pdf';
    let ocrText: string = '';

    if (isPdf) {
      // First try Claude directly on the PDF (handles text-layer PDFs at no
      // Vision cost). If Claude reports "no readable text layer" we fall
      // back to Vision OCR.
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: b64 },
            },
            {
              type: 'text',
              text: `You're extracting structured facts from a document attached to a senior user's email. Today is ${todayISO} (America/Toronto).

Return ONE line of JSON. No markdown. No code fences.

{
  "summary": "<<one short sentence describing what this document is, under 140 chars>>",
  "document_type": "invoice" | "warranty" | "receipt" | "contract" | "medical" | "statement" | "tax" | "ticket" | "notice" | "calendar" | "other",
  "amount_cents": <<integer cents if a monetary total is present, else null>>,
  "currency": "<<USD|CAD|EUR|...>> or null",
  "date": "<<ISO 8601 date of the document itself (invoice date, statement date, appointment date) or null>>",
  "reference": "<<primary identifier printed on the document — invoice number, policy number, case id, confirmation code, order number — else null>>",
  "expiry": "<<ISO 8601 date when the document/coverage expires (warranty end, policy expiry, ticket use-by) or null — NOT the same as date>>"
}

Rules:
- If the PDF has no readable text layer (it's scanned images), return {"summary":"Scanned document — text not readable","document_type":"other","amount_cents":null,"currency":null,"date":null,"reference":null,"expiry":null}.
- amount_cents: "$12.50" → 1250. "CA$75" → 7500 with currency "CAD". Use the DOCUMENT TOTAL — not any line item.
- date = when the document was issued; expiry = when it stops being valid. Do not fill the same value in both.
- Do not fabricate a reference — leave it null if none is printed.
- Keep summary plain-spoken (example: "Anthropic API invoice for $20 issued March 15").
- document_type meanings:
    invoice   = a bill requesting payment (may or may not be paid yet)
    receipt   = proof of payment completed
    warranty  = coverage/protection document with an expiry
    contract  = signed agreement, terms of service
    medical   = lab result, prescription, referral, medical notice
    statement = periodic account summary (bank, credit card, utility monthly)
    tax       = T4, CRA correspondence, tax slip, tax return
    ticket    = travel or event ticket, boarding pass, reservation confirmation
    notice    = government or institutional notice (gov.ca, condo AGM, official letter)
    calendar  = a recurring schedule with many dated events — school year calendar, sports season schedule, holiday list, program timetable. This is the right pick when the doc shows a grid of dates or a long list of events across a whole year.
    other     = documentary but none of the above.`,
            },
          ],
        }],
      });

      const raw = response.content[0].type === 'text' ? response.content[0].text : '';
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      try { parsed = JSON.parse(cleaned); } catch { /* fall through to OCR */ }
    }

    // Decide whether to run OCR: images always need it; scanned PDFs need it
    // when Claude's direct read returned the sentinel or failed to parse.
    const claudeSummary = (parsed?.summary ?? '').toString().toLowerCase();
    const needsOcr =
      isImage ||
      parsed == null ||
      claudeSummary.includes('scanned') ||
      claudeSummary.includes('not readable');

    if (needsOcr) {
      if (!visionKey) {
        await supabase
          .from('documents')
          .update({ extracted_at: new Date().toISOString(), extraction_error: 'vision_key_missing' })
          .eq('id', doc.id);
        return new Response(JSON.stringify({ ok: false, reason: 'vision_key_missing' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      if (isPdf && bytes.length > MAX_PDF_BYTES_FOR_VISION_SYNC) {
        await supabase
          .from('documents')
          .update({ extracted_at: new Date().toISOString(), extraction_error: 'ocr_too_large_sync' })
          .eq('id', doc.id);
        return new Response(JSON.stringify({ ok: false, reason: 'ocr_too_large_sync' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      const ocr = await ocrWithVision(b64, doc.mime_type ?? '', visionKey);
      if (!ocr) {
        await supabase
          .from('documents')
          .update({ extracted_at: new Date().toISOString(), extraction_error: 'ocr_empty' })
          .eq('id', doc.id);
        return new Response(JSON.stringify({ ok: false, reason: 'ocr_empty' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }
      ocrText = ocr;

      parsed = await claudeExtractFromText(client, ocrText, todayISO);
      path = 'vision_ocr';
      if (!parsed) {
        await supabase
          .from('documents')
          .update({ extracted_at: new Date().toISOString(), extraction_error: 'ocr_parse_failed' })
          .eq('id', doc.id);
        return new Response(JSON.stringify({ ok: false, reason: 'ocr_parse_failed' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }
    }

    // If OCR ran, persist the raw text AND upload a sidecar .ocr.txt next to
    // the source file in Drive so the user can read / verify what Vision
    // actually extracted. Replace any previous sidecar from an earlier run.
    let ocrSidecarDriveFileId: string | null = null;
    if (path === 'vision_ocr' && ocrText) {
      const parentFolderId = await getParentFolderId(accessToken, drive_file_id);
      if (parentFolderId) {
        if (doc.ocr_sidecar_drive_file_id) {
          await deleteDriveFile(accessToken, doc.ocr_sidecar_drive_file_id);
        }
        const baseName = doc.file_name.replace(/\.[^.]+$/, '');
        const sidecarName = `${baseName}.ocr.txt`;
        try {
          ocrSidecarDriveFileId = await uploadTextSidecar(
            accessToken, parentFolderId, sidecarName, ocrText,
          );
        } catch (err) {
          console.error('[extract-document-text] sidecar create failed:', err);
        }
      }
    }

    // Content-based document_type classification. Re-route the Drive file
    // (and its sidecar) to the correct Documents/<type>/ subfolder when the
    // model says so — but only when:
    //   (a) the file is currently unclassified (in 'other' or null), or
    //   (b) the caller explicitly set reclassify=true.
    // Rationale: classification is probabilistic, so we lock it in after
    // the first confident answer to avoid "file keeps moving around".
    let newDocumentType: DocType | null = null;
    const classified = parsed.document_type;
    if (isValidDocType(classified)) newDocumentType = classified;

    const currentType = doc.document_type ?? null;
    const shouldReclassify =
      newDocumentType != null &&
      newDocumentType !== currentType &&
      (reclassify === true || currentType == null || currentType === 'other');

    let movedTo: string | null = null;
    if (shouldReclassify && newDocumentType) {
      try {
        const currentParent = await getParentFolderId(accessToken, drive_file_id);
        if (currentParent) {
          const rootFolderId     = await findOrCreateFolderUnder(accessToken, /* we need MyNaavi root */
            await (async () => {
              // Walk up: currentParent is Documents/<X>/ — its parent is Documents/, whose parent is MyNaavi/.
              const docsParent = await getParentFolderId(accessToken, currentParent);
              const myNaaviParent = docsParent ? (await getParentFolderId(accessToken, docsParent)) : null;
              if (myNaaviParent) return myNaaviParent;
              // Fallback: find MyNaavi at Drive root.
              const q = `name='MyNaavi' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
              const r = await fetch(`${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (r.ok) {
                const d = await r.json();
                if (Array.isArray(d.files) && d.files.length > 0) return d.files[0].id as string;
              }
              throw new Error('MyNaavi root folder not found');
            })(),
            'Documents',
          );
          const newCategoryFolderId = await findOrCreateFolderUnder(accessToken, rootFolderId, newDocumentType);

          if (newCategoryFolderId !== currentParent) {
            await moveDriveFile(accessToken, drive_file_id, currentParent, newCategoryFolderId);
            movedTo = newDocumentType;
            // Also move the sidecar .ocr.txt file, if any.
            if (doc.ocr_sidecar_drive_file_id) {
              const sidecarParent = await getParentFolderId(accessToken, doc.ocr_sidecar_drive_file_id);
              if (sidecarParent && sidecarParent !== newCategoryFolderId) {
                try {
                  await moveDriveFile(accessToken, doc.ocr_sidecar_drive_file_id, sidecarParent, newCategoryFolderId);
                } catch (err) {
                  console.error('[extract-document-text] sidecar move failed:', err);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[extract-document-text] reclassify move failed:', err);
      }
    }

    const update: Record<string, unknown> = {
      extracted_at: new Date().toISOString(),
      extracted_summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 300) : null,
      extracted_amount_cents: typeof parsed.amount_cents === 'number' ? parsed.amount_cents : null,
      extracted_currency: typeof parsed.currency === 'string' ? parsed.currency.slice(0, 8) : null,
      extracted_date: parsed.date ?? null,
      extracted_reference: typeof parsed.reference === 'string' ? parsed.reference.slice(0, 120) : null,
      extracted_expiry: parsed.expiry ?? null,
      extraction_error: null,
    };
    if (path === 'vision_ocr') {
      update.extracted_text = ocrText;
      update.ocr_sidecar_drive_file_id = ocrSidecarDriveFileId;
    }
    // Only persist document_type when we actually moved the file — otherwise
    // keep the existing value so the "classify once" rule holds.
    if (movedTo) update.document_type = movedTo;

    const { error: updErr } = await supabase
      .from('documents')
      .update(update)
      .eq('id', doc.id);
    if (updErr) throw new Error(`update failed: ${updErr.message}`);

    return new Response(JSON.stringify({ ok: true, path, moved_to: movedTo, extracted: update }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[extract-document-text] Error:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
