/**
 * ConversationActionCard
 *
 * Displays a single extracted action from a recorded conversation.
 * Robert can tap "Add to Calendar" or "Draft Email" directly from the card.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';
import type { ConversationAction } from '@/hooks/useConversationRecorder';

const TYPE_CONFIG: Record<ConversationAction['type'], { icon: string; color: string; bg: string }> = {
  appointment: { icon: '📅', color: '#0369A1', bg: '#E0F2FE' },
  test:        { icon: '🧪', color: '#7C3AED', bg: '#F5F3FF' },
  prescription:{ icon: '💊', color: '#065F46', bg: '#D1FAE5' },
  follow_up:   { icon: '🔁', color: '#92400E', bg: '#FEF3C7' },
  task:        { icon: '✅', color: '#1F2937', bg: '#F3F4F6' },
};

interface Props {
  action: ConversationAction;
  onCalendar?: (action: ConversationAction) => void;
  onEmail?: (action: ConversationAction) => void;
}

export function ConversationActionCard({ action, onCalendar, onEmail }: Props) {
  const cfg = TYPE_CONFIG[action.type] ?? TYPE_CONFIG.task;

  return (
    <View style={[styles.card, { backgroundColor: cfg.bg, borderLeftColor: cfg.color }]}>
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
        <Text style={styles.suggestedBy}>— {action.suggested_by}</Text>
      </View>

      <View style={styles.actions}>
        {action.calendar_title && onCalendar && (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: cfg.color }]}
            onPress={() => onCalendar(action)}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>📅 Add to Calendar</Text>
          </TouchableOpacity>
        )}
        {onEmail && (
          <TouchableOpacity
            style={[styles.btn, styles.btnOutline, { borderColor: cfg.color }]}
            onPress={() => onEmail(action)}
            activeOpacity={0.8}
          >
            <Text style={[styles.btnText, { color: cfg.color }]}>✉️ Draft Email</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderLeftWidth: 4,
    padding: 14,
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
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  title: {
    fontSize: Typography.base,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  description: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  timing: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  suggestedBy: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  btnText: {
    fontSize: Typography.sm,
    fontWeight: '600',
    color: '#fff',
  },
});
