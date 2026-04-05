/**
 * BriefCard — widget-style card for the morning brief.
 *
 * Displayed in a horizontal scroll row. Each card is a self-contained
 * colour-coded widget: large icon, category label, title, and detail.
 * Designed for seniors: large text, generous touch targets, high contrast.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';
import type { BriefItem } from '@/lib/naavi-client';

// ─── Per-category visual config ──────────────────────────────────────────────

const CATEGORY_CONFIG: Record<BriefItem['category'], {
  bg: string; accent: string; icon: string; label: string;
}> = {
  weather:  { bg: '#E0F2FE', accent: '#0369A1', icon: '🌤',  label: 'Weather'  },
  calendar: { bg: '#DCFCE7', accent: '#15803D', icon: '📅',  label: 'Calendar' },
  task:     { bg: '#FEF3C7', accent: '#B45309', icon: '☑️',  label: 'Tasks'    },
  email:    { bg: '#EFF6FF', accent: '#1D4ED8', icon: '✉️',  label: 'Email'    },
  social:   { bg: '#FFF1F2', accent: '#BE123C', icon: '🎂',  label: 'Birthday' },
  health:   { bg: '#F0FDFA', accent: '#0F766E', icon: '💊',  label: 'Health'   },
  home:     { bg: '#F5F3FF', accent: '#7C3AED', icon: '🏠',  label: 'Home'     },
};

interface Props {
  item: BriefItem;
  onPress?: (item: BriefItem) => void;
}

export function BriefCard({ item, onPress }: Props) {
  const config = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.calendar;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: config.bg }]}
      onPress={() => onPress?.(item)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${config.label}: ${item.title}`}
    >
      {/* Top row: icon + category label */}
      <View style={styles.topRow}>
        <Text style={styles.icon}>{config.icon}</Text>
        {item.urgent && <View style={[styles.urgentPill, { backgroundColor: config.accent }]}>
          <Text style={styles.urgentText}>Now</Text>
        </View>}
      </View>

      {/* Category label */}
      <Text style={[styles.categoryLabel, { color: config.accent }]}>{config.label}</Text>

      {/* Title — the main content */}
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>

      {/* Detail — time, location, or description */}
      {item.detail ? (
        <Text style={[styles.detail, { color: config.accent }]} numberOfLines={1}>
          {item.detail}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 190,
    minHeight: 150,
    borderRadius: 20,
    padding: 16,
    marginRight: 12,
    justifyContent: 'space-between',
    // Subtle shadow for depth
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
    }),
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    fontSize: 28,
  },
  urgentPill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  urgentText: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: '#fff',
  },
  categoryLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    lineHeight: Typography.lineHeightBase,
    flex: 1,
  },
  detail: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    marginTop: 6,
  },
});
