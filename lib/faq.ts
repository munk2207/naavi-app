/**
 * FAQ match table — mirrors the 12 questions live at mynaavi.com/faq.
 *
 * Used by the Report-a-problem + Contact-support forms to suggest matching
 * articles as the user types. Keyword matching is local (no network, no AI
 * API call), so the suggestion UX is instant and private. Tapping a suggestion
 * opens the live FAQ page anchored to that question.
 *
 * When the canonical FAQ on mynaavi.com changes, update this file to keep
 * keywords in sync. The content itself lives on the website — we only mirror
 * the SLUG and the match keywords here.
 */

export interface FaqEntry {
  slug:     string;
  question: string;
  keywords: string[];
}

export const FAQ_ITEMS: FaqEntry[] = [
  {
    slug: 'talk-to-naavi',
    question: 'How do I talk to MyNaavi?',
    keywords: ['talk', 'speak', 'speaking', 'voice', 'microphone', 'mic', 'button', 'ask', 'hands-free', 'type', 'typing'],
  },
  {
    slug: 'what-can-i-ask',
    question: 'What can I ask MyNaavi to do?',
    keywords: ['can', 'do', 'ask', 'help', 'features', 'abilities', 'capable', 'capabilities'],
  },
  {
    slug: 'set-up-alert',
    question: 'How do I set up an alert?',
    keywords: ['alert', 'alerts', 'reminder', 'reminders', 'set', 'setup', 'create', 'new', 'arrive', 'when'],
  },
  {
    slug: 'didnt-hear-me',
    question: "Why didn't MyNaavi hear me?",
    keywords: ['hear', 'heard', 'listen', 'listening', 'not hearing', 'microphone', 'mic', 'permission', 'noise', 'quiet', 'speak up', 'ignore', 'ignoring', 'doesnt hear', "can't hear"],
  },
  {
    slug: 'delete-alert',
    question: 'How do I delete an alert?',
    keywords: ['delete', 'remove', 'cancel', 'stop', 'alert', 'alerts', 'reminder', 'get rid'],
  },
  {
    slug: 'what-remembers',
    question: 'What does MyNaavi remember?',
    keywords: ['remember', 'memory', 'note', 'notes', 'stored', 'saved', 'remembers', 'memorize', 'forget'],
  },
  {
    slug: 'send-texts-emails',
    question: 'Can MyNaavi send texts or emails for me?',
    keywords: ['text', 'texts', 'texting', 'email', 'emails', 'send', 'message', 'messages', 'sms', 'whatsapp', 'call'],
  },
  {
    slug: 'privacy',
    question: 'Is my data private?',
    keywords: ['private', 'privacy', 'data', 'safe', 'secure', 'security', 'share', 'sell', 'third party', 'confidential'],
  },
  {
    slug: 'why-called-me',
    question: 'Why did MyNaavi call me?',
    keywords: ['call', 'called', 'calling', 'phone', 'ringing', 'outbound', 'morning', 'brief', 'briefing', 'arrival'],
  },
  {
    slug: 'stop-talking',
    question: 'How do I stop MyNaavi from talking?',
    keywords: ['stop', 'silent', 'silence', 'mute', 'quiet', 'tts', 'speaking', 'talking', 'shut up', 'interrupt'],
  },
  {
    slug: 'brief-showing-tomorrow',
    question: "Why is the morning brief showing tomorrow's events?",
    keywords: ['brief', 'briefing', 'morning', 'today', 'tomorrow', 'calendar', 'schedule', 'wrong day', 'days'],
  },
  {
    slug: 'report-problem',
    question: "Something's broken. How do I report it?",
    keywords: ['broken', 'bug', 'problem', 'issue', 'error', 'crash', 'crashed', 'report', 'not working', "doesn't work", 'fix', 'help'],
  },
];

/**
 * Score an FAQ entry against user text. Higher = stronger match.
 * Score = count of keyword overlaps (case-insensitive, word boundary).
 * Returns 0 when no keyword is found.
 */
function scoreEntry(entry: FaqEntry, text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of entry.keywords) {
    // Word-boundary match; avoids "alertness" counting as "alert" while
    // still catching "alerting" (kw is usually the stem).
    const pattern = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (pattern.test(lower)) score++;
  }
  // Title match counts extra — if the user literally typed the question's
  // core noun, prioritise that entry.
  const titleWords = entry.question.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3);
  for (const w of titleWords) {
    if (lower.includes(w)) score += 0.5;
  }
  return score;
}

/**
 * Suggest FAQ entries matching the user's text. Returns up to `max` entries
 * sorted by score descending, filtered to score ≥ `minScore`. Empty array
 * when nothing clears the bar — caller should render nothing in that case.
 */
export function suggestFaq(
  text: string,
  opts: { max?: number; minScore?: number } = {},
): FaqEntry[] {
  const max      = opts.max      ?? 2;
  const minScore = opts.minScore ?? 2;
  if (!text || text.trim().split(/\s+/).length < 3) return [];
  return FAQ_ITEMS
    .map(entry => ({ entry, score: scoreEntry(entry, text) }))
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(x => x.entry);
}

export const FAQ_BASE_URL = 'https://mynaavi.com/faq';

/** Build the direct-anchor URL for a given FAQ entry. */
export function faqUrl(entry: FaqEntry): string {
  return `${FAQ_BASE_URL}#${entry.slug}`;
}
