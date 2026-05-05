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

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Modal,
  AppState,
  Alert,
  Keyboard,
  Linking as RNLinking,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import * as Speech from 'expo-speech';
import { SPEECH } from '@/lib/voice-confirm';

import { getUserName } from '@/lib/naavi-client';
import { useOrchestrator, isInputLocked, isSendLocked, isOrangeButtonVisible, orangeButtonLabel } from '@/hooks/useOrchestrator';
import { useVoice } from '@/hooks/useVoice';
import { useWhisperMemo } from '@/hooks/useWhisperMemo';
import { useConversationRecorder } from '@/hooks/useConversationRecorder';
import { useLiveTranscript } from '@/hooks/useLiveTranscript';
import { VoiceButton } from '@/components/VoiceButton';
import { BriefCard } from '@/components/BriefCard';
import { ConversationBubble } from '@/components/ConversationBubble';
import { isVoiceEnabledSync, hydrateVoicePref, refreshVoicePref } from '@/lib/voicePref';
import { ConversationActionCard } from '@/components/ConversationActionCard';
import { TopBarMenu } from '@/components/TopBarMenu';
import { IconButton } from '@/components/IconButton';
import { LocationRuleCard } from '@/components/LocationRuleCard';
import { getBriefWindow, filterByWindow, pickRandomTip } from '@/lib/brief-logic';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';
import type { BriefItem, GlobalSearchResult } from '@/lib/naavi-client';
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
import { lookupContact, type Contact } from '@/lib/contacts';
import { resolveRecipient } from '@/lib/recipientLookup';
import { saveContact, loadTodayConversation, signInWithGoogle, signOut } from '@/lib/supabase';
import { getBackgroundPermission, getForegroundPermission, requestLocationPermissions } from '@/lib/location';
import { fetchUpcomingEvents, fetchUpcomingBirthdays, captureAndStoreGoogleToken, triggerCalendarSync, isCalendarConnected } from '@/lib/calendar';
import { registry } from '@/lib/adapters/registry';
import { supabase } from '@/lib/supabase';
import { invokeWithTimeout, queryWithTimeout, getSessionWithTimeout, getCachedUserId } from '@/lib/invokeWithTimeout';
import { justForegrounded, msSinceForeground, getLifecycleSession } from '@/lib/appLifecycle';
import { remoteLog } from '@/lib/remoteLog';

// ─── Integrations data ────────────────────────────────────────────────────────

// Integration catalogue shown in the Info modal. Items may use either an
// Ionicons name (preferred — consistent sizing + stroke weight with the home
// bottom bar) or an emoji fallback when no Ionicons match exists.
type IntegrationItem =
  | { ionIcon: string; name: string; description: string; icon?: never }
  | { icon: string;    name: string; description: string; ionIcon?: never };

const INTEGRATION_CATEGORIES: Array<{ category: string; items: IntegrationItem[] }> = [
  {
    category: 'AI Core',
    items: [
      {
        icon: '🤖',
        name: 'MyNaavi AI',
        description: 'Claude-powered assistant. Robert speaks or types naturally — MyNaavi understands intent and takes action without any app switching.',
      },
      {
        // Matches the mic icon on the home screen bottom bar so the two feel
        // connected — same glyph, same weight, same colour.
        ionIcon: 'mic',
        name: 'Whisper Voice',
        description: 'Tap the microphone at the bottom right, speak your request, and release. OpenAI Whisper transcribes the audio and MyNaavi responds. Enables fully hands-free interaction.',
      },
    ],
  },
  {
    category: 'Email & Contacts',
    items: [
      {
        icon: '✉️',
        name: 'Gmail',
        description: 'Surfaces important unread emails in the brief. Robert can send emails by voice ("send John a message saying I\'ll be late") — draft appears for review, one tap to send.',
      },
      {
        ionIcon: 'people-circle',
        name: 'Google Contacts',
        description: 'Automatically resolves contact names to email addresses. Robert says a name — MyNaavi finds the email. Unknown contacts are saved for future use.',
      },
    ],
  },
  {
    category: 'Calendar & Navigation',
    items: [
      {
        icon: '📅',
        name: 'Google Calendar',
        description: 'Reads upcoming events into the morning brief. Robert can create events by voice ("schedule a meeting with Sarah on Friday at 2pm") — automatically added to Google Calendar.',
      },
      {
        icon: '🗺️',
        name: 'Google Maps',
        description: 'Shows driving time and leave-by time for meetings with a location. A banner automatically appears when it\'s time to leave — tap to open Google Maps navigation.',
      },
    ],
  },
  {
    category: 'Files & Notes',
    items: [
      {
        icon: '📁',
        name: 'Google Drive',
        description: 'Search documents by voice. Save voice notes or text directly as Google Docs. Send Drive files as email attachments — all without opening Drive.',
      },
      {
        icon: '🧠',
        name: 'Knowledge Memory',
        description: 'Robert can say "remember that…" and MyNaavi stores it permanently. Facts, preferences, and life context are recalled automatically in future conversations — no need to repeat yourself.',
      },
    ],
  },
];

function IntegrationsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={intStyles.overlay}>
        <View style={intStyles.sheet}>
          <View style={intStyles.header}>
            <Text style={intStyles.title}>MyNaavi Orchestration</Text>
            <TouchableOpacity onPress={onClose} style={intStyles.closeBtn}>
              <Text style={intStyles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {INTEGRATION_CATEGORIES.map(group => (
              <View key={group.category}>
                <Text style={intStyles.categoryLabel}>{group.category}</Text>
                {group.items.map(int => (
                  <View key={int.name} style={intStyles.card}>
                    {int.ionIcon ? (
                      <View style={intStyles.cardIconWrap}>
                        <Ionicons
                          name={int.ionIcon as React.ComponentProps<typeof Ionicons>['name']}
                          size={28}
                          color={Colors.accent}
                        />
                      </View>
                    ) : (
                      <Text style={intStyles.cardIcon}>{int.icon}</Text>
                    )}
                    <View style={intStyles.cardBody}>
                      <Text style={intStyles.cardName}>{int.name}</Text>
                      <Text style={intStyles.cardDesc}>{int.description}</Text>
                    </View>
                  </View>
                ))}
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
    fontWeight: '700',
    color: Colors.textPrimary,
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
    fontSize: 30,
    marginRight: 14,
    marginTop: 2,
    width: 36,
    textAlign: 'center',
  },
  cardIconWrap: {
    width: 36,
    marginRight: 14,
    marginTop: 2,
    alignItems: 'center',
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
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  cardDesc: {
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 22,
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

function DraftCard({ action, onManualSend }: { action: import('@/lib/naavi-client').NaaviAction; onManualSend?: () => void }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState((action as any)._voiceConfirmed === true);
  const [sendError, setSendError] = useState<string | null>(null);
  const [resolvedContact, setResolvedContact] = useState<string | null>(null);

  // Email recipient resolution (Session 26 design lock).
  //   recipientCandidates  — all matches returned by resolveRecipient()
  //   selectedRecipientIdx — picker selection (0 by default, multi-match only)
  //   manualEmail          — fallback typed email when no contact match
  //   overrideManualEntry  — V57.3: when the picker's matches are all wrong
  //                          ("none of these"), Robert switches to manual
  //                          email entry even if the picker had matches.
  //                          Privacy fix — without this, the picker forces
  //                          one of the wrong matches.
  //   discarded            — V57.3: Robert can dismiss a draft card via the
  //                          ✕ Discard button. Sets the card to a minimal
  //                          "Draft discarded" placeholder; no Gmail action.
  // Messaging (SMS/WhatsApp) keeps the existing single-match flow for V57.
  const [recipientCandidates, setRecipientCandidates] = useState<Contact[]>([]);
  const [selectedRecipientIdx, setSelectedRecipientIdx] = useState<number>(0);
  const [manualEmail, setManualEmail] = useState<string>('');
  const [overrideManualEntry, setOverrideManualEntry] = useState<boolean>(false);
  const [discarded, setDiscarded] = useState<boolean>(false);

  const channel = String(action.channel ?? 'email').toLowerCase() as 'email' | 'sms' | 'whatsapp';
  const isMessaging = channel === 'sms' || channel === 'whatsapp';
  const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'Email';
  const channelIcon = channel === 'whatsapp' ? '💬' : channel === 'sms' ? '📱' : '✉';

  // Auto-lookup contact on mount.
  // Email path uses resolveRecipient (multi-match capable + calendar fallback).
  // Messaging path uses single-match lookupContact (unchanged for V57).
  React.useEffect(() => {
    const to = String(action.to ?? '').trim();
    if (!to || to.includes('@') || to.startsWith('+')) return;

    if (isMessaging) {
      lookupContact(to).then(contact => {
        if (contact?.phone) setResolvedContact(contact.phone);
      });
      return;
    }

    // Email — full multi-match resolution
    resolveRecipient(to).then(({ matches }) => {
      setRecipientCandidates(matches);
      if (matches.length > 0) {
        setSelectedRecipientIdx(0);
        // Mirror into the legacy resolvedContact so the inline "(email)"
        // readback still renders for the single-match case.
        if (matches.length === 1 && matches[0].email) {
          setResolvedContact(matches[0].email);
        }
      }
    });
  }, [action.to, isMessaging]);

  async function handleSend() {
    // If voice-confirm is active for this draft, clear it (tap overrides voice)
    onManualSend?.();
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
        const { data, error } = await invokeWithTimeout('send-sms', {
          body: { to: phone, body: String(action.body ?? ''), channel },
        }, 30_000);
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
          // V57.8 — speak confirmation (CLAUDE.md "ONE TTS confirmation"
          // rule). Both tap-to-send and voice-confirm-to-send must emit
          // the same audio feedback. Without this Robert can't tell from
          // a quick glance whether the message was sent.
          try { Speech.speak(SPEECH.SENT, { rate: 1.0, pitch: 1.0 }); } catch {}
        }
      } catch (err) {
        setSending(false);
        setSendError(err instanceof Error ? err.message : `${channelLabel} send failed`);
      }
    } else {
      // Email — recipient resolution per Session 26 design lock:
      //   1. `to` is already an email      → use directly
      //   2. Manual email typed by Robert  → use that (multi-channel fallback)
      //   3. Selected from picker          → use that
      //   4. Single contact match          → use it (already shown inline)
      //   5. Nothing                       → ask Robert (block send)
      let email: string | null = to.includes('@') ? to : null;
      if (!email && manualEmail.trim().includes('@')) {
        email = manualEmail.trim();
      }
      if (!email && recipientCandidates.length > 0) {
        email = recipientCandidates[selectedRecipientIdx]?.email ?? null;
      }
      if (!email) {
        setSending(false);
        setSendError(`No email address found for ${to}. Type one above or say "Remember ${to}'s email is name@example.com".`);
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
        // V57.8 — speak confirmation (see matching note in SMS path).
        try { Speech.speak(SPEECH.SENT, { rate: 1.0, pitch: 1.0 }); } catch {}
      } else {
        setSendError(result.error ?? 'Send failed');
      }
    }
  }

  // Email-only — show a picker when there are multiple matches, or a manual
  // input field when there are no matches and `to` isn't already an address.
  //
  // Channel-consistency rule (Session 26 design lock):
  //   - The Naavi prompt (RULE 1a) speaks "I don't have their email — what is
  //     it?" when emitting DRAFT_MESSAGE without an address. When Voice Playback
  //     is ON, that line is announced via TTS.
  //   - This card is the text-channel fallback: Robert types the email here.
  //   - Pure voice-channel asking (Robert speaks the email, Naavi captures via
  //     directed STT) is DEFERRED to V58 along with Voice-mode speaker labeling.
  //   - Hands-free users who land here must tap End to use the keyboard. UX gap
  //     is documented; full voice-channel email ask ships in V58.
  const toRaw = String(action.to ?? '');
  const toIsEmail = toRaw.includes('@');
  const showPicker = !isMessaging && !toIsEmail && recipientCandidates.length > 1 && !sent && !overrideManualEntry;
  const showManualInput = !isMessaging && !toIsEmail && (recipientCandidates.length === 0 || overrideManualEntry) && !sent;

  // Discarded card — minimal placeholder, no Gmail action possible.
  if (discarded) {
    return (
      <View style={[styles.draftCard, { opacity: 0.55 }]}>
        <Text style={[styles.draftLabel, { color: Colors.textMuted }]}>
          ✕ Draft discarded
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.draftCard}>
      <Text style={styles.draftLabel}>
        {sent ? `✓ ${channelLabel} sent` : `${channelIcon} ${channelLabel} draft ready`}
      </Text>
      <Text style={styles.draftField}>
        <Text style={styles.draftFieldLabel}>To: </Text>
        {toRaw}
        {resolvedContact && !toIsEmail && !toRaw.startsWith('+')
          ? <Text style={styles.contactResolved}> ({resolvedContact})</Text>
          : null}
      </Text>
      {/* Multi-match picker — Robert taps the right John. */}
      {showPicker && (
        <View style={{ marginTop: 6, marginBottom: 4 }}>
          <Text style={[styles.draftFieldLabel, { marginBottom: 4 }]}>
            I found {recipientCandidates.length} matches — tap the right one:
          </Text>
          {recipientCandidates.map((c, idx) => (
            <TouchableOpacity
              key={`${c.email ?? 'no-email'}-${idx}`}
              onPress={() => setSelectedRecipientIdx(idx)}
              accessibilityLabel={`Select ${c.name}`}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: 6, paddingHorizontal: 10,
                marginBottom: 4, borderRadius: 6,
                backgroundColor: idx === selectedRecipientIdx ? Colors.accent : 'rgba(0,0,0,0.05)',
              }}
            >
              <Text style={{ color: idx === selectedRecipientIdx ? '#fff' : Colors.text, fontWeight: '600' }}>
                {idx === selectedRecipientIdx ? '● ' : '○ '}{c.name}
              </Text>
              <Text style={{ color: idx === selectedRecipientIdx ? '#fff' : Colors.textMuted, marginLeft: 8 }}>
                {c.email}
              </Text>
            </TouchableOpacity>
          ))}
          {/* V57.3: "None of these" escape — when none of the suggested
              contacts is the right person, Robert can switch to typing a
              fresh email. Without this, the picker silently forced one of
              the wrong choices (privacy gap). */}
          <TouchableOpacity
            onPress={() => setOverrideManualEntry(true)}
            accessibilityLabel="None of these — type a different email"
            style={{
              paddingVertical: 8, paddingHorizontal: 10,
              marginTop: 4, borderRadius: 6,
              borderWidth: 0.5, borderColor: Colors.textMuted,
              borderStyle: 'dashed',
            }}
          >
            <Text style={{ color: Colors.accent, fontWeight: '600' }}>
              ✕ None of these — type a different email
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {/* No-match manual entry — Robert types the email himself. */}
      {showManualInput && (
        <View style={{ marginTop: 6, marginBottom: 4 }}>
          <Text style={[styles.draftFieldLabel, { marginBottom: 4 }]}>
            I don't have an email for {toRaw} — type it here:
          </Text>
          <TextInput
            style={styles.speakerInput}
            placeholder="name@example.com"
            placeholderTextColor={Colors.textMuted}
            value={manualEmail}
            onChangeText={setManualEmail}
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
      )}
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
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TouchableOpacity
            style={[styles.draftSendBtn, sending && styles.draftSendBtnDisabled, { flex: 1 }]}
            onPress={handleSend}
            disabled={sending}
            accessibilityLabel={`Send ${channelLabel}`}
          >
            <Text style={styles.draftSendBtnText}>
              {sending ? 'Sending…' : `${channelIcon} Send`}
            </Text>
          </TouchableOpacity>
          {/* V57.3: ✕ Discard button — sets discarded=true; the entire card
              re-renders as a minimal "Draft discarded" placeholder. No Gmail
              interaction. Pairs with the picker "None of these" option as a
              clean exit from any draft Robert no longer wants to send. */}
          <TouchableOpacity
            style={styles.draftDiscardBtn}
            onPress={() => setDiscarded(true)}
            disabled={sending}
            accessibilityLabel="Discard draft"
          >
            <Text style={styles.draftDiscardBtnText}>✕ Discard</Text>
          </TouchableOpacity>
        </View>
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
  // V57.11.1 — mirror the input text in a ref so handleSend reads the
  // latest value without depending on the React state having flushed.
  // Wael 2026-05-04: typed "Navigate to my next meeting" but the bubble
  // showed "Navigate to my next" — last word lost because state hadn't
  // committed before Send fired. The ref always has the most recent
  // onChangeText value, no closure / batching gap.
  const [inputText, _setInputText] = useState('');
  const inputTextRef = useRef('');
  const setInputText = useCallback((t: string) => {
    inputTextRef.current = t;
    _setInputText(t);
  }, []);
  const [memoTranscript, setMemoTranscript] = useState<string | null>(null);
  const [brief, setBrief] = useState<BriefItem[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [navAlert, setNavAlert] = useState<{ title: string; location: string; startMs: number } | null>(null);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  // Location permission state. Tracks whether the device has BACKGROUND
  // location ("Always allow") — the level required for geofencing to fire
  // when the app is closed. Re-checked on sign-in and on app foreground in
  // case the user changed it via system settings. (Session 26 design lock,
  // V57.1 Bug 7: explicit value-permission framing tied to sign-in instead of
  // a hidden Settings toggle.)
  const [locationGranted, setLocationGranted] = useState<boolean>(true); // optimistic default; corrected on first check
  const [locationCheckDone, setLocationCheckDone] = useState<boolean>(false);
  const [locationBusy, setLocationBusy] = useState<boolean>(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // V57.8 — track which past turns the user manually expanded.
  // Default: only the latest turn is expanded; older turns auto-collapse to
  // a 1-line summary. User taps the summary to expand. Reduces cognitive
  // load on the chat page (Wael feedback 2026-04-29).
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set());
  const [briefDays, setBriefDays] = useState<number>(1); // default: today only
  const [recordingPrompt, setRecordingPrompt] = useState<{ title: string; endMs: number } | null>(null);

  // Marketing-hook tip for the empty-brief state. Picked once per mount so it
  // doesn't flicker on re-render. Copy comes from lib/brief-logic.ts.
  const tipRef = useRef<string>(pickRandomTip());
  // Screen-level peek caption for the bottom-bar icons. Rendered as a wide
  // bar above the input row so long descriptions can breathe horizontally
  // instead of being squeezed into the 52-px icon's bubble. Any IconButton
  // that's passed onPeek below toggles this through hover / long-press.
  const [peekText, setPeekText] = useState<string | null>(null);
  // Chat auto-clear timers — chat takes over the screen when turns > 0, and
  // must return to the brief on (a) user saying "cancel", (b) 3-min idle, or
  // (c) midnight rollover. Refs live here so clearTimeout works across re-renders.
  const chatIdleTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const midnightTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load weather immediately (no auth needed)
  useEffect(() => {
    fetchOttawaWeather().then(w => setBrief([w]));
  }, []);

  // Hydrate voice playback preference at app start (AsyncStorage cache),
  // then refresh from Supabase. Without this, every cold start would briefly
  // act as if voice is enabled even when the user has it turned off.
  useEffect(() => {
    hydrateVoicePref().then(() => { refreshVoicePref(); });
  }, []);

  // V57.9.7 — "stale auth" detection. The Layer 1 SecureStore fallback
  // catches most install-wipes-AsyncStorage cases silently. This is the
  // failsafe banner for the rare case where SecureStore ALSO didn't
  // restore (corrupted Keystore, oversized blob, fresh-fresh install).
  // Conditions: getCachedUserId returned non-null (proving prior sign-in
  // happened on this device) AND current session is null (auth not
  // restored). Banner offers one-tap re-sign-in.
  const [staleAuth, setStaleAuth] = useState(false);

  // Resolve user ID — from getSession on mount OR onAuthStateChange
  useEffect(() => {
    if (!supabase) return;

    getSessionWithTimeout().then((session) => {
      console.log('[Home] getSession:', session?.user?.id ?? 'none');
      if (session?.user) {
        setCurrentUserId(session.user.id);
        setIsSignedIn(true);
        setStaleAuth(false);
      } else if (getCachedUserId()) {
        // Cache says we WERE signed in here before — but the SDK has no
        // session right now. Show the recovery banner.
        console.warn('[Home] stale-auth: cached user_id present but session is null');
        setStaleAuth(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[Home] onAuthStateChange:', event, 'user:', session?.user?.id ?? 'none', 'msSinceFg:', msSinceForeground());
        remoteLog(getLifecycleSession(), 'home-auth-event', {
          event,
          has_session: !!session,
          has_user: !!session?.user,
          has_provider_refresh_token: !!session?.provider_refresh_token,
          ms_since_fg: msSinceForeground(),
        });
        if (event === 'SIGNED_IN' && session?.provider_refresh_token) {
          await captureAndStoreGoogleToken();
        }
        if (session?.user) {
          setCurrentUserId(session.user.id);
          setIsSignedIn(true);
          setStaleAuth(false);
        }
        if (event === 'SIGNED_OUT') {
          // V57.9.8 defensive — ignore SIGNED_OUT that fires within 5 s
          // of an AppState→active transition. The Supabase SDK can emit
          // a transient SIGNED_OUT during process resume while the
          // AsyncStorage / SecureStore session is still loading. Wael
          // 2026-05-01 hit this after granting "Allow all the time"
          // location permission — chat sends started returning 401 even
          // though the underlying user_tokens row was intact.
          if (justForegrounded(5_000)) {
            console.warn('[Home] SIGNED_OUT during foreground window — ignoring + re-polling');
            // Re-poll after 1.5 s. If the session genuinely is gone
            // (real sign-out), the re-poll returns null and we clear
            // state then. If it was a transient blip, we restore.
            setTimeout(async () => {
              try {
                const recheck = await getSessionWithTimeout();
                if (!recheck?.user) {
                  console.warn('[Home] re-poll confirms no session — clearing state');
                  setCurrentUserId(null);
                  setIsSignedIn(false);
                  setStaleAuth(false);
                } else {
                  console.log('[Home] re-poll restored session:', recheck.user.id);
                }
              } catch { /* leave state as-is */ }
            }, 1500);
            return;
          }
          setCurrentUserId(null);
          setIsSignedIn(false);
          setStaleAuth(false);
        }
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
    queryWithTimeout(
      supabase.from('knowledge_fragments')
        .select('content')
        .eq('user_id', currentUserId)
        .ilike('content', '%highway%')
        .limit(5),
      15_000,
      'select-highway-prefs',
    ).then(({ data }) => {
      avoidHighwaysRef.current = !!(data && data.length > 0);
    }).catch((err) => {
      // V57.7 — defensive catch. An unhandled rejection during startup
      // can crash the home render on Android. Fail open.
      console.error('[Home] highway-prefs lookup failed:', err);
    });
  }, [currentUserId]);

  // Check location permission whenever the user signs in (or changes user).
  // Background "Always allow" is required for geofencing to fire when the
  // app is closed. If not granted, a persistent banner in the home screen
  // explains the value and offers to enable. The banner stays until the
  // permission is granted — no hidden Settings toggle. (Bug 7, V57.1.)
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    (async () => {
      try {
        // V57.10.1 — banner hides when EITHER foreground or background
        // permission is granted. Old behaviour kept the banner visible
        // until "Allow all the time" was granted, which felt naggy after
        // the user had already chosen "While using the app". Wael
        // 2026-05-01: "we did not remove the Enable location from the
        // top of the home" — banner should disappear once any permission
        // is granted; the user has made their choice.
        const [fg, bg] = await Promise.all([
          getForegroundPermission(),
          getBackgroundPermission(),
        ]);
        if (cancelled) return;
        setLocationGranted(fg === 'granted' || bg === 'granted');
        setLocationCheckDone(true);
      } catch (err) {
        console.error('[Home] location permission check failed:', err);
        if (!cancelled) setLocationCheckDone(true); // proceed with default optimistic
      }
    })();
    return () => { cancelled = true; };
  }, [currentUserId]);

  // Re-check location permission on every app foreground — the user may have
  // changed it via system settings while away. Without this we'd keep showing
  // the "Enable location" banner even after the user granted from Settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active' && currentUserId) {
        // V57.10.1 — banner hides when EITHER foreground or background
        // permission is granted (see initial-check useEffect above).
        const [fg, bg] = await Promise.all([
          getForegroundPermission(),
          getBackgroundPermission(),
        ]);
        const anyGranted = fg === 'granted' || bg === 'granted';
        setLocationGranted(anyGranted);
        setLocationCheckDone(true);
        // V57.9.9 diagnostic — re-check Google connection on every foreground
        // and log the result. Captures the moment Wael returns from the
        // Android Settings round-trip so we can correlate the connection
        // state with the location-permission status he just changed.
        remoteLog(getLifecycleSession(), 'home-foreground-recheck', {
          location_status: bg, // keeps the legacy field name pointing at background
          location_foreground: fg,
          location_any_granted: anyGranted,
          current_user_id_present: !!currentUserId,
        });
        try {
          const connected = await isCalendarConnected();
          remoteLog(getLifecycleSession(), 'home-foreground-recheck-connection', {
            google_connected: connected,
          });
        } catch (err) {
          remoteLog(getLifecycleSession(), 'home-foreground-recheck-connection', {
            google_connected: false,
            error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
          });
        }
      }
    });
    return () => sub.remove();
  }, [currentUserId]);

  // V57.9.9 diagnostic — log every currentUserId flip (null ↔ user-id) so we
  // can see the exact sequence when auth state changes around a location
  // permission toggle. Pairs with home-auth-event + lifecycle-appstate to
  // form a complete timeline.
  useEffect(() => {
    remoteLog(getLifecycleSession(), 'home-currentUserId-flip', {
      has_user_id: !!currentUserId,
      user_id_short: currentUserId ? currentUserId.slice(0, 8) : null,
      ms_since_fg: msSinceForeground(),
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

  // V57.11.3 — hands-free mode removed. The mobile surface is now strictly
  // tap-to-talk + press-and-hold-anywhere on the chat. The phone (Twilio)
  // surface remains the always-listening voice channel — that is the
  // strategic moat. See docs/SESSION_HANDOFF_V57.11.3.md for the rationale.
  const { status, turns, error, send, clearHistory, loadHistory, stopSpeaking, onOrangeButtonPressed, isAudioPlaying, pendingAction, confirmPending, cancelPending, editPending } = useOrchestrator('en', brief, avoidHighwaysRef.current, false);

  // Lock-model derived flags — wired into every voice-channel button below.
  const inputLocked = isInputLocked(status);
  const orangeVisible = isOrangeButtonVisible(status, isAudioPlaying);
  const orangeLabel = orangeButtonLabel(status);

  // Per-(turn, source) expanded state for Global Search "N more" groups.
  // Key format: `${turnIndex}:${source}`. When a key is present, show all
  // hits in that group instead of the first 3.
  const [expandedSearchGroups, setExpandedSearchGroups] = useState<Set<string>>(new Set());
  const toggleSearchGroup = useCallback((key: string) => {
    setExpandedSearchGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Re-check highway preference after each turn so DELETE_MEMORY takes effect immediately
  useEffect(() => {
    if (!supabase || !currentUserId) return;
    queryWithTimeout(
      supabase.from('knowledge_fragments')
        .select('content')
        .eq('user_id', currentUserId)
        .ilike('content', '%highway%')
        .limit(5),
      15_000,
      'recheck-highway-prefs',
    ).then(({ data }) => { avoidHighwaysRef.current = !!(data && data.length > 0); });
  }, [turns, currentUserId]);

  // Auto-scroll to bottom when new conversation turns arrive
  useEffect(() => {
    if (turns.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [turns.length]);

  // 3-minute idle auto-clear DISABLED 2026-04-26 (Session 24, Wael's request).
  // Original intent: return to brief after 3 min of inactivity so the user
  // doesn't return to stale bubbles. Re-enable later if the freeze
  // investigation rules out clearHistory + concurrent timers as the cause.
  // The midnight clear (effect below) still runs.
  //
  // useEffect(() => {
  //   if (chatIdleTimerRef.current) {
  //     clearTimeout(chatIdleTimerRef.current);
  //     chatIdleTimerRef.current = null;
  //   }
  //   if (turns.length === 0) return;
  //   chatIdleTimerRef.current = setTimeout(() => {
  //     console.log('[Home] chat idle 3 min — auto-clearing');
  //     clearHistory();
  //   }, 3 * 60 * 1000);
  //   return () => {
  //     if (chatIdleTimerRef.current) clearTimeout(chatIdleTimerRef.current);
  //   };
  // }, [turns.length, clearHistory]);

  // Midnight clear — schedule once, reschedules itself daily. Runs even if
  // no turns exist (cheap to reset a no-op at midnight).
  useEffect(() => {
    const scheduleMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      const ms = nextMidnight.getTime() - now.getTime();
      midnightTimerRef.current = setTimeout(() => {
        console.log('[Home] midnight — clearing chat');
        clearHistory();
        scheduleMidnight();
      }, ms);
    };
    scheduleMidnight();
    return () => {
      if (midnightTimerRef.current) clearTimeout(midnightTimerRef.current);
    };
  }, [clearHistory]);

  // V57.11.1 — auto-open Google Maps removed. Wael 2026-05-04: yanking the
  // user out of the app to Google Maps before they read the travel time was
  // disorienting. The "Open in Google Maps" button on the TravelTimeCard
  // is the chosen path — user taps when they're ready to navigate.

  // V57.11.3 — Hands-free mode REMOVED. The mobile surface is tap-to-talk +
  // press-and-hold-anywhere only. The phone (Twilio) is the always-listening
  // voice channel. Voice-confirm flow died with hands-free; drafts confirm
  // via the DraftCard Send button.

  // Auto-intent deep link: naavi://?auto=record → start conversation
  // recording. Other naavi:// links (e.g. ?auto=handsfree from the
  // long-deprecated Hey Google route) are now no-ops.
  const autoIntentRef = useRef(false);
  useEffect(() => {
    if (autoIntentRef.current) return;

    async function checkIntent() {
      try {
        const url = await Linking.getInitialURL();
        if (!url || !url.startsWith('naavi://')) return;

        const autoParam = (() => {
          try {
            const m = url.match(/[?&]auto=([^&]+)/i);
            return m ? decodeURIComponent(m[1]).toLowerCase() : null;
          } catch { return null; }
        })();

        autoIntentRef.current = true;
        console.log('[Home] Opened via intent:', url, '— auto:', autoParam ?? '(none)');

        if (autoParam === 'record') {
          setTimeout(() => {
            try {
              startConvRecording();
            } catch (err) {
              console.error('[Home] Auto-record failed:', err);
            }
          }, 500);
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

  // V57.11.3 — press-and-hold-anywhere on chat → trigger to OPEN the mic.
  // The hold is just an entry gesture (300 ms intentional press); once
  // the mic is open the user can release their finger and the recording
  // stays running, exactly like a tap-to-talk session. To stop and send,
  // tap the mic button (same as today). This pattern feels right for the
  // senior user — they don't have to keep their finger down while
  // composing what to say. Wael 2026-05-05.
  const onChatLongPress = useCallback(() => {
    if (isInputLocked(status)) return;
    if (memoState !== 'idle') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    memoStartedAtRef.current = Date.now();
    startRecording();
  }, [status, memoState, startRecording]);

  const { startLive, stopLive, clearSegments: clearLive } = useLiveTranscript();

  const [showSpeakerModal, setShowSpeakerModal] = useState(false);
  const voiceLang = 'en';
  // Local state + refs for speaker-naming modal.
  // Session 26 design lock: iterative speaker labeling. Robert taps a channel
  // (Voice / Type) up-front; in Type mode he adds chips one at a time. Voice
  // is greyed out for V57 — ships in the next AAB.
  const [labelingChannel, setLabelingChannel] = useState<'unset' | 'type' | 'voice'>('unset');
  const [chipNames, setChipNames]     = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState<string>('');
  const [localTitle, setLocalTitle]   = useState('');
  const chipNamesRef = useRef<string[]>([]);
  const currentInputRef = useRef<string>('');
  const localTitleRef = useRef<string>('');
  // committedNamesRef — set at the exact moment the user presses Done.
  // Used for transcript display: avoids any async state/hook lag.
  const committedNamesRef = useRef<Record<string, string>>({});

  function updateLocalTitle(v: string) {
    localTitleRef.current = v;
    setLocalTitle(v);
  }
  function updateCurrentInput(v: string) {
    currentInputRef.current = v;
    setCurrentInput(v);
  }
  function setChipNamesBoth(arr: string[]) {
    chipNamesRef.current = arr;
    setChipNames(arr);
  }
  // Add the typed name to the chip list, clear input. Used by the [Add] button
  // and by [Done] when there's pending input.
  function commitCurrentInputAsChip() {
    const name = currentInputRef.current.trim();
    if (!name) return;
    const next = [...chipNamesRef.current, name];
    setChipNamesBoth(next);
    updateCurrentInput('');
  }
  // Remove a chip by index. Used by the chip's ✕ button.
  function removeChipAt(idx: number) {
    const next = chipNamesRef.current.filter((_, i) => i !== idx);
    setChipNamesBoth(next);
  }
  // Edit a chip in place: pull its text into the input, remove from chip list.
  // Robert can re-type and re-Add. Used by tap-on-chip-body.
  function editChipAt(idx: number) {
    const name = chipNamesRef.current[idx] ?? '';
    const next = chipNamesRef.current.filter((_, i) => i !== idx);
    setChipNamesBoth(next);
    updateCurrentInput(name);
  }
  // Map chip names → speaker_id dict for confirmSpeakers. First N chips map to
  // AssemblyAI's detected speakers in order; any extras map to synthetic
  // participant_N keys (kept for global-search tagging, won't match utterances).
  function mapChipsToNames(chips: string[]): Record<string, string> {
    const names: Record<string, string> = {};
    chips.forEach((name, idx) => {
      const key = speakers[idx] ?? `participant_${idx + 1}`;
      names[key] = name;
    });
    return names;
  }

  // When transcription finishes, auto-label or pre-fill using saved user name.
  // Session 26 design lock: chips, not fixed-grid. Pre-fill the user's name as
  // the first chip when there are 2+ speakers; if there's only one speaker, skip
  // the modal entirely.
  useEffect(() => {
    if (convState !== 'labeling') return;

    const savedName = getUserName();

    if (savedName && speakers.length === 1) {
      // Only the user in the recording — skip the modal entirely.
      const names = { [speakers[0]]: savedName };
      committedNamesRef.current = names;
      confirmSpeakers(names, '').catch(() => {});
      return;
    }

    // Reset modal state for a fresh labeling session.
    const initialChips = savedName && speakers.length >= 2 ? [savedName] : [];
    setChipNamesBoth(initialChips);
    updateCurrentInput('');
    localTitleRef.current = '';
    committedNamesRef.current = {};
    setLocalTitle('');
    setLabelingChannel('unset');
  }, [convState, speakers]);

  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return t('home.greeting_morning');
    if (hour < 17) return t('home.greeting_afternoon');
    return t('home.greeting_evening');
  }

  async function handleSend() {
    // V57.11.1 — read from the ref (always up-to-date) rather than the
    // state, which could lag on Android by one onChangeText cycle. Also
    // dismiss the keyboard so any pending IME composition flushes
    // before we read.
    Keyboard.dismiss();
    const text = (inputTextRef.current || inputText).trim();
    console.log('[handleSend] inputText ref=', JSON.stringify(inputTextRef.current), 'state=', JSON.stringify(inputText), 'trimmed=', JSON.stringify(text));
    // V57.11 — Send is gated by isSendLocked (looser than isInputLocked).
    // Mic / hands-free / Visits are still under the full input lock; only
    // typed-text Send is allowed during 'speaking' and 'answer_active' so
    // the user can reply to a clarification without waiting for the TTS
    // to finish. send() in the orchestrator silences ongoing audio at
    // turn start so the new turn doesn't collide.
    if (!text || isSendLocked(status)) return;
    setInputText('');
    // "Cancel" during an active chat returns to the brief without asking Claude.
    // Only triggers when a conversation is actually in progress — otherwise
    // "cancel" is a normal Claude-handled phrase.
    if (turns.length > 0 && /^(cancel|never ?mind|stop|forget it|back)\b/i.test(text)) {
      clearHistory();
      return;
    }
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
    idle:            '',
    thinking:        t('home.thinking'),
    speaking:        '',
    pending_confirm: '',
    error:           error ?? t('errors.apiError'),
  }[status];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Attach the 3-dot menu to the native header so it sits on the same row
          as "MyNaavi". Callbacks close over state declared in this component. */}
      <Stack.Screen
        options={{
          // Root screen — no back chevron (nothing to go back to). Overrides
          // the default headerLeft set in app/_layout.tsx.
          headerLeft: () => null,
          headerRight: () => (
            <TopBarMenu items={[
              { label: 'Alerts',   onPress: () => router.push('/alerts') },
              { label: 'Notes',    onPress: () => router.push('/notes') },
              { label: 'Info',     onPress: () => setShowIntegrations(true) },
              { label: 'Help',     onPress: () => router.push('/help') },
              { label: 'Settings', onPress: () => router.push('/settings') },
            ]} />
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        {/* V57.9.7 — stale-auth recovery banner. Shown when we have a
            cached user_id (prior sign-in on this device) but no current
            session — which means the auth tokens didn't survive the last
            install. One tap re-runs the Google sign-in flow. */}
        {staleAuth && (
          <TouchableOpacity
            style={styles.staleAuthBanner}
            onPress={() => {
              setSigningIn(true);
              signInWithGoogle()
                .catch(err => console.error('[Home] stale-auth re-sign-in failed:', err))
                .finally(() => setSigningIn(false));
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.staleAuthBannerText}>
              {signingIn ? 'Opening sign-in…' : 'Sign-in expired — tap to fix'}
            </Text>
          </TouchableOpacity>
        )}

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

        <IntegrationsModal visible={showIntegrations} onClose={() => setShowIntegrations(false)} />

        {/* Speaker labeling modal — Session 26 design lock.
            Step 1: Robert picks a channel (Voice or Type) up-front.
            Step 2 (Type): iterative growing-list — title input + chips + one
            input field at the bottom. [Add] saves the typed name as a chip;
            [Done] commits and extracts actions.
            Voice mode is greyed out for V57 — ships in the next AAB. */}
        <Modal
          visible={showSpeakerModal || convState === 'labeling'}
          transparent
          animationType="slide"
          onRequestClose={() => setShowSpeakerModal(false)}
        >
          <View style={styles.modalOverlay}>
            <ScrollView
              style={styles.speakerModal}
              contentContainerStyle={{ paddingBottom: 240 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.speakerModalTitle}>🎙 Conversation Recorded</Text>

              {labelingChannel === 'unset' && (
                <>
                  <Text style={styles.speakerModalSub}>
                    How would you like to label the speakers?
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
                    <TouchableOpacity
                      style={[styles.speakerConfirmBtn, { flex: 1, marginRight: 6, opacity: 0.4 }]}
                      disabled
                      accessibilityLabel="Voice (coming soon)"
                    >
                      <Text style={styles.speakerConfirmText}>🎤 Voice (coming soon)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.speakerConfirmBtn, { flex: 1, marginLeft: 6 }]}
                      onPress={() => setLabelingChannel('type')}
                      accessibilityLabel="Type"
                    >
                      <Text style={styles.speakerConfirmText}>⌨ Type</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => { setShowSpeakerModal(false); resetConv(); }}>
                    <Text style={styles.speakerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}

              {labelingChannel === 'type' && (
                <>
                  <Text style={styles.speakerModalSub}>
                    Give this conversation a title, then add the speakers one by one.
                  </Text>

                  {/* Title input — kept as before */}
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

                  {/* Chips — growing list of speakers entered so far. Tap ✕ to
                      remove. Tap chip body to edit (loads back into input). */}
                  {chipNames.length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, marginBottom: 4 }}>
                      {chipNames.map((name, idx) => (
                        <View key={`${name}-${idx}`} style={styles.speakerChip}>
                          <TouchableOpacity onPress={() => editChipAt(idx)} accessibilityLabel={`Edit ${name}`}>
                            <Text style={styles.speakerChipText}>{name}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => removeChipAt(idx)}
                            accessibilityLabel={`Remove ${name}`}
                            style={styles.speakerChipRemove}
                          >
                            <Text style={styles.speakerChipRemoveText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Current speaker input — prompt updates with the next number */}
                  <View style={styles.speakerRow}>
                    <Text style={styles.speakerLabel}>{`Speaker ${chipNames.length + 1}`}</Text>
                    <TextInput
                      style={styles.speakerInput}
                      placeholder="Who was speaking?"
                      placeholderTextColor={Colors.textMuted}
                      value={currentInput}
                      onChangeText={updateCurrentInput}
                      onSubmitEditing={commitCurrentInputAsChip}
                      returnKeyType="next"
                      autoCorrect={false}
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.speakerConfirmBtn, { backgroundColor: Colors.moderate }]}
                    onPress={commitCurrentInputAsChip}
                    disabled={!currentInput.trim()}
                  >
                    <Text style={styles.speakerConfirmText}>+ Add another speaker</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.speakerConfirmBtn}
                    onPress={async () => {
                      // If there's pending text in the input, treat it as the
                      // last chip so Robert doesn't have to tap Add first.
                      const finalChips = currentInputRef.current.trim()
                        ? [...chipNamesRef.current, currentInputRef.current.trim()]
                        : chipNamesRef.current;
                      const names = mapChipsToNames(finalChips);
                      const title = localTitleRef.current;
                      console.log('[SpeakerModal] names:', JSON.stringify(names), 'title:', title, 'chips:', finalChips.length);
                      committedNamesRef.current = { ...names };
                      setShowSpeakerModal(false);
                      await confirmSpeakers(names, title);
                    }}
                  >
                    {convState === 'extracting'
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.speakerConfirmText}>Done — Extract Action Items →</Text>}
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => { setShowSpeakerModal(false); resetConv(); }}>
                    <Text style={styles.speakerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </Modal>

        {/* Floating sign-in banner — absolute positioned, doesn't shift page layout.
            Shows only when the user is not yet signed in. */}
        {!currentUserId && (
          <TouchableOpacity
            style={styles.floatingSignInBanner}
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
            activeOpacity={0.85}
          >
            <Ionicons name="key" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.floatingSignInText} numberOfLines={1}>
              {signingIn ? 'Signing in…' : 'Sign in with Google'}
            </Text>
          </TouchableOpacity>
        )}

        {/* V57.10.1 — persistent location-permission banner removed.
            Permission is now requested lazily, only the moment Robert
            creates a location-trigger rule (handled in
            useOrchestrator.ts SET_ACTION_RULE intercept). Wael 2026-05-01:
            persistent home banner felt naggy; on-demand prompt has the
            right context for the user. */}

        {/* V57.11.3 — Press-and-hold-anywhere on the chat opens the mic.
            Pressable is INSIDE the ScrollView (not around it) so the
            ScrollView always gets first crack at touches. Vertical drag
            = scroll (ScrollView wins). Stationary press 300 ms = mic
            opens. After mic opens, user can release; recording stays on
            until they tap the mic button to stop + send. */}
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
        <Pressable
          delayLongPress={300}
          onLongPress={onChatLongPress}
        >
          {/* "← Brief" chip — only appears during an active conversation so
              Robert can bail back to the brief without scrolling. */}
          {turns.length > 0 && (
            <View style={styles.topBarRow}>
              <TouchableOpacity
                style={styles.newChatBtn}
                onPress={clearHistory}
                accessibilityLabel="Return to brief"
              >
                <Text style={styles.newChatBtnText}>← Brief</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Morning brief — grouped by category */}
          {turns.length === 0 && (() => {
            // Time-window filter only applies to the "Today" selector — for
            // 3/7-day views, show everything in range. brief-logic keeps the
            // window rules (morning/midday/evening/night) in one place.
            const now    = new Date();
            const window = getBriefWindow(now);
            const byCat: Record<string, BriefItem[]> = { weather: [], calendar: [], task: [], health: [] };
            for (const i of brief) {
              if (!byCat[i.category]) continue;
              if (i.category === 'weather') { byCat.weather.push(i); continue; }
              if (briefDays < 7 && i.startISO) {
                const itemDate = new Date(i.startISO);
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() + briefDays - 1);
                cutoff.setHours(23, 59, 59, 999);
                if (itemDate > cutoff) continue;
              }
              byCat[i.category].push(i);
            }
            if (briefDays === 1) {
              // Strip past events for today-view based on current time-window.
              for (const k of Object.keys(byCat)) {
                byCat[k] = filterByWindow(byCat[k], window, now);
              }
            }
            const totalItems = Object.values(byCat).reduce((sum, arr) => sum + arr.length, 0);
            // "Nothing today" check — weather alone means an otherwise empty day.
            const hasOnlyWeather = byCat.weather.length > 0
              && byCat.calendar.length === 0
              && byCat.task.length === 0
              && byCat.health.length === 0;
            return (
              <View style={styles.briefSection}>
                <Text style={styles.sectionTitle}>{t('home.briefTitle')}</Text>
                {[
                  { key: 'weather',  label: 'Weather' },
                  { key: 'calendar', label: 'Calendar' },
                  { key: 'task',     label: 'Tasks' },
                  { key: 'health',   label: 'Health' },
                ].map(({ key, label }) => {
                  const items = byCat[key] ?? [];
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
                {/* Empty state — nothing today beyond the weather anchor, show
                    a friendly line plus a rotating example prompt. Tip picked
                    once per mount via tipRef. */}
                {(totalItems === 0 || hasOnlyWeather) && briefDays === 1 && (
                  <View style={styles.briefEmpty}>
                    <Text style={styles.briefEmptyText}>Nothing on your plate today.</Text>
                    <Text style={styles.briefEmptyTip}>{tipRef.current}</Text>
                  </View>
                )}
              </View>
            );
          })()}

          {/* "Clear chat" link — visible only when there's history.
              V57.8 — explicit reset for Robert when the screen feels cluttered.
              Wraps clearHistory() which resets turns + cards. */}
          {turns.length > 0 && (
            <TouchableOpacity
              onPress={clearHistory}
              style={styles.clearChatLink}
              accessibilityLabel="Clear chat"
              accessibilityRole="button"
            >
              <Text style={styles.clearChatLinkText}>✕ Clear chat</Text>
            </TouchableOpacity>
          )}

          {/* Conversation turns — each turn shows bubbles then its own cards.
              V57.8 — older turns auto-collapse to 1-line summaries to reduce
              cognitive load (per Wael 2026-04-29). Latest turn stays expanded.
              Tap a collapsed bubble to expand it. Cards (drafts, alerts,
              prescriptions, etc.) ALWAYS stay visible regardless of collapse
              state — those are the actionable items Robert needs. */}
          {turns.map((turn, ti) => {
            const isLatest = ti === turns.length - 1;
            const isCollapsed = !isLatest && !expandedTurns.has(ti);
            return (
            <View key={ti}>
              {isCollapsed ? (
                <TouchableOpacity
                  onPress={() => setExpandedTurns(prev => new Set([...prev, ti]))}
                  style={styles.collapsedTurn}
                  accessibilityLabel="Expand earlier conversation"
                  accessibilityRole="button"
                >
                  <Text style={styles.collapsedTurnText} numberOfLines={1}>
                    Earlier: {turn.userMessage.slice(0, 50)}{turn.userMessage.length > 50 ? '…' : ''}
                  </Text>
                  <Text style={styles.collapsedTurnHint}>▾ show</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <ConversationBubble role="user" content={turn.userMessage} timestamp={turn.timestamp} />
                  <ConversationBubble role="assistant" content={turn.assistantSpeech} timestamp={turn.timestamp} />
                  {/* V57.9.7 — collapse-back affordance for older turns
                      that were expanded. Without this, expand was a one-way
                      action (Wael 2026-05-01). Latest turn never gets this
                      because it's always expanded. */}
                  {!isLatest && (
                    <TouchableOpacity
                      onPress={() => setExpandedTurns(prev => {
                        const next = new Set(prev);
                        next.delete(ti);
                        return next;
                      })}
                      style={styles.collapseBackRow}
                      accessibilityLabel="Collapse earlier conversation"
                      accessibilityRole="button"
                    >
                      <Text style={styles.collapsedTurnHintHide}>▴ hide</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* Draft emails */}
              {turn.drafts.filter(a => a.type === 'DRAFT_MESSAGE').map((action, i) => (
                <DraftCard
                  key={i}
                  action={action}
                  onManualSend={pendingAction && pendingAction.action === action ? () => cancelPending('') : undefined}
                />
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
                      WebBrowser.openBrowserAsync(url).catch(() => {});
                    }}
                  >
                    <Text style={styles.navOpenBtnText}>Open in Google Maps →</Text>
                  </TouchableOpacity>
                </View>
              ))}

              {/* Global Search results */}
              {turn.globalSearch && turn.globalSearch.results.length > 0 && (
                <View style={styles.globalSearchSection}>
                  <Text style={styles.globalSearchLabel}>
                    🔎 Results for "{turn.globalSearch.query}"
                  </Text>
                  {Object.entries(
                    turn.globalSearch.results.reduce<Record<string, GlobalSearchResult[]>>((acc, r) => {
                      (acc[r.source] ||= []).push(r);
                      return acc;
                    }, {})
                  ).map(([source, hits]) => {
                    const groupKey = `${ti}:${source}`;
                    const isExpanded = expandedSearchGroups.has(groupKey);
                    const visibleHits = isExpanded ? hits : hits.slice(0, 3);
                    const hiddenCount = hits.length - 3;
                    return (
                      <View key={source} style={styles.globalSearchGroup}>
                        <Text style={styles.globalSearchGroupLabel}>
                          {source === 'calendar' ? '📅 Calendar' :
                           source === 'contacts' ? '👤 Contacts' :
                           source === 'lists' ? '📝 Lists' :
                           source === 'gmail' ? '✉ Email' :
                           source === 'sent_messages' ? '📤 Sent messages' :
                           source === 'rules' ? '⚡ Automations' :
                           source === 'knowledge' ? '🧠 Memory' :
                           source}
                          {' · '}{hits.length}
                        </Text>
                        {visibleHits.map((hit, i) => (
                          <TouchableOpacity
                            key={i}
                            style={styles.globalSearchHit}
                            onPress={() => hit.url && Linking.openURL(hit.url)}
                            disabled={!hit.url}
                          >
                            <Text style={styles.globalSearchHitTitle} numberOfLines={2}>{hit.title}</Text>
                            {hit.snippet ? (
                              <Text style={styles.globalSearchHitMeta} numberOfLines={2}>{hit.snippet}</Text>
                            ) : null}
                          </TouchableOpacity>
                        ))}
                        {hits.length > 3 && (
                          <TouchableOpacity
                            style={styles.globalSearchHit}
                            onPress={() => toggleSearchGroup(groupKey)}
                            accessibilityLabel={isExpanded ? `Collapse ${source} results` : `Show ${hiddenCount} more ${source} results`}
                          >
                            <Text style={styles.globalSearchExpandToggle}>
                              {isExpanded ? `▲ Show less` : `▼ Show ${hiddenCount} more in ${source}`}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

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
                <TouchableOpacity key={i} style={styles.eventCard} onPress={() => { if (ev.htmlLink) WebBrowser.openBrowserAsync(ev.htmlLink).catch(() => {}); }} accessibilityLabel="Open event in Google Calendar">
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

              {/* Location rules — V57.4 Part B toggle card */}
              {(turn.locationRules ?? []).map((rule, i) => (
                <LocationRuleCard
                  key={`loc-${rule.ruleId}-${i}`}
                  ruleId={rule.ruleId}
                  placeName={rule.placeName}
                  initialOneShot={rule.oneShot}
                />
              ))}

              {/* List results */}
              {(turn.listResults ?? []).map((lr, i) => (
                <TouchableOpacity key={i} style={styles.listCard} onPress={() => lr.webViewLink ? Linking.openURL(lr.webViewLink) : undefined} accessibilityLabel={`${lr.action} list ${lr.listName}`}>
                  <Text style={styles.listLabel}>
                    {lr.action === 'created' ? '📋 List created' : lr.action === 'added' ? '📋 Added to list' : lr.action === 'removed' ? '📋 Removed from list' : '📋 List items'}
                  </Text>
                  <Text style={styles.listTitle}>{lr.listName}</Text>
                  {lr.items && lr.items.length > 0 && (
                    <Text style={styles.listItems}>{lr.items.map(item => `• ${item}`).join('\n')}</Text>
                  )}
                  {lr.webViewLink ? <Text style={styles.eventLink}>Tap to open in Google Docs</Text> : null}
                </TouchableOpacity>
              ))}
            </View>
            );
          })}

          {/* V57.10.1 — typing indicator. While the orchestrator is thinking,
              show a placeholder assistant-style bubble at the end of the chat
              thread so Robert sees that a reply is coming. Without this the
              chat looks frozen for 2-8 s on slow paths and Robert gives up
              before the answer lands. The small status row at the bottom of
              the screen exists too but is far from the action. */}
          {status === 'thinking' && (
            <View style={styles.typingBubble}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.typingBubbleText}>Naavi is thinking…</Text>
            </View>
          )}

          {/* Conversation action cards */}
          {convActions.length > 0 && (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.convActionsHeader}>📋 Actions from your conversation</Text>
              {convActions.map((action, i) => (
                <ConversationActionCard
                  key={i}
                  action={action}
                  /* onCalendar removed in V57.1 — calendar events for the
                     auto-created types (appointment / meeting / call / test /
                     prescription / follow_up) are created during
                     confirmSpeakers, so re-firing through Naavi here would
                     produce duplicates and a redundant time prompt. The card
                     now shows a read-only "✓ In your calendar" badge. */
                  onEmail={(a) => {
                    // Auto-send the draft request. Use suggested_by (the speaker
                    // who proposed the action — usually the doctor / professional
                    // we'd email back) as the explicit recipient, so Claude emits
                    // a DRAFT_MESSAGE instead of a conversational reply. If
                    // suggested_by is missing or "Unknown", fall back to asking
                    // Claude to ask for the recipient.
                    const recipient = a.suggested_by && a.suggested_by !== 'Unknown'
                      ? a.suggested_by
                      : null;
                    const body = a.email_draft ?? a.description;
                    const msg = recipient
                      ? `Draft an email to ${recipient} about ${a.title}. Body: ${body}`
                      : `Draft an email about ${a.title}. Ask me who to send it to. Body: ${body}`;
                    setInputText('');
                    send(msg);
                  }}
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
                // Live preview from the chips Robert is currently typing —
                // shown before he taps Done so the transcript reflects partial
                // labeling. After Done, committedNamesRef/confirmedNames take
                // over.
                const livePreview = mapChipsToNames(chipNames);
                const name = committedNamesRef.current[u.speaker] || confirmedNames[u.speaker] || livePreview[u.speaker] || `Speaker ${u.speaker}`;
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
        </Pressable>
        </ScrollView>

        {/* Recording / transcribing status.
            V57.11.3 — when in press-and-hold mode the hint is "release to
            send" (finger still down); the regular tap-to-talk hint is
            "tap ⏹ when done". */}
        {memoState === 'recording' ? (
          <View style={styles.statusRow}>
            <Text style={styles.recordingHintText}>
              🔴 Recording… tap ⏹ when done
            </Text>
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

        {/* Orange button — single touch point for the lock model.
            ⏹ Stop in thinking / speaking → cancels in-flight or silences voice.
            ✕ Cancel in answer_active     → releases the 10s lock buffer.
            Hidden in idle / pending_confirm / error.
            Visible regardless of Voice Playback setting — its role goes beyond
            silencing audio (cancelling thinking, releasing the answer-active
            lock). See Session 26 design lock. */}
        {orangeVisible && orangeLabel && (
          <TouchableOpacity
            style={styles.stopSpeakingBtn}
            onPress={onOrangeButtonPressed}
            accessibilityLabel={orangeLabel}
          >
            <Text style={styles.stopSpeakingText}>{orangeLabel}</Text>
          </TouchableOpacity>
        )}

        {/* Input area — full-width text input + icon row (no labels).
            Mic ↔ Send toggles on the far right based on whether text is typed.
            Long-press any icon to see its label.
            V57.11.3 — hands-free state guards removed; the input area is
            always visible. */}
        {true ? (
          <View style={styles.inputArea}>
            {/* Row 1 — full-width text input, no embedded send */}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.inputFull}
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('home.inputPlaceholder')}
                placeholderTextColor={Colors.textMuted}
                multiline
                maxLength={500}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                // Always editable — typing has no audio-pickup risk and Robert
                // can pre-compose his next question while reading. Send is the
                // gate, not the input. (Session 26 design lock.)
                editable={true}
                accessibilityLabel="Message input"
                // Android autocomplete/autocorrect off — it was stripping typed
                // digits (contact suggestions replacing phone numbers). Trade
                // word-suggestions for reliable input; right call for Robert.
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                textContentType="none"
                keyboardType="default"
              />
            </View>
            {/* Row 2 — Meet + Free on the left, Mic/Send toggle far right. */}
            <View style={styles.actionButtonsRow}>
              {/* Visits — conversation / thought recorder.
                  Locked while a Naavi reply is in flight (thinking/speaking/
                  answer_active/pending_confirm). Stays tappable mid-recording
                  so Robert can always stop a conversation he's already
                  recording. (Session 26 design lock.) */}
              {memoSupported && (
                <IconButton
                  label={convState === 'recording' ? 'Stop recording' : convState === 'labeling' ? 'Label speakers' : 'Visits'}
                  description={
                    convState === 'recording' ? 'Stop recording. MyNaavi will transcribe and save it.'
                    : convState === 'labeling' ? 'Label who was speaking before MyNaavi files the transcript.'
                    : 'Record a visit or your own thoughts — summary created and action taken.'
                  }
                  onPeek={setPeekText}
                  icon={
                    ['uploading', 'transcribing', 'extracting'].includes(convState)
                      ? <ActivityIndicator size="small" color="#fff" />
                      : convState === 'recording'
                        ? <Ionicons name="stop" size={30} color="#fff" />
                        : convState === 'labeling'
                          ? <Ionicons name="pricetag" size={30} color="#fff" />
                          : <Ionicons name="people" size={30} color="#fff" />
                  }
                  style={[
                    { backgroundColor: Colors.moderate },
                    convState === 'recording' && { backgroundColor: Colors.alert },
                  ]}
                  // Lock when input lock engaged AND we're not already inside a
                  // recording / processing flow. Mid-flow taps (stop recording,
                  // label speakers) must still work.
                  disabled={inputLocked && convState === 'idle'}
                  onPress={() => {
                    if (convState === 'labeling') { setShowSpeakerModal(true); return; }
                    if (convState === 'recording') { stopConvRecording(); stopLive(); return; }
                    if (['uploading', 'transcribing', 'extracting'].includes(convState)) return;
                    resetConv(); clearLive(); startConvRecording(voiceLang); startLive();
                  }}
                />
              )}

              {/* V57.11.3 — Hands-free button removed. The phone (Twilio
                  voice line) is the always-listening surface. Mobile is
                  tap-to-talk + press-and-hold-anywhere on the chat. */}

              {/* Recording timer badge — info only */}
              {convState === 'recording' && (
                <View style={[styles.convTimerBadge, { marginLeft: 8 }]} pointerEvents="none">
                  <View style={styles.convTimerDot} />
                  <Text style={styles.convTimerText}>
                    {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </Text>
                </View>
              )}

              {/* Mic/Send toggle — icon depends on input state.
                    empty + idle → 🎙 (start voice)
                    text present → ➤ (send)
                    recording    → ⏹ (stop + transcribe)
                    transcribing → … (busy) */}
              {(() => {
                const hasText        = inputText.trim().length > 0;
                const isRecording    = memoState === 'recording';
                const isTranscribing = memoState === 'transcribing';
                let icon:  React.ReactNode = <Ionicons name="mic" size={30} color="#fff" />;
                let label = 'Voice';
                let description = 'Tap to speak to MyNaavi. Tap again to stop and send.';
                let bg    = Colors.accent;
                if (isTranscribing)       { icon = <Ionicons name="ellipsis-horizontal" size={30} color="#fff" />; label = 'Transcribing'; description = 'Converting your voice to text…'; }
                else if (isRecording)     { icon = <Ionicons name="stop" size={30} color="#fff" />; label = 'Stop recording'; description = 'Stop recording and send what you said to MyNaavi.'; bg = Colors.alert; }
                else if (hasText)         { icon = <Ionicons name="send" size={26} color="#fff" />; label = 'Send'; description = 'Send your typed message to MyNaavi.'; }
                // V57.11 — Differentiated lock. When the button is in Send
                // mode (hasText), use the looser isSendLocked so the user
                // can reply to a clarification while Naavi's TTS is still
                // playing. When in Voice mode (no text), keep the full
                // input lock so the mic doesn't open over Naavi's audio.
                const sendModeLocked = isSendLocked(status);
                const voiceModeLocked = inputLocked;
                const lockForCurrentMode = hasText ? sendModeLocked : voiceModeLocked;
                const disabled = isTranscribing || (lockForCurrentMode && !isRecording);
                const onPress = () => {
                  if (hasText && !isRecording && !isTranscribing) { handleSend(); return; }
                  if (isRecording) {
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
                  if (!memoSupported) return;
                  if (isTranscribing) return;
                  memoStartedAtRef.current = Date.now();
                  startRecording();
                };
                return (
                  <IconButton
                    label={label}
                    description={description}
                    onPeek={setPeekText}
                    icon={icon}
                    onPress={onPress}
                    disabled={disabled}
                    // V57.11.3 — width 78 (was 52). Per Wael 2026-05-05:
                    // since the hands-free button is gone, give the mic
                    // 50% more horizontal target without changing height
                    // or pushing the input row up. Easier to hit, no UI
                    // re-layout.
                    style={{ backgroundColor: bg, width: 78, borderRadius: 26 }}
                  />
                );
              })()}
            </View>
          </View>
        ) : null}
        {/* Mic-large pill button kept here in code position; rendered above. */}
      </KeyboardAvoidingView>
      {/* Screen-wide peek bar — shows the IconButton's description during
          hover / long-press. Positioned above the input row so the bottom
          icons aren't covered. pointerEvents='none' so it doesn't interrupt
          the press that triggered it. Long descriptions have ~90% of the
          screen width to spread on one or two lines. */}
      {peekText && (
        <View style={styles.peekBar} pointerEvents="none">
          <Text style={styles.peekText} numberOfLines={3}>{peekText}</Text>
        </View>
      )}
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
  // V57.8 — clear-chat link + collapsed-turn pill (chat page declutter)
  clearChatLink: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 4,
  },
  clearChatLinkText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '500',
  },
  collapsedTurn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginVertical: 4,
  },
  collapsedTurnText: {
    flex: 1,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
  },
  // V57.9.7-fix — separate styles for expand vs collapse so the user
  // sees colour at a glance instead of relying on text. Green ▾ show =
  // open, soft red ▴ hide = close. Same shape, opposite colour and
  // chevron direction.
  collapsedTurnHint: {
    color: 'rgba(94, 217, 200, 0.95)', // teal/green — ▾ show (opens)
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  collapsedTurnHintHide: {
    color: 'rgba(242, 139, 130, 0.95)', // soft coral/red — ▴ hide (closes)
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  // Right-aligned tap target shown under expanded older turns to
  // collapse them back to the 1-line summary.
  collapseBackRow: {
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 4,
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
  // V57.9.7 — stale-auth recovery banner. Same visual language as the
  // navAlert banner but with a distinct amber/orange colour so the user
  // sees it as "needs attention" rather than "running late".
  staleAuthBanner: {
    marginHorizontal: 0,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#b87a1c', // muted amber
    zIndex: 21,
  },
  staleAuthBannerText: {
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
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 6,
    gap: 8,
    maxWidth: '80%',
  },
  typingBubbleText: {
    fontSize: Typography.sm,
    color: Colors.textPrimary,
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
  listCard: {
    marginTop: 12,
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
    padding: 16,
    gap: 4,
  },
  listLabel: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: '#4CAF50',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  listTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  listItems: {
    fontSize: Typography.body,
    color: Colors.textPrimary,
    lineHeight: Typography.lineHeightBody,
    marginTop: 4,
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
    alignItems: 'center',
  },
  draftSendBtnDisabled: {
    opacity: 0.5,
  },
  draftSendBtnText: {
    color: '#fff',
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  // V57.3: ✕ Discard button next to Send. Outlined / less prominent than Send
  // so the primary action stays visually obvious; discard is a deliberate
  // secondary action.
  draftDiscardBtn: {
    marginTop: 10,
    backgroundColor: 'transparent',
    borderWidth: 0.5,
    borderColor: Colors.textMuted,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftDiscardBtnText: {
    color: Colors.textMuted,
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
  globalSearchSection: {
    marginTop: 12,
    gap: 10,
    backgroundColor: Colors.bgElevated,
    borderRadius: 16,
    padding: 14,
  },
  globalSearchLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  globalSearchGroup: {
    gap: 6,
  },
  globalSearchGroupLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  globalSearchHit: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  globalSearchHitTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  globalSearchHitMeta: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  globalSearchExpandToggle: {
    fontSize: Typography.sm,
    color: Colors.brandTeal ?? '#5DCAA5',
    fontWeight: Typography.semibold,
    textAlign: 'center',
    paddingVertical: 4,
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
  // Speaker chip — pill showing a name already added to the labeling list.
  // Tap body → load text into input and remove chip (in-place edit).
  // Tap ✕ → remove chip outright.
  speakerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.moderate,
    borderRadius: 16,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    marginRight: 6,
    marginBottom: 6,
  },
  speakerChipText: {
    color: '#fff',
    fontSize: Typography.body,
    fontWeight: '600',
  },
  speakerChipRemove: {
    marginLeft: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerChipRemoveText: {
    color: '#fff',
    fontSize: 12,
    lineHeight: 14,
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
    paddingTop: 10,
    // Flush to the system nav — SafeAreaView edges=['bottom'] on the parent
    // already reserves the exact gesture/nav-bar inset. Zero padding here
    // means the icon row sits against that reserved space with nothing in
    // between. Dynamic-viewport-aware without needing CSS dvh tricks.
    paddingBottom: 0,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bgApp,
    gap: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // All three icons grouped on the right side of the row with equal
    // gap between them. Per-icon bg colours differentiate their purpose
    // (Meet moderate-blue, Free blue, Mic/Send accent). Mic/Send stays
    // last (closest to the screen edge) so the most-used button has the
    // shortest thumb path.
    justifyContent: 'flex-end',
    gap: 16,
    paddingBottom: 8,
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
  // Full-width text input — replaces `input` (which was flex: 1 alongside a
  // send button). Now a standalone row, no embedded send, so the input takes
  // the full row width and the Mic/Send toggle lives below it.
  // Height is tight to the font (roughly font + vertical padding) so the
  // field doesn't dominate the bottom bar. Grows with multiline content.
  inputFull: {
    width: '100%',
    backgroundColor: Colors.bgElevated,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    // Match the "WEATHER" brief-group-label: Typography.body (15) + weight 700.
    fontSize: Typography.body,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: Colors.textPrimary,
    maxHeight: 120,
    lineHeight: 20,
  },
  // Top-of-scroll row — holds the "← Brief" chip (only visible during an
  // active conversation) and the 3-dot menu on the right.
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 2,
    paddingVertical: 4,
    minHeight: 40,
  },
  // Floating sign-in banner — absolute-positioned pill that overlays the
  // scroll content. Visible only when the user isn't signed in. Kept short
  // so it doesn't dominate; tapping opens the Google sign-in flow.
  floatingSignInBanner: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    maxWidth: 380,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 22,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  floatingSignInText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Persistent location-permission banner. V57.3: thin one-line bar at the top
  // of the chat that pushes content down (no longer position:absolute). Subtle
  // amber-tinted background — visible enough to notice, not aggressive enough
  // to feel like an error. Stays visible until permission is granted.
  locationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(180, 83, 9, 0.18)', // amber-700 at 18% alpha
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(251, 191, 36, 0.4)', // amber-400 hairline
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  locationBannerText: {
    flex: 1,
    color: '#FBBF24', // amber-400 — readable on dark background
    fontSize: 12,
    fontWeight: '500',
  },
  // Empty-state block inside the brief — "Nothing on your plate today" plus
  // a rotating Try-this tip from lib/brief-logic.
  briefEmpty: {
    paddingVertical: 28,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  // Screen-wide caption bar for bottom-icon hover / long-press. Positioned
  // above the input area via absolute bottom offset so it stays visible
  // while the user is interacting with an icon.
  peekBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 150, // clears the input + icon row
    backgroundColor: 'rgba(0,0,0,0.92)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    zIndex: 500,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  peekText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'center',
  },
  briefEmptyText: {
    color: Colors.textSecondary,
    fontSize: 17,
    fontWeight: '500',
    marginBottom: 12,
    textAlign: 'center',
  },
  briefEmptyTip: {
    color: Colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 22,
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
});
