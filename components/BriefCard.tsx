/**
 * BriefCard
 *
 * Displays a single item from the morning brief — a calendar event,
 * health note, weather summary, or pending task.
 * Dark theme with Gentler Streak styling.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';
import type { BriefItem } from '@/lib/naavi-client';

const CATEGORY_ICONS: Record<BriefItem['category'], string> = {
  calendar: '📅',
  email:    '✉️',
  health:   '🏥',
  weather:  '🌤',
  social:   '👤',
  home:     '🏠',
  task:     '✓',
};

interface Props {
  item: BriefItem;
  onPress?: (item: BriefItem) => void;
}

export function BriefCard({ item, onPress }: Props) {
  return (
    <TouchableOpacity
      style={[styles.card, item.urgent && styles.urgentCard]}
      onPress={() => onPress?.(item)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${item.category}: ${item.title}`}
    >
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>{CATEGORY_ICONS[item.category]}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        {item.detail && (
          <Text style={styles.detail} numberOfLines={2}>{item.detail}</Text>
        )}
      </View>
      {item.urgent && (
        <View style={styles.urgentDot} accessibilityLabel="Urgent" />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 16,
    marginVertical: 5,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: Typography.touchTargetIdeal,
  },
  urgentCard: {
    borderColor: Colors.caution,
    borderWidth: 1.5,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  icon: {
    fontSize: 22,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: Typography.cardTitle,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    lineHeight: Typography.lineHeightCard,
  },
  detail: {
    fontSize: Typography.body,
    color: Colors.textSecondary,
    marginTop: 3,
    lineHeight: Typography.lineHeightBody,
  },
  urgentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.caution,
    marginLeft: 10,
  },
});
