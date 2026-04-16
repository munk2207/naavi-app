/**
 * extract-actions Edge Function
 *
 * Receives a speaker-labeled conversation transcript and uses Claude
 * to extract structured action items (appointments, prescriptions, follow-ups, tasks).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export interface ConversationAction {
  type: 'appointment' | 'prescription' | 'follow_up' | 'task' | 'test' | 'call' | 'email' | 'meeting' | 'reminder';
  title: string;
  description: string;
  timing: string;           // e.g. "within 2 weeks", "today", "by March 30"
  suggested_by: string;     // speaker name e.g. "Dr. Ahmed"
  calendar_title?: string;  // pre-filled calendar event title
  email_draft?: string;     // pre-filled email draft text
  // Structured scheduling fields — used for type='prescription' to expand into daily events.
  start_date?: string;      // ISO date "YYYY-MM-DD"
  duration_days?: number;   // total days the medication is taken
  dose_times?: string[];    // HH:MM times per day, e.g. ["09:00","21:00"]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const { utterances, speaker_names } = await req.json();
    // utterances: [{ speaker: 'A', text: '...' }, ...]
    // speaker_names: { 'A': 'Dr. Ahmed', 'B': 'Robert' }

    if (!utterances || utterances.length === 0) throw new Error('No utterances provided');

    // Build labeled transcript
    const transcript = utterances
      .map((u: { speaker: string; text: string }) => {
        const name = speaker_names?.[u.speaker] ?? `Speaker ${u.speaker}`;
        return `${name}: ${u.text}`;
      })
      .join('\n');

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a conversation analyst. Extract ALL action items, commitments, and next steps from this conversation transcript — regardless of topic (medical, business, personal, legal, etc.).

Return ONLY a JSON array — no explanation, no markdown, no code blocks.

Each object must have:
- type: one of "appointment", "meeting", "call", "email", "task", "follow_up", "test", "prescription", "reminder"
- title: short title (max 8 words)
- description: what needs to be done
- timing: when it should happen (e.g. "within 2 weeks", "today", "by end of week", "as soon as possible")
- suggested_by: the name of who suggested or committed to it (use "Unknown" if unclear)
- calendar_title: a ready-to-use calendar event title (for appointments/meetings/calls)
- email_draft: optional short email text to follow up on this action

For type="prescription" ONLY, also include these structured scheduling fields so a calendar can auto-create daily dose events:
- start_date: ISO date "YYYY-MM-DD" when the medication starts. Default to today if the transcript says "starting today"/"now". If it says "starting tomorrow", use tomorrow's date. If unclear, omit.
- duration_days: integer total number of days the medication is taken (e.g. "for 10 days" → 10, "for two weeks" → 14, "for a month" → 30). Omit if unclear.
- dose_times: array of HH:MM 24-hour strings for each dose per day. Examples: "once daily" → ["09:00"], "twice a day" → ["09:00","21:00"], "three times a day" → ["08:00","14:00","20:00"], "every 4 hours" → ["08:00","12:00","16:00","20:00"]. Omit if unclear.

Use these types:
- appointment / meeting → any scheduled get-together, visit, or session
- call → a phone or video call to make
- email → an email to send
- task → any to-do item or commitment
- follow_up → check back on something later
- test / prescription → medical lab work or medication
- reminder → something to remember but no specific action

TRANSCRIPT:
${transcript}

Return only the JSON array. If no action items found, return [].`,
      }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    console.log('[extract-actions] Claude raw response:', raw.substring(0, 200));

    // Strip any accidental markdown
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    let actions: ConversationAction[] = [];
    try {
      actions = JSON.parse(cleaned);
      if (!Array.isArray(actions)) actions = [];
    } catch (e) {
      console.error('[extract-actions] Failed to parse Claude response:', cleaned);
      actions = [];
    }

    console.log('[extract-actions] Extracted', actions.length, 'actions');

    return new Response(
      JSON.stringify({ actions }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[extract-actions] Error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }
});
