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
        <View style={[styles.naaviPlain, styles.textRow]}>
          <Text style={[styles.naaviText, styles.textFlex]}>{content}</Text>
        </View>
      ) : (
        <View style={[styles.bubble, styles.robertBubble, styles.textRow]}>
          <Text style={[styles.robertText, styles.textFlex]}>{content}</Text>
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
  // Row-flex wrapper around the Text — gifted-chat-style. Forces a stable
  // width context on Android so Yoga measures correctly and Text wraps
  // instead of silently truncating ("What is my calendar next" instead of
  // "What is my calendar next\nweek"). Combined with `textFlex` below,
  // this is the battle-tested pattern from react-native-gifted-chat.
  textRow: {
    flexDirection: 'row',
  },
  // `flex: 0` (don't grow) + `flexShrink: 1` (allow shrink to fit row) on
  // the Text itself is what lets Android wrap correctly inside the row.
  //
  // V57.10.3 — paddingRight: 4 + includeFontPadding: false (Android-only)
  // fix the last-character clip ("Yes" → "Ye", "Costco, Gloucester" →
  // "Costco") Wael saw 2026-05-01. Android's intrinsic-width measurement
  // for short strings is sometimes 1-2px short of the actual glyph extent
  // when used inside a row with flex: 0; the extra buffer absorbs that
  // measurement quirk without changing wrap behaviour for long strings.
  textFlex: {
    flex: 0,
    flexShrink: 1,
    paddingRight: 4,
    includeFontPadding: false,
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
