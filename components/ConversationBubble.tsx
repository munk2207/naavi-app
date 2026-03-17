/**
 * ConversationBubble
 *
 * Displays a single turn of conversation — either Robert's message
 * or Naavi's response. Senior-friendly sizing and high contrast.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';

interface Props {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export function ConversationBubble({ role, content, timestamp }: Props) {
  const isNaavi = role === 'assistant';

  return (
    <View style={[styles.container, isNaavi ? styles.naaviContainer : styles.robertContainer]}>
      {isNaavi && (
        <Text style={styles.label}>Naavi</Text>
      )}
      <View style={[styles.bubble, isNaavi ? styles.naaviBubble : styles.robertBubble]}>
        <Text style={[styles.text, isNaavi ? styles.naaviText : styles.robertText]}>
          {content}
        </Text>
      </View>
      {timestamp && (
        <Text style={styles.timestamp}>{timestamp}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
    maxWidth: '85%',
  },
  naaviContainer: {
    alignSelf: 'flex-start',
  },
  robertContainer: {
    alignSelf: 'flex-end',
  },
  label: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginBottom: 4,
    marginLeft: 4,
    fontWeight: Typography.medium,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  naaviBubble: {
    backgroundColor: Colors.bubbleNaavi,
    borderBottomLeftRadius: 4,
  },
  robertBubble: {
    backgroundColor: Colors.bubbleRobert,
    borderBottomRightRadius: 4,
  },
  text: {
    fontSize: Typography.md,
    lineHeight: Typography.lineHeightMd,
  },
  naaviText: {
    color: Colors.textOnDark,
  },
  robertText: {
    color: Colors.textPrimary,
  },
  timestamp: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: 4,
    marginHorizontal: 4,
  },
});
