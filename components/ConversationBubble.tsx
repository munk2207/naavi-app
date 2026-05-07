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

// V57.13.6 — short user messages get a trailing dot pad as a workaround for
// the Yoga single-line intrinsic-width measurement bug on Samsung One UI
// (react-native#35039). Yoga reports a slightly-too-small width, so the LAST
// word of short single-line messages gets clipped ("Alert me at Walmart" →
// "Alert me at"). Long messages that already wrap to 2+ lines self-heal.
// Padding short text with visible dots pushes the truncation point onto the
// dots instead of the user's real word; user's text stays whole.
//
// Only applied to user messages under TRUNCATION_PAD_THRESHOLD chars.
// Naavi messages don't truncate (they routinely wrap to multiple lines).
const TRUNCATION_PAD_THRESHOLD = 50;
const TRUNCATION_PAD = '. . . . . .';

function maybePad(content: string, isNaavi: boolean): string {
  if (isNaavi) return content;
  if (!content) return content;
  if (content.length >= TRUNCATION_PAD_THRESHOLD) return content;
  return `${content} ${TRUNCATION_PAD}`;
}

export function ConversationBubble({ role, content, timestamp }: Props) {
  const isNaavi = role === 'assistant';
  const displayContent = maybePad(content, isNaavi);

  // V57.11.5 — bubble layout reworked. The maxWidth + alignSelf approach
  // kept tripping Android's Yoga text measurement and dropping trailing
  // words. Use a row container with justifyContent (left for Naavi, right
  // for Robert) so the bubble has a clear flex parent. The inner bubble
  // uses flexShrink: 1 so it fits within the row, and the Text inside
  // gets explicit width so wrap is deterministic. This is the
  // gifted-chat-style row pattern but with explicit Text width to avoid
  // the residual Samsung clipping the previous attempts left behind.
  return (
    <View style={[styles.row, isNaavi ? styles.rowNaavi : styles.rowRobert]}>
      <View style={styles.column}>
        {isNaavi && <Text style={styles.label}>MyNaavi</Text>}
        {isNaavi ? (
          <View style={styles.naaviPlain}>
            {/* V57.11.8 — textBreakStrategy="simple" fixes the chronic
                Samsung S22 / Android Yoga Text-intrinsic-width measurement
                bug. Five layout attempts in V57.10.3..V57.11.7 fought
                container width; the actual cause is Android's default
                "highQuality" break strategy reporting a wrong intrinsic
                width on Samsung's One UI Roboto. "simple" uses greedy
                line-break, no width-balancing pass, intrinsic measurement
                reports correctly. Android-only; ignored on iOS.
                Evidence: react-native-paper #3472, #4395; react-native
                #35039. Investigated 2026-05-06. */}
            <Text style={styles.naaviText} textBreakStrategy="simple">{content}</Text>
          </View>
        ) : (
          <View style={[styles.bubble, styles.robertBubble]}>
            <Text style={styles.robertText} textBreakStrategy="simple">{displayContent}</Text>
          </View>
        )}
        {timestamp && (
          <Text style={[styles.timestamp, !isNaavi && styles.timestampRight]}>{timestamp}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // V57.11.5 — outer row gives flex context so Yoga measures Text
  // properly. justifyContent positions the bubble left (Naavi) or right
  // (Robert). Width is full available; padding handled via container's
  // paddingHorizontal in the parent ScrollView.
  row: {
    flexDirection: 'row',
    marginVertical: 6,
    width: '100%',
  },
  rowNaavi: {
    justifyContent: 'flex-start',
  },
  rowRobert: {
    justifyContent: 'flex-end',
  },
  // Inner column wraps label + bubble + timestamp. flexShrink:1 lets
  // it shrink within the row so Text can wrap. maxWidth caps it at
  // 85% of screen.
  // V57.11.7 — explicit maxWidth on the Text style itself (not just
  // the column) is the fix for the chronic Yoga visual-truncation bug
  // on Samsung Android. Wael 2026-05-06: V57.11.6 instrumentation
  // proved data is FULL at every step (turn-stored = "Navigate to my
  // next meeting." 28 chars) but the bubble cropped to "Navigate to my
  // next" (19 chars). Pure rendering bug. Numeric maxWidth on the Text
  // gives Yoga a hard pixel boundary it cannot mis-measure.
  // BUBBLE_MAX_WIDTH - 32 subtracts the bubble's horizontal padding
  // (16 left + 16 right) so the Text wraps inside the visible bubble.
  column: {
    flexShrink: 1,
    maxWidth: BUBBLE_MAX_WIDTH,
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
    // V57.12.2 — drop bubble lineHeight from 24 (1.6 × 15) to 20 (1.33 × 15)
    // to escape react-native#35039's bubble-truncation regime. Six prior
    // layout tweaks at the 1.6 ratio failed; 1.33 is the documented
    // resolution. Bubble-specific override so other text sites keep their
    // current spacing.
    lineHeight: 20,
    color: Colors.textPrimary,
  },
  robertText: {
    fontSize: Typography.body,
    lineHeight: 20,
    color: Colors.textPrimary,
  },
  timestamp: {
    fontSize: Typography.caption,
    color: Colors.textHint,
    marginTop: 4,
    marginHorizontal: 4,
  },
  timestampRight: {
    textAlign: 'right',
  },
});
