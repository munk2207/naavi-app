/**
 * Session 2026-07-14 — B9v: diagnostic instrumentation for the Notifications
 * "Fix" button, which Wael reported producing no visible reaction at all —
 * the 3rd report of this symptom despite B9p's fix (verified working on
 * build 304) and no code changes to this file since. The code read matches
 * Android's documented APP_NOTIFICATION_SETTINGS intent API correctly, so
 * rather than guess at another fix, this adds remoteLog tracing at every
 * step of hooks/useGeofencePermissions.ts's fixPermission('notifications')
 * so the next tap reveals exactly where it stops — request never resolving,
 * the intent throwing, or something else.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: hooks/useGeofencePermissions.ts
 * is a React Native / Expo module that cannot be safely imported into this
 * Node/tsx test runner. This is a source-pattern assertion verifying the
 * diagnostic log points exist at each step of the flow.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const GEOFENCE_PERMS_PATH = join(process.cwd(), 'hooks', 'useGeofencePermissions.ts');

export const session2026_07_14_b9vNotificationFixDiagnosticsTests: TestCase[] = [
  {
    id: 'b9v.notification-fix-traces-every-step',
    category: 'rules',
    description: 'fixPermission(\'notifications\') logs a diagnostic step before and after each async call, so a real tap reveals exactly where it stops',
    async run() {
      const src = readFileSync(GEOFENCE_PERMS_PATH, 'utf8');

      expectTruthy(
        src.includes("import { newDiagSession, remoteLog, endDiagSession } from '@/lib/remoteLog';"),
        'B9v diagnostic: useGeofencePermissions.ts must import the remoteLog helpers',
      );

      const fnIdx = src.indexOf('async function fixPermission(key: GeofencePermKey): Promise<void> {');
      expectTruthy(fnIdx !== -1, 'fixPermission function not found');
      const fnEnd = src.indexOf('\n}', fnIdx);
      const fnBody = src.slice(fnIdx, fnEnd);

      const requiredSteps = [
        'fixPermission-notifications-entry',
        'requestPermissionsAsync-start',
        'requestPermissionsAsync-resolved',
        'fixPermission-notifications-done',
        'fixPermission-outer-catch',
      ];
      for (const step of requiredSteps) {
        expectTruthy(
          fnBody.includes(step),
          `B9v diagnostic: fixPermission must log the '${step}' step`,
        );
      }

      expectTruthy(
        fnBody.includes('openNotificationSettings(diag)'),
        'B9v diagnostic: fixPermission must pass the diag session into openNotificationSettings so its internal steps are traced too',
      );
    },
  },
  {
    id: 'b9v.open-notification-settings-traces-intent-outcome',
    category: 'rules',
    description: 'openNotificationSettings logs whether the intent resolved or threw, and traces the openAppSettings fallback too',
    async run() {
      const src = readFileSync(GEOFENCE_PERMS_PATH, 'utf8');

      const fnIdx = src.indexOf('async function openNotificationSettings(diag?: string): Promise<void> {');
      expectTruthy(fnIdx !== -1, 'openNotificationSettings(diag?) signature not found — must accept an optional diag session');
      const fnEnd = src.indexOf('\n}', fnIdx);
      const fnBody = src.slice(fnIdx, fnEnd);

      expectTruthy(
        fnBody.includes('openNotificationSettings-start') &&
        fnBody.includes('openNotificationSettings-intent-resolved') &&
        fnBody.includes('openNotificationSettings-intent-threw'),
        'B9v diagnostic: openNotificationSettings must log start, success, and thrown-exception outcomes separately',
      );
      expectTruthy(
        fnBody.includes('await openAppSettings(diag)'),
        'B9v diagnostic: openNotificationSettings must pass the diag session through to its openAppSettings fallback',
      );
    },
  },
];
