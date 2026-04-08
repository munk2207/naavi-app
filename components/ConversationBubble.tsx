/**
 * ConversationBubble
 *
 * Displays a single turn of conversation — either Robert's message
 * or Naavi's response. Dark theme with Gentler Streak styling.
 *
 * Naavi's responses are simple text (no box/bubble).
 * Robert's messages use an elevated surface bubble.
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
        <Text style={styles.label}>MyNaavi</Text>
      )}
      {isNaavi ? (
        <View style={styles.naaviPlain}>
          {content.split('\n').map((line, i) => (
            <Text key={i} style={styles.naaviText}>
              {line}
            </Text>
          ))}
        </View>
      ) : (
        <View style={[styles.bubble, styles.robertBubble]}>
          {content.split('\n').map((line, i) => (
            <Text key={i} style={styles.robertText}>
              {line}
            </Text>
          ))}
        </View>
      )}
      {timestamp && (
        <Text style={[styles.timestamp, !isNaavi && { textAlign: 'right' }]}>{timestamp}</Text>
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
    fontSize: Typography.caption,
    color: Colors.textHint,
    marginBottom: 4,
    marginLeft: 4,
    fontWeight: Typography.medium,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  naaviPlain: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  robertBubble: {
    backgroundColor: Colors.bgElevated,
    borderBottomRightRadius: 4,
  },
  naaviText: {
    fontSize: Typography.body,
    lineHeight: Typography.lineHeightBody,
    color: Colors.textPrimary,
  },
  robertText: {
    fontSize: Typography.body,
    lineHeight: Typography.lineHeightBody,
    color: Colors.textPrimary,
  },
  timestamp: {
    fontSize: Typography.caption,
    color: Colors.textHint,
    marginTop: 4,
    marginHorizontal: 4,
  },
});
