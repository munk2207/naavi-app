/**
 * Conversation recorder ("Visits" button) regression — 2026-08-15.
 *
 * Root cause: `upload-conversation`, `poll-conversation`, and `extract-actions`
 * were deleted on 2026-06-11 (commit f9465e0, "remove 8 dead Edge Functions")
 * as believed-dead code — but the mobile app's Visits button
 * (hooks/useConversationRecorder.ts) still calls all three today. Neither
 * staging nor production had them deployed; every tap crashed with "Edge
 * Function returned a non-2xx status code" for over two months.
 *
 * Restored all three from git history. extract-actions worked immediately.
 * upload-conversation and poll-conversation crashed on EVERY invocation
 * (even an empty body) with a generic WORKER_ERROR — traced via Supabase's
 * function logs to the `assemblyai` npm SDK's main entry point bundling its
 * realtime WebSocket support (`ws`), which pulls in Node-only modules
 * (`node:url`) and native binary addons (`utf-8-validate`, `bufferutil`)
 * that don't exist in Supabase's Deno edge runtime. Fixed by rewriting both
 * functions to call AssemblyAI's REST API directly via fetch() instead of
 * the SDK — we only ever used the REST endpoints, never realtime.
 *
 * These tests lock in: (1) neither function crashes at the module level
 * (the WORKER_ERROR shape must never reappear), and (2) the full
 * upload → submit → poll → completed pipeline works end-to-end.
 */

import { adapters } from '../lib/adapters';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

// Small (~2s, 8kHz mono) synthetic WAV — a 440Hz tone, not silence, so the
// upload/transcode path is genuinely exercised. No real speech is expected
// (this only proves the pipeline runs; empty utterances is the correct
// result for tone-only audio, not a failure).
function buildTestWavBase64(): string {
  const sampleRate = 8000;
  const seconds = 2;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const v = Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf.toString('base64');
}

export const session2026_08_15_conversationRecorderFixTests: TestCase[] = [
  {
    id: 'conversation-recorder.upload-conversation-no-worker-crash',
    category: 'conversation-recorder',
    description: '2026-08-15 — upload-conversation must never return the generic WORKER_ERROR module-crash shape, even on bad input',
    timeoutMs: 30_000,
    async run(ctx) {
      const { data } = await adapters.call(ctx, 'upload-conversation', {});
      ctx.log(`response: ${JSON.stringify(data)}`);
      expectTruthy(
        data?.code !== 'WORKER_ERROR',
        `upload-conversation crashed at the module level (WORKER_ERROR) — the assemblyai SDK/ws regression is back. Response: ${JSON.stringify(data)}`,
      );
      expectTruthy(
        data?.error === 'No audio provided',
        `expected clean "No audio provided" error for empty input, got: ${JSON.stringify(data)}`,
      );
    },
  },
  {
    id: 'conversation-recorder.poll-conversation-no-worker-crash',
    category: 'conversation-recorder',
    description: '2026-08-15 — poll-conversation must never return the generic WORKER_ERROR module-crash shape, even on bad input',
    timeoutMs: 30_000,
    async run(ctx) {
      const { data } = await adapters.call(ctx, 'poll-conversation', {});
      ctx.log(`response: ${JSON.stringify(data)}`);
      expectTruthy(
        data?.code !== 'WORKER_ERROR',
        `poll-conversation crashed at the module level (WORKER_ERROR) — the assemblyai SDK/ws regression is back. Response: ${JSON.stringify(data)}`,
      );
      expectTruthy(
        data?.error === 'No transcript_id provided',
        `expected clean "No transcript_id provided" error for empty input, got: ${JSON.stringify(data)}`,
      );
    },
  },
  {
    id: 'conversation-recorder.full-pipeline-upload-to-completed',
    category: 'conversation-recorder',
    description: '2026-08-15 — full round trip: upload real audio, submit transcription, poll until completed, no crash at any stage',
    timeoutMs: 90_000,
    async run(ctx) {
      const audioB64 = buildTestWavBase64();

      const uploadResult = await adapters.call(ctx, 'upload-conversation', { audio: audioB64, mimeType: 'audio/wav' });
      ctx.log(`upload: ${JSON.stringify(uploadResult.data)}`);
      expectTruthy(uploadResult.data?.transcript_id, `upload-conversation must return a transcript_id. Got: ${JSON.stringify(uploadResult.data)}`);

      const transcriptId = uploadResult.data.transcript_id;
      const deadline = Date.now() + 75_000;
      let finalStatus: any = null;
      while (Date.now() < deadline) {
        const pollResult = await adapters.call(ctx, 'poll-conversation', { transcript_id: transcriptId });
        ctx.log(`poll: ${JSON.stringify(pollResult.data)}`);
        expectTruthy(pollResult.data?.code !== 'WORKER_ERROR', `poll-conversation crashed mid-pipeline: ${JSON.stringify(pollResult.data)}`);
        if (pollResult.data?.status === 'completed' || pollResult.data?.status === 'error' || pollResult.data?.error) {
          finalStatus = pollResult.data;
          break;
        }
        await new Promise(r => setTimeout(r, 3_000));
      }

      expectTruthy(finalStatus, 'transcription did not reach a terminal status within 75s');
      expectTruthy(
        finalStatus.status === 'completed',
        `expected status "completed", got: ${JSON.stringify(finalStatus)}`,
      );
    },
  },
];
