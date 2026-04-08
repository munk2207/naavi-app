/**
 * Naavi design system — typography
 *
 * Dark theme spec inspired by Gentler Streak.
 * Font families: SF Pro Rounded (headings), SF Pro (body), SF Mono (metric labels).
 * On Android: system Roboto is used as fallback.
 */

import { Platform } from 'react-native';

export const Typography = {
  // Font families — platform-aware
  fontHeading:  Platform.select({ ios: 'System', android: 'Roboto', default: 'System' }),
  fontBody:     Platform.select({ ios: 'System', android: 'Roboto', default: 'System' }),
  fontMono:     Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),

  // Font sizes — new design spec
  screenTitle:    34,   // Screen titles — SF Pro Rounded
  sectionHeading: 22,   // Section headings — SF Pro Rounded
  cardTitle:      17,   // Card titles — SF Pro
  body:           15,   // Body text — SF Pro
  largeMetric:    40,   // Large metric numerals — SF Pro Rounded
  metricLabel:    12,   // Metric unit labels — SF Mono, ALL CAPS
  caption:        12,   // Captions — SF Pro

  // Legacy aliases (for gradual migration)
  xs:   12,
  sm:   15,
  base: 15,
  md:   17,
  lg:   22,
  xl:   28,
  xxl:  34,

  // Line heights
  lineHeightBody:    24,   // 1.6 × 15
  lineHeightCard:    26,   // 1.5 × 17
  lineHeightSection: 30,   // 1.36 × 22
  lineHeightTitle:   40,   // 1.18 × 34

  // Legacy line height aliases
  lineHeightBase: 24,
  lineHeightMd:   26,
  lineHeightLg:   30,

  // Font weights
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,

  // Letter spacing
  letterTitle:   -0.5,
  letterMetric:  -1,
  letterLabel:    0.06,   // em — for metric unit labels

  // Touch targets
  touchTargetMin:    44,   // Minimum per new spec
  touchTargetIdeal:  52,   // Standard button height
  touchTargetVoice:  80,   // Voice button — primary interaction
} as const;
