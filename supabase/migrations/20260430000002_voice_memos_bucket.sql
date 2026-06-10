-- voice-memos Storage bucket
--
-- Mobile app uploads each recorded voice memo here, then calls
-- `transcribe-memo` with just the storage path (instead of shipping
-- 50-200 KB of base64 audio in the request body, which was taking
-- 30-90 seconds to upload over a sluggish connection — Wael
-- 2026-04-30 morning testing).
--
-- File path convention: `{user_id}/{timestamp}.{ext}`. Files are
-- transient — only needed for the duration of the transcribe call.
-- A future cleanup job can prune anything older than 24 hours.

INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-memos', 'voice-memos', false)
ON CONFLICT (id) DO NOTHING;

-- Anyone authenticated can upload to their own folder. Folder name
-- must equal the user's auth uid (enforced by the path-prefix check).
DROP POLICY IF EXISTS "voice_memos_user_upload" ON storage.objects;
CREATE POLICY "voice_memos_user_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'voice-memos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can read their own files (debugging / replay).
DROP POLICY IF EXISTS "voice_memos_user_read" ON storage.objects;
CREATE POLICY "voice_memos_user_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'voice-memos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Service role (Edge Functions) has full access — transcribe-memo
-- needs to download the file regardless of who uploaded it.
DROP POLICY IF EXISTS "voice_memos_service_all" ON storage.objects;
CREATE POLICY "voice_memos_service_all"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'voice-memos')
  WITH CHECK (bucket_id = 'voice-memos');
