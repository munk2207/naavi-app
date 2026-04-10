/**
 * Home screen — the main Naavi interface Robert sees every day.
 *
 * Layout (top to bottom):
 * 1. Morning brief — today's key items
 * 2. Conversation — the back-and-forth after Robert speaks
 * 3. Input bar — text input + voice button
 *
 * Phase 7: text input only (works in Expo Go without native code)
 * Phase 7.5: voice recording via expo-av replaces the text input
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Linking from 'expo-linking';

import { getUserName } from '@/lib/naavi-client';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { useVoice } from '@/hooks/useVoice';
import { useWhisperMemo } from '@/hooks/useWhisperMemo';
import { useHandsfreeMode } from '@/hooks/useHandsfreeMode';
import { useConversationRecorder } from '@/hooks/useConversationRecorder';
import { useLiveTranscript } from '@/hooks/useLiveTranscript';
import { VoiceButton } from '@/components/VoiceButton';
import { BriefCard } from '@/components/BriefCard';
import { ConversationBubble } from '@/components/ConversationBubble';
import { ConversationActionCard } from '@/components/ConversationActionCard';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';
import type { BriefItem } from '@/lib/naavi-client';
import type { Email } from '@/lib/types';

function emailToBriefItem(email: Email): BriefItem {
  return {
    id: email.id,
    category: 'email',
    title: email.subject,
    urgent: email.isImportant,
    detail: email.summary || `From: ${email.from.name || email.from.email}`,
    startISO: email.receivedAt,
  };
}
import { fetchOttawaWeather } from '@/lib/weather';
import { sendDriveFileAsEmail } from '@/lib/drive';
import { lookupContact } from '@/lib/contacts';
import { saveContact, loadTodayConversation, signInWithGoogle, signOut } from '@/lib/supabase';
import { fetchUpcomingEvents, fetchUpcomingBirthdays, captureAndStoreGoogleToken, triggerCalendarSync } from '@/lib/calendar';
import { registry } from '@/lib/adapters/registry';
import { supabase } from '@/lib/supabase';

// ─── How to use MyNaavi ───────────────────────────────────────────────────────

const HOW_TO_FEATURES = [
  {
    icon: '📅',
    name: 'Calendar',
    description: 'Instead of opening Google Calendar, just ask. MyNaavi reads your events, creates new ones, and reminds you when to leave.',
  },
  {
    icon: '✉️',
    name: 'Email & Messaging',
    description: 'Say who and what. MyNaavi picks the right channel based on your preference — email, WhatsApp, or text — drafts it, and sends when you confirm.',
  },
  {
    icon: '🗺️',
    name: 'Navigation',
    description: 'When a meeting has a location, MyNaavi shows driving time and a leave-by banner. Tap to open Google Maps.',
  },
  {
    icon: '🧠',
    name: 'Memory',
    description: 'Say "remember that…" and it sticks. MyNaavi recalls it automatically when it\'s relevant.',
  },
  {
    icon: '🏥',
    name: 'Medical records',
    description: 'MyNaavi connects to your health portal so you can check appointments, medications, and lab results without logging in yourself.',
  },
  {
    icon: '👥',
    name: 'Conversations',
    description: 'Record a conversation and MyNaavi will remember the details — names, decisions, follow-ups — so you don\'t have to take notes.',
  },
  {
    icon: '⭐',
    name: 'Your preferences',
    description: 'MyNaavi learns how you like things done. No meetings before 10? It\'ll flag early invites. Prefer WhatsApp over email? It picks WhatsApp next time. You set it once — MyNaavi follows it from then on.',
  },
  {
    icon: '☀️',
    name: 'Morning / afternoon brief',
    description: 'Before you ask, MyNaavi has already checked your calendar, email, and weather. One screen, everything that matters today.',
  },
  {
    icon: '🔜',
    name: 'And more coming',
    description: 'Behaviour monitoring, sharing with family and caregivers, and much more — MyNaavi keeps growing with you.',
  },
];

const FAQ_ITEMS = [
  {
    q: 'How do I talk to Naavi?',
    a: 'Tap the red mic button and speak naturally. Say "Hi Naavi" in hands-free mode.',
  },
  {
    q: 'Do I need to learn commands?',
    a: 'No. Just talk like you would to a person.',
  },
  {
    q: 'What if I want to cancel something?',
    a: 'Say "cancel" or "no" before confirming. Nothing sends without your OK.',
  },
  {
    q: 'Who sees my data?',
    a: 'Nobody. Your data stays on Canadian servers. No audio is stored.',
  },
];

function HowToModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={intStyles.overlay}>
        <View style={intStyles.sheet}>
          <View style={intStyles.header}>
            <Text style={intStyles.title}>
              How to use <Text style={intStyles.titleBrand}>MyNaavi</Text>
            </Text>
            <TouchableOpacity onPress={onClose} style={intStyles.closeBtn}>
              <Text style={intStyles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Tagline */}
            <Text style={intStyles.tagline}>
              MyNaavi navigates your daily tools so you don't have to.{'\n'}You speak once — MyNaavi handles the rest.
            </Text>

            {/* Features */}
            {HOW_TO_FEATURES.map(item => (
              <View key={item.name} style={intStyles.card}>
                <Text style={intStyles.cardIcon}>{item.icon}</Text>
                <View style={intStyles.cardBody}>
                  <Text style={intStyles.cardName}>{item.name}</Text>
                  <Text style={intStyles.cardDesc}>{item.description}</Text>
                </View>
              </View>
            ))}

            {/* FAQ */}
            <Text style={intStyles.categoryLabel}>Questions</Text>
            {FAQ_ITEMS.map(faq => (
              <View key={faq.q} style={intStyles.faqCard}>
                <Text style={intStyles.faqQ}>{faq.q}</Text>
                <Text style={intStyles.faqA}>{faq.a}</Text>
              </View>
            ))}

            <View style={{ height: 32 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const intStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.bgCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    maxHeight: '88%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: Typography.sectionHeading,
    fontWeight: '300',
    color: Colors.textPrimary,
  },
  titleBrand: {
    fontStyle: 'italic',
    fontWeight: '600',
    color: Colors.accent,
  },
  tagline: {
    fontSize: Typography.caption,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
    textAlign: 'center',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 18,
    color: Colors.textHint,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.bgElevated,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardIcon: {
    fontSize: 26,
    marginRight: 14,
    marginTop: 2,
  },
  cardBody: {
    flex: 1,
  },
  categoryLabel: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
  },
  cardName: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: Typography.caption,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  faqCard: {
    backgroundColor: Colors.bgElevated,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  faqQ: {
    fontSize: Typography.body,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  faqA: {
    fontSize: Typography.caption,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
});

// ─── Enrich calendar events with travel time ──────────────────────────────────

async function enrichWithTravelTime(items: BriefItem[]): Promise<BriefItem[]> {
  const now = Date.now();
  const eightHours = 8 * 60 * 60 * 1000;

  return Promise.all(items.map(async item => {
    if (
      item.category !== 'calendar' ||
      !item.location ||
      !item.startISO
    ) return item;

    const startMs = new Date(item.startISO).getTime();
    // Only fetch travel time for events starting within the next 8 hours
    if (startMs < now || startMs - now > eightHours) return item;

    const travel = await registry.maps.fetchTravelTime(item.location, item.startISO);
    if (!travel) return item;

    return {
      ...item,
      detail: item.location
        ? `${item.location} — ${travel.summary}`
        : travel.summary,
      leaveByMs: travel.leaveByMs,
    };
  }));
}

// No hardcoded brief — all items come from real data (calendar, weather)

// ─── Draft card component ─────────────────────────────────────────────────────

function DraftCard({ action }: { action: import('@/lib/naavi-client').NaaviAction }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [resolvedContact, setResolvedContact] = useState<string | null>(null);

  const channel = String(action.channel ?? 'email').toLowerCase() as 'email' | 'sms' | 'whatsapp';
  const isMessaging = channel === 'sms' || channel === 'whatsapp';
  const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'Email';
  const channelIcon = channel === 'whatsapp' ? '💬' : channel === 'sms' ? '📱' : '✉';

  // Auto-lookup contact on mount
  React.useEffect(() => {
    const to = String(action.to ?? '').trim();
    if (!to.includes('@') && !to.startsWith('+')) {
      lookupContact(to).then(contact => {
        if (isMessaging && contact?.phone) setResolvedContact(contact.phone);
        else if (!isMessaging && contact?.email) setResolvedContact(contact.email);
      });
    }
  }, [action.to]);

  async function handleSend() {
    setSending(true);
    setSendError(null);

    const to = String(action.to ?? '').trim();

    if (isMessaging) {
      // SMS or WhatsApp — need phone number
      // Detect phone numbers: strip dashes/spaces/brackets, check if mostly digits
      const stripped = to.replace(/[^+\d]/g, '');  // keep only digits and +
      let phone = stripped.startsWith('+') ? stripped
                 : /^\d{10}$/.test(stripped) ? `+1${stripped}`   // 10-digit North American → add +1
                 : /^\d{7,15}$/.test(stripped) ? `+${stripped}`  // other lengths → add +
                 : null;
      if (!phone) {
        const contact = await lookupContact(to);
        phone = contact?.phone ?? null;
      }
      if (!phone) {
        setSending(false);
        setSendError(`No phone number found for ${to}. Try saying "Remember ${to}'s phone is +1234567890" first.`);
        return;
      }

      try {
        console.log(`[Send] ${channelLabel} to ${phone}, body: ${String(action.body ?? '').slice(0, 30)}`);
        const { data, error } = await supabase.functions.invoke('send-sms', {
          body: { to: phone, body: String(action.body ?? ''), channel },
        });
        console.log('[Send] Response:', JSON.stringify({ data, error: error?.message }));
        setSending(false);
        if (error || !data?.success) {
          // Extract detailed error from Supabase FunctionsHttpError
          let detail = '';
          if (error && typeof (error as any).context?.json === 'function') {
            try { const ctx = await (error as any).context.json(); detail = JSON.stringify(ctx); } catch {}
          }
          setSendError(detail || (error?.message ?? data?.error ?? `${channelLabel} send failed`));
        } else {
          setSent(true);
        }
      } catch (err) {
        setSending(false);
        setSendError(err instanceof Error ? err.message : `${channelLabel} send failed`);
      }
    } else {
      // Email
      let email = to.includes('@') ? to : null;
      if (!email) {
        const contact = await lookupContact(to);
        email = contact?.email ?? null;
      }
      if (!email) {
        setSending(false);
        setSendError(`No email address found for ${to}. Try saying "Remember ${to}'s email is name@example.com" first.`);
        return;
      }

      const originalName = to;
      const result = await registry.email.send({
        to:      [{ name: email !== originalName ? originalName : '', email }],
        subject: String(action.subject ?? ''),
        body:    String(action.body    ?? ''),
      });
      setSending(false);
      if (result.success) {
        setSent(true);
      } else {
        setSendError(result.error ?? 'Send failed');
      }
    }
  }

  return (
    <View style={styles.draftCard}>
      <Text style={styles.draftLabel}>
        {sent ? `✓ ${channelLabel} sent` : `${channelIcon} ${channelLabel} draft ready`}
      </Text>
      <Text style={styles.draftField}>
        <Text style={styles.draftFieldLabel}>To: </Text>
        {String(action.to ?? '')}
        {resolvedContact && !String(action.to ?? '').includes('@') && !String(action.to ?? '').startsWith('+')
          ? <Text style={styles.contactResolved}> ({resolvedContact})</Text>
          : null}
      </Text>
      {!isMessaging && (
        <Text style={styles.draftField}>
          <Text style={styles.draftFieldLabel}>Subject: </Text>
          {String(action.subject ?? '')}
        </Text>
      )}
      <Text style={styles.draftBody}>{String(action.body ?? '')}</Text>
      {sendError ? (
        <Text style={styles.draftSendError}>{sendError}</Text>
      ) : null}
      {!sent && (
        <TouchableOpacity
          style={[styles.draftSendBtn, sending && styles.draftSendBtnDisabled]}
          onPress={handleSend}
          disabled={sending}
          accessibilityLabel={`Send ${channelLabel}`}
        >
          <Text style={styles.draftSendBtnText}>
            {sending ? 'Sending…' : `${channelIcon} Send`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const runSyncRef = useRef<(() => void) | null>(null);
  const avoidHighwaysRef = useRef(false);
  const [inputText, setInputText] = useState('');
  const [memoTranscript, setMemoTranscript] = useState<string | null>(null);
  const [brief, setBrief] = useState<BriefItem[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [navAlert, setNavAlert] = useState<{ title: string; location: string; startMs: number } | null>(null);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [briefDays, setBriefDays] = useState<number>(1); // default: today only
  const [recordingPrompt, setRecordingPrompt] = useState<{ title: string; endMs: number } | null>(null);

  // Load weather immediately (no auth needed)
  useEffect(() => {
    fetchOttawaWeather().then(w => setBrief([w]));
  }, []);

  // Resolve user ID — from getSession on mount OR onAuthStateChange
  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[Home] getSession:', session?.user?.id ?? 'none');
      if (session?.user) { setCurrentUserId(session.user.id); setIsSignedIn(true); }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[Home] onAuthStateChange:', event, 'user:', session?.user?.id ?? 'none');
        if (event === 'SIGNED_IN' && session?.provider_refresh_token) {
          await captureAndStoreGoogleToken();
        }
        if (session?.user) { setCurrentUserId(session.user.id); setIsSignedIn(true); }
        if (event === 'SIGNED_OUT') { setCurrentUserId(null); setIsSignedIn(false); }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  // Conversation intentionally starts fresh on every page load.
  // (History is still saved to Supabase for records, just not re-displayed.)

  // Load driving preferences from knowledge fragments (re-runs on user change only;
  // turns-based re-check is declared below after useOrchestrator is called)
  useEffect(() => {
    if (!supabase || !currentUserId) return;
    supabase.from('knowledge_fragments')
      .select('content')
      .eq('user_id', currentUserId)
      .ilike('content', '%highway%')
      .limit(5)
      .then(({ data }) => {
        avoidHighwaysRef.current = !!(data && data.length > 0);
      });
  }, [currentUserId]);

  // Load calendar data whenever user ID becomes available
  useEffect(() => {
    if (!currentUserId) return;
    console.log('[Home] loading calendar for user:', currentUserId);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    Promise.all([
      fetchUpcomingEvents(7, currentUserId),
      fetchUpcomingBirthdays(currentUserId),
      registry.email.fetchImportant(currentUserId),
    ]).then(async ([calendarItems, birthdayItems, emailItems]) => {
      console.log('[Home] calendar:', calendarItems.length, 'birthdays:', birthdayItems.length, 'emails:', emailItems.length);

      // Enrich calendar events that have a location with travel time
      const enriched = await enrichWithTravelTime(calendarItems);

      setBrief(prev => {
        const weather = prev.find(i => i.id === 'weather');
        return [...enriched, ...birthdayItems, ...emailItems.map(emailToBriefItem), ...(weather ? [weather] : [])];
      });
    });

    const runSync = () =>
      Promise.all([triggerCalendarSync(), registry.email.sync(currentUserId)]).then(() =>
        Promise.all([
          fetchUpcomingEvents(7, currentUserId),
          fetchUpcomingBirthdays(currentUserId),
          registry.email.fetchImportant(currentUserId),
        ])
      ).then(async ([fresh, freshBirthdays, freshEmails]) => {
        const freshEnriched = await enrichWithTravelTime(fresh);
        setBrief(prev => {
          const weather = prev.find(i => i.id === 'weather');
          return [...freshEnriched, ...freshBirthdays, ...freshEmails.map(emailToBriefItem), ...(weather ? [weather] : [])];
        });
      }).catch(() => {});

    // Background sync on load, then every minute while page is open
    runSyncRef.current = runSync;
    runSync();
    const syncInterval = setInterval(runSync, 60 * 1000);
    return () => clearInterval(syncInterval);
  }, [currentUserId]);

  const {
    convState, convError, elapsedSeconds,
    speakers, confirmedNames,
    startRecording: startConvRecording,
    stopRecording: stopConvRecording,
    confirmSpeakers, reset: resetConv,
    actions: convActions,
    utterances: convUtterances,
    savedDocLink,
  } = useConversationRecorder();

  // Recording prompt — checks every 60s for events starting within 10 minutes
  useEffect(() => {
    function checkUpcomingEvents() {
      const now = Date.now();

      // Auto-stop if currently recording and event ended
      if (convState === 'recording') {
        if (recordingPrompt && now > recordingPrompt.endMs) {
          stopConvRecording();
          setRecordingPrompt(null);
        }
        return; // don't show a new prompt while already recording
      }

      // Find next calendar event starting within 10 minutes
      for (const item of brief) {
        if (item.category !== 'calendar' || !item.startISO) continue;
        const startMs = new Date(item.startISO).getTime();
        const minutesUntil = (startMs - now) / 60000;
        if (minutesUntil > 0 && minutesUntil <= 10) {
          const endMs = item.endISO
            ? new Date(item.endISO).getTime()
            : startMs + 60 * 60 * 1000; // default 1hr
          setRecordingPrompt({ title: item.title, endMs });
          return;
        }
      }

      // Clear prompt if no upcoming event
      if (convState === 'idle') setRecordingPrompt(null);
    }

    checkUpcomingEvents();
    const interval = setInterval(checkUpcomingEvents, 60_000);
    return () => clearInterval(interval);
  }, [brief, convState, recordingPrompt]);

  // Navigation alert timer — checks every 30s if it's time to leave
  useEffect(() => {
    function checkLeaveTime() {
      const now = Date.now();
      for (const item of brief) {
        if (item.category !== 'calendar' || !item.location || !item.leaveByMs || !item.startISO) continue;
        const startMs = new Date(item.startISO).getTime();
        const cutoff = startMs + 60 * 60 * 1000; // show up to 60 min after start
        if (now >= item.leaveByMs && now <= cutoff) {
          setNavAlert({ title: item.title, location: item.location, startMs });
          return;
        }
      }
      setNavAlert(null);
    }
    checkLeaveTime();
    const interval = setInterval(checkLeaveTime, 30_000);
    return () => clearInterval(interval);
  }, [brief]);

  const { status, turns, error, send, clearHistory, loadHistory, stopSpeaking } = useOrchestrator('en', brief, avoidHighwaysRef.current);

  // Re-check highway preference after each turn so DELETE_MEMORY takes effect immediately
  useEffect(() => {
    if (!supabase || !currentUserId) return;
    supabase.from('knowledge_fragments')
      .select('content')
      .eq('user_id', currentUserId)
      .ilike('content', '%highway%')
      .limit(5)
      .then(({ data }) => { avoidHighwaysRef.current = !!(data && data.length > 0); });
  }, [turns, currentUserId]);

  // Auto-scroll to bottom when new conversation turns arrive
  useEffect(() => {
    if (turns.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [turns.length]);

  // Auto-open Google Maps when a navigation result arrives
  const lastAutoOpenedTurnRef = useRef(-1);
  useEffect(() => {
    const lastIdx = turns.length - 1;
    if (lastIdx < 0 || lastIdx === lastAutoOpenedTurnRef.current) return;
    const lastTurn = turns[lastIdx];
    if (lastTurn.navigationResults.length > 0) {
      lastAutoOpenedTurnRef.current = lastIdx;
      const nav = lastTurn.navigationResults[0];
      const avoid = avoidHighwaysRef.current ? '&avoid=highways' : '';
      const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(nav.destination)}&travelmode=driving${avoid}`;
      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } else {
        Linking.openURL(url).catch(() => {});
      }
    }
  }, [turns]);

  // ── Hands-free mode ──────────────────────────────────────────────────────
  // speakCue: short spoken cue using expo-speech (local, instant, no echo).
  // Returns a Promise that resolves when TTS finishes — hands-free waits
  // before starting speech recognition (Android can't do both simultaneously).
  // Cloud TTS (nova) is used for Naavi's full responses, not for short cues.
  const speakCueRef = useRef((text: string): Promise<void> => {
    return new Promise((resolve) => {
      const Speech = require('expo-speech');
      // Cancel any in-flight cue first — prevents two voices overlapping
      // when e.g. the pause cue is still playing and the user taps resume.
      try { Speech.stop(); } catch {}
      Speech.speak(text, {
        language: 'en-CA',
        rate: 0.85,
        pitch: 1.05,
        onDone: () => resolve(),
        onError: () => resolve(),
        onStopped: () => resolve(),
      });
      // Safety timeout in case callbacks don't fire
      setTimeout(resolve, 5000);
    });
  });

  const handsfree = useHandsfreeMode(status, send, speakCueRef.current);

  // Auto-activate hands-free when app is opened via "Hey Google" (naavi:// deep link)
  const handsfreeActivatedRef = useRef(false);
  useEffect(() => {
    if (handsfreeActivatedRef.current) return;

    async function checkIntent() {
      try {
        const url = await Linking.getInitialURL();
        if (url && url.startsWith('naavi://')) {
          console.log('[Home] Opened via intent:', url, '— activating hands-free');
          handsfreeActivatedRef.current = true;
          // Small delay to let the screen render first
          setTimeout(() => handsfree.activate(), 500);
        }
      } catch {}
    }

    if (Platform.OS !== 'web') {
      checkIntent();
    }
  }, []);

  const { voiceState, voiceError, startListening, stopListening, isSupported } = useVoice('en');
  const { memoState, memoError, isSupported: memoSupported, startRecording, stopRecording } = useWhisperMemo();
  const memoStartedAtRef = useRef<number>(0);

  const { startLive, stopLive, clearSegments: clearLive } = useLiveTranscript();

  const [showSpeakerModal, setShowSpeakerModal] = useState(false);
  const voiceLang = 'en';
  // Local state + refs for speaker-naming modal
  // Refs are updated on every keystroke — guaranteed latest value at confirm time
  const [localNames, setLocalNames]   = useState<Record<string, string>>({});
  const [localTitle, setLocalTitle]   = useState('');
  const localNamesRef = useRef<Record<string, string>>({});
  const localTitleRef = useRef<string>('');
  // committedNamesRef — set at the exact moment the user presses confirm.
  // Used for transcript display: avoids any async state/hook lag.
  const committedNamesRef = useRef<Record<string, string>>({});

  function updateLocalName(spk: string, v: string) {
    localNamesRef.current = { ...localNamesRef.current, [spk]: v };
    setLocalNames({ ...localNamesRef.current });
  }
  function updateLocalTitle(v: string) {
    localTitleRef.current = v;
    setLocalTitle(v);
  }

  // When transcription finishes, auto-label or pre-fill using saved user name
  useEffect(() => {
    if (convState !== 'labeling') return;

    const savedName = getUserName();
    const init: Record<string, string> = {};
    speakers.forEach(s => { init[s] = ''; });

    if (savedName && speakers.length === 1) {
      // Only the user in the recording — skip the modal entirely
      const names = { [speakers[0]]: savedName };
      committedNamesRef.current = names;
      localNamesRef.current = names;
      setLocalNames(names);
      confirmSpeakers(names, '').catch(() => {});
      return;
    }

    if (savedName && speakers.length >= 2) {
      // Pre-fill the first speaker as the user; ask for the rest
      init[speakers[0]] = savedName;
    }

    localNamesRef.current = { ...init };
    localTitleRef.current = '';
    committedNamesRef.current = {};
    setLocalNames(init);
    setLocalTitle('');
  }, [convState, speakers]);

  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return t('home.greeting_morning');
    if (hour < 17) return t('home.greeting_afternoon');
    return t('home.greeting_evening');
  }

  async function handleSend() {
    const text = inputText.trim();
    if (!text || status === 'thinking' || status === 'speaking') return;
    setInputText('');
    // Fire calendar sync in background so next response has fresh data
    if (currentUserId) runSyncRef.current?.();
    await send(text);
    // Scroll to bottom after response
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  function handleVoicePress() {
    if (voiceState === 'listening') {
      stopListening();
      return;
    }
    startListening(async (transcript) => {
      setInputText('');
      await send(transcript);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
  }

  function handleBriefItemPress(item: BriefItem) {
    // Calendar events with a location → open Google Maps navigation
    if (item.category === 'calendar' && item.location) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(item.location)}`;
      Linking.openURL(url);
      return;
    }
    send(`Tell me more about: ${item.title}`);
  }

  const statusLabel = {
    idle:       '',
    thinking:   t('home.thinking'),
    speaking:   '',
    error:      error ?? t('errors.apiError'),
  }[status];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        {/* Navigation alert banner */}
        {navAlert && (
          <TouchableOpacity
            style={[
              styles.navBanner,
              Date.now() >= navAlert.startMs ? styles.navBannerLate : styles.navBannerOnTime,
            ]}
            onPress={() => {
              Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navAlert.location)}`);
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.navBannerText}>
              {Date.now() >= navAlert.startMs
                ? `⚠️ Running late — ${navAlert.title}. Tap to navigate`
                : `🚗 Time to leave — ${navAlert.title}. Tap to navigate`}
            </Text>
          </TouchableOpacity>
        )}

        {/* Recording prompt banner — event starting within 10 minutes */}
        {recordingPrompt && convState === 'idle' && (
          <View style={styles.recordingPromptBanner}>
            <Text style={styles.recordingPromptText}>
              🩺 {recordingPrompt.title} — start recording?
            </Text>
            <TouchableOpacity
              style={styles.recordingPromptBtn}
              onPress={() => {
                setLocalTitle(recordingPrompt.title);
                clearLive();
                startConvRecording();
                startLive();
                setRecordingPrompt(prev => prev); // keep for auto-stop
              }}
            >
              <Text style={styles.recordingPromptBtnText}>Start</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setRecordingPrompt(null)}>
              <Text style={styles.recordingPromptDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        <HowToModal visible={showIntegrations} onClose={() => setShowIntegrations(false)} />

        {/* Speaker labeling modal — appears after transcription completes */}
        <Modal
          visible={showSpeakerModal || convState === 'labeling'}
          transparent
          animationType="slide"
          onRequestClose={() => setShowSpeakerModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.speakerModal}>
              <Text style={styles.speakerModalTitle}>🎙 Conversation Recorded</Text>
              <Text style={styles.speakerModalSub}>
                {speakers.length} speaker{speakers.length !== 1 ? 's' : ''} detected. Give this conversation a title and name each speaker.
              </Text>
              <View style={styles.speakerRow}>
                <Text style={styles.speakerLabel}>Title</Text>
                <TextInput
                  style={styles.speakerInput}
                  placeholder="e.g. Dr. Ahmed — Blood Work"
                  placeholderTextColor={Colors.textMuted}
                  value={localTitle}
                  onChangeText={updateLocalTitle}
                  autoCorrect={false}
                />
              </View>
              {speakers.map((spk, idx) => (
                <View key={spk} style={styles.speakerRow}>
                  <Text style={styles.speakerLabel}>Speaker {idx + 1}</Text>
                  <TextInput
                    style={styles.speakerInput}
                    placeholder={idx === 0 ? 'e.g. Dr. Ahmed' : 'e.g. Robert'}
                    placeholderTextColor={Colors.textMuted}
                    value={localNames[spk] ?? ''}
                    onChangeText={(v) => updateLocalName(spk, v)}
                    autoCorrect={false}
                  />
                </View>
              ))}
              <TouchableOpacity
                style={styles.speakerConfirmBtn}
                onPress={async () => {
                  // Read from refs — always the latest typed values
                  const names = { ...localNamesRef.current };
                  const title = localTitleRef.current;
                  console.log('[SpeakerModal] names:', JSON.stringify(names), 'title:', title);
                  // Commit names to component ref immediately — used by transcript display
                  committedNamesRef.current = { ...names };
                  setShowSpeakerModal(false);
                  await confirmSpeakers(names, title);
                }}
              >
                {convState === 'extracting'
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.speakerConfirmText}>Extract Action Items →</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setShowSpeakerModal(false); resetConv(); }}>
                <Text style={styles.speakerCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Greeting on its own row (left-aligned) */}
          <View style={styles.greetingRowLeft}>
            <Text style={styles.greetingSmall}>{getGreeting()}</Text>
          </View>

          {/* Action buttons on a separate row, right-aligned */}
          <View style={styles.greetingActionsRow}>
            {turns.length > 0 && (
              <TouchableOpacity
                style={styles.newChatBtn}
                onPress={clearHistory}
                accessibilityLabel="New chat"
              >
                <Text style={styles.newChatBtnText}>+ New</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.labeledBtn}
              onPress={() => setShowIntegrations(true)}
              accessibilityLabel="View integrations"
            >
              <View style={styles.infoBtn}><Text style={styles.infoBtnText}>?</Text></View>
              <Text style={styles.btnLabel} numberOfLines={1}>Info</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.labeledBtn}
              onPress={() => router.push('/notes')}
              accessibilityLabel="Open notes"
            >
              <View style={styles.notesBtn}><Text style={styles.notesBtnText}>📋</Text></View>
              <Text style={styles.btnLabel}>Notes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.labeledBtn}
              onPress={() => router.push('/settings')}
              accessibilityLabel="Open settings"
            >
              <View style={styles.settingsBtn}><Text style={styles.settingsIcon}>⚙</Text></View>
              <Text style={styles.btnLabel}>Settings</Text>
            </TouchableOpacity>
          </View>

          {/* Sign-in banner — only shown when not signed in on native */}
          {!currentUserId && (
            <TouchableOpacity
              style={styles.signInBanner}
              onPress={async () => {
                try {
                  setSigningIn(true);
                  await signInWithGoogle();
                } catch (e) {
                  console.error('[SignIn]', e);
                } finally {
                  setSigningIn(false);
                }
              }}
              disabled={signingIn}
            >
              <Text style={styles.signInBannerText}>
                {signingIn ? 'Signing in…' : '🔑  Sign in with Google to unlock calendar, email & preferences'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Morning brief — grouped by category */}
          {turns.length === 0 && (
            <View style={styles.briefSection}>
              <Text style={styles.sectionTitle}>{t('home.briefTitle')}</Text>
              <View style={styles.daySelector}>
                {[1, 3, 7].map(d => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.daySelectorBtn, briefDays === d && styles.daySelectorBtnActive]}
                    onPress={() => setBriefDays(d)}
                  >
                    <Text style={[styles.daySelectorText, briefDays === d && styles.daySelectorTextActive]}>
                      {d === 1 ? 'Today' : `${d} days`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {[
                { key: 'weather',  label: 'Weather' },
                { key: 'calendar', label: 'Calendar' },
                { key: 'task',     label: 'Tasks' },
                { key: 'health',   label: 'Health' },
              ].map(({ key, label }) => {
                const items = brief.filter(i => {
                  if (i.category !== key) return false;
                  if (i.category === 'weather') return true;
                  if (briefDays >= 7) return true;
                  if (!i.startISO) return false;
                  const itemDate = new Date(i.startISO);
                  const cutoff = new Date();
                  cutoff.setDate(cutoff.getDate() + briefDays - 1);
                  cutoff.setHours(23, 59, 59, 999);
                  return itemDate <= cutoff;
                });
                if (items.length === 0) return null;
                const collapsed = collapsedGroups[key] ?? true;
                return (
                  <View key={key} style={styles.briefGroup}>
                    <TouchableOpacity
                      style={styles.briefGroupHeader}
                      onPress={() => setCollapsedGroups(prev => ({ ...prev, [key]: !collapsed }))}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.briefGroupLabel}>{label}</Text>
                      <Text style={styles.briefGroupCount}>{items.length}</Text>
                      <Text style={styles.briefGroupArrow}>{collapsed ? '+' : '−'}</Text>
                    </TouchableOpacity>
                    {!collapsed && items.map(item => (
                      <BriefCard
                        key={item.id}
                        item={item}
                        onPress={handleBriefItemPress}
                      />
                    ))}
                  </View>
                );
              })}
            </View>
          )}

          {/* Conversation turns — each turn shows bubbles then its own cards */}
          {turns.map((turn, ti) => (
            <View key={ti}>
              <ConversationBubble role="user" content={turn.userMessage} timestamp={turn.timestamp} />
              <ConversationBubble role="assistant" content={turn.assistantSpeech} timestamp={turn.timestamp} />

              {/* Draft emails */}
              {turn.drafts.filter(a => a.type === 'DRAFT_MESSAGE').map((action, i) => (
                <DraftCard key={i} action={action} />
              ))}

              {/* Contact saved */}
              {turn.drafts.filter(a => a.type === 'ADD_CONTACT').map((action, i) => (
                <View key={i} style={styles.contactCard}>
                  <Text style={styles.contactLabel}>+ Contact saved</Text>
                  {action.name ? <Text style={styles.draftField}><Text style={styles.draftFieldLabel}>Name: </Text>{String(action.name)}</Text> : null}
                  {action.email ? <Text style={styles.draftField}><Text style={styles.draftFieldLabel}>Email: </Text>{String(action.email)}</Text> : null}
                  {action.phone ? <Text style={styles.draftField}><Text style={styles.draftFieldLabel}>Phone: </Text>{String(action.phone)}</Text> : null}
                  {action.relationship ? <Text style={styles.draftField}><Text style={styles.draftFieldLabel}>Relationship: </Text>{String(action.relationship)}</Text> : null}
                </View>
              ))}

              {/* Travel time */}
              {turn.navigationResults.map((nav, i) => (
                <View key={i} style={styles.navCard}>
                  <Text style={styles.navLabel}>🗺️ Travel time</Text>
                  <Text style={styles.navDestination}>{nav.destination}</Text>
                  <Text style={styles.navDetail}>{nav.durationMinutes} min · {nav.distanceKm.toFixed(1)} km</Text>
                  <Text style={styles.navLeaveBy}>
                    {nav.leaveByLabel ?? `Leave by ${new Date(nav.leaveByMs).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true })}`}
                  </Text>
                  <TouchableOpacity
                    style={styles.navOpenBtn}
                    onPress={() => {
                      const avoid = avoidHighwaysRef.current ? '&avoid=highways' : '';
                      const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(nav.destination)}&travelmode=driving${avoid}`;
                      const a = document.createElement('a');
                      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
                      document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    }}
                  >
                    <Text style={styles.navOpenBtnText}>Open in Google Maps →</Text>
                  </TouchableOpacity>
                </View>
              ))}

              {/* Drive files */}
              {turn.driveFiles.length > 0 && (
                <View style={styles.driveSection}>
                  <Text style={styles.draftLabel}>📄 Drive documents</Text>
                  {turn.driveFiles.map((file, i) => (
                    <View key={i} style={[styles.driveCard, file.parentFolderName ? styles.driveCardIndented : null]}>
                      <TouchableOpacity onPress={() => Linking.openURL(file.webViewLink)} accessibilityLabel={`Open ${file.name} in Google Drive`}>
                        <Text style={styles.driveFileName}>{file.name}</Text>
                        <Text style={styles.driveFileMeta}>
                          {friendlyMimeType(file.mimeType)} · modified {new Date(file.modifiedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {file.parentFolderName ? ` · in "${file.parentFolderName}"` : ''}
                        </Text>
                      </TouchableOpacity>
                      {file.mimeType !== 'application/vnd.google-apps.folder' && (
                        <TouchableOpacity style={styles.driveSendBtn} onPress={async () => {
                          const to = typeof window !== 'undefined' ? window.prompt(`Send "${file.name}" to (enter email address):`) : null;
                          if (!to?.trim()) return;
                          const result = await sendDriveFileAsEmail({ fileId: file.id, fileName: file.name, mimeType: file.mimeType, to: to.trim() });
                          if (typeof window !== 'undefined') window.alert(result.success ? `"${file.name}" sent to ${to.trim()}.` : `Failed: ${result.error ?? 'Could not send the file.'}`);
                        }} accessibilityLabel={`Send ${file.name} as email attachment`}>
                          <Text style={styles.driveSendBtnText}>✉ Send</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Saved to Drive */}
              {turn.savedDocs.map((doc, i) => (
                <TouchableOpacity key={i} style={styles.savedDocCard} onPress={() => doc.webViewLink ? Linking.openURL(doc.webViewLink) : undefined} accessibilityLabel="Open document in Google Drive">
                  <Text style={styles.savedDocLabel}>📄 Saved to Google Drive</Text>
                  <Text style={styles.savedDocTitle}>{doc.title}</Text>
                  {doc.webViewLink ? <Text style={styles.eventLink}>Tap to open in Google Docs</Text> : null}
                </TouchableOpacity>
              ))}

              {/* Calendar events created */}
              {turn.createdEvents.map((ev, i) => (
                <TouchableOpacity key={i} style={styles.eventCard} onPress={() => { if (ev.htmlLink) { const a = document.createElement('a'); a.href = ev.htmlLink; a.target = '_blank'; a.rel = 'noopener noreferrer'; document.body.appendChild(a); a.click(); document.body.removeChild(a); } }} accessibilityLabel="Open event in Google Calendar">
                  <Text style={styles.eventLabel}>📅 Event added to calendar</Text>
                  <Text style={styles.eventTitle}>{ev.summary}</Text>
                  {ev.htmlLink ? <Text style={styles.eventLink}>Tap to view in Google Calendar</Text> : null}
                </TouchableOpacity>
              ))}

              {/* Memory saved */}
              {turn.rememberedItems.map((item, i) => (
                <View key={i} style={styles.memoryCard}>
                  <Text style={styles.memoryLabel}>🧠 Saved to memory</Text>
                  <Text style={styles.memoryText}>{item.text}</Text>
                  {item.count > 0 && <Text style={styles.memoryMeta}>{item.count} fragment{item.count !== 1 ? 's' : ''} stored</Text>}
                </View>
              ))}
            </View>
          ))}

          {/* Conversation action cards */}
          {convActions.length > 0 && (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.convActionsHeader}>📋 Actions from your conversation</Text>
              {convActions.map((action, i) => (
                <ConversationActionCard
                  key={i}
                  action={action}
                  onCalendar={(a) => send(`Create a calendar event: ${a.calendar_title ?? a.title}, ${a.timing}`)}
                  onEmail={(a) => setInputText(`Draft an email to book: ${a.title}. ${a.email_draft ?? a.description}`)}
                />
              ))}
              {savedDocLink ? (
                <TouchableOpacity
                  style={styles.convSavedDoc}
                  onPress={() => Linking.openURL(savedDocLink)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.convSavedDocText}>📄 Full transcript saved to Google Drive — tap to open</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {/* Conversation transcript — speaker-labeled utterances */}
          {convUtterances.length > 0 && (
            <View style={styles.convTranscript}>
              <Text style={styles.convActionsHeader}>🎙 Conversation Transcript</Text>
              {convUtterances.map((u, i) => {
                const name = committedNamesRef.current[u.speaker] || confirmedNames[u.speaker] || localNames[u.speaker] || `Speaker ${u.speaker}`;
                const isFirst = speakers[0] === u.speaker;
                return (
                  <View key={i} style={[styles.utteranceRow, isFirst ? styles.utteranceLeft : styles.utteranceRight]}>
                    <Text style={styles.utteranceSpeaker}>{name}</Text>
                    <Text style={styles.utteranceText}>{u.text}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Voice error message */}
          {voiceError ? (
            <View style={styles.statusRow}>
              <Text style={styles.errorText}>{voiceError}</Text>
            </View>
          ) : null}

          {/* Status indicator */}
          {statusLabel ? (
            <View style={styles.statusRow}>
              {status === 'thinking' && (
                <ActivityIndicator size="small" color={Colors.primary} />
              )}
              <Text style={[
                styles.statusText,
                status === 'error' && styles.errorText,
              ]}>
                {statusLabel}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Recording / transcribing status */}
        {memoState === 'recording' ? (
          <View style={styles.statusRow}>
            <Text style={styles.recordingHintText}>🔴 Recording… tap ⏹ when done</Text>
          </View>
        ) : memoState === 'transcribing' ? (
          <View style={styles.statusRow}>
            <Text style={styles.memoTranscriptText}>Processing…</Text>
          </View>
        ) : null}

        {/* Memo transcript preview */}
        {memoTranscript ? (
          <View style={styles.statusRow}>
            <Text style={styles.memoTranscriptText}>🎙 Heard: "{memoTranscript}"</Text>
          </View>
        ) : null}

        {/* Memo error */}
        {memoError ? (
          <View style={styles.statusRow}>
            <Text style={styles.errorText}>{memoError}</Text>
          </View>
        ) : null}

        {/* Conversation recorder error / status */}
        {convError ? (
          <View style={styles.statusRow}>
            <Text style={styles.errorText}>{convError}</Text>
          </View>
        ) : convState === 'uploading' || convState === 'transcribing' || convState === 'extracting' ? (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={Colors.moderate} />
            <Text style={styles.statusText}>
              {convState === 'uploading' ? 'Uploading audio…'
                : convState === 'transcribing' ? 'Transcribing with speaker detection…'
                : 'Extracting action items…'}
            </Text>
          </View>
        ) : null}

        {/* Conversation recording banner — simple, no countdown */}
        {convState === 'recording' && (
          <View style={styles.convRecordingBanner}>
            <View style={styles.convRecordingDot} />
            <Text style={styles.convRecordingText}>Recording conversation… tap ⏹ to stop</Text>
          </View>
        )}

        {/* Stop speaking button — visible only while Naavi is talking */}
        {status === 'speaking' && (
          <TouchableOpacity
            style={styles.stopSpeakingBtn}
            onPress={stopSpeaking}
            accessibilityLabel="Stop speaking"
          >
            <Text style={styles.stopSpeakingText}>⏹ Stop</Text>
          </TouchableOpacity>
        )}

        {/* Hands-free mode status banner */}
        {handsfree.state === 'listening' && (
          <View style={styles.handsfreeBanner}>
            <View style={styles.handsfreePulse} />
            <Text style={styles.handsfreeBannerText}>Listening…</Text>
            <TouchableOpacity onPress={handsfree.deactivate} style={styles.handsfreeStopBtn}>
              <Text style={styles.handsfreeStopText}>End</Text>
            </TouchableOpacity>
          </View>
        )}
        {handsfree.state === 'processing' && (
          <View style={styles.handsfreeBanner}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.handsfreeBannerText}>Processing…</Text>
          </View>
        )}
        {handsfree.state === 'waiting' && (
          <View style={styles.handsfreeBanner}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.handsfreeBannerText}>
              {status === 'thinking' ? 'Thinking…' : status === 'speaking' ? 'Speaking…' : 'Working…'}
            </Text>
          </View>
        )}
        {handsfree.state === 'paused' && (
          <View style={[styles.handsfreeBanner, styles.handsfreeBannerPaused]}>
            <Text style={styles.handsfreeBannerText}>Tap Resume to continue</Text>
            <TouchableOpacity onPress={handsfree.activate} style={styles.handsfreeResumeBtn}>
              <Text style={styles.handsfreeStopText}>Resume</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handsfree.deactivate} style={styles.handsfreeStopBtn}>
              <Text style={styles.handsfreeStopText}>End</Text>
            </TouchableOpacity>
          </View>
        )}
        {handsfree.error && (
          <View style={styles.statusRow}>
            <Text style={styles.errorText}>{handsfree.error}</Text>
          </View>
        )}

        {/* Input area — two rows when hands-free is inactive */}
        {handsfree.state === 'inactive' ? (
          <View style={styles.inputArea}>
            {/* Row 1: text input + send (full width) */}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('home.inputPlaceholder')}
                placeholderTextColor={Colors.textMuted}
                multiline
                maxLength={500}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                editable={status === 'idle' || status === 'error'}
                accessibilityLabel="Message input"
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!inputText.trim() || status === 'thinking' || status === 'speaking') && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!inputText.trim() || status === 'thinking' || status === 'speaking'}
                accessibilityLabel="Send message"
              >
                <Text style={styles.sendBtnText}>➤</Text>
                <Text style={styles.sendBtnLabel}>Send</Text>
              </TouchableOpacity>
            </View>

            {/* Row 2: three action buttons centered */}
            <View style={styles.actionButtonsRow}>
              {/* Naavi mic — speak a question, note, or command */}
              {memoSupported && (
                <TouchableOpacity
                  style={[styles.unifiedBtn, memoState === 'recording' && styles.unifiedBtnActive]}
                  onPress={() => {
                    if (memoState === 'recording') {
                      // Ignore stop taps within 1500ms of starting — prevents double-fire on web
                      if (Date.now() - memoStartedAtRef.current < 1500) return;
                      stopRecording(async (transcript) => {
                        if (!transcript.trim()) return;
                        setMemoTranscript(transcript);
                        await send(transcript);
                        setTimeout(() => setMemoTranscript(null), 5000);
                      }, voiceLang);
                      return;
                    }
                    if (memoState === 'transcribing' || status === 'thinking') return;
                    memoStartedAtRef.current = Date.now();
                    startRecording();
                  }}
                  accessibilityLabel="Tap to speak to MyNaavi"
                >
                  <Text style={styles.unifiedBtnText}>
                    {memoState === 'recording' ? '⏹' : memoState === 'transcribing' ? '…' : '🎙'}
                  </Text>
                  <Text style={styles.bottomBtnLabel}>Voice</Text>
                </TouchableOpacity>
              )}

              {/* Hands-free button */}
              <TouchableOpacity
                style={[styles.unifiedBtn, { backgroundColor: '#2563EB' }]}
                onPress={() => handsfree.activate()}
                accessibilityLabel="Tap to start hands-free mode"
              >
                <Text style={styles.unifiedBtnText}>🙌</Text>
                <Text style={styles.bottomBtnLabel}>Free</Text>
              </TouchableOpacity>

              {/* Conversation button */}
              {memoSupported && (
                <TouchableOpacity
                  style={[styles.convBtn, convState === 'recording' && styles.convBtnActive]}
                  onPress={() => {
                    if (convState === 'labeling') { setShowSpeakerModal(true); return; }
                    if (convState === 'recording') { stopConvRecording(); stopLive(); return; }
                    if (['uploading', 'transcribing', 'extracting'].includes(convState)) return;
                    resetConv(); clearLive(); startConvRecording(voiceLang); startLive();
                  }}
                  accessibilityLabel="Tap to record a conversation"
                >
                  {['uploading', 'transcribing', 'extracting'].includes(convState) ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.unifiedBtnText}>
                      {convState === 'recording' ? '⏹' : convState === 'labeling' ? '🏷️' : '👥'}
                    </Text>
                  )}
                  <Text style={styles.bottomBtnLabel}>Record</Text>
                </TouchableOpacity>
              )}

              {/* Timer badge — info only, not tappable */}
              {convState === 'recording' && (
                <View style={styles.convTimerBadge} pointerEvents="none">
                  <View style={styles.convTimerDot} />
                  <Text style={styles.convTimerText}>
                    {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function friendlyMimeType(mimeType: string): string {
  const types: Record<string, string> = {
    'application/vnd.google-apps.document':     'Google Doc',
    'application/vnd.google-apps.spreadsheet':  'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.folder':       'Folder',
    'application/pdf':                          'PDF',
    'application/msword':                       'Word',
    'text/plain':                               'Text file',
  };
  return types[mimeType] ?? 'File';
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bgApp,
  },
  flex: {
    flex: 1,
  },
  navBanner: {
    marginHorizontal: 0,
    paddingVertical: 14,
    paddingHorizontal: 20,
    zIndex: 20,
  },
  navBannerOnTime: {
    backgroundColor: Colors.accent,
  },
  navBannerLate: {
    backgroundColor: Colors.alert,
  },
  navBannerText: {
    color: '#fff',
    fontSize: Typography.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  greetingRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: 8,
  },
  greetingActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 16,
  },
  brandName: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: Colors.accent,
  },
  greetingSmall: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  newChatBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: Colors.accent,
  },
  newChatBtnText: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.accentDark,
  },
  labeledBtn: {
    alignItems: 'center',
    gap: 2,
    minWidth: 50,
    overflow: 'visible',
  },
  btnLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
    width: 50,
  },
  greetingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.accent,
  },
  notesBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesBtnText: {
    fontSize: 18,
  },
  signInBanner: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.caution,
  },
  signInBannerText: {
    color: Colors.caution,
    fontSize: Typography.body,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    fontSize: 22,
    color: Colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
  },
  greeting: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    flex: 1,
  },
  sectionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  briefGroup: {
    marginBottom: 12,
  },
  briefGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.bgElevated,
    borderRadius: 12,
    marginBottom: 8,
  },
  briefGroupLabel: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
    flex: 1,
  },
  briefGroupCount: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.accent,
    marginRight: 10,
    opacity: 0.7,
  },
  briefGroupArrow: {
    fontSize: 28,
    fontWeight: '300',
    color: Colors.accent,
    lineHeight: 28,
  },
  briefSection: {
    marginBottom: 16,
  },
  daySelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  daySelectorBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: Colors.bgElevated,
  },
  daySelectorBtnActive: {
    backgroundColor: Colors.accent,
  },
  daySelectorText: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  daySelectorTextActive: {
    color: Colors.accentDark,
  },
  conversationSection: {
    marginTop: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingLeft: 4,
  },
  statusText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  errorText: {
    color: Colors.error,
    fontStyle: 'normal',
  },
  savedDocCard: {
    marginTop: 12,
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.caution,
    padding: 16,
    gap: 4,
  },
  savedDocLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.caution,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  savedDocTitle: {
    fontSize: Typography.cardTitle,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  eventCard: {
    marginTop: 12,
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.gentle,
    padding: 16,
    gap: 4,
  },
  eventLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.gentle,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  eventTitle: {
    fontSize: Typography.cardTitle,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  eventLink: {
    fontSize: Typography.body,
    color: Colors.textHint,
    marginTop: 2,
  },
  contactCard: {
    marginTop: 12,
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.gentle,
    padding: 16,
    gap: 6,
  },
  contactLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.gentle,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  memoryCard: {
    marginTop: 12,
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.gentle,
    padding: 16,
    gap: 4,
  },
  memoryLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.gentle,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  memoryText: {
    fontSize: Typography.body,
    color: Colors.textPrimary,
    lineHeight: Typography.lineHeightBody,
  },
  memoryMeta: {
    fontSize: Typography.caption,
    color: Colors.textHint,
    marginTop: 4,
    fontStyle: 'italic',
  },
  draftCard: {
    marginTop: 12,
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.moderate,
    padding: 16,
    gap: 6,
  },
  draftLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.moderate,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  draftField: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
  },
  draftFieldLabel: {
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  draftBody: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
    marginTop: 6,
    lineHeight: Typography.lineHeightBase,
  },
  contactResolved: {
    fontSize: Typography.sm,
    color: Colors.success,
    fontStyle: 'italic',
  },
  draftSendBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: Colors.moderate,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  draftSendBtnDisabled: {
    opacity: 0.5,
  },
  draftSendBtnText: {
    color: '#fff',
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  recordingHintText: {
    fontSize: Typography.body,
    color: Colors.alert,
    fontWeight: Typography.semibold,
    flex: 1,
  },
  memoTranscriptText: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    flex: 1,
  },
  draftSendError: {
    marginTop: 6,
    fontSize: Typography.sm,
    color: Colors.error,
  },
  driveSection: {
    marginTop: 12,
    gap: 8,
  },
  driveCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.moderate,
    padding: 16,
    gap: 4,
  },
  driveCardIndented: {
    marginLeft: 16,
    borderLeftColor: Colors.moderate,
    backgroundColor: Colors.bgElevated,
  },
  driveFileName: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  driveFileMeta: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  driveSendBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: Colors.moderate,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  driveSendBtnText: {
    color: '#fff',
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  memoBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.alert,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoBtnRecording: {
    backgroundColor: Colors.alert,
    opacity: 0.8,
  },
  recordingPromptBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.moderate,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  recordingPromptText: {
    flex: 1,
    color: '#fff',
    fontSize: Typography.body,
    fontWeight: '600',
  },
  recordingPromptBtn: {
    backgroundColor: Colors.bgElevated,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  recordingPromptBtnText: {
    color: Colors.moderate,
    fontWeight: '700',
    fontSize: Typography.body,
  },
  recordingPromptDismiss: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 18,
    paddingHorizontal: 4,
  },
  convActionsHeader: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.moderate,
    marginBottom: 8,
    marginTop: 4,
  },
  convSavedDoc: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 12,
    marginTop: 4,
    borderLeftWidth: 3,
    borderLeftColor: Colors.moderate,
  },
  convSavedDocText: {
    fontSize: Typography.body,
    color: Colors.moderate,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  speakerModal: {
    backgroundColor: Colors.bgCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 16,
  },
  speakerModalTitle: {
    fontSize: Typography.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  speakerModalSub: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  speakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  speakerLabel: {
    fontSize: Typography.sm,
    fontWeight: '600',
    color: Colors.textPrimary,
    width: 80,
  },
  speakerInput: {
    flex: 1,
    backgroundColor: Colors.bgElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: Typography.body,
    color: Colors.textPrimary,
  },
  speakerConfirmBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  speakerConfirmText: {
    color: Colors.accentDark,
    fontWeight: '700',
    fontSize: Typography.body,
  },
  speakerCancelText: {
    color: Colors.textMuted,
    fontSize: Typography.sm,
    textAlign: 'center',
    paddingVertical: 8,
  },
  convBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.moderate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  convBtnRecording: {
    backgroundColor: Colors.moderate,
  },
  convBtnActive: {
    backgroundColor: Colors.alert,
  },
  memoBtnText: {
    fontSize: 22,
  },
  stopSpeakingBtn: {
    alignSelf: 'center',
    backgroundColor: Colors.alert,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 8,
  },
  stopSpeakingText: {
    color: '#fff',
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bgApp,
    gap: 12,
  },
  inputArea: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bgApp,
    gap: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingBottom: 12,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.bgElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    maxHeight: 120,
    lineHeight: Typography.lineHeightBody,
    height: 48,
  },
  // ─── Live transcript panel ──────────────────────────────────────────────────
  livePanel: {
    backgroundColor: Colors.bgCard,
    borderTopWidth: 1,
    borderTopColor: Colors.moderate,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
    maxHeight: 140,
  },
  livePanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.alert,
  },
  liveLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.alert,
    letterSpacing: 1.5,
  },
  liveErrorText: {
    fontSize: 11,
    color: Colors.alert,
    marginLeft: 6,
    fontStyle: 'italic',
  },
  livePanelScroll: {
    flex: 1,
  },
  liveSegmentText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 20,
    marginBottom: 2,
  },
  livePartialText: {
    fontSize: 14,
    color: '#fff',
    lineHeight: 21,
    fontStyle: 'italic',
  },
  // ─── Unified record button ──────────────────────────────────────────────────
  langBtn: {
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  langBtnText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.accent,
    letterSpacing: 0.5,
  },
  sendBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.caution,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  sendBtnDisabled: {
    backgroundColor: Colors.bgElevated,
  },
  sendBtnText: {
    fontSize: 24,
    lineHeight: 28,
  },
  sendBtnLabel: {
    fontSize: 9,
    color: '#fff',
    marginTop: -2,
    textAlign: 'center',
  },
  bottomBtnLabel: {
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
    width: 52,
  },
  unifiedBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unifiedBtnActive: {
    backgroundColor: Colors.alert,
  },
  unifiedBtnNote: {
    backgroundColor: Colors.gentle,
  },
  unifiedBtnConv: {
    backgroundColor: Colors.moderate,
  },
  unifiedBtnText: {
    fontSize: 20,
    color: '#fff',
  },
  // ─── Mode selection sheet ───────────────────────────────────────────────────
  modeOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modeSheet: {
    backgroundColor: Colors.bgCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 4,
  },
  modeSheetTitle: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textHint,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  modeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: Colors.bgElevated,
    marginBottom: 8,
    gap: 14,
  },
  modeOptionIcon: {
    fontSize: 28,
  },
  modeOptionBody: {
    flex: 1,
  },
  modeOptionTitle: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modeOptionDesc: {
    fontSize: Typography.caption,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  // ─── Saved note card ────────────────────────────────────────────────────────
  savedNoteCard: {
    marginTop: 12,
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.gentle,
    padding: 16,
    gap: 4,
  },
  savedNoteLabel: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.gentle,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  savedNoteTitle: {
    fontSize: Typography.body,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  convTranscript: {
    marginBottom: 12,
  },
  utteranceRow: {
    marginBottom: 8,
    maxWidth: '85%',
    padding: 10,
    borderRadius: 12,
  },
  utteranceLeft: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.bgElevated,
    borderBottomLeftRadius: 4,
  },
  utteranceRight: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.bgCard,
    borderBottomRightRadius: 4,
  },
  utteranceSpeaker: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.moderate,
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  utteranceText: {
    fontSize: Typography.body,
    color: Colors.textPrimary,
    lineHeight: Typography.lineHeightBody,
  },
  convRecordingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  convRecordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.alert,
  },
  convRecordingText: {
    fontSize: Typography.body,
    color: Colors.alert,
    fontWeight: '600',
  },
  convTimerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: 22,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 5,
  },
  convTimerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.alert,
  },
  convTimerText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.alert,
  },
  navCard: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  navLabel: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.moderate,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  navDestination: {
    fontSize: Typography.body,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  navDetail: {
    fontSize: Typography.caption,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  navLeaveBy: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.moderate,
    marginBottom: 8,
  },
  navOpenBtn: {
    backgroundColor: Colors.moderate,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
  },
  navOpenBtnText: {
    fontSize: Typography.body,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // ── Hands-free mode styles ──────────────────────────────────────────────
  handsfreeBtn: {
    backgroundColor: Colors.accent,
  },
  handsfreeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    gap: 10,
  },
  handsfreeBannerPaused: {
    backgroundColor: Colors.bgElevated,
  },
  handsfreeBannerText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  handsfreePulse: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4ADE80',
  },
  handsfreeStopBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  handsfreeResumeBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  handsfreeStopText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
