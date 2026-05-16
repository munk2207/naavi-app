# Transistorsoft v5.x — Doc Review + Config-Gap Analysis (2026-05-16)

Branch reviewed: `claude/transistorsoft-retry` at `C:\Users\waela\OneDrive\Desktop\Naavi`.
SDK version in `package.json`: `react-native-background-geolocation@^5.1.1`.
RN: `0.83.2`. Expo: `^55.0.9`.

This document is a side-by-side of "what vendor docs / canonical demo / maintainer say" vs "what we currently have." Observation only — no recommendations. All vendor claims are sourced; quoted phrases are verbatim where preserved.

---

## TL;DR

- **`geofenceModeHighAccuracy: false` (our value, also the SDK default) keeps the SDK in Android's lazy passive geofencing mode.** The maintainer's exact words on a near-identical question (Issue #1830, 2023-09-28): "It's well-known that Android geofence-only mode is lazier with passively monitoring geofences… you could achieve the same thing [as launching Google Maps] without launching Google maps by configuring `Config.geofenceModeHighAccuracy`, which will turn on location-services in geofence-only mode." The demo's canonical `applyTestConfig` sets it `true`. We do not set it. This is the single biggest config gap relative to "Samsung-resilient geofence-only" use cases.

- **Our `notification.sticky` is unset (default `false`).** Per vendor's `NotificationConfig.sticky` doc: "Configure the Android Foreground Service icon and notification to be displayed **always**. Defaults to false; normally shows only while device is moving." In geofence-only mode without `geofenceModeHighAccuracy`, the device is "always stationary" from the SDK's POV (see Issue #2113 maintainer quote), so the foreground-service notification can be absent or intermittent. This is consistent with our observation that one of two test phones showed the FG notification while the other did not.

- **`disableMotionActivityUpdates` not set, `disableStopDetection` not set.** Maintainer on Issue #1830 (2023-10-04): "If you want the plugin to be able to detect when the device is moving, yes [set `disableMotionActivityUpdates: false`]." The demo lists both as `defaultValue: false`. We rely on defaults; this is fine — but pairs with `geofenceModeHighAccuracy` for the SDK to know when to wake up its location-services in geofence-only mode.

- **HeadlessTask registration pattern is the right shape but contains an `expo-router/entry` first-line import.** Vendor's Android-Headless-Mode wiki ("`index.js` is the **ONLY** place where you can register your headless-task") and demo `index.js` both register the task at the top level of `index.js` and the maintainer has stated (Issue #2160, 2024-10-05): "And in the Android terminated state, your event handler IS your registered HeadlessTask." That matches our layout — but vendor docs are silent on whether `import 'expo-router/entry'` evaluated before `registerHeadlessTask` affects bring-up timing. Marked as an open question rather than a gap.

- **The 3-hour T1→T2 latency we observed is consistent with vendor's statement** in Philosophy of Operation: "Android can suspend your WebView (where your Javascript lives) and even delay reporting of motion-activity updates, in spite of your configured `#activityRecognitionInterval`, if the device remains still for long periods of time." Vendor offers no documented upper bound on the delay between native event capture and HeadlessTask JS execution; the closest mitigation knobs are `geofenceModeHighAccuracy`, `notification.sticky`, `heartbeatInterval`, and `preventSuspend` (the last being iOS-only per `AppConfig` docs).

- **`debug: true` is the maintainer's #1 diagnostic ask in every Samsung/geofence/headless thread.** It plays a unique sound effect on each event class so you can audibly confirm whether the native SDK detected a transition independent of whether the JS handler ran. We do not set `debug: true` anywhere; we have no analogue. (`logLevel: Info` is set; that's the *log* knob, not the sound-effect knob — they are separate config properties per LoggerConfig docs.)

---

## Source inventory

URLs accessed 2026-05-16:

- **Wiki source (raw .md):**
  - https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Android-Headless-Mode.md — full text retrieved
  - https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Philosophy-of-Operation.md — full text retrieved
  - https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Debugging.md — full text retrieved
  - https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Geofence-Features.md — full text retrieved
  - https://github.com/transistorsoft/react-native-background-geolocation/wiki/Android-Custom-Notification-Layout — partial via WebFetch (icon-format passage)
- **TypeDoc API reference (v5.0.0):**
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/ — section index
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/Config.html — top-level Config (nested sub-objects)
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/GeoConfig.html — geolocation sub-config (incl. `geofenceProximityRadius`, `geofenceModeHighAccuracy`, `geofenceInitialTriggerEntry`)
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/AppConfig.html — app sub-config (incl. `enableHeadless`, `stopOnTerminate`, `startOnBoot`, `notification`, `preventSuspend`, `heartbeatInterval`)
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/LoggerConfig.html — `logLevel`, `logMaxDays`, `debug`
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/NotificationConfig.html — `title`, `text`, `smallIcon`, `largeIcon`, `color`, `priority`, `channelName`, `channelId`, `sticky`, `layout`, `strings`, `actions`
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/Geofence.html — incl. `loiteringDelay`, polygon `vertices`
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/State.html — `trackingMode`, `enabled`, `schedulerEnabled`, `didDeviceReboot`, `didLaunchInBackground`
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/BackgroundGeolocation.html — full event list (`onLocation`, `onGeofence`, etc.)
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/Logger.html — `getLog`, `emailLog`, `uploadLog`, `destroyLog`
  - https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/HeadlessEvent.html — partial
  - https://transistorsoft.github.io/react-native-background-geolocation/interfaces/devicesettings.html (older 4.x path; 5.x path 404s — vendor doc-site has dead links) — `isIgnoringBatteryOptimizations`, `showIgnoreBatteryOptimizations`, `showPowerManager`, `show`
- **Demo source (v5, canonical):**
  - https://raw.githubusercontent.com/transistorsoft/rn-background-geolocation-demo/master/index.js — full file
  - https://raw.githubusercontent.com/transistorsoft/rn-background-geolocation-demo/master/src/advanced/lib/SettingsService.ts — `PLUGIN_SETTINGS`, `applyTestConfig`
- **CHANGELOG:**
  - https://raw.githubusercontent.com/transistorsoft/react-native-background-geolocation/master/CHANGELOG.md — v5.0.0 → v5.1.1
- **Help docs:**
  - https://github.com/transistorsoft/react-native-background-geolocation/blob/master/help/INSTALL-EXPO.md
  - https://github.com/transistorsoft/react-native-background-geolocation/blob/master/help/geofencing.md
- **GitHub Issues (with maintainer @christocracy comments verbatim via REST API):**
  - https://github.com/transistorsoft/react-native-background-geolocation/issues/1147 — Samsung battery optimization geofence unreliability
  - https://github.com/transistorsoft/react-native-background-geolocation/issues/1462 — Samsung activity recognition
  - https://github.com/transistorsoft/react-native-background-geolocation/issues/1830 — no geofence events with Android headless when app closed (★ most relevant)
  - https://github.com/transistorsoft/react-native-background-geolocation/issues/2160 — onGeofence not firing in killed state (★ explicit "your handler IS your HeadlessTask" quote)
  - https://github.com/transistorsoft/react-native-background-geolocation/issues/2412 — Android 15 headless geofence stops after app update
  - https://github.com/transistorsoft/react-native-background-geolocation/issues/2407 — onGeofence not calling in background android/iOS
  - https://github.com/transistorsoft/react-native-background-geolocation/issues/2113 — geofences-only mode iOS bug fix (incidentally documents that `isMoving` is **always false** in geofence-only mode)
  - https://github.com/transistorsoft/react-native-background-geolocation/issues/2441 — onLocation after kill (logs include canonical Samsung SM-G780F output)
  - https://github.com/transistorsoft/react-native-background-geolocation/issues/458 — frequent location in headless task (canonical "shoot yourself in foot in headless" lesson)

WebFetch's content extractor refused to reproduce some pages in full citing length / quote limits; in those cases I supplemented via direct `Invoke-WebRequest` to the raw GitHub URL or via the GitHub REST API for comments, which returned the source verbatim. The 4.x docs paths (`/interfaces/config.html`, `/classes/backgroundgeolocation.html`) returned HTTP 404; only the v5 paths under `/latest/` work for the current SDK. Some `/latest/` paths also 404'd intermittently (`NotificationConfig`, `Logger`, `BackgroundGeolocation` initially returned 404 then succeeded on retry) — vendor's TypeDoc-generated site is partially broken.

---

## Question 1: Canonical `ready()` config for "geofence-only, Samsung-resilient, headless-capable"

### Vendor says

There is no single canonical "geofence-only Samsung-resilient" snippet in the docs. The vendor's authoritative anchor is the demo app's `applyTestConfig()` method (https://raw.githubusercontent.com/transistorsoft/rn-background-geolocation-demo/master/src/advanced/lib/SettingsService.ts, line ~931):

```javascript
await BackgroundGeolocation.reset({
  transistorAuthorizationToken: token,
  debug: true,
  logLevel: BackgroundGeolocation.LOG_LEVEL_VERBOSE,
  desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
  distanceFilter: 50,
  disableElasticity: false,
  locationUpdateInterval: 1000,
  fastestLocationUpdateInterval: -1,
  stopTimeout: 1,
  motionTriggerDelay: 30000,
  backgroundPermissionRationale: {
    title: "Allow {applicationName} to access this device's location even when closed or not in use.",
    message: "This app collects location data to enable recording your trips to work and calculate distance-travelled.",
    positiveAction: 'Change to "{backgroundPermissionOptionLabel}"',
    negativeAction: 'Cancel'
  },
  schedule: [ '1-6 09:00-17:00' ],
  scheduleUseAlarmManager: true,
  maxDaysToPersist: 14,
  geofenceModeHighAccuracy: true,
  stopOnTerminate: false,
  startOnBoot: true,
  enableHeadless: true,
  heartbeatInterval: -1
});
```

Note this is a flat-key config; v5's TypeScript `Config` interface is nested (`{geolocation, app, logger, http, ...}`) per https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/Config.html. Vendor accepts both styles; the demo uses flat.

The closest published "geofence-only" guidance is via the Android Headless Mode wiki (https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Android-Headless-Mode.md):

> ```javascript
> BackgroundGeolocation.ready({
>   enableHeadless: true,
>   stopOnTerminate: false,  // <-- required for Headless JS
>   .
>   .
>   .
> }, (state) => { console.log('- Configure success'); });
> ```

And the maintainer's reply to Issue #1830 (https://github.com/transistorsoft/react-native-background-geolocation/issues/1830, 2023-09-28, @christocracy verbatim):

> "It's well-known that Android geofence-only mode is lazier with passively monitoring geofences. It's completely up to the OS to monitor geofences. The plugin has nothing to do with firing a geofence event… you could achieve the same thing [as launching Google Maps] without launching Google maps by configuring [`Config.geofenceModeHighAccuracy`](https://transistorsoft.github.io/react-native-background-geolocation/interfaces/config.html#geofencemodehighaccuracy), which will turn on location-services in geofence-only mode."

Follow-up on the same issue (2023-10-04):

> "Should we set `disableMotionActivityUpdates` to false? — If you want the plugin to be able to detect when the device is moving, yes."

### We have

`C:\Users\waela\OneDrive\Desktop\Naavi\hooks\useGeofencing.ts` lines 154-194 — `BackgroundGeolocation.ready({...})` call:

```javascript
const state: State = await BackgroundGeolocation.ready({
  reset: true,
  geolocation: {
    desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,
    geofenceProximityRadius: 5000,
    geofenceInitialTriggerEntry: false,
  },
  app: {
    stopOnTerminate: false,
    startOnBoot: true,
    enableHeadless: true,
    notification: {
      title: 'MyNaavi is keeping your alerts ready',
      text: 'Tap to open Naavi',
      smallIcon: 'drawable/notification_icon',
      color: '#5DCAA5',
    },
  },
  logger: { logLevel: BackgroundGeolocation.LogLevel.Info },
});
```

### Gap

Keys present in vendor canonical config but absent from ours (Android-relevant only):

| Key | Vendor demo value | Vendor default (per docs) | Our value |
|---|---|---|---|
| `geofenceModeHighAccuracy` | `true` | `false` | not set → `false` |
| `debug` | `true` (in test config) | `false` | not set → `false` |
| `notification.sticky` | not set in demo's geofence subset; demo elsewhere defaults to `false` | `false` ("normally shows only while device is moving" — Notification docs) | not set → `false` |
| `notification.priority` | demo exposes the select; demo default `BackgroundGeolocation.NOTIFICATION_PRIORITY_DEFAULT` | `DEFAULT` (per NotificationPriority docs) | not set → `DEFAULT` |
| `heartbeatInterval` | `-1` in demo's `applyTestConfig` (disabled), but the demo's `PLUGIN_SETTINGS` lists `defaultValue: 60` (in seconds) | per AppConfig docs minimum is 60s | not set → disabled |
| `disableMotionActivityUpdates` | demo `defaultValue: false`; maintainer (Issue #1830) explicitly says leave `false` for geofence-only | `false` | not set → `false` (OK by default) |
| `disableStopDetection` | demo `defaultValue: false` | `false` | not set → `false` (OK by default) |
| `motionTriggerDelay` (Android only) | `30000` in `applyTestConfig` | per `PLUGIN_SETTINGS.android` default `0` | not set → `0` |
| `locationUpdateInterval` / `fastestLocationUpdateInterval` (Android only) | `1000` / `-1` in `applyTestConfig` | not stated in GeoConfig page; `fastestLocationUpdateInterval` default per docs `30000` | not set |
| `triggerActivities` (Android only) | demo default `'in_vehicle, on_bicycle, running, walking, on_foot'` | n/a | not set |
| `backgroundPermissionRationale` (Android 11+) | populated in demo | n/a | not set |
| `useSignificantChangesOnly` | `false` in demo | `false` per GeoConfig | not set → `false` (OK by default) |
| `transistorAuthorizationToken` | set in demo (Transistor's tracker server) | demo-only | n/a (we use our own HTTP path) |

Keys present in ours and worth flagging:

- `geofenceProximityRadius: 5000` — vendor docs (GeoConfig): "Defines the radius (in meters) around the device used to query for geofences that should be actively monitored." Default `1000`, minimum `1000`. Our `5000` is valid (covered separately in Q4).
- `geofenceInitialTriggerEntry: false` — vendor default is **`true`** ("When a device is already within a just-created geofence, fire the enter transition immediately"). Our `false` is non-default. Comment in our code says we have our own initial-state suppression, so this is intentional, but it means the SDK will not fire an ENTER event for a geofence the user is already inside at registration time.
- `reset: true` — vendor's Config docs: default `true` ("Reset the plugin to its initial state before applying this configuration"). Our explicit `true` matches the default.
- `app.notification.smallIcon: 'drawable/notification_icon'` — matches the documented format. Per NotificationConfig docs: "Must specify format as `{type}/icon_name` (e.g., `drawable/my_custom_notification_small_icon` or `mipmap/my_custom_notification_small_icon`). Do not append file extensions." Whether the named resource actually resolves at build time in our Expo prebuild is a build-config question, not a `ready()` config gap.
- `logger.logLevel: Info` — vendor docs LoggerConfig default `LogLevel.Off`. Wiki Debugging warns: "Do not publish an app with `LOG_LEVEL_VERBOSE`." Info is fine for trial.

Structural difference: we use the v5 nested config (`{geolocation, app, logger}`); the demo uses flat keys. Both are accepted by the SDK; this is not a gap.

---

## Question 2: Canonical HeadlessTask registration pattern in Expo

### Vendor says

Android Headless Mode wiki (https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Android-Headless-Mode.md), verbatim:

> **Step 1:** Where you execute `BackgroundGeolocation.ready(config)`, add the following options:
> ```javascript
> BackgroundGeolocation.ready({
>   enableHeadless: true,
>   stopOnTerminate: false,  // <-- required for Headless JS
>   ...
> }, (state) => { console.log('- Configure success'); });
> ```
>
> **Step 2:** `BackgroundGeolocation.registerHeadlessTask(task)`. In your application's **`index.js`** file, register your Javascript *Headless Task*:
>
> > [!WARNING] **`index.js`** is the **ONLY** place where you can register your headless-task.
>
> ```javascript
> import { AppRegistry } from 'react-native';
> import App from './src/App';
>
> AppRegistry.registerComponent('MyApp', () => App);
>
> const BGHeadlessTask = async (event) => {
>   const params = event.params;
>   console.log('[BackgroundGeolocation HeadlessTask] -', event.name, params);
>
>   switch (event.name) {
>     case 'terminate':
>       await doCustomWork();
>       break;
>     case 'heartbeat':
>       const location = await getCurrentPosition({ samples: 1, extras: { headless: true }, persist: true });
>       console.log('[BackgroundGeolocation HeadlessTask] - getCurrentPosition:', location);
>       break;
>   }
> }
>
> BackgroundGeolocation.registerHeadlessTask(BGHeadlessTask);
> ```

Demo's `index.js` (https://raw.githubusercontent.com/transistorsoft/rn-background-geolocation-demo/master/index.js) verbatim:

```javascript
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import BackgroundGeolocation from "./src/react-native-background-geolocation";
import BackgroundFetch from "react-native-background-fetch";
import ENV from './src/ENV';

AppRegistry.registerComponent(appName, () => App);

// [Android-only] See API docs Config.enableHeadless.  This method MUST exist here in index.js.
// An Android Headless Task will receive all events emitted by the background-geolocation plugin while
// your app is terminated.
//
const bgGeoHeadlessTask = async (event) => {
  const params     = event.params;
  const eventName  = event.name;
  const taskId     = event.taskId;
  console.log(`[BGGeoHeadlessTask] ${eventName}`, JSON.stringify(params));
  await doWork(eventName);
}

BackgroundGeolocation.registerHeadlessTask(bgGeoHeadlessTask);
```

Maintainer comments add detail:

- Issue #2160 (https://github.com/transistorsoft/react-native-background-geolocation/issues/2160, 2024-10-02): "Do you know that your Javascript code in your React Native App no longer exists when an Android app is terminated (including your event-listener `BackgroundGeolocation.onGeofence`)?"
- Issue #2160 (2024-10-05): "And in the Android terminated state, your event handler IS your registered HeadlessTask."
- Issue #2160 (2024-10-05): When a user pasted `BackgroundGeolocation.onGeofence(...)` inside their `index.js`, the maintainer replied: "What is this?? Delete it. It does not belong in index.js."
- Issue #458 (2020-07-08): "Headless [task] has the *same config* [as `ready()`]." And the canonical foot-gun: "Yes, you *are* 'shooting yourself in the foot'. You have to be aware that calling `getCurrentPosition` **generates a headless `location` event**. You have created an *infinite loop.*"

Expo-specific install guide (https://github.com/transistorsoft/react-native-background-geolocation/blob/master/help/INSTALL-EXPO.md) — what the WebFetch returned: only covers `app.json` plugin block, `expo install`, iOS Info.plist. **No mention of HeadlessTask registration with `expo-router`, no mention of where in `index.js` to put the `BackgroundGeolocation.registerHeadlessTask(...)` line relative to `expo-router/entry`.**

### We have

`C:\Users\waela\OneDrive\Desktop\Naavi\index.js` — entire file:

```javascript
import 'expo-router/entry';
import BackgroundGeolocation from 'react-native-background-geolocation';
import { handleGeofenceEvent } from './hooks/useGeofencing';

const HeadlessTask = async (event) => {
  try {
    if (event?.name === 'geofence' && event?.params) {
      await handleGeofenceEvent(event.params);
    }
  } catch (err) {
    console.error('[headless-task] failed:', err);
  }
};

BackgroundGeolocation.registerHeadlessTask(HeadlessTask);
```

And `C:\Users\waela\OneDrive\Desktop\Naavi\hooks\useGeofencing.ts` lines 138-149 — at module scope inside `ensureReady()`:

```javascript
BackgroundGeolocation.onGeofence(handleGeofenceEvent);
BackgroundGeolocation.onProviderChange((event) => { ... });
```

### Gap

- `registerHeadlessTask` is in `index.js` — ✓ matches vendor.
- The `async (event) => {...}` shape matches vendor.
- We dispatch only on `event.name === 'geofence'`. Vendor's demo dispatches on multiple `event.name` values (`'terminate'`, `'heartbeat'`, `'activitychange'` are all shown in the wiki + headless logcat traces). Vendor docs do not state that filtering out other events causes harm, but they show handlers that process several event names.
- We do **not** call `event.taskId` or use `BackgroundGeolocation.startBackgroundTask()` / `.stopBackgroundTask()` for long-running work. The demo comment says "<-- very important!" next to `event.taskId` and the canonical "long-running task" wrap uses `startBackgroundTask` + `stopBackgroundTask` to guarantee the OS doesn't kill the JS runtime mid-await. Our `handleGeofenceEvent` awaits `fetch()` to our Edge Function — vendor docs (Headless Mode wiki + demo comment) state: "HeadlessTasks are automatically terminated after execution of the last line of your function." So `await fetch(...)` should keep the task alive until the response, but if the OS forces termination mid-fetch, vendor's `startBackgroundTask` pattern is the documented insurance. We do not use it.
- `import 'expo-router/entry'` as the first line is not addressed in any vendor doc page I could find. The Expo install guide does not mention `expo-router`. **This is an open question, not a documented gap.** Vendor's demo uses the bare-RN entry: `AppRegistry.registerComponent(appName, () => App);` directly. With `expo-router/entry`, the `AppRegistry.registerComponent` call happens inside `expo-router/entry`'s import side-effect, so by the time our `BackgroundGeolocation.registerHeadlessTask(...)` runs, the app component is already registered. Vendor docs don't comment on whether this ordering matters.
- We **also** call `BackgroundGeolocation.onGeofence(handleGeofenceEvent)` inside `ensureReady()` in the hook (line 138). Per Issue #2160, the maintainer explicitly says `BackgroundGeolocation.onGeofence` doesn't fire in the terminated state and "your event handler IS your registered HeadlessTask." So `onGeofence` covers foreground (live JS runtime); the HeadlessTask covers terminated. Having both is the documented vendor pattern. Note we route both to the same `handleGeofenceEvent` function via different entry points (the HeadlessTask passes `event.params`, the `onGeofence` listener passes the event object directly). Per Issue #458: "[Headless task] has the *same config* [as `ready()`]" — but vendor never explicitly says "the HeadlessTask `event.params` payload for a geofence event has the same shape as the `GeofenceEvent` you'd receive from `onGeofence`." Our code assumes it does. (Inference; vendor `HeadlessEvent` interface page is too sparse to confirm.)

---

## Question 3: Vendor's stated expected behavior when Android kills the JS process

### Vendor says

Headless Mode wiki, intro paragraph (verbatim):

> "BackgroundGeolocation implements the React Native [Headless JS](https://facebook.github.io/react-native/docs/headless-js-android.html) mechanism. With *Headless JS*, you can continue to respond to `BackgroundGeolocation` events after your app has **been terminated** (assuming you've configured `stopOnTerminate: false`)."

Headless Mode wiki, testing section (verbatim) — the canonical proof-of-life pattern:

> "In `$ adb logcat`, you'll see `HeadlessTask` events prefixed with the "💀" icon (as in *dead / terminated*). These "💀" events are logged just before being sent to your `HeadlessTask`:
> ```
> TSLocationManager: [c.t.r.HeadlessTask <init>] 💀  event: terminate
> TSLocationManager: [c.t.l.a.BackgroundGeolocation isMainActivityActive] NO
> TSLocationManager: [c.t.r.HeadlessTask onHeadlessJsTaskStart] taskId: 1
> ...
> TSLocationManager: [c.t.r.HeadlessTask onHeadlessJsTaskFinish] taskId: 1
> ```"

Read literally: an `onHeadlessJsTaskStart` / `onHeadlessJsTaskFinish` pair around every event. The JS runtime is spun up per event ("automatically terminated after execution of the last line of your function" — demo `index.js` comment).

Issue #2160 (maintainer @christocracy, 2024-10-03): "Everything in this plug-in can work in the Android terminated state."

Issue #2160 (2024-10-05): "And in the Android terminated state, your event handler IS your registered HeadlessTask." Implication: foreground-registered `onGeofence` listeners do NOT fire when terminated; only the HeadlessTask does.

Philosophy of Operation (verbatim, "Android Stationary State" section):

> "In the stationary-state, Android is constantly listening to the `ActivityRecognitionAPI` for changes in motion-activity. Android *can* suspend your WebView (where your Javascript lives) and even delay reporting of motion-activity updates, in spite of your configured `#activityRecognitionInterval`, if the device remains still for long periods of time. However, if the `ActivityRecognitionAPI` detects a *change* in motion-activity, it *will* reawaken your app to respond to that change."

There is **no documented upper bound** in any vendor source I found on how long the OS may delay delivering a geofence event to the HeadlessTask. Maintainer's quote from Issue #1830 (2023-09-28) is the most candid: "It's well-known that Android geofence-only mode is lazier with passively monitoring geofences… It's completely up to the OS to monitor geofences. The plugin has nothing to do with firing a geofence event."

### We have

Our observation (provided by the requester, not from code): T1 (native geofence event captured per SDK log) was 6:42 PM EDT; T2 (HeadlessTask JS handler executed) was 9:45 PM EDT — 3-hour gap.

`hooks/useGeofencing.ts:230-235` writes a `geofence-T1-task-fired` remote log on entry to `handleGeofenceEvent`. T1 in our logs is JS-side; the native-SDK side has its own timestamp in `getLog()`.

### Gap

This is more an observation than a config gap, given vendor's wording:

- Vendor explicitly warns that Android can delay event delivery: "Android *can* suspend your WebView… and even delay reporting of motion-activity updates, in spite of your configured `#activityRecognitionInterval`, if the device remains still for long periods of time."
- Vendor explicitly says geofence-only mode is "lazier" without `geofenceModeHighAccuracy`.
- Vendor offers no SLA on HeadlessTask wake latency.
- Vendor's diagnostic ask (Issues #1147, #2407, #2160, #2485 etc., universal pattern): "Are you observing the plugin logs? See wiki Debugging." — i.e., use `getLog()` / `emailLog()` to obtain the native-side timeline (the `TSLocationManager: 💀 event: geofence` line + the `onHeadlessJsTaskStart taskId: X` line) to distinguish "native event captured, JS not spun up" from "native event delivered to JS, our handler slow." Our diagnostic pipeline (remoteLog) only captures the JS side; the native-side delay (whether the OS delivered the event T2 hours after the SDK captured T1, or whether the SDK captured T1 hours after the geofence-crossing physically occurred) is invisible to us.

What vendor explicitly does NOT say:
- Vendor does not say "HeadlessTask wakes the JS runtime immediately on each geofence event." The wiki logcat trace shows `onHeadlessJsTaskStart` after `💀 event: terminate` with no claimed latency.
- Vendor does not say the runtime is persistent across events. The demo comment "HeadlessTasks are automatically terminated after execution of the last line of your function" implies per-event runtime spin-up.

---

## Question 4: Recommended `geofenceProximityRadius` for our use case

### Vendor says

GeoConfig docs (https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/GeoConfig.html), verbatim:

> **geofenceProximityRadius** — `number`. Default `1000`. "Defines the radius (in meters) around the device used to query for geofences that should be actively monitored." Minimum value is **1000 m**.

help/geofencing.md (https://github.com/transistorsoft/react-native-background-geolocation/blob/master/help/geofencing.md):

> "[`@config geofenceProximityRadius {Integer} [1000] meters`] controls the circular area around the device's current position where geofences will be activated."
>
> "When adding multiple geofences, it's over 10× faster to use the method `addGeofences` (plural) rather than looping and executing `#addGeofence`."

Demo `PLUGIN_SETTINGS.common` (https://raw.githubusercontent.com/transistorsoft/rn-background-geolocation-demo/master/src/advanced/lib/SettingsService.ts:181):

```javascript
{name: 'geofenceProximityRadius', group: 'geolocation', dataType: 'integer', inputType: 'select',
 values: [1000, 1500, 2000, 5000, 10000, 100000], defaultValue: 1000 },
```

Demo's selectable values include `5000` (our value) and go up to `100000` (100 km). The demo defaults to `1000` (the min/default).

Geofence radius itself (separate from proximityRadius), per Geofence-Features wiki:

> "The radius of the circular geofence. A radius of >100 meters works best."

And per the `Geofence` interface docs: "Minimum reliable value is 200 meters."

Maintainer in Issue #1830 (2023-09-29): "Your logs suggest you're using geofence-only mode (.startGeofences)…you didn't specify. If you are, you probably need to **increase the radius or drive slower**." (Speaking of the per-geofence `radius`, not `geofenceProximityRadius`.)

### We have

`hooks/useGeofencing.ts:167`:
```javascript
geofenceProximityRadius: 5000, // 5 km — covers Wael's typical day
```

Per-geofence `radius` values are populated from `cfg.radius_meters` with fallback `100` (line 416 and 434):
```javascript
radius: typeof cfg.radius_meters === 'number' ? cfg.radius_meters : 100,
```

### Gap

- Our `geofenceProximityRadius: 5000` is within the documented allowed range (≥ 1000 min, no documented max). 5 km is one of the listed demo-selectable values. Not a gap.
- Our per-geofence `radius` fallback of `100` is **below vendor's documented minimum reliable value of `200`** (Geofence interface) and below the help/geofencing.md guidance of "A radius of >100 meters works best." Whether actual rules' `cfg.radius_meters` is ≥ 200 depends on values our `resolve-place` Edge Function returns; we did not audit the DB. Maintainer's Issue #1830 advice ("increase the radius or drive slower") was given to someone using "200m" + driving.

---

## Question 5: Events besides `onGeofence` for diagnostic completeness

### Vendor says

`BackgroundGeolocation` class API (https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/BackgroundGeolocation.html). All event subscription methods documented:

| Method | Payload | Vendor description (verbatim) |
|---|---|---|
| `onLocation(cb)` | `Location` | "Every location recorded by the SDK is provided to your callback." |
| `onMotionChange(cb)` | `MotionChangeEvent` | "Executed each time the device has changed-state between MOVING or STATIONARY." |
| `onGeofence(cb)` | `GeofenceEvent` | "Called when any monitored geofence crossing occurs." |
| `onGeofencesChange(cb)` | `GeofencesChangeEvent` | "Fired when the list of monitored-geofences changed." |
| `onActivityChange(cb)` | `MotionActivityEvent` | "Executed each time the activity-recognition system receives an event." |
| `onProviderChange(cb)` | `ProviderChangeEvent` | "Executed whenever a change in the state of the device's Location Services detected." |
| `onHeartbeat(cb)` | `HeartbeatEvent` | "Executed for each heartbeatInterval while the device is in stationary state." |
| `onHttp(cb)` | `HttpEvent` | "Executed when HttpConfig.url responds." |
| `onSchedule(cb)` | `State` | "Executed each time a schedule event fires." |
| `onConnectivityChange(cb)` | `ConnectivityChangeEvent` | "Fired when the state of the device's network-connectivity changes." |
| `onPowerSaveChange(cb)` | `boolean` | "Fired when the state of the operating-system's Power Saving mode changes." |
| `onEnabledChange(cb)` | `boolean` | "Fired when the SDK's enabled state changes." |
| `onNotificationAction(cb)` | `string` (buttonId) | "Subscribe to button-clicks of a custom notification layout." |
| `onAuthorization(cb)` | `AuthorizationEvent` | "Fired when AuthorizationConfig.refreshUrl responds." |

Vendor docs do not explicitly tag any of these "essential for production observability." (Inference based on the topic: `onGeofencesChange`, `onProviderChange`, `onMotionChange`, `onPowerSaveChange`, and `onEnabledChange` are the events that would tell you the SDK's internal state when geofences misbehave. `onActivityChange` would tell you why the SDK thinks the device is moving or not, which directly affects whether `geofenceModeHighAccuracy: false`-mode wakes up. Marked as inference.)

Additional vendor diagnostic surfaces (from Debugging wiki, verbatim):

> "Use the config `Config.logLevel` to adjust the verbosity of the logging, from `0: NONE` to `5: VERBOSE`. The default is `LOG_LEVEL_VERBOSE`."
>
> "Fetching the logs: Use the method `Logger.getLog` to retrieve the current contents of the log from the database as a single String. Warning: The log can be very large, several megabytes."

And the "debug sounds" mechanism — Debugging wiki (verbatim, "Activity Recognition System" section):
> "You can easily simulate the `on_foot` state by shaking the device vigorously until the next `#activityRecognitionInterval` ticks over). You'll hear the sound 'doodly-doo' when location-updates are initiated."

Plus Issue #2160 (2024-10-04, @christocracy): "are you configuring the plug-in with `debug: true` so you can *hear* the geofence events?"

### We have

`hooks/useGeofencing.ts` subscribes to exactly two events at module level (lines 138, 142):

```javascript
BackgroundGeolocation.onGeofence(handleGeofenceEvent);
BackgroundGeolocation.onProviderChange((event) => { remoteLog(... 'tsoft-provider-change' ...); });
```

`debug: true` is not set anywhere. `logger.logLevel: Info` is set; vendor's default for prod-grade is `Off` and verbose-warning is for `LOG_LEVEL_VERBOSE`. We do not call `BackgroundGeolocation.logger.getLog()` or `emailLog()` or `uploadLog()` from anywhere in our code.

### Gap

We subscribe to 2 of 14 documented events. Events vendor's docs/issues specifically call out as relevant when geofences misbehave:

- `onGeofencesChange` — fires when SDK swaps geofences in/out of native monitoring set. Tells you which geofences are currently "active" vs "dormant." Not subscribed.
- `onMotionChange` — tells you when SDK thinks device transitioned MOVING ↔ STATIONARY. Per maintainer (Issue #1830), the SDK's willingness to fire geofence events in geofence-only mode hinges on this. Not subscribed.
- `onActivityChange` — tells you which `MotionActivity` the SDK saw last (`still`, `on_foot`, `in_vehicle`). Per Philosophy wiki: this is the SDK's primary state-transition signal on Android. Not subscribed.
- `onPowerSaveChange` — tells you when Android entered Power Saving mode (which can throttle background services and hence the SDK). Not subscribed.
- `onEnabledChange` — tells you if the SDK got disabled. Not subscribed.
- `onHttp` — would tell you if any SDK-side HTTP sync failed; we don't use the SDK's HTTP pipeline so N/A.
- `onHeartbeat` — fires periodically while stationary; only meaningful if `heartbeatInterval` is set. We don't set `heartbeatInterval`, so this doesn't fire regardless.
- `onConnectivityChange` — tells you when network connectivity changed; would tell you if our `fetch()` to Edge Function failed due to no network. Not subscribed.

`debug: true` (sound effects) — not enabled. Per maintainer this is the single most-requested diagnostic across the issue tracker for "geofence not firing" reports.

`Logger.getLog()` / `emailLog()` / `uploadLog()` — not wired into our diagnostic pipeline. See Q6.

---

## Question 6: `getLog()` / `emailLog()` — capturing SDK-internal logs from production

### Vendor says

Logger API (https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/Logger.html), verbatim signatures:

- `getLog(query?: SQLQuery): Promise<string>` — "Returns the records from log database as a `String`. Provide an optional SQLQuery to constrain results between dates."
- `emailLog(email: string, query?: SQLQuery): Promise<boolean | void>` — "Email the result of Logger.getLog using device's mail client."
- `uploadLog(url: string, query?: SQLQuery): Promise<boolean | void>` — "Upload the result of getLog to provided url… The file-upload request will attach your configured HttpConfig.headers for authentication."
- `destroyLog(): Promise<void>` — "Destroy the entire contents of SDK's log database."

Access pattern (verbatim from Logger page):

```javascript
let Logger = BackgroundGeolocation.logger;
```

LoggerConfig.logMaxDays — default `3` ("Maximum number of days to persist a log-entry in database").

Wiki Debugging (verbatim):

```javascript
BackgroundGeolocation.logger.getLog(function(log) {
  console.log(log);
});

BackgroundGeolocation.logger.emailLog('foo@bar.com').then((success) => {
  console.log('[emailLog] SUCCESS');
}).catch((error) => {
  console.log('[emailLog] ERROR: ', error);
});
```

Maintainer's universal ask across issues (verbatim examples):

- Issue #2407 (2025-10-01): "See wiki 'Debugging'. Learn to fetch plug-in logs via .emailLog method."
- Issue #2485 (2026-02-05): "Are you observing the plug-in logs? See wiki 'Debugging'"
- Issue #2407 (2025-10-14): "See Wiki 'Debugging'. See API docs '.emailLog'"

The recommended pattern for surfacing production logs is `uploadLog(url)`, which the docs describe as: "Upload the result of `getLog` to provided url… The file-upload request will attach your configured `HttpConfig.headers` for authentication."

### We have

No call to `BackgroundGeolocation.logger.getLog()`, `.emailLog()`, `.uploadLog()`, or `.destroyLog()` anywhere in our codebase. Verified via:

```
Grep "BackgroundGeolocation\.logger|getLog|emailLog|uploadLog" → no matches in hooks/, app/, lib/
```

We have our own `remoteLog(eventId, label, payload)` helper (`lib/remoteLog.ts`, referenced from useGeofencing) that posts JS-side events to our own diagnostic endpoint. This is parallel to the SDK's internal log, not a window into it.

`logger.logMaxDays` not set → SDK keeps 3 days by default.
`debug: false` (not set) → no debug sound effects.

### Gap

The SDK is logging internally (we set `logLevel: Info`, so events are being written to the SDK's SQLite log). We have no path to retrieve, view, or upload that log. When our JS-side `handleGeofenceEvent` doesn't fire (e.g., the 3-hour T1→T2 gap), we cannot distinguish:

(a) the OS captured the geofence event and held it for hours before delivering to the SDK,
(b) the SDK captured and held it before invoking the HeadlessTask,
(c) the HeadlessTask spun up but our `await fetch(...)` blocked / silently failed.

Vendor's only documented way to disambiguate is `getLog()` / `emailLog()` / `uploadLog()`. We do not call any.

---

## Question 7: Vendor's stated behavior for specific config knobs

For each: doc page, default, Android/iOS scope, vendor description verbatim where preserved, our current value.

### `notification.priority`

- **Doc:** NotificationConfig (https://transistorsoft.github.io/react-native-background-geolocation/latest/interfaces/NotificationConfig.html).
- **Type:** `NotificationPriority` enum.
- **Default:** `DEFAULT` per NotificationConfig doc + demo.
- **Values:** `DEFAULT`, `HIGH`, `LOW`, `MAX`, `MIN` per demo `PLUGIN_SETTINGS.android` (lines 248-254). The dedicated `NotificationPriority` enum page returned 404 — vendor doc-site bug. NotificationConfig page describes only as: "Controls notification order and status-bar icon position. Options include Default, High, Low, Max, and Min with varying alignment behaviors."
- **Samsung-specific advice:** None found in any vendor doc or maintainer comment I retrieved.
- **Our value:** not set → `DEFAULT`.

### `disableElasticity`

- **Doc:** GeoConfig.
- **Default:** `false`.
- **Description (verbatim):** "Set true to disable automatic, speed-based distanceFilter auto-scaling."
- **Scope:** both platforms.
- **Demo's `applyTestConfig`:** `false` (explicit, matches default).
- **Samsung-specific advice:** none. This knob is about distance-based recording elasticity; in geofence-only mode (where `distanceFilter` isn't actively driving recordings), its effect is minimal.
- **Our value:** not set → `false`.

### `preventSuspend`

- **Doc:** AppConfig.
- **Default:** `false`.
- **Description (verbatim):** "Prevent iOS from suspending your application after location-services have been turned off."
- **Scope: iOS only** (explicitly tagged in AppConfig docs).
- **Samsung relevance:** N/A — iOS-only.
- **Our value:** not set → `false`.

Philosophy wiki adds (verbatim): "⚠️ WARNING: Since `preventSuspend` will keep your app running indefinitely in the background (albeit without running location-services constantly), your app *will* consume more power simply because your app is awake. You *must* take special care to actively manage this feature."

### `heartbeatInterval`

- **Doc:** AppConfig.
- **Default:** AppConfig page lists no default. Demo's `PLUGIN_SETTINGS.common` lists `defaultValue: 60` (in seconds, since the AppConfig description says "Controls the rate (in seconds)"); Issue #458 (2020-07-11) maintainer reply when a user cited "Default: 60" from docs: "Docs are wrong." So the documented default is unreliable.
- **Description (verbatim):** "Controls the rate (in seconds) at which BackgroundGeolocation.onHeartbeat events will fire." Minimum 60s.
- **Demo's `applyTestConfig`:** `-1` (i.e., disabled).
- **Scope:** both platforms, BUT Philosophy wiki specifies behavior:
  - iOS: "While in the `#preventSuspend` mode in the **stationary** state, the plugin is able to fire a `heartbeat` event periodically."
  - Android: "While in the **stationary** state, since Android does not *completely* suspend apps in the background, the plugin is able to fire a `heartbeat` event periodically (`#heartbeatInterval`). The `heartbeat` event is implemented using the Android `AlarmManager` mechanism and is **guaranteed** to fire your Javascript callback."
- **Samsung-specific advice:** none, but "guaranteed to fire your Javascript callback" via `AlarmManager` is the vendor's strongest delivery-guarantee phrasing in any doc page.
- **Our value:** not set → disabled (no heartbeat events fire).

### `stationaryRadius`

- **Doc:** GeoConfig.
- **Default:** "Minimum enforced value is 25m." (No "default" stated; enforced lower bound only.)
- **Description (verbatim):** "The minimum distance the device must move beyond the stationary location for aggressive background-tracking to engage."
- **Scope:** primarily iOS (per Philosophy wiki: "When iOS detects a transition out of the 'stationary geofence', the plugin will change state from stationary -> moving"). On Android, motion is detected via ActivityRecognitionAPI per Philosophy.
- **Demo's `PLUGIN_SETTINGS.ios`:** `stationaryRadius: 25` (the documented minimum).
- **Samsung-specific advice:** none. Android does not use a stationary geofence the same way iOS does.
- **Our value:** not set.

### `desiredAccuracy` for geofence mode specifically

- **Doc:** GeoConfig.
- **Default:** undocumented in `GeoConfig` page (no default stated).
- **Description (verbatim):** "Specify the desired-accuracy of the geolocation system." "Only `DesiredAccuracy.High` uses GPS; speed, heading, altitude available only from GPS."
- **Demo's `applyTestConfig`:** `DesiredAccuracy.HIGH`. Demo's `PLUGIN_SETTINGS` lists default `NAVIGATION` for "Location + Geofences" mode.
- **Geofence-mode-specific guidance:** maintainer in Issue #1830 (2023-10-04) speaking to geofence-only mode: "With `geofenceModeHighAccuracy: true`, the foreground-service notification appears *only* when the device is detected to be moving. Go outside for a walk." — i.e., `desiredAccuracy` is **subordinate** to `geofenceModeHighAccuracy` in the geofence-only path.
- **Our value:** `DesiredAccuracy.High`. Matches demo.

### `geofenceInitialTriggerEntry`

- **Doc:** GeoConfig.
- **Default:** `true`.
- **Description (verbatim):** "When a device is already within a just-created geofence, fire the enter transition immediately."
- **Scope:** both platforms.
- **Samsung-specific advice:** none.
- **Our value:** `false`. We override the default. Comment in our code says we run our own initial-state suppression; vendor docs do not state any consequence to setting this `false` other than the obvious (no auto-ENTER on registration when already inside).

### `foregroundService` related config

The v5 nested `AppConfig` interface page lists `notification` (Android-only) — vendor states (verbatim): "Configures the persistent foreground-service Notification required by Android." The plugin always runs as a foreground service on Android while enabled; there is no toggle to disable the foreground-service mechanism itself. Configuration is via `notification.*` (and `sticky` controls when the notification is visible):

- `notification.sticky` (NotificationConfig, verbatim): "Configure the Android Foreground Service icon and notification to be displayed **always**. Defaults to false; normally shows only while device is moving."

Issue #2113 (2024-08-19, @christocracy): "Since in geofence-only mode, `config.isMoving` is **always** `false`…" — this explains why, with `sticky: false` (default), the foreground notification may not display in geofence-only mode even though the foreground service is technically running.

Our `notification` block sets `title`, `text`, `smallIcon`, `color` — no `sticky`, no `priority`, no `channelName`, no `channelId`. Per docs:
- `channelName` defaults to app name from AndroidManifest.
- `channelId` defaults to `your.package.name.TSLocationManager`.
- `sticky` defaults to `false`.
- `priority` defaults to `DEFAULT`.

There is no separate top-level `foregroundService: {...}` block in v5 docs; the foreground service is configured entirely through `notification`.

### `stopOnTerminate` / `startOnBoot` / `enableHeadless`

All three from AppConfig. Vendor descriptions verbatim:

- **`stopOnTerminate`**: type `boolean`, default `true`. "Controls whether to continue location-tracking after the application is terminated." Our value: `false` (correct for our use case, matches demo, matches Headless Mode wiki Step 1).
- **`startOnBoot`**: type `boolean`, default `false`. "Controls whether to resume location-tracking after the device is rebooted." Our value: `true` (correct for our use case, matches demo). Note: requires Android permission `RECEIVE_BOOT_COMPLETED` — our `app.json` line 30 has it.
- **`enableHeadless`**: type `boolean`, default `false`. **Android only.** "Enables 'Headless' operation allowing you to respond to events after your app has been terminated." Our value: `true` (correct for our use case, matches demo, matches Headless Mode wiki Step 1).

All three are correct for "geofence-only, Samsung-resilient, headless-capable."

---

## Question 8: Vendor-published OEM / Samsung One UI checklist

### Vendor says

Vendor does not publish a Samsung-specific or OEM-specific checklist in any wiki page I could retrieve (Philosophy, Geofence Features, Android Headless Mode, Debugging, Android Custom Notification Layout — none contain a Samsung section).

Vendor's universal answer in OEM-related issues is **a link to https://dontkillmyapp.com**. Verbatim quotes from @christocracy:

- Issue #1147 (2020-10-01): "I regularly test with a *Nokia TA-27 @ 8.0.0* and *Huawei P20 Lite (ANE-LX3) @ 8.0.0*. I had to follow the instructions at http://dontkillmyapp.com **to get both these devices to work**."
- Issue #1147 (2020-10-01): "Did you follow the *exact* instructions at http://dontkillmyapp.com? There's more involved than simply 'turning off battery optimization' for both *Huawei* and *Nokia*."
- Issue #1462 (2022-05-13): "Yes, Huawei are horrible. There is no software solution that can overcome some particular manufacturer's additions to the OS that prevent foreground-services from operating as documented."
- Issue #1462 (2022-05-13): "See http://dontkillmyapp.com"
- Issue #1462 (2022-05-13): "Have you applied the settings changes as documented at dontkillmyapp.com? There's nothing the plugin can do to overcome restrictions imposed by some particular device manufacturer."
- Issue #2160 (2024-10-04): "See https://dontkillmyapp.com"
- Issue #2407 (2025-10-01): "Also see https://dontkillmyapp.com"

The vendor's in-SDK affordance for OEM whitelisting is the `DeviceSettings` API. Per the 4.x DeviceSettings page (the 5.x path returns 404 but the API is unchanged per CHANGELOG):

| Method | Description (verbatim where preserved) |
|---|---|
| `BackgroundGeolocation.deviceSettings.isIgnoringBatteryOptimizations()` | "Returns `true` if device is ignoring battery optimizations for your app." |
| `BackgroundGeolocation.deviceSettings.showIgnoreBatteryOptimizations()` | "Prepare a request to show Android's _Ignore Battery Optimizations_ settings screen." Returns a `DeviceSettingsRequest`. |
| `BackgroundGeolocation.deviceSettings.showPowerManager()` | "Prepare a request to show a vendor-specific 'Power Manager' screen (Huawei, Xiaomi, Vivo, etc)." |
| `BackgroundGeolocation.deviceSettings.show(request)` | "Execute a previously prepared DeviceSettingsRequest to actually show the screen." |

CHANGELOG v5.0.4 (2025-03-18): "Fix bug in `DeviceSettings` (`ReferenceError: Property 'args' doesn't exist`) when calling `BackgroundGeolocation.deviceSettings.show(request)`" — confirms the API call shape is two-step: prepare a request, then `.show(request)`.

dontkillmyapp.com itself, per its Samsung page (https://dontkillmyapp.com/samsung) — verbatim per search snippet: "For proper background app functionality on Samsung, apps need to be whitelisted in App power monitor and added to Unmonitored apps."

### We have

- `app.json` line 39: `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is in the Android permissions list. ✓
- A separate, app-level Battery Optimization prompt was shipped V57.14.2 (per CLAUDE.md memory `project_naavi_battery_opt_inapp_prompt.md`) — uses `expo-intent-launcher` to deep-link to Android's Battery Optimization settings.
- `BackgroundGeolocation.deviceSettings.*` is not called anywhere in our code (`Grep "deviceSettings" → no matches`).
- We do not surface a Samsung-specific "App power monitor → Unmonitored apps" instruction in-app or in any onboarding flow.
- Notification icon path `'drawable/notification_icon'` matches vendor's documented format. Whether the actual resource ships into the prebuild output is a build-config question outside the scope of this review.

### Gap

There is no vendor-published "Samsung One UI checklist." The vendor's only mechanism is the `DeviceSettings` API + a reference to dontkillmyapp.com. Items the vendor's API exposes that we do not currently invoke:

- `BackgroundGeolocation.deviceSettings.isIgnoringBatteryOptimizations()` (programmatic check).
- `BackgroundGeolocation.deviceSettings.showIgnoreBatteryOptimizations()` + `.show(req)` (open the system screen via the SDK rather than our own `expo-intent-launcher` path).
- `BackgroundGeolocation.deviceSettings.showPowerManager()` + `.show(req)` (open vendor-specific Power Manager screens — relevant for Xiaomi/Huawei/Vivo per docs; Samsung not explicitly named in the doc snippet).

dontkillmyapp.com's Samsung page lists OEM-specific user actions ("App power monitor → Unmonitored apps") that the SDK cannot perform programmatically. No vendor doc instructs the developer to surface these to the user; vendor's stance per maintainer's "There's nothing the plugin can do" quotes is that user education is on the developer.

---

## Cross-cutting observations

1. **The SDK has no documented control over OS-side geofence delivery latency.** Vendor's most direct statement is the maintainer's Issue #1830 quote: "It's well-known that Android geofence-only mode is lazier with passively monitoring geofences… It's completely up to the OS to monitor geofences. The plugin has nothing to do with firing a geofence event." This is consistent with vendor's repeated framing across every OEM/geofence/headless issue. The SDK's leverage is in `geofenceModeHighAccuracy` (turns location-services on while in geofence-only mode), `heartbeatInterval` (forces periodic AlarmManager wake — Android-only and described as "guaranteed to fire"), and `notification.sticky` (forces foreground-service visibility, which sometimes correlates with FG-service persistence).

2. **In geofence-only mode, `State.isMoving` is always `false`.** Maintainer's verbatim statement from Issue #2113 (2024-08-19): "Since in geofence-only mode, `config.isMoving` is **always** `false`." Combined with NotificationConfig.sticky default ("normally shows only while device is moving"), this means the foreground notification can be absent in geofence-only mode unless `sticky: true`. This aligns with our observed asymmetry between two test phones in the same drive.

3. **`debug: true` is the maintainer's diagnostic-of-first-resort.** In every Samsung/geofence/headless issue I read, the maintainer's first ask was either "are you observing the plug-in logs" (→ `getLog`/`emailLog`) or "are you configuring the plug-in with `debug: true` so you can hear the geofence events." We use neither.

4. **`onHeartbeat` is the only event vendor describes with the word "guaranteed."** Philosophy wiki, Android section: "The `heartbeat` event is implemented using the Android `AlarmManager` mechanism and is **guaranteed** to fire your Javascript callback." No similar guarantee phrasing appears for `onGeofence`. (Inference: this is consistent with the rest of the doc set's framing that geofence delivery is the OS's call, not the SDK's.)

5. **The v5 docs site is partially broken.** Multiple `interfaces/*.html` URLs returned 404 (`Logger.html`, `BackgroundGeolocation.html`, `NotificationConfig.html` intermittently). Several wiki pages claim 14 total pages but only ~4 load. The maintainer's responses on Issues remain the highest-fidelity source for "how to actually configure this for geofencing on Samsung."

6. **Vendor canonical demo config is `flat`, not nested.** Our v5 nested `{geolocation, app, logger}` config is the documented v5 TypeScript shape, but no vendor demo uses it. The demo's `BackgroundGeolocation.reset({...flat...})` works because the SDK accepts both styles. This is not a gap, just a stylistic divergence.

7. **The `lib/naavi-client.ts` mobile prompt-fallback drift item from CLAUDE.md is unrelated** — that's about Claude prompt sync, not SDK config. Mentioned here only to disambiguate.

---

## What this review does NOT cover

- **Native build configuration.** Whether the Expo prebuild correctly emits AndroidManifest entries for `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, the Transistorsoft `BackgroundGeolocationService`, the boot-receiver, and the `notification_icon` drawable resource is a build-output review, not a JS-config review. CHANGELOG v5.0.0-beta.4 noted a proguard rule update "to prevent key classnames being minified (eg: HeadlessTask)" — whether our R8/proguard config in the Expo prebuild preserves the HeadlessTask class is unverified.

- **License entitlement vs runtime behavior.** Vendor's README says "The SDK is fully functional in DEBUG builds — no license required" but the trial license in `app.json` line 73 has `"trial": true, "trial_days": 30` and `"max_build_stamp": 20260614`. CHANGELOG v5.0.2 noted "Fix bug in iOS License Validation Failure modal dialog interfering with React Native app launching" — confirms license-validation failures have user-visible side effects. Whether our specific license validates correctly in RELEASE builds is unverified by docs alone.

- **The actual SDK-internal log from our phones.** Without `getLog()` or `uploadLog()` wiring, the native-side timeline of our 3-hour T1→T2 incident is not in this review. Several of vendor's diagnostic ambiguities can only be resolved by reading that log.

- **`expo-router` interaction with HeadlessTask.** Not addressed in any vendor doc; flagged in Q2 as an open question rather than a gap.

- **Samsung "One UI"-specific advice beyond dontkillmyapp.com.** None published by vendor that I could find. The 14-issue search of maintainer comments never produced a Samsung-One-UI-specific config recommendation distinct from the generic "see dontkillmyapp.com / enable `geofenceModeHighAccuracy` / read the logs" pattern.

- **`Geofence.loiteringDelay` / `notifyOnDwell` interaction.** We use `notifyOnDwell: false` (useGeofencing.ts:454). The Geofence interface documents `loiteringDelay` and the demo enables `notifyOnDwell: true` with `loiteringDelay: 60000` for some regions. Whether dwell-based detection would compensate for missed enter events in geofence-only mode is not addressed in vendor docs and not in scope here.

- **Polygon geofencing.** Our license includes the `polygon-geofencing` entitlement (per `app.json` decoded `entitlements`), but we use circular geofences only. Issue #2113 documents a polygon-mode-specific iOS bug fixed in 4.17.0-beta.3.

- **`schedule` / `scheduleUseAlarmManager`.** The demo's `applyTestConfig` includes a `schedule: ['1-6 09:00-17:00']` cron-like entry. We do not use scheduling.
