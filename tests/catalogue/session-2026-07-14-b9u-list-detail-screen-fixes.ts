/**
 * Session 2026-07-14 — B9u: two bugs found live in app/lists/[id].tsx while
 * testing B9c on staging build 305.
 *
 * Bug 1 — mislabeled button: on an ENABLED list, the red bottom button read
 * "Delete list" but actually triggered a reversible soft-disable (the confirm
 * modal it opens correctly says "Disable '<name>'? ... You can reactivate it
 * from the Lists screen."). Wael caught the inconsistency directly against
 * the Alerts screen, which correctly labels the same action "Disable alert".
 * Fixed: button now reads "Disable list" when the list is enabled.
 *
 * Bug 2 — items vanish after disabling: the detail screen read items via
 * readList(listName), which resolves the list by name through
 * findListByName()'s enabled-only filter (lib/lists.ts). Once a list is
 * disabled, that lookup can never find it again, so the screen showed "No
 * items yet" even though the Drive doc content (confirmed: a disabled
 * "Costco" list with "eggs"/"gas") was fully preserved — this was the
 * "not yet investigated" gap flagged in B9c's original write-up, now
 * root-caused and confirmed live. Fixed: the screen already has drive_file_id
 * from its own by-ID (not by-name) row fetch — it now reads items directly
 * via the new readListItemsByFileId() export, bypassing the enabled-only
 * name lookup entirely.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: both files are React
 * Native / Expo modules that cannot be safely imported into this Node/tsx
 * test runner. These are source-pattern assertions.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const LIST_DETAIL_PATH = join(process.cwd(), 'app', 'lists', '[id].tsx');
const LISTS_LIB_PATH = join(process.cwd(), 'lib', 'lists.ts');

export const session2026_07_14_b9uListDetailScreenFixesTests: TestCase[] = [
  {
    id: 'b9u.enabled-list-button-says-disable-not-delete',
    category: 'rules',
    description: 'the bottom button on an enabled list reads "Disable list", matching the reversible action it actually performs',
    async run() {
      const src = readFileSync(LIST_DETAIL_PATH, 'utf8');
      expectTruthy(
        src.includes("{list.enabled ? 'Disable list' : 'Delete permanently'}"),
        'B9u fix: enabled-list button text must say "Disable list", not "Delete list" — the button triggers a reversible soft-disable, and the confirm modal it opens already correctly says "Disable"',
      );
      expectTruthy(
        !src.includes("{list.enabled ? 'Delete list' : 'Delete permanently'}"),
        'B9u fix: the old mislabeled "Delete list" text must be gone',
      );
    },
  },
  {
    id: 'b9u.list-detail-reads-items-by-file-id-not-name',
    category: 'rules',
    description: 'list-detail screen reads items via readListItemsByFileId (works for disabled lists), not readList(name) (enabled-only lookup, always empty for a disabled list)',
    async run() {
      const detailSrc = readFileSync(LIST_DETAIL_PATH, 'utf8');
      const libSrc = readFileSync(LISTS_LIB_PATH, 'utf8');

      expectTruthy(
        detailSrc.includes("import { readListItemsByFileId, disableList, reactivateList } from '@/lib/lists';"),
        'B9u fix: list-detail screen must import readListItemsByFileId instead of readList',
      );
      expectTruthy(
        detailSrc.includes('readListItemsByFileId(detail.drive_file_id, detail.name)'),
        'B9u fix: list-detail screen must read items via readListItemsByFileId(detail.drive_file_id, ...) — detail.drive_file_id came from a by-ID row fetch with no enabled filter, so this works for disabled lists',
      );
      expectTruthy(
        !detailSrc.includes('readList(detail.name)'),
        'B9u fix: the old readList(detail.name) call must be gone — it resolves the list by name through an enabled-only filter, which can never find a disabled list',
      );
      expectTruthy(
        libSrc.includes('export async function readListItemsByFileId('),
        'B9u fix: lib/lists.ts must export readListItemsByFileId so the detail screen can read items without the enabled-only name lookup',
      );
    },
  },
];
