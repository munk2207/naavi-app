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
  // Structured scheduling fields for the calendar pipeline.
  // start_date + start_time: used for all event-like types (appointment, meeting, call,
  //   test, follow_up, task, reminder, prescription) when the transcript mentions a
  //   resolvable date/time. Callers fall back to defaults when missing.
  // duration_days + dose_times: prescription-only; used to expand into daily dose events.
  start_date?: string;      // ISO date "YYYY-MM-DD"
  start_time?: string;      // HH:MM 24-hour
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

    // Inject today's date so Claude can resolve relative timings like "in 3 weeks"
    // into concrete ISO dates. Use America/Toronto (user's home timezone).
    const todayTorontoParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'long',
    }).formatToParts(new Date());
    const todayYear = todayTorontoParts.find(p => p.type === 'year')!.value;
    const todayMonth = todayTorontoParts.find(p => p.type === 'month')!.value;
    const todayDay = todayTorontoParts.find(p => p.type === 'day')!.value;
    const todayWeekday = todayTorontoParts.find(p => p.type === 'weekday')!.value;
    const todayISO = `${todayYear}-${todayMonth}-${todayDay}`;

    // Sonnet → Haiku: structured extraction from a transcript is Haiku-easy.
    // Prompt caching: the stable extraction rules live in a cached system block;
    // only the transcript varies per call.
    const extractionRules = `You are a conversation analyst. Extract ALL action items, commitments, and next steps from a conversation transcript — regardless of topic (medical, business, personal, legal, etc.).

Today's date is ${todayISO} (${todayWeekday}, America/Toronto timezone). Use this as the reference point for resolving relative timing phrases like "tomorrow", "in 3 weeks", "next Tuesday", "by end of month".

Return ONLY a JSON array — no explanation, no markdown, no code blocks.

Each object must have:
- type: one of "appointment", "meeting", "call", "email", "task", "follow_up", "test", "prescription", "reminder"
- title: short title (max 8 words)
- description: what needs to be done
- timing: when it should happen as a human-readable phrase (e.g. "within 2 weeks", "today", "by end of week", "as soon as possible")
- suggested_by: the name of who suggested or committed to it (use "Unknown" if unclear)
- calendar_title: a ready-to-use calendar event title (for appointments/meetings/calls)
- email_draft: optional short email text to follow up on this action. ONLY include this field when the transcript explicitly mentions sending an email, contacting someone by email, or mentions a specific email address. Do NOT auto-generate email_draft for general appointments, follow-ups, or scheduling — those go on the calendar, not in an email. Without an explicit "send an email to X" or similar in the transcript, OMIT this field.

Structured scheduling fields — include when the transcript makes them resolvable:
- start_date: ISO date "YYYY-MM-DD" when the action should happen, resolved against today (${todayISO}). Examples: "today" → ${todayISO}; "tomorrow" → tomorrow's date; "in 3 weeks" → today + 21 days; "next Tuesday" → the upcoming Tuesday. Applies to ALL types. Omit if truly unclear.
- start_time: HH:MM 24-hour string if a time is mentioned (e.g. "at 2pm" → "14:00", "at 8:30am" → "08:30"). Omit if no time was specified.

For type="prescription" ONLY, ALSO include these dose-schedule fields so the calendar can expand into per-day events:

duration_days: integer TOTAL number of days the medication is taken from start to finish. READ THE TRANSCRIPT CAREFULLY — undercounting strands the user without doses. When the speaker says "complete the full N-day course" or "finish the entire course" the duration is the full N, not how many days the user has already taken or any other smaller number.
- "for 10 days" → 10
- "for ten days" → 10 (number-words count too)
- "for two weeks" → 14
- "for three weeks" → 21
- "for a month" → 30
- "for a 10 day course" → 10
- "complete the full 10 day course" → 10  (NOT 2, NOT 1 — the FULL course)
- "5 days on, 3 days off, repeat for a month" → 30
- "until your next visit in 4 weeks" → 28
- ONLY omit if the transcript truly does not mention any duration. Do not guess "1" or "2" as a default — that's worse than omitting.

dose_times: array of HH:MM 24-hour strings for each dose per day. Examples:
- "once daily" / "once a day" → ["09:00"]
- "in the morning with breakfast" → ["08:00"]
- "twice a day" / "morning and evening" → ["09:00","21:00"]
- "three times a day" → ["08:00","14:00","20:00"]
- "every 4 hours" → ["08:00","12:00","16:00","20:00"]
- "every 6 hours" → ["06:00","12:00","18:00","00:00"]
Omit only if no dose frequency is mentioned at all.

Use these types:
- appointment / meeting → any scheduled get-together, visit, or session
- call → a phone or video call to make
- email → an email to send
- task → any to-do item or commitment
- follow_up → check back on something later
- test / prescription → medical lab work or medication
- reminder → something to remember but no specific action

Return only the JSON array. If no action items found, return [].`;

    const response = await client.messages.create({
      // Reverted from Haiku → Sonnet 2026-04-27. Haiku was returning wrong
      // prescription duration_days (e.g. "for 10 days" → 2) and over-emitting
      // email_draft. Per CLAUDE.md "stability over cost" rule, accuracy on
      // medical extractions outweighs token cost.
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        { type: 'text', text: extractionRules, cache_control: { type: 'ephemeral' } },
      ] as any,
      messages: [{
        role: 'user',
        content: `TRANSCRIPT:\n${transcript}`,
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
