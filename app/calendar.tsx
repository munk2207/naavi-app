/**
 * Calendar deep link screen
 *
 * Opened by Google Assistant via naavi://calendar?date=<ISO-8601>
 * Calls assistant-fulfillment with the date, speaks the event list, returns home.
 */

import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';

type Status = 'loading' | 'speaking' | 'done' | 'error';

export default function CalendarScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const [status, setStatus]   = useState<Status>('loading');
  const [plainText, setPlainText] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('assistant-fulfillment', {
          body: { intent: 'calendar', date: date ?? new Date().toISOString() },
        });

        if (cancelled) return;
        if (error) throw error;

        const text: string = data?.plainText ?? 'No events found for that date.';
        setPlainText(text);
        setStatus('speaking');

        Speech.speak(text, {
          language: 'en-US',
          rate: 0.95,
          onDone: () => {
            if (!cancelled) {
              setStatus('done');
              setTimeout(() => router.replace('/'), 1000);
            }
          },
          onError: () => {
            if (!cancelled) router.replace('/');
          },
        });
      } catch {
        if (!cancelled) {
          setStatus('error');
          setTimeout(() => router.replace('/'), 2000);
        }
      }
    })();

    return () => {
      cancelled = true;
      Speech.stop();
    };
  }, [date]);

  const dateLabel = date
    ? new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : 'Today';

  return (
    <View style={styles.container}>
      {status === 'loading' && (
        <>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.label}>Loading calendar for {dateLabel}...</Text>
        </>
      )}
      {status === 'speaking' && (
        <>
          <Text style={styles.title}>Calendar — {dateLabel}</Text>
          {plainText ? <Text style={styles.body}>{plainText}</Text> : null}
        </>
      )}
      {status === 'done' && (
        <Text style={styles.label}>Done</Text>
      )}
      {status === 'error' && (
        <Text style={styles.error}>Could not load calendar. Returning...</Text>
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
    backgroundColor: Colors.background,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 16,
    textAlign: 'center',
  },
  label: {
    fontSize: 16,
    color: Colors.text ?? '#333',
    marginTop: 16,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: Colors.text ?? '#333',
    lineHeight: 22,
    textAlign: 'center',
  },
  error: {
    fontSize: 15,
    color: '#c0392b',
    textAlign: 'center',
  },
});
