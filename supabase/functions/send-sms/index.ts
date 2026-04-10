/**
 * send-sms Edge Function
 *
 * Sends an SMS or WhatsApp message to a phone number via Twilio.
 * Called by check-email-alerts, check-reminders, and the app (DRAFT_MESSAGE).
 *
 * Required Supabase secrets:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER                       (e.g. "+15145550100" — for SMS)
 *   TWILIO_WHATSAPP_FROM                     (e.g. "+16138796681" — production WhatsApp)
 *   TWILIO_WHATSAPP_TEMPLATE_MESSAGE_SID     (HX... — naavi_message_from_sender)
 *   TWILIO_WHATSAPP_TEMPLATE_REMINDER_SID    (HX... — naavi_appointment_reminder)
 *   TWILIO_WHATSAPP_TEMPLATE_TASK_SID        (HX... — naavi_task_confirmation)
 *
 * Request body:
 *   SMS:
 *     { to: "+1234567890", body: "message text", channel: "sms" }
 *
 *   WhatsApp with template (production — required for business-initiated messages):
 *     { to: "+1234567890", channel: "whatsapp",
 *       templateName: "message" | "reminder" | "task",
 *       variables: { "1": "John", "2": "Robert", "3": "running late" } }
 *
 *   WhatsApp with raw text (sandbox or 24h reply window only):
 *     { to: "+1234567890", body: "text", channel: "whatsapp" }
 *
 * For WhatsApp: prefixes To/From with "whatsapp:" per Twilio API.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getTemplateSid(templateName: string): string | null {
  const map: Record<string, string | undefined> = {
    message:  Deno.env.get('TWILIO_WHATSAPP_TEMPLATE_MESSAGE_SID'),
    reminder: Deno.env.get('TWILIO_WHATSAPP_TEMPLATE_REMINDER_SID'),
    task:     Deno.env.get('TWILIO_WHATSAPP_TEMPLATE_TASK_SID'),
  };
  return map[templateName] ?? null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const {
      to,
      body,
      channel = 'sms',
      templateName: rawTemplateName,
      variables: rawVariables,
      recipientName,
      senderName,
    } = await req.json() as {
      to: string;
      body?: string;
      channel?: 'sms' | 'whatsapp';
      templateName?: 'message' | 'reminder' | 'task';
      variables?: Record<string, string>;
      recipientName?: string;
      senderName?: string;
    };

    if (!to) {
      return new Response(JSON.stringify({ error: 'Missing to' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isWhatsApp = channel === 'whatsapp';

    // Auto-wrap WhatsApp into default template if no explicit template was given.
    // This is the simple approach that lets WhatsApp production work without an app rebuild.
    // Future: orchestrator will pick the right template (see project_naavi_whatsapp_templates.md).
    let templateName = rawTemplateName;
    let variables = rawVariables;
    if (isWhatsApp && !templateName && body) {
      templateName = 'message';
      variables = {
        '1': recipientName?.trim() || 'there',
        '2': senderName?.trim() || 'Robert',
        '3': body,
      };
    }

    const isTemplate = isWhatsApp && !!templateName;

    // Validation: SMS and WhatsApp-free-text need a body. WhatsApp-template needs variables.
    if (!isTemplate && !body) {
      return new Response(JSON.stringify({ error: 'Missing body (or provide templateName + variables for WhatsApp)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (isTemplate && !variables) {
      return new Response(JSON.stringify({ error: 'Missing variables for WhatsApp template' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
    const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')!;

    // Resolve From number
    const whatsAppFrom = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '+14155238886';
    const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER')!;
    const twilioTo   = isWhatsApp ? `whatsapp:${to}` : to;
    const twilioFrom = isWhatsApp ? `whatsapp:${whatsAppFrom}` : fromNumber;

    // Build request body
    const form = new URLSearchParams({ To: twilioTo, From: twilioFrom });

    if (isTemplate) {
      const contentSid = getTemplateSid(templateName!);
      if (!contentSid) {
        return new Response(JSON.stringify({ error: `Unknown WhatsApp templateName: ${templateName}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      form.append('ContentSid', contentSid);
      form.append('ContentVariables', JSON.stringify(variables));
      console.log(`[send-sms] WhatsApp template="${templateName}" sid=${contentSid} to=${to}`);
    } else {
      form.append('Body', body!);
      console.log(`[send-sms] ${channel} to=${to} body="${body!.slice(0, 60)}"`);
    }

    const credentials = btoa(`${accountSid}:${authToken}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error(`[send-sms] Twilio error (${channel}):`, data);
      return new Response(JSON.stringify({ error: data.message ?? 'Twilio error', details: data }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, sid: data.sid }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[send-sms] Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
