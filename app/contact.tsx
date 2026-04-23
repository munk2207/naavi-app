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

import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

const FORMSPREE_URL = 'https://formspree.io/f/xgorryye';

export default function ContactScreen() {
  const router = useRouter();
  const [message, setMessage]     = useState('');
  const [email, setEmail]         = useState('');
  const [userId, setUserId]       = useState('');
  const [userName, setUserName]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]     = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) setEmail(session.user.email);
      if (session?.user?.id) {
        setUserId(session.user.id);
        const { data } = await supabase
          .from('user_settings')
          .select('name')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (data?.name) setUserName(data.name);
      }
    })();
  }, []);

  async function handleSubmit() {
    setErrorText(null);
    const m = message.trim();
    if (!m) { setErrorText('Tell us what you need.'); return; }
    if (!email.trim() || !/@/.test(email)) { setErrorText('Your email is needed so we can reply.'); return; }

    setSubmitting(true);
    try {
      const appVersion = `${Constants.expoConfig?.version ?? '?'} (build ${Constants.expoConfig?.android?.versionCode ?? '?'})`;
      const body = new URLSearchParams();
      body.append('message',       m);
      body.append('email',         email.trim());
      body.append('app_version',   appVersion);
      body.append('platform',      `${Platform.OS} ${Platform.Version}`);
      body.append('user_id',       userId);
      body.append('user_name',     userName);
      body.append('submitted_at',  new Date().toISOString());
      body.append('_subject',      `MyNaavi support — ${appVersion}`);

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
            We read every message and reply within a few days. If you included your email, we'll use it.
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
            Messages go to the MyNaavi team. Reply within a few days.
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
