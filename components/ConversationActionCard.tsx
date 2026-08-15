/**
 * ConversationActionCard
 *
 * Displays a single extracted action from a recorded conversation.
 * Dark theme with semantic ramp color-coding.
 *
 * Action items of types appointment / meeting / call / test / prescription /
 * follow_up are AUTO-CREATED as Google Calendar events the moment the user
 * confirms speakers (see useConversationRecorder.confirmSpeakers). The card
 * shows a "✓ In your calendar" badge for those types — tapping it opens the
 * real event in Google Calendar (action.calendar_html_link, set by
 * confirmSpeakers after creation succeeds). There is no separate "add to
 * calendar" button — that would create duplicates.
 *
 * 2026-08-15 fix — the badge used to be purely informational (no onPress at
 * all, and no field existed to even store the created event's link). Now
 * tappable whenever calendar_html_link is present; falls back to a plain,
 * non-tappable badge if creation failed and no link exists.
 *
 * The "Draft Email" button only shows when action.email_draft is populated
 * (2026-08-15 fix — previously shown unconditionally on every card, even
 * when the transcript never mentioned email at all). extract-actions only
 * fills email_draft when the transcript explicitly mentions sending one,
 * so this ties the button's visibility to actual relevance.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';
import type { ConversationAction } from '@/hooks/useConversationRecorder';

// Map action types to semantic ramp levels
const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  appointment:  { icon: '📅', color: Colors.moderate },
  meeting:      { icon: '🤝', color: Colors.moderate },
  call:         { icon: '📞', color: Colors.moderate },
  email:        { icon: '✉️', color: Colors.moderate },
  test:         { icon: '🧪', color: Colors.caution },
  prescription: { icon: '💊', color: Colors.gentle },
  follow_up:    { icon: '🔁', color: Colors.caution },
  reminder:     { icon: '🔔', color: Colors.caution },
  task:         { icon: '✅', color: Colors.gentle },
};

interface Props {
  action: ConversationAction;
  onEmail?: (action: ConversationAction) => void;
}

// Types that confirmSpeakers auto-creates calendar events for.
// Keep in sync with useConversationRecorder.ts:calendarTypes.
const AUTO_CALENDAR_TYPES = ['appointment', 'meeting', 'call', 'test', 'prescription', 'follow_up'];

export function ConversationActionCard({ action, onEmail }: Props) {
  const cfg = TYPE_CONFIG[action.type] ?? TYPE_CONFIG.task;
  const wasAutoAdded = AUTO_CALENDAR_TYPES.includes(action.type);

  return (
    <View style={[styles.card, { borderLeftColor: cfg.color }]}>
      <View style={styles.headerRow}>
        <Text style={styles.icon}>{cfg.icon}</Text>
        <View style={styles.headerText}>
          <Text style={[styles.typeLabel, { color: cfg.color }]}>
            {action.type.replace('_', ' ').toUpperCase()}
          </Text>
          <Text style={styles.title}>{action.title}</Text>
        </View>
      </View>

      <Text style={styles.description}>{action.description}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.timing}>⏱ {action.timing}</Text>
      </View>

      <View style={styles.actions}>
        {wasAutoAdded && (
          action.calendar_html_link ? (
            <TouchableOpacity
              style={styles.calendarBadge}
              onPress={() => Linking.openURL(action.calendar_html_link!)}
              activeOpacity={0.8}
            >
              <Text style={styles.calendarBadgeText}>✓ In your calendar</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.calendarBadge}>
              <Text style={styles.calendarBadgeText}>✓ In your calendar</Text>
            </View>
          )
        )}
        {onEmail && action.email_draft && (
          <TouchableOpacity
            style={styles.btnOutline}
            onPress={() => onEmail(action)}
            activeOpacity={0.8}
          >
            <Text style={styles.btnOutlineText}>✉️ Draft Email</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    padding: 16,
    marginBottom: 10,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  icon: {
    fontSize: 24,
    marginTop: 2,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  typeLabel: {
    fontSize: Typography.caption,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: Typography.cardTitle,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  description: {
    fontSize: Typography.body,
    color: Colors.textSecondary,
    lineHeight: Typography.lineHeightBody,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  timing: {
    fontSize: Typography.caption,
    color: Colors.textHint,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  // Read-only badge replacing the old "Add to Calendar" button. Shows when the
  // action's calendar event was auto-created at confirmSpeakers time.
  calendarBadge: {
    backgroundColor: 'rgba(108, 196, 161, 0.18)', // Colors.accent at 18% alpha
    borderWidth: 0.5,
    borderColor: Colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
  },
  calendarBadgeText: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.accent,
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 0.5,
    borderColor: Colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 14,
  },
  btnOutlineText: {
    fontSize: Typography.body,
    fontWeight: '600',
    color: Colors.accent,
  },
});
