/**
 * Expo Config Plugin — Strip ACTIVITY_RECOGNITION from the merged AndroidManifest
 *
 * Why this exists:
 *   Naavi has no health features. The android.permission.ACTIVITY_RECOGNITION
 *   permission is contributed transitively by react-native-background-geolocation
 *   (Transistorsoft) because the SDK uses Android's Motion API to optimize
 *   battery during geofencing. Google Play classifies any AAB declaring this
 *   permission as a Health App and requires the Health apps declaration form.
 *   Google's own form copy explicitly tells non-health apps to remove the
 *   permission instead of declaring health features.
 *
 *   This plugin uses Android's manifest-merger override rule
 *   (`tools:node="remove"`) to strip the permission from the final AAB
 *   AndroidManifest.xml while leaving the Transistorsoft library installed.
 *   It MUST be paired with `disableMotionActivityUpdates: true` in
 *   `BackgroundGeolocation.ready({...})` so the SDK stops calling the now-
 *   blocked Motion API (see `hooks/useGeofencing.ts`).
 *
 *   Vendor-documented consequences (from
 *   https://transistorsoft.medium.com/google-play-store-required-declarations-for-foreground-services-and-health-97da6e2abd5a):
 *   "Removing the ACTIVITY_RECOGNITION permission will have major consequences
 *    on the performance of the SDK — it will require a much longer distance
 *    before the device is detected to be moving (200–1000 meters)."
 *   Real-world impact must be verified by drive test on Wael's Samsung before
 *   promoting to production AAB.
 *
 * How verification works:
 *   After EAS prebuild, the merged AndroidManifest.xml at
 *   android/app/src/main/AndroidManifest.xml should contain neither a
 *   <uses-permission> for ACTIVITY_RECOGNITION nor the FOREGROUND_SERVICE_HEALTH
 *   permission. The maintainer-recommended verification is ClassyShark on the
 *   built APK (see Issue #2031 comment by @christocracy, Sep 12 2024).
 *
 * What this plugin does at build time:
 *   1. Ensures `xmlns:tools="http://schemas.android.com/tools"` is declared on
 *      the <manifest> root. The Android manifest merger requires this namespace
 *      for the `tools:node="remove"` directive to be honored.
 *   2. Injects two <uses-permission> elements with `tools:node="remove"`, one
 *      for ACTIVITY_RECOGNITION (the trigger Google Play Health-classifies on)
 *      and one for FOREGROUND_SERVICE_HEALTH (a related permission flagged by
 *      the same community pattern — see @ademirtemur Dec 30 2024 in Issue
 *      #2031). Both are idempotent — if they already exist (from a previous
 *      build), the plugin is a no-op.
 */

const { withAndroidManifest } = require('@expo/config-plugins');

const PERMISSIONS_TO_REMOVE = [
  'android.permission.ACTIVITY_RECOGNITION',
  'android.permission.FOREGROUND_SERVICE_HEALTH',
];

module.exports = function withRemoveActivityRecognition(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults?.manifest;
    if (!manifest) {
      console.warn(
        '[withRemoveActivityRecognition] No manifest found in modResults — skipping.'
      );
      return config;
    }

    // 1. Ensure xmlns:tools is declared on the <manifest> root.
    //    Without this, the manifest merger silently ignores tools:node="remove".
    if (!manifest.$) manifest.$ = {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // 2. Inject <uses-permission tools:node="remove"> for each target permission,
    //    deduplicated against existing entries.
    if (!Array.isArray(manifest['uses-permission'])) {
      manifest['uses-permission'] = [];
    }

    for (const permissionName of PERMISSIONS_TO_REMOVE) {
      const existingRemoveEntry = manifest['uses-permission'].find(
        (entry) =>
          entry?.$?.['android:name'] === permissionName &&
          entry?.$?.['tools:node'] === 'remove'
      );
      if (existingRemoveEntry) continue;

      manifest['uses-permission'].push({
        $: {
          'android:name': permissionName,
          'tools:node': 'remove',
        },
      });
      console.log(
        `[withRemoveActivityRecognition] Injected tools:node="remove" for ${permissionName}`
      );
    }

    return config;
  });
};
