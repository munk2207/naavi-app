/**
 * Naavi design system — typography
 *
 * Sized specifically for seniors (68+).
 * Standard mobile apps use 14-16sp. Naavi uses 18-24sp.
 * All touch targets are minimum 48pt (Apple HIG recommendation for seniors).
 */

export const Typography = {
  // Font sizes — larger than standard mobile apps
  xs:   14, // Timestamps, labels — absolute minimum
  sm:   16, // Supporting text
  base: 18, // Body text — default reading size for seniors
  md:   20, // Brief items, conversation text
  lg:   24, // Section headings
  xl:   28, // Screen titles
  xxl:  36, // Hero text (Naavi wordmark)

  // Line heights — generous spacing improves readability
  lineHeightBase:  28,
  lineHeightMd:    32,
  lineHeightLg:    36,

  // Font weights
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,

  // Touch targets
  touchTargetMin:    48, // Apple HIG minimum
  touchTargetIdeal:  64, // Recommended for seniors
  touchTargetVoice:  80, // Voice button — the primary interaction
} as const;
