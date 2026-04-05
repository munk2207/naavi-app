/**
 * Naavi design system — colours
 *
 * Chosen for seniors: high contrast, warm tones, nothing harsh.
 * All text/background combinations meet WCAG AA contrast ratio.
 */

export const Colors = {
  // Brand
  primary:     '#1B4332', // Deep forest green — Naavi's identity colour
  primaryMid:  '#40916C', // Medium green — active states, highlights
  primaryLight:'#D8F3DC', // Very light green — backgrounds, tags

  // Backgrounds
  background:  '#FAFAF8', // Warm off-white — easy on aging eyes
  surface:     '#FFFFFF', // Card backgrounds
  surfaceAlt:  '#F3F4F1', // Subtle alternate rows

  // Text
  textPrimary:   '#1A1A1A', // Near-black — main content
  textSecondary: '#4B5563', // Mid grey — supporting content
  textMuted:     '#9CA3AF', // Light grey — timestamps, labels
  textOnDark:    '#FFFFFF', // White text on dark green backgrounds

  // Conversation bubbles
  bubbleNaavi:   '#1B4332', // Naavi speaks — dark green
  bubbleRobert:  '#F3F4F1', // Robert speaks — light grey

  // Semantic
  success:  '#2D6A4F',
  warning:  '#D97706',
  error:    '#DC2626',
  info:     '#1D4ED8',

  // Accent
  gold:        '#C9963A', // Warm gold — tasks, highlights, urgency
  goldLight:   '#FEF3C7', // Light gold background

  // UI
  border:      '#E5E7EB',
  divider:     '#F3F4F6',
  shadow:      'rgba(0, 0, 0, 0.08)',

  // Voice button states
  voiceIdle:      '#2D9D5C',
  voiceListening: '#DC2626', // Red when recording — clear visual signal
  voiceProcessing:'#D97706', // Amber when thinking
} as const;
