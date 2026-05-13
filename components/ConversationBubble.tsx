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

// V57.13.7 — bubble truncation via two-layer overlay (Wael 2026-05-07: "#3 is better").
// Why: V57.13.7's always-visible trailing dots cluttered every user bubble.
// Two-layer fix: a ruler Text (invisible user content + faded dot pad) gives
// Yoga a long string to measure, so Samsung One UI's intrinsic-width bug
// can't trim past the actual content. The user's text is then drawn on top
// via position: absolute, inheriting the ruler's bounds — no wrap math, no
// intrinsic-width guess. Visible result: user words at top-left, faded dots
// fill only the trailing space.
const DOT_RULER = '. '.repeat(20);

// V57.15.3 — Naavi-side ruler uses plain spaces, not dots. Samsung One
// UI's compositor leaks faint visible glyphs through `opacity: 0` on
// dot-character Text nodes (see screenshot 2026-05-13: cottage answer
// rendered correctly but trailing "..........." dots bled through).
// Spaces have zero glyph regardless of opacity, so they can't leak.
// They still produce the same width measurement Yoga needs to size
// the parent correctly. User bubble keeps DOT_RULER (intentionally
// faded-visible there because its background hides the bleed).
const NAAVI_INVISIBLE_RULER = ' '.repeat(50);

export function ConversationBubble({ role, content, timestamp }: Props) {
  const isNaavi = role === 'assistant';

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
          // V57.15.2 — apply the V57.13.7 ruler+overlay pattern that
          // already fixed the user (Robert) bubble's Samsung-Yoga
          // intrinsic-width truncation. Naavi's bubble had the same
          // class of bug (Wael 2026-05-13: long LIST_CONNECTION_QUERY
          // answer "…1. grocery. 2. cottage." clipped at "2."). Same
          // mechanism: outer Text contains the invisible content + an
          // invisible dot-ruler so Yoga measures the wider width; the
          // overlay Text on top displays the actual content with the
          // correct wrap because the parent's measured width is right.
          //
          // Difference from Robert's bubble: dots are opacity:0 (not
          // 0.35) because Naavi has no bubble background to fill —
          // any visible dot would be a leak.
          <View style={styles.naaviPlain}>
            <Text style={styles.naaviRuler} textBreakStrategy="simple">
              <Text style={styles.naaviRulerInvisible}>{content}</Text>
              <Text style={styles.naaviRulerDots}>{NAAVI_INVISIBLE_RULER}</Text>
            </Text>
            <Text style={styles.naaviOverlay} textBreakStrategy="simple">{content}</Text>
          </View>
        ) : (
          <View style={[styles.bubble, styles.robertBubble]}>
            <Text style={styles.bubbleRuler} textBreakStrategy="simple">
              <Text style={styles.bubbleRulerInvisible}>{content}</Text>
              <Text style={styles.bubbleRulerDots}>{DOT_RULER}</Text>
            </Text>
            <Text style={styles.bubbleOverlay} textBreakStrategy="simple">{content}</Text>
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
    // Retained for any other site that imports this style directly;
    // ConversationBubble itself now uses naaviRuler + naaviOverlay
    // (V57.15.2 ruler+overlay pattern, see comment in component above).
    fontSize: Typography.body,
    lineHeight: 20,
    color: Colors.textPrimary,
  },
  // V57.15.2 — Naavi ruler+overlay. Same pattern as the user bubble's
  // bubbleRuler / bubbleRulerInvisible / bubbleRulerDots / bubbleOverlay,
  // tuned for naaviPlain's smaller padding (paddingHorizontal/Vertical: 4).
  naaviRuler: {
    fontSize: Typography.body,
    lineHeight: 20,
  },
  naaviRulerInvisible: {
    opacity: 0,
  },
  naaviRulerDots: {
    // opacity:0 (not 0.35) — Naavi has no bubble background, so any
    // visible dot would be a UI leak. We only need Yoga to measure
    // the wider intrinsic width; the dots themselves stay hidden.
    opacity: 0,
  },
  naaviOverlay: {
    position: 'absolute',
    top:    4,   // matches naaviPlain.paddingVertical
    left:   4,   // matches naaviPlain.paddingHorizontal
    right:  4,
    fontSize: Typography.body,
    lineHeight: 20,
    color: Colors.textPrimary,
  },
  bubbleRuler: {
    fontSize: Typography.body,
    lineHeight: 20,
  },
  bubbleRulerInvisible: {
    // Wael 2026-05-10 (B3b): color:'transparent' renders as faintly visible
    // glyphs on Samsung One UI long-wrap user bubbles (compositor doesn't
    // fully suppress). opacity:0 hides at the compositor level instead, no
    // glyph leak. Architecture (invisible-user-content sizes the bubble
    // height) intact.
    opacity: 0,
  },
  bubbleRulerDots: {
    color: Colors.textHint,
    opacity: 0.35,
  },
  bubbleOverlay: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
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
