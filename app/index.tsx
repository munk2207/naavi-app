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
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useOrchestrator } from '@/hooks/useOrchestrator';
import { useVoice } from '@/hooks/useVoice';
import { useWhisperMemo } from '@/hooks/useWhisperMemo';
import { VoiceButton } from '@/components/VoiceButton';
import { BriefCard } from '@/components/BriefCard';
import { ConversationBubble } from '@/components/ConversationBubble';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';
import type { BriefItem } from '@/lib/naavi-client';
import { fetchOttawaWeather } from '@/lib/weather';
import { sendDriveFileAsEmail } from '@/lib/drive';
import { fetchUpcomingEvents, fetchUpcomingBirthdays, captureAndStoreGoogleToken, triggerCalendarSync } from '@/lib/calendar';
import { fetchImportantEmails, triggerGmailSync, sendEmail } from '@/lib/gmail';
import { supabase } from '@/lib/supabase';

// No hardcoded brief — all items come from real data (calendar, weather)

// ─── Draft card component ─────────────────────────────────────────────────────

function DraftCard({ action }: { action: import('@/lib/naavi-client').NaaviAction }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleSendEmail() {
    setSending(true);
    setSendError(null);

    let to = String(action.to ?? '').trim();

    // If no email address, ask for one
    if (!to.includes('@') && typeof window !== 'undefined') {
      const entered = window.prompt(`Enter email address for ${to || 'recipient'}:`);
      if (!entered?.trim()) { setSending(false); return; }
      to = entered.trim();
    }

    const result = await sendEmail({
      to,
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

  return (
    <View style={styles.draftCard}>
      <Text style={styles.draftLabel}>
        {sent ? '✓ Email sent' : '✉ Draft ready'}
      </Text>
      <Text style={styles.draftField}>
        <Text style={styles.draftFieldLabel}>To: </Text>
        {String(action.to ?? '')}
      </Text>
      <Text style={styles.draftField}>
        <Text style={styles.draftFieldLabel}>Subject: </Text>
        {String(action.subject ?? '')}
      </Text>
      <Text style={styles.draftBody}>{String(action.body ?? '')}</Text>
      {sendError ? (
        <Text style={styles.draftSendError}>{sendError}</Text>
      ) : null}
      {!sent && (
        <TouchableOpacity
          style={[styles.draftSendBtn, sending && styles.draftSendBtnDisabled]}
          onPress={handleSendEmail}
          disabled={sending}
          accessibilityLabel="Send email"
        >
          <Text style={styles.draftSendBtnText}>
            {sending ? 'Sending…' : '✉ Send'}
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
  const [inputText, setInputText] = useState('');
  const [brief, setBrief] = useState<BriefItem[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Load weather immediately (no auth needed)
  useEffect(() => {
    fetchOttawaWeather().then(w => setBrief([w]));
  }, []);

  // Resolve user ID — from getSession on mount OR onAuthStateChange
  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[Home] getSession:', session?.user?.id ?? 'none');
      if (session?.user) setCurrentUserId(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[Home] onAuthStateChange:', event, 'user:', session?.user?.id ?? 'none');
        if (event === 'SIGNED_IN' && session?.provider_refresh_token) {
          await captureAndStoreGoogleToken();
        }
        if (session?.user) setCurrentUserId(session.user.id);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  // Load calendar data whenever user ID becomes available
  useEffect(() => {
    if (!currentUserId) return;
    console.log('[Home] loading calendar for user:', currentUserId);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    Promise.all([
      fetchUpcomingEvents(7, currentUserId),
      fetchUpcomingBirthdays(currentUserId),
      fetchImportantEmails(currentUserId),
    ]).then(([calendarItems, birthdayItems, emailItems]) => {
      console.log('[Home] calendar:', calendarItems.length, 'birthdays:', birthdayItems.length, 'emails:', emailItems.length);
      setBrief(prev => {
        const weather = prev.find(i => i.id === 'weather');
        return [...calendarItems, ...birthdayItems, ...emailItems, ...(weather ? [weather] : [])];
      });
    });

    // Background sync — refresh after Google Calendar + Gmail are polled
    Promise.all([triggerCalendarSync(), triggerGmailSync()]).then(() =>
      Promise.all([
        fetchUpcomingEvents(7, currentUserId),
        fetchUpcomingBirthdays(currentUserId),
        fetchImportantEmails(currentUserId),
      ])
    ).then(([fresh, freshBirthdays, freshEmails]) => {
      setBrief(prev => {
        const weather = prev.find(i => i.id === 'weather');
        return [...fresh, ...freshBirthdays, ...freshEmails, ...(weather ? [weather] : [])];
      });
    }).catch(() => {});
  }, [currentUserId]);

  const { status, history, drafts, createdEvents, driveFiles, error, send } = useOrchestrator('en', brief);
  const { voiceState, voiceError, startListening, isSupported } = useVoice('en');
  const { memoState, memoError, isSupported: memoSupported, startRecording, stopRecording } = useWhisperMemo();

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
    await send(text);
    // Scroll to bottom after response
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  function handleVoicePress() {
    if (voiceState === 'listening') return;
    startListening(async (transcript) => {
      setInputText('');
      await send(transcript);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
  }

  function handleBriefItemPress(item: BriefItem) {
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
        {/* Settings button */}
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/settings')}
          accessibilityLabel="Open settings"
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Greeting */}
          <Text style={styles.greeting}>{getGreeting()}</Text>

          {/* Morning brief */}
          {history.length === 0 && (
            <View style={styles.briefSection}>
              <Text style={styles.sectionTitle}>{t('home.briefTitle')}</Text>
              {brief.map(item => (
                <BriefCard
                  key={item.id}
                  item={item}
                  onPress={handleBriefItemPress}
                />
              ))}
            </View>
          )}

          {/* Conversation history */}
          {history.length > 0 && (
            <View style={styles.conversationSection}>
              {history.map((turn, index) => (
                <ConversationBubble
                  key={index}
                  role={turn.role}
                  content={turn.content}
                />
              ))}
            </View>
          )}

          {/* Draft message card */}
          {drafts.filter(a => a.type === 'DRAFT_MESSAGE').map((action, i) => (
            <DraftCard key={i} action={action} />
          ))}

          {/* Drive file cards */}
          {driveFiles.length > 0 && (
            <View style={styles.driveSection}>
              <Text style={styles.draftLabel}>📄 Drive documents</Text>
              {driveFiles.map((file, i) => (
                <View key={i} style={[styles.driveCard, file.parentFolderName ? styles.driveCardIndented : null]}>
                  <TouchableOpacity
                    onPress={() => Linking.openURL(file.webViewLink)}
                    accessibilityLabel={`Open ${file.name} in Google Drive`}
                  >
                    <Text style={styles.driveFileName}>{file.name}</Text>
                    <Text style={styles.driveFileMeta}>
                      {friendlyMimeType(file.mimeType)} · modified {new Date(file.modifiedTime).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {file.parentFolderName ? ` · in "${file.parentFolderName}"` : ''}
                    </Text>
                  </TouchableOpacity>
                  {file.mimeType !== 'application/vnd.google-apps.folder' && <TouchableOpacity
                    style={styles.driveSendBtn}
                    onPress={async () => {
                      const to = typeof window !== 'undefined'
                        ? window.prompt(`Send "${file.name}" to (enter email address):`)
                        : null;
                      if (!to?.trim()) return;
                      const result = await sendDriveFileAsEmail({
                        fileId: file.id,
                        fileName: file.name,
                        mimeType: file.mimeType,
                        to: to.trim(),
                      });
                      if (typeof window !== 'undefined') {
                        window.alert(result.success
                          ? `"${file.name}" sent to ${to.trim()}.`
                          : `Failed: ${result.error ?? 'Could not send the file.'}`
                        );
                      }
                    }}
                    accessibilityLabel={`Send ${file.name} as email attachment`}
                  >
                    <Text style={styles.driveSendBtnText}>✉ Send</Text>
                  </TouchableOpacity>}
                </View>
              ))}
            </View>
          )}

          {/* Calendar event created cards */}
          {createdEvents.map((ev, i) => (
            <TouchableOpacity
              key={i}
              style={styles.eventCard}
              onPress={() => ev.htmlLink ? Linking.openURL(ev.htmlLink) : undefined}
              accessibilityLabel="Open event in Google Calendar"
            >
              <Text style={styles.eventLabel}>📅 Event added to calendar</Text>
              <Text style={styles.eventTitle}>{ev.summary}</Text>
              {ev.htmlLink ? <Text style={styles.eventLink}>Already saved — tap to view in Google Calendar</Text> : null}
            </TouchableOpacity>
          ))}

          {/* Add contact card */}
          {drafts.filter(a => a.type === 'ADD_CONTACT').map((action, i) => (
            <View key={i} style={styles.contactCard}>
              <Text style={styles.contactLabel}>+ Contact saved</Text>
              {action.name ? (
                <Text style={styles.draftField}>
                  <Text style={styles.draftFieldLabel}>Name: </Text>
                  {String(action.name)}
                </Text>
              ) : null}
              {action.email ? (
                <Text style={styles.draftField}>
                  <Text style={styles.draftFieldLabel}>Email: </Text>
                  {String(action.email)}
                </Text>
              ) : null}
              {action.phone ? (
                <Text style={styles.draftField}>
                  <Text style={styles.draftFieldLabel}>Phone: </Text>
                  {String(action.phone)}
                </Text>
              ) : null}
              {action.relationship ? (
                <Text style={styles.draftField}>
                  <Text style={styles.draftFieldLabel}>Relationship: </Text>
                  {String(action.relationship)}
                </Text>
              ) : null}
            </View>
          ))}

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

        {/* Memo error */}
        {memoError ? (
          <View style={styles.statusRow}>
            <Text style={styles.errorText}>{memoError}</Text>
          </View>
        ) : null}

        {/* Input bar */}
        <View style={styles.inputBar}>
          {/* Whisper memo button */}
          {memoSupported && (
            <TouchableOpacity
              style={[styles.memoBtn, memoState === 'recording' && styles.memoBtnRecording]}
              onPressIn={startRecording}
              onPressOut={() => stopRecording(async (transcript) => {
                if (transcript.trim()) await send(transcript);
              })}
              disabled={memoState === 'transcribing' || status === 'thinking'}
              accessibilityLabel="Hold to record voice memo"
            >
              <Text style={styles.memoBtnText}>
                {memoState === 'recording' ? '⏹' : memoState === 'transcribing' ? '…' : '🎙'}
              </Text>
            </TouchableOpacity>
          )}

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
          {isSupported ? (
            <VoiceButton
              status={voiceState === 'listening' ? 'speaking' : status}
              onPress={inputText.trim() ? handleSend : handleVoicePress}
              disabled={status === 'thinking'}
            />
          ) : (
            <VoiceButton
              status={status}
              onPress={handleSend}
              disabled={!inputText.trim()}
            />
          )}
        </View>
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
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  settingsBtn: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 10,
    width: Typography.touchTargetIdeal,
    height: Typography.touchTargetIdeal,
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
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  briefSection: {
    marginBottom: 16,
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
  eventCard: {
    marginTop: 12,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#22C55E',
    padding: 14,
    gap: 4,
  },
  eventLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: '#16A34A',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  eventTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  eventLink: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginTop: 2,
  },
  contactCard: {
    marginTop: 12,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: Colors.success,
    padding: 14,
    gap: 6,
  },
  contactLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.success,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  draftCard: {
    marginTop: 12,
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: Colors.info,
    padding: 14,
    gap: 6,
  },
  draftLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.info,
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
  draftSendBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: Colors.info,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  draftSendBtnDisabled: {
    opacity: 0.5,
  },
  draftSendBtnText: {
    color: '#fff',
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
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
    backgroundColor: '#F0F7FF',
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#4285F4',
    padding: 12,
    gap: 4,
  },
  driveCardIndented: {
    marginLeft: 16,
    borderLeftColor: '#8AB4F8',
    backgroundColor: '#E8F0FE',
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
    backgroundColor: '#4285F4',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  driveSendBtnText: {
    color: '#fff',
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  memoBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  memoBtnRecording: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
  },
  memoBtnText: {
    fontSize: 18,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 12,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    maxHeight: 120,
    lineHeight: Typography.lineHeightBase,
  },
});
