/**
 * Expo Config Plugin — Google Assistant App Actions
 *
 * Injected automatically during every EAS build. Do NOT hand-edit android/.
 *
 * What this does:
 *  1. Writes res/xml/shortcuts.xml with three App Action capabilities
 *  2. Adds <meta-data android:name="android.app.shortcuts"> to AndroidManifest.xml
 *  3. Ensures the naavi:// scheme intent filter is present on the main activity
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// shortcuts.xml — declares the three App Action capabilities
// ---------------------------------------------------------------------------
const SHORTCUTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">

  <!--
    Morning Brief
    Trigger phrases: "Hey Google, open my morning brief on MyNaavi"
    Deep link:       naavi://brief
  -->
  <capability android:name="actions.intent.GET_NEWS_ARTICLE">
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="naavi://brief" />
    </intent>
  </capability>

  <!--
    Calendar Events
    Trigger phrases: "Hey Google, what's on my calendar tomorrow on MyNaavi"
    Deep link:       naavi://calendar?date=<ISO-8601>
    BII parameter:   startDate (schema.org/Date) mapped to query key "date"
  -->
  <capability android:name="actions.intent.GET_CALENDAR_EVENT">
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="naavi://calendar?date={startDate.iso_8601_full}" />
      <parameter
        android:name="startDate"
        android:key="date"
        android:mimeType="http://schema.org/Date" />
    </intent>
  </capability>

  <!--
    Contact Lookup
    Trigger phrases: "Hey Google, look up John Smith on MyNaavi"
    Deep link:       naavi://contacts?name=<name>
    BII parameter:   contact.name (schema.org/Text) mapped to query key "name"
  -->
  <capability android:name="actions.intent.GET_CONTACT">
    <intent android:action="android.intent.action.VIEW">
      <url-template android:value="naavi://contacts?name={contact.name}" />
      <parameter
        android:name="contact.name"
        android:key="name"
        android:mimeType="http://schema.org/Text" />
    </intent>
  </capability>

</shortcuts>
`;

// ---------------------------------------------------------------------------
// Step 1 — write shortcuts.xml into the Android res/xml directory
// ---------------------------------------------------------------------------
function withAppActionsXml(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'res', 'xml'
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'shortcuts.xml'), SHORTCUTS_XML, 'utf8');
      console.log('[withAppActions] shortcuts.xml written to', xmlDir);
      return config;
    },
  ]);
}

// ---------------------------------------------------------------------------
// Step 2 — patch AndroidManifest.xml
// ---------------------------------------------------------------------------
function withAppActionsManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest    = config.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) return config;

    // 2a. Add <meta-data android:name="android.app.shortcuts"> (deduplicated)
    if (!application['meta-data']) application['meta-data'] = [];

    const shortcutMetaExists = application['meta-data'].some(
      (m) => m.$?.['android:name'] === 'android.app.shortcuts'
    );
    if (!shortcutMetaExists) {
      application['meta-data'].push({
        $: {
          'android:name':     'android.app.shortcuts',
          'android:resource': '@xml/shortcuts',
        },
      });
    }

    // 2b. Ensure MainActivity has an explicit naavi:// intent filter.
    //     Expo Router already adds one via the "scheme" field in app.json,
    //     but we guard here in case the build order differs.
    const mainActivity = (application.activity ?? []).find(
      (a) =>
        a.$?.['android:name'] === '.MainActivity' ||
        a.$?.['android:name'] === 'ca.naavi.app.MainActivity'
    );

    if (mainActivity) {
      // Allow free rotation — follow the phone's sensor/auto-rotate setting
      mainActivity.$['android:screenOrientation'] = 'unspecified';

      if (!mainActivity['intent-filter']) mainActivity['intent-filter'] = [];

      const hasNaaviScheme = mainActivity['intent-filter'].some((f) =>
        (f.data ?? []).some((d) => d.$?.['android:scheme'] === 'naavi')
      );

      if (!hasNaaviScheme) {
        mainActivity['intent-filter'].push({
          $: { 'android:autoVerify': 'true' },
          action:   [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
          data: [{ $: { 'android:scheme': 'naavi' } }],
        });
        console.log('[withAppActions] naavi:// intent filter added to MainActivity');
      }
    }

    return config;
  });
}

// ---------------------------------------------------------------------------
// Export — compose both mods
// ---------------------------------------------------------------------------
module.exports = function withAppActions(config) {
  config = withAppActionsXml(config);
  config = withAppActionsManifest(config);
  return config;
};
