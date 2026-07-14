/**
 * Session 2026-07-14 — B9c: the "Your Lists" screen kept showing a
 * just-disabled list as active. The DB write was already confirmed correct
 * (enabled: false persisted) and the row already had grayed-out/"Expired"
 * styling for disabled lists (since build 199) — the actual gap was that
 * app/lists.tsx only fetched on mount (useEffect(() => { load(); }, [load]))
 * with no refetch on screen focus, so a disable done elsewhere (chat/voice)
 * left the screen showing stale pre-disable data until a manual
 * pull-to-refresh.
 *
 * Fix: replaced the mount-only useEffect with useFocusEffect
 * (@react-navigation/native, already a transitive dependency via
 * expo-router) so load() reruns every time the screen regains focus.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: app/lists.tsx is a React
 * Native module with Expo/RN imports that cannot be safely imported into
 * this Node/tsx test runner. This is a source-pattern assertion verifying
 * the focus-refetch wiring is present and the stale mount-only effect is
 * gone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const LISTS_PATH = join(process.cwd(), 'app', 'lists.tsx');

export const session2026_07_14_b9cListsFocusRefetchTests: TestCase[] = [
  {
    id: 'b9c.lists-screen-refetches-on-focus',
    category: 'rules',
    description: 'app/lists.tsx refetches lists via useFocusEffect so a disable/reactivate done elsewhere is never shown stale',
    async run() {
      const src = readFileSync(LISTS_PATH, 'utf8');

      expectTruthy(
        src.includes("import { useFocusEffect } from '@react-navigation/native';"),
        'B9c fix: app/lists.tsx must import useFocusEffect from @react-navigation/native',
      );
      expectTruthy(
        src.includes('useFocusEffect(useCallback(() => { load(); }, [load]))'),
        'B9c fix: the screen must call load() inside useFocusEffect, not just a mount-only useEffect',
      );
      expectTruthy(
        !/useEffect\(\(\) => \{ load\(\); \}, \[load\]\);/.test(src),
        'B9c fix: the old mount-only useEffect(() => { load(); }, [load]) must be removed, not left alongside the focus effect',
      );
    },
  },
];
