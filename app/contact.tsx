/**
 * Contact Support screen
 *
 * Simpler cousin of the Report-a-problem form. No severity picker —
 * just "What do you need?" + your email. Submits to the separate
 * Formspree form (xgorryye) so support requests are separated from
 * bug reports in the inbox.
 *
 * Accessed from Help → Contact support.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { queryWithTimeout, getSessionWithTimeout } from '@/lib/invokeWithTimeout';
/* F25 Stage 2 (2026-09-04) — this screen used to match against lib/faq.ts, a
 * hand-written copy of 12 questions inside the app. It knew 12 of 26 published
 * answers, and its scoring could not clear its own threshold on a single word.
 * It now asks match-faq, the same matcher the website uses, on Send.
 *
 * ON SEND, never while typing. Wael, 2026-09-04: "Do not make paid AI calls
 * while typing." The old debounce ran on every keystroke, which was free
 * because the matching was local arithmetic. This is not. */
type FaqMatch = { slug: string; question: string; url: string; confidence?: string };

const FAQ_MATCH_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/match-faq`;
const FAQ_MATCH_TIMEOUT_MS = 4_000;

const SUPABASE_URL  = process.env.EXPO_PUBLIC_SUPABASE_URL  ?? '';
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export default function ContactScreen() {
  const router = useRouter();
  const [message, setMessage]     = useState('');
  const [email, setEmail]         = useState('');
  const [userId, setUserId]       = useState('');
  const [userName, setUserName]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]     = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<FaqMatch[]>([]);
  /* Asked once per SUBMISSION, not once per screen.
   *
   * This started as "once per visit", copied from the website along with a
   * comment claiming it was once per submission attempt. It was neither: the
   * flag never reset, and setSuccess(true) swaps to the "Thanks" view inside
   * this same component, so the screen does not unmount. A customer filing a
   * second ticket in one sitting got no check at all.
   *
   * Measured on build 334, 2026-09-05: Wael filed three tickets and only the
   * first was ever offered an answer. For a feature whose whole purpose is
   * deflection, that is most of the value gone.
   *
   * Resetting on a text change is what makes "per submission" true. Pressing
   * Send twice without editing still sends — the flag is set from the first
   * press and the text has not changed — so the customer is never trapped.
   * Editing and sending again is a new question, and gets a new check.
   *
   * A ref, not state: flipping it must not re-render the form mid-submit. */
  const faqChecked = useRef(false);
  useEffect(() => { faqChecked.current = false; }, [message]);

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const session = await getSessionWithTimeout();
      if (session?.user?.email) setEmail(session.user.email);
      if (session?.user?.id) {
        setUserId(session.user.id);
        const { data } = await queryWithTimeout(
          supabase
            .from('user_settings')
            .select('name')
            .eq('user_id', session.user.id)
            .maybeSingle(),
          15_000,
          'select-user-settings-name',
        );
        if (data?.name) setUserName(data.name);
      }
    })();
  }, []);

  /**
   * Ask whether an answer already exists. Returns true when the customer
   * should be given a chance to look before the ticket is filed.
   *
   * ⚠️ EVERY failure path returns false and lets the ticket through — a
   * timeout, a network error, a rate limit, 'unavailable', 'no_match', a
   * malformed body. Nobody is ever blocked from reaching support because a
   * suggestion lookup went wrong. This mirrors report.html:294-314 deliberately:
   * the two surfaces should behave the same at the same moment.
   */
  async function faqCheckBlocks(text: string): Promise<boolean> {
    if (faqChecked.current) return false;
    faqChecked.current = true;
    if (text.length < 8) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FAQ_MATCH_TIMEOUT_MS);
    try {
      const session = await getSessionWithTimeout();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON,
      };
      /* Send the session token when there is one, and NOTHING when there is
         not. The anon key is identical on every install, so sending it here
         would put every signed-out user in one rate-limit bucket — worse than
         the address they came from. match-faq treats it as no identity, but
         not sending it at all is the honest signal. */
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch(FAQ_MATCH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, surface: 'app-contact' }),
        signal: controller.signal,
      });
      const d = await res.json();
      if (d?.ok && d.status === 'matched' && Array.isArray(d.matches) && d.matches.length) {
        setSuggestions(d.matches as FaqMatch[]);
        return true;
      }
    } catch (e) {
      console.error('[faq-check] contact: failed, sending anyway:', e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
    return false;
  }

  async function handleSubmit() {
    setErrorText(null);
    const m = message.trim();
    if (!m) { setErrorText('Tell us what you need.'); return; }
    if (!email.trim() || !/@/.test(email)) { setErrorText('Your email is needed so we can reply.'); return; }

    setSubmitting(true);
    if (await faqCheckBlocks(m)) { setSubmitting(false); return; }
    try {
      const appVersion = `${Constants.expoConfig?.version ?? '?'} (build ${Constants.expoConfig?.android?.versionCode ?? '?'})`;
      const session = await getSessionWithTimeout();
      const authToken = session?.access_token ?? SUPABASE_ANON;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/ingest-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          source_channel:  'mobile-contact',
          subject:         m.slice(0, 80),
          body:            m,
          reporter_email:  email.trim(),
          reporter_name:   userName || undefined,
          user_id:         userId   || undefined,
          context:         `app_version=${appVersion} platform=${Platform.OS} ${Platform.Version}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Submit failed ${res.status}`);
      }
      setSuccess(true);
    } catch (err) {
      console.error('[Contact] submit failed:', err);
      setErrorText(err instanceof Error ? err.message : 'Could not send — try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.successWrap}>
          <Ionicons name="checkmark-circle" size={72} color={Colors.accent} />
          <Text style={styles.successTitle}>Thanks — we got it.</Text>
          <Text style={styles.successSub}>
            We read every message and reply within one business day. If you included your email, we'll use it.
          </Text>
          <TouchableOpacity style={styles.successBtn} onPress={() => router.back()}>
            <Text style={styles.successBtnText}>Back to MyNaavi</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.intro}>
            Questions, feedback, or anything else — drop us a note.
            We read every one.
          </Text>

          <Text style={styles.sectionLabel}>What do you need?</Text>
          <TextInput
            style={[styles.textarea, { minHeight: 140 }]}
            value={message}
            onChangeText={setMessage}
            placeholder="Describe what you'd like to know or tell us…"
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={1500}
            autoCorrect={false}
            autoComplete="off"
            textAlignVertical="top"
          />

          {suggestions.length > 0 && (
            <View style={styles.suggestBox}>
              <View style={styles.suggestHeader}>
                <View style={styles.suggestHeaderLeft}>
                  <Ionicons name="bulb" size={16} color={Colors.accent} />
                  <Text style={styles.suggestTitle}>Maybe this answers it</Text>
                </View>
                <TouchableOpacity
                  /* Clears the panel directly. It used to set a
                     `suggestionsDismissed` flag that an effect read to empty
                     this list — and when that effect was removed with the
                     per-keystroke matching, the flag was left with no reader
                     and this button silently stopped working. */
                  onPress={() => setSuggestions([])}
                  hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                  <Ionicons name="close" size={16} color={Colors.error} />
                </TouchableOpacity>
              </View>
              {suggestions.map(s => (
                <TouchableOpacity
                  key={s.slug}
                  style={styles.suggestRow}
                  onPress={() => {
                    /* The URL comes back in the match. lib/faq.ts used to
                       build it from a slug it also stored; there is nothing
                       left to keep in sync. */
                    Linking.openURL(s.url).catch(() => { /* silent */ });
                  }}
                  activeOpacity={0.75}
                >
                  {/* Two lines, not one. 8 of the 26 published questions are
                      longer than fits on one phone line — the longest is 58
                      characters — and a truncated question cannot be judged.
                      Wael saw "What is the phone number to call …" cut off on
                      build 333. The panel's whole job is to be readable enough
                      to be chosen instead of Send. */}
                  <Text style={styles.suggestText} numberOfLines={2}>{s.question}</Text>
                  <Ionicons name="open-outline" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionLabel}>Your email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={Colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
          />

          <TouchableOpacity
            style={[styles.submitBtn, (!message.trim() || submitting) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!message.trim() || submitting}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.submitBtnText}>Send</Text>}
          </TouchableOpacity>

          {errorText && (
            <Text style={styles.errorText}>{errorText}</Text>
          )}

          <Text style={styles.footerNote}>
            Messages go to the MyNaavi team. Reply within one business day.
          </Text>
        </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bgApp,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  intro: {
    color: Colors.textSecondary,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 8,
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 8,
  },
  textarea: {
    backgroundColor: Colors.bgElevated,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  input: {
    backgroundColor: Colors.bgElevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  submitBtn: {
    marginTop: 24,
    backgroundColor: Colors.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  errorText: {
    color: Colors.alert,
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },
  footerNote: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
  },
  suggestBox: {
    marginTop: 10,
    backgroundColor: 'rgba(93,202,165,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(93,202,165,0.25)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  suggestHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  suggestTitle: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(93,202,165,0.15)',
  },
  suggestText: {
    color: Colors.textPrimary,
    fontSize: 14,
    flex: 1,
    marginRight: 10,
  },
  successWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successTitle: {
    color: Colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  successSub: {
    color: Colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  successBtn: {
    marginTop: 28,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  successBtnText: {
    color: Colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
});
