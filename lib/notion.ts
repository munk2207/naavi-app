/**
 * Notion integration
 *
 * Searches Robert's Notion workspace for pages mentioning a person.
 * Uses the Notion Search API — requires an Internal Integration token
 * created at https://www.notion.so/my-integrations
 *
 * The token is stored in localStorage (web) or SecureStore (mobile).
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const NOTION_VERSION = '2022-06-28';
const SEARCH_URL = 'https://api.notion.com/v1/search';
const STORE_KEY = 'naavi_notion_token';

// ─── Token storage ────────────────────────────────────────────────────────────

export async function saveNotionToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(STORE_KEY, token);
  } else {
    await SecureStore.setItemAsync(STORE_KEY, token);
  }
}

export async function getNotionToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(STORE_KEY);
  }
  return SecureStore.getItemAsync(STORE_KEY);
}

export async function removeNotionToken(): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(STORE_KEY);
  } else {
    await SecureStore.deleteItemAsync(STORE_KEY);
  }
}

export async function hasNotionToken(): Promise<boolean> {
  const token = await getNotionToken();
  return !!token && token.length > 0;
}

// ─── Notion search ────────────────────────────────────────────────────────────

interface NotionPage {
  id: string;
  url: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
}

function extractTitle(page: NotionPage): string {
  // Notion pages store title in different property names
  const props = page.properties as Record<string, {
    type: string;
    title?: Array<{ plain_text: string }>;
  }>;

  for (const key of ['title', 'Title', 'Name', 'name']) {
    const prop = props[key];
    if (prop?.title && prop.title.length > 0) {
      return prop.title[0].plain_text;
    }
  }
  return 'Untitled page';
}

/**
 * Search Notion for pages mentioning the given person's name.
 * Returns a list of note strings to include in the person's context.
 */
export async function fetchNotionNotesForPerson(name: string): Promise<string[]> {
  const token = await getNotionToken();
  if (!token) return [];

  try {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify({
        query: name,
        filter: { value: 'page', property: 'object' },
        page_size: 10,
      }),
    });

    if (!res.ok) {
      console.warn('[Notion] Search failed:', res.status);
      return [];
    }

    const data = await res.json();
    const pages: NotionPage[] = data.results ?? [];

    if (pages.length === 0) return [];

    console.log('[Notion] Found', pages.length, 'pages for', name);

    return pages.map(page => {
      const title = extractTitle(page);
      const edited = new Date(page.last_edited_time).toLocaleDateString('en-CA', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
      return `Notion: "${title}" (last edited ${edited})`;
    });
  } catch (err) {
    console.error('[Notion] Fetch error:', err);
    return [];
  }
}
