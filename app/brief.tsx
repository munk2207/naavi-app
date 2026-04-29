/**
 * Morning Brief screen
 *
 * Opened by Google Assistant via naavi://brief
 * Calls assistant-fulfillment, speaks the response, then returns to home.
 */

import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import * as Speech from 'expo-speech';
import { supabase } from '@/lib/supabase';
import { invokeWithTimeout } from '@/lib/invokeWithTimeout';
import { Colors } from '@/constants/Colors';
// speakCue uses Deepgram aura-hera-en so this screen sounds like Naavi's
// main voice (falls back to expo-speech if the network is down).
import { speakCue } from '@/lib/tts';

type Status = 'loading' | 'speaking' | 'done' | 'error';

export default function BriefScreen() {
  const [status, setSatus]   = useState<Status>('loading');
  const [plainText, setPlainText] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await invokeWithTimeout('assistant-fulfillment', {
          body: { intent: 'brief' },
        }, 30_000);

        if (cancelled) return;
        if (error) throw error;

        const text: string = data?.plainText ?? 'Your morning brief is ready.';
        setPlainText(text);
        setSatus('speaking');

        speakCue(text, 'en').then(() => {
          if (cancelled) return;
          setSatus('done');
          setTimeout(() => router.replace('/'), 1000);
        });
      } catch {
        if (!cancelled) {
          setSatus('error');
          setTimeout(() => router.replace('/'), 2000);
        }
      }
    })();

    return () => {
      cancelled = true;
      Speech.stop();
    };
  }, []);

  return (
    <View style={styles.container}>
      {status === 'loading' && (
        <>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.label}>Getting your morning brief...</Text>
        </>
      )}
      {status === 'speaking' && (
        <>
          <Text style={styles.title}>Morning Brief</Text>
          {plainText ? <Text style={styles.body}>{plainText}</Text> : null}
        </>
      )}
      {status === 'done' && (
        <Text style={styles.label}>Done</Text>
      )}
      {status === 'error' && (
        <Text style={styles.error}>Could not load your brief. Returning...</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: Colors.bgApp,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.accent,
    marginBottom: 16,
    textAlign: 'center',
  },
  label: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginTop: 16,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
  },
  error: {
    fontSize: 15,
    color: Colors.alert,
    textAlign: 'center',
  },
});
