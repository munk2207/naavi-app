/**
 * Report-a-problem screen
 *
 * Self-contained bug-report form that POSTs to Formspree
 * (https://formspree.io/f/mpqkkdep). Reports land in the MyNaavi team's
 * inbox with device + user context auto-attached so we don't have to ask
 * the user for it.
 *
 * Accessed from the 3-dot menu → "Report a problem" on the home screen.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
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
import { suggestFaq, faqUrl, type FaqEntry } from '@/lib/faq';

const FORMSPREE_URL = 'https://formspree.io/f/mpqkkdep';

type Severity = 'urgent' | 'important' | 'annoying' | 'suggestion';

const SEVERITY_OPTIONS: Array<{ key: Severity; label: string; sub: string; icon: string; color: string }> = [
  { key: 'urgent',     label: 'Urgent',     sub: 'app is broken',    icon: 'alert-circle',  color: Colors.alert },
  { key: 'important',  label: 'Important',  sub: "doesn't work",     icon: 'warning',       color: Colors.caution },
  { key: 'annoying',   label: 'Annoying',   sub: 'glitch / typo',    icon: 'flag',          color: Colors.accent },
  { key: 'suggestion', label: 'Suggestion', sub: 'just an idea',     icon: 'bulb',          color: Colors.moderate },
];

export default function ReportScreen() {
  const router = useRouter();
  const [description, setDescription] = useState('');
  const [context, setContext]         = useState('');
  const [severity, setSeverity]       = useState<Severity>('annoying');
  const [email, setEmail]             = useState('');
  const [userId, setUserId]           = useState<string>('');
  const [userName, setUserName]       = useState<string>('');
  const [submitting, setSubmitting]   = useState(false);
  const [success, setSuccess]         = useState(false);
  const [errorText, setErrorText]     = useState<string | null>(null);
  // FAQ suggestion panel — debounced match against description + context.
  // Dismissed flag lets the user hide the panel if the suggestions don't fit,
  // so it doesn't keep resurfacing as they keep typing.
  const [suggestions, setSuggestions] = useState<FaqEntry[]>([]);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  useEffect(() => {
    if (suggestionsDismissed) { setSuggestions([]); return; }
    const combined = `${description} ${context}`.trim();
    const t = setTimeout(() => {
      setSuggestions(suggestFaq(combined, { max: 2, minScore: 2 }));
    }, 300);
    return () => clearTimeout(t);
  }, [description, context, suggestionsDismissed]);

  // Prefill email + user identity from the signed-in session + user_settings.
  // Falls through silently if the user is signed out — they can still submit
  // anonymously by typing an email manually.
  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const session = await getSessionWithTimeout();
      const authEmail = session?.user?.email ?? '';
      if (authEmail) setEmail(authEmail);
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

  async function handleSubmit() {
    setErrorText(null);
    const desc = description.trim();
    if (!desc) { setErrorText('Please describe what happened.'); return; }
    if (!email.trim() || !/@/.test(email)) { setErrorText('Your email is needed so we can reply.'); return; }

    setSubmitting(true);
    try {
      const appVersion = `${Constants.expoConfig?.version ?? '?'} (build ${Constants.expoConfig?.android?.versionCode ?? '?'})`;
      const platform   = `${Platform.OS} ${Platform.Version}`;

      const body = new URLSearchParams();
      body.append('description',   desc);
      body.append('context',       context.trim());
      body.append('severity',      severity);
      body.append('email',         email.trim());
      body.append('app_version',   appVersion);
      body.append('platform',      platform);
      body.append('user_id',       userId);
      body.append('user_name',     userName);
      body.append('submitted_at',  new Date().toISOString());
      body.append('_subject',      `[${severity.toUpperCase()}] MyNaavi bug report — ${appVersion}`);

      const res = await fetch(FORMSPREE_URL, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Formspree returned ${res.status}`);
      }
      setSuccess(true);
    } catch (err) {
      console.error('[Report] submit failed:', err);
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
            We read every report and reply within a few days if we need more detail.
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionLabel}>What happened</Text>
          <TextInput
            style={[styles.textarea, { minHeight: 96 }]}
            value={description}
            onChangeText={setDescription}
            placeholder="Naavi didn't do what I expected…"
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={1200}
            autoCorrect={false}
            autoComplete="off"
            textAlignVertical="top"
          />

          {suggestions.length > 0 && (
            <View style={styles.suggestBox}>
              <View style={styles.suggestHeader}>
                <View style={styles.suggestHeaderLeft}>
                  <Ionicons name="bulb" size={16} color={Colors.accent} />
                  <Text style={styles.suggestTitle}>Maybe this helps</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSuggestionsDismissed(true)}
                  hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                  <Ionicons name="close" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              {suggestions.map(s => (
                <TouchableOpacity
                  key={s.slug}
                  style={styles.suggestRow}
                  onPress={() => {
                    Linking.openURL(faqUrl(s)).catch(() => { /* silent — no network alerts mid-form */ });
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.suggestText} numberOfLines={1}>{s.question}</Text>
                  <Ionicons name="open-outline" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionLabel}>Context — what were you doing?</Text>
          <TextInput
            style={[styles.textarea, { minHeight: 72 }]}
            value={context}
            onChangeText={setContext}
            placeholder="Optional. E.g. 'I asked her to text my wife…'"
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={800}
            autoCorrect={false}
            autoComplete="off"
            textAlignVertical="top"
          />

          <Text style={styles.sectionLabel}>How bad is this?</Text>
          <View style={styles.severityGrid}>
            {SEVERITY_OPTIONS.map(opt => {
              const selected = severity === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.severityCard, selected && { backgroundColor: opt.color, borderColor: opt.color }]}
                  onPress={() => setSeverity(opt.key)}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={opt.icon as React.ComponentProps<typeof Ionicons>['name']}
                    size={22}
                    color={selected ? '#fff' : opt.color}
                  />
                  <Text style={[styles.severityLabel, selected && styles.severityLabelSelected]}>{opt.label}</Text>
                  <Text style={[styles.severitySub, selected && styles.severitySubSelected]}>{opt.sub}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

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
            style={[styles.submitBtn, (!description.trim() || submitting) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!description.trim() || submitting}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.submitBtnText}>Send report</Text>}
          </TouchableOpacity>

          {errorText && (
            <Text style={styles.errorText}>{errorText}</Text>
          )}

          <Text style={styles.footerNote}>
            Reports go to the MyNaavi team. We read every one.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
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
  severityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  severityCard: {
    width: '48%',
    backgroundColor: Colors.bgElevated,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 12,
    minHeight: 86,
  },
  severityLabel: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 6,
  },
  severitySub: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  severityLabelSelected: { color: '#fff' },
  severitySubSelected:   { color: 'rgba(255,255,255,0.9)' },
  submitBtn: {
    marginTop: 24,
    backgroundColor: Colors.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
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
  // ── FAQ suggestion panel ────────────────────────────────────────────────
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
  // ── Success state ───────────────────────────────────────────────────────
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
