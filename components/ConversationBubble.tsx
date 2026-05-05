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
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';

// Fixed-pixel max width computed from the window width at render time.
// Percentage maxWidth ('85%') combined with alignSelf: 'flex-end' and a
// long unbreakable word (e.g. a 10-digit phone number) caused Android to
// clip text silently instead of wrapping. A fixed-pixel value sidesteps the
// measurement quirk and lets Android wrap normally.
const BUBBLE_MAX_WIDTH = Math.round(Dimensions.get('window').width * 0.85);

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
          <Text style={styles.naaviText}>{content}</Text>
        </View>
      ) : (
        <View style={[styles.bubble, styles.robertBubble]}>
          <Text style={styles.robertText}>{content}</Text>
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
    maxWidth: BUBBLE_MAX_WIDTH,
  },
  // V57.11.3 — removed the textRow + textFlex flex pattern entirely.
  // It was added in V57.10.3 to fix Yoga measurement on Samsung Android
  // (gifted-chat-style row wrapper + flex:0 + flexShrink:1 on the Text).
  // The pattern fixed single-character clips but Wael 2026-05-04 caught
  // it still dropping whole words on medium-length strings ("Navigate
  // to my next meeting" → "Navigate to my next"). Bumping paddingRight
  // 4 → 12 helped some lengths but not others. Dropping the row +
  // flex props lets RN's default text layout wrap normally inside the
  // maxWidth-constrained container, which is the simpler and correct
  // pattern for a chat bubble.
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
