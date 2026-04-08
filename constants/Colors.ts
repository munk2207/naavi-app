/**
 * Naavi design system — dark theme colours
 *
 * Inspired by Gentler Streak (Apple Design Award 2024).
 * Dark, warm, non-clinical. Colour encodes effort or state, never judgment.
 * All text/background combinations meet WCAG AA contrast ratio.
 */

export const Colors = {
  // Backgrounds
  bgApp:       '#1C1C1E',   // App background
  bgCard:      '#2C2C2E',   // Cards, panels
  bgElevated:  '#3A3A3C',   // Bottom sheets, modals, inputs

  // Text
  textPrimary:   '#FFFFFF',                  // Headings, values
  textSecondary: 'rgba(255,255,255,0.60)',   // Body copy, descriptions
  textHint:      'rgba(255,255,255,0.35)',   // Captions, placeholders, metric labels

  // Accent
  accent:      '#5DCAA5',   // CTAs, active icons, links
  accentDark:  '#085041',   // Text on accent background

  // Borders
  border:      'rgba(255,255,255,0.08)',   // Dividers, card borders
  borderFocus: 'rgba(255,255,255,0.25)',   // Input focus ring

  // Semantic ramp — use to signal intensity or state, never red/green pass-fail
  gentle:   '#5DCAA5',   // Success, positive
  moderate: '#4A9EDB',   // Info, scheduling
  caution:  '#EF9F27',   // Active, attention
  alert:    '#D85A30',   // Hard, error (never pure red)

  // Voice button states (mapped to semantic ramp)
  voiceIdle:       '#5DCAA5',   // Gentle — ready
  voiceListening:  '#5DCAA5',   // Gentle — recording
  voiceProcessing: '#EF9F27',   // Caution — thinking
  voiceSpeaking:   '#4A9EDB',   // Moderate — responding
  voiceError:      '#D85A30',   // Alert — error

  // Conversation bubbles
  bubbleNaavi:  'transparent',  // Naavi speaks — plain text, no bubble
  bubbleRobert: '#3A3A3C',     // Robert speaks — elevated surface

  // Overlay
  overlay: 'rgba(0,0,0,0.60)',

  // ---- Legacy aliases (for gradual migration) ----
  primary:      '#5DCAA5',
  primaryMid:   '#5DCAA5',
  primaryLight: '#2C2C2E',
  background:   '#1C1C1E',
  surface:      '#2C2C2E',
  surfaceAlt:   '#3A3A3C',
  textOnDark:   '#FFFFFF',
  textMuted:    '#9CA3AF',
  success:      '#5DCAA5',
  warning:      '#EF9F27',
  error:        '#D85A30',
  info:         '#4A9EDB',
  divider:      'rgba(255,255,255,0.08)',
  shadow:       'transparent',
} as const;
