/**
 * Session 2026-07-13 — B9p: the geofence setup screen's "Fix" button for
 * Notifications appeared to do nothing, requiring the user to manually
 * enable notifications in Android Settings.
 *
 * Root cause: two independent places requested the same POST_NOTIFICATIONS
 * permission and raced each other. app/_layout.tsx's maybeAutoRegisterPush
 * ran automatically on every cold start and called
 * Notifications.requestPermissionsAsync() whenever status was
 * 'undetermined' — firing before the user ever saw the setup screen.
 * Android only shows its permission dialog a limited number of times before
 * silently suppressing it and returning the prior status with no dialog —
 * so by the time the user tapped "Fix" on the setup screen
 * (hooks/useGeofencePermissions.ts), Android showed nothing, and the code
 * fell through to opening the generic app-info Settings page instead of the
 * notification toggle directly, making it look like nothing happened.
 *
 * Fix: (1) app/_layout.tsx no longer requests the permission itself — it
 * only checks status and registers the push token if already granted, so
 * the setup screen's Fix button is the ONE place that ever asks; (2) the
 * Settings fallback now opens the notification-specific settings screen
 * (ACTION_APP_NOTIFICATION_SETTINGS) instead of the generic app-info page,
 * so even when it does fall back, the user lands on the right toggle.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: both files are React
 * Native modules with Expo/RN imports that cannot be safely imported into
 * this Node/tsx test runner. These are source-pattern assertions verifying
 * the race is removed and the fallback intent is correct.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const LAYOUT_PATH = join(process.cwd(), 'app', '_layout.tsx');
const GEOFENCE_PERMS_PATH = join(process.cwd(), 'hooks', 'useGeofencePermissions.ts');

export const session2026_07_13_b9pNotificationPermissionRaceTests: TestCase[] = [
  {
    id: 'b9p.layout-no-longer-requests-notification-permission',
    category: 'rules',
    description: 'app/_layout.tsx\'s maybeAutoRegisterPush only checks notification permission status, never requests it, so it can\'t race the setup screen\'s Fix button',
    async run() {
      const src = readFileSync(LAYOUT_PATH, 'utf8');
      const fnIdx = src.indexOf('const maybeAutoRegisterPush = async () => {');
      expectTruthy(fnIdx !== -1, 'maybeAutoRegisterPush function not found in app/_layout.tsx');

      const fnEnd = src.indexOf('};', fnIdx);
      const fnBody = src.slice(fnIdx, fnEnd);

      expectTruthy(
        fnBody.includes('Notifications.getPermissionsAsync()'),
        'maybeAutoRegisterPush must still check status via getPermissionsAsync',
      );
      expectTruthy(
        !fnBody.includes('requestPermissionsAsync'),
        'B9p fix: maybeAutoRegisterPush must NOT call requestPermissionsAsync — that races the geofence setup screen\'s own Notifications Fix button and burns Android\'s one-time permission dialog before the user sees the setup screen',
      );
    },
  },
  {
    id: 'b9p.notification-fix-falls-back-to-notification-specific-settings',
    category: 'rules',
    description: 'the Notifications Fix button falls back to the notification-specific Settings screen instead of the generic app-info page',
    async run() {
      const src = readFileSync(GEOFENCE_PERMS_PATH, 'utf8');

      expectTruthy(
        src.includes('APP_NOTIFICATION_SETTINGS'),
        'B9p fix: openNotificationSettings must use the android.settings.APP_NOTIFICATION_SETTINGS intent',
      );
      expectTruthy(
        src.includes("'android.provider.extra.APP_PACKAGE'"),
        'B9p fix: the APP_NOTIFICATION_SETTINGS intent must pass the APP_PACKAGE extra so it opens for the right app',
      );

      const notifCaseIdx = src.indexOf("case 'notifications': {");
      expectTruthy(notifCaseIdx !== -1, 'notifications case not found in fixPermission');
      const notifCaseEnd = src.indexOf('break;', notifCaseIdx);
      const notifCaseBody = src.slice(notifCaseIdx, notifCaseEnd);

      expectTruthy(
        notifCaseBody.includes('openNotificationSettings('),
        'B9p fix: the notifications case must call openNotificationSettings(...), not the generic openAppSettings(...), when the permission request doesn\'t result in granted',
      );
      expectTruthy(
        !notifCaseBody.includes('await openAppSettings(diag)') && !/await openAppSettings\(\);/.test(notifCaseBody.split('openNotificationSettings(')[0]),
        'B9p fix: the notifications case must not fall back to the generic openAppSettings before trying openNotificationSettings',
      );
    },
  },
];
