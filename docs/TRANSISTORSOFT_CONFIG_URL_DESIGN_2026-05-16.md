# Transistorsoft Config.url — V57.17 Implementation Design (2026-05-16)

> Research + design only. No code changes were made. Marks observations vs inferences explicitly. Cites vendor sources verbatim wherever possible.

---

## TL;DR

- **Set `url`, `headers`, `autoSync: true`, `persistMode: PERSIST_MODE_GEOFENCE`, `geofenceTemplate` (custom shape that matches our existing `LocationEvent`), `maxDaysToPersist`, `httpTimeout`** in `BackgroundGeolocation.ready({...})`. Native code (not JS) handles the POST, including queue + retry — this is the vendor-documented fix for the JS-suspension class of bug we observed today.
- **Auth: static bearer in `headers`** (`Authorization: Bearer <NAAVI_TSOFT_INGEST_KEY>`). The SDK's typed `authorization` field only supports JWT (vendor: *"⚠️ Only [JWT](https://jwt.io/) is currently supported"*), and we have no per-user JWT to feed it from a killed/suspended JS context. A new static secret env var on the Edge Function side avoids re-using `NAAVI_ANON_KEY` for a public-facing webhook.
- **User identification: bake `user_id` into per-geofence `extras` at registration time** in `syncGeofencesForUser`. Vendor explicitly supports this and `extras` is included in the geofence HTTP payload. Avoids a server-side `action_rules` lookup before fan-out (we still do that lookup for action_config; the gain is we never have to *resolve* the user from the rule).
- **New Edge Function `tsoft-geofence-webhook`** (thin adapter). Validates static auth header, normalizes the SDK's payload shape (or our `geofenceTemplate`-emitted shape), then either invokes `report-location-event` internally OR runs the same logic inline. Keeping `report-location-event` unchanged means the legacy JS handler keeps working unmodified during the rollout window.
- **Keep JS handler (`onGeofence`) during rollout for defense in depth.** Vendor docs show no warning against coexistence; the two paths produce duplicate POSTs that the server's existing 30-min dedup window catches. Delete the JS handler in V57.18 once Config.url is proven over 1-2 weeks of drives.

---

## Source inventory

All sources accessed 2026-05-16. Local type definitions are checked into `node_modules` at the project's pinned version.

| # | Source | URL / Path | Status |
|---|---|---|---|
| 1 | `Config.d.ts` — `url`, `autoSync`, `batchSync`, `maxBatchSize`, `httpRootProperty`, `locationTemplate`, `geofenceTemplate`, `persistMode`, `maxDaysToPersist`, `maxRecordsToPersist`, `disableAutoSyncOnCellular`, `headers`, `params`, `extras`, `authorization`, `httpTimeout` | `C:\Users\waela\OneDrive\Desktop\Naavi\node_modules\react-native-background-geolocation\src\declarations\interfaces\Config.d.ts` | Read in full (2,476 lines) |
| 2 | `HttpEvent.d.ts` — HTTP Guide embedded in TSdoc, RPC mechanism | `…\interfaces\HttpEvent.d.ts` | Read in full (313 lines) |
| 3 | `Geofence.d.ts` — geofence registration shape, `extras`, geofence-only mode docs | `…\interfaces\Geofence.d.ts` | Read in full (319 lines) |
| 4 | `GeofenceEvent.d.ts` — onGeofence event shape | `…\interfaces\GeofenceEvent.d.ts` | Read in full (35 lines) |
| 5 | `Authorization.d.ts` — JWT-only auth strategy | `…\interfaces\Authorization.d.ts` | Read in full (185 lines) |
| 6 | `TransistorAuthorizationToken.d.ts` — demo-server token helper | `…\interfaces\TransistorAuthorizationToken.d.ts` | Read in full (63 lines) |
| 7 | `index.js` — PERSIST_MODE constants | `…\react-native-background-geolocation\src\index.js` lines 73-76, 137-140 | Grep'd verbatim |
| 8 | Wiki — Location-Data-Schema | https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Location-Data-Schema.md | Quote captured |
| 9 | Wiki — Geofence-Features (typedoc derivative) | Embedded in `Geofence.d.ts` interface | Read in full |
| 10 | Wiki — Android Headless Mode | https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Android-Headless-Mode.md | Read; no HTTP-vs-headless discussion |
| 11 | Typedoc 4.x — Config interface (persistMode, geofenceTemplate, autoSync) | https://transistorsoft.github.io/react-native-background-geolocation/4.x/interfaces/Config.html | Excerpts captured |
| 12 | Demo `HelloWorldView.tsx` — minimum-viable ready() call | https://github.com/transistorsoft/rn-background-geolocation-demo/blob/master/src/hello-world/HelloWorldView.tsx | Inspected |
| 13 | Demo `SettingsService.ts::applyTestConfig` — Advanced ready() call | https://github.com/transistorsoft/rn-background-geolocation-demo/blob/master/src/advanced/lib/SettingsService.ts | Inspected (does NOT set HTTP fields directly; uses `transistorAuthorizationToken` shorthand) |
| 14 | `useGeofencing.ts` — current V57.16.x integration | `C:\Users\waela\OneDrive\Desktop\Naavi\hooks\useGeofencing.ts` | Read in full (736 lines) |
| 15 | `report-location-event/index.ts` — current server | `C:\Users\waela\OneDrive\Desktop\Naavi\supabase\functions\report-location-event\index.ts` | Read in full (529 lines) |

**Sources we tried and failed to load** (404 or insufficient extract): `wiki/HTTP-Guide.md` (vendor moved this; the content survives verbatim inside `HttpEvent.d.ts` TSdoc comments), `transistorsoft/background-geolocation-console` server route handlers (path moved; the demo-server payload shape is documented authoritatively in the Location-Data-Schema wiki above), individual issues #1830 / #2160 / #2407 / #2120 / #2554 maintainer-reply text (GitHub Issues pages don't render comment text to WebFetch).

---

## Question 1 — Native payload shape

### Vendor says (verbatim, Location-Data-Schema wiki)

> ```
> {
>     "location": {
>         "coords": {
>             "latitude":   [Float],
>             "longitude":  [Float],
>             "accuracy":   [Float],
>             "speed":      [Float],
>             "heading":    [Float],
>             "altitude":   [Float]
>         },
>         "extras": {
>             "foo": "bar"
>         },
>         "activity": {
>             "type": [still|on_foot|walking|running|in_vehicle|on_bicycle|unknown],
>             "confidence": [0-100%]
>         },
>         "geofence": {
>             "identifier": [String],
>             "action": [String ENTER|EXIT]
>         },
>         "battery": {
>             "level": [Float],
>             "is_charging": [Boolean]
>         },
>         "timestamp": [ISO-8601 UTC],
>         "age":       [Integer],
>         "uuid":      [String],
>         "event"      [String],
>         "is_moving": [Boolean],
>         "is_heartbeat: [Boolean],
>         "odometer": [Float/meters]
>     }
> }
> ```
>
> "Geofence" data appears conditionally: "Present only if a geofence was triggered at this location" with identifier and action (ENTER or EXIT) properties.
>
> The documentation notes that `location` becomes an array during batched requests.

Source: https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Location-Data-Schema.md

Cross-reference from `HttpEvent.d.ts` lines 67-105:
> "The SDK's HTTP Service will upload recorded locations as JSON to your [[Config.url]] (See [[Location]] for the JSON schema) with `Content-Type application/json`."

### Our schema mapping

Current `report-location-event` expects:

```ts
interface LocationEvent {
  user_id?: string;     // bakeable into extras
  rule_id: string;      // = geofence.identifier
  lat: number;          // = location.coords.latitude
  lng: number;          // = location.coords.longitude
  event: 'enter' | 'exit' | 'dwell';  // = location.geofence.action lowercased
  timestamp: string;    // = location.timestamp
  event_id?: string;    // synthesize server-side or via geofenceTemplate <%= uuid %>
}
```

Two paths to bridge them:

- **Path A (default schema)** — accept the vendor's default `{location: {...}}` shape on a new Edge Function and translate it. Server code does `body.location.geofence.identifier` → `rule_id`, `body.location.geofence.action.toLowerCase()` → `event`, etc.
- **Path B (geofenceTemplate)** — configure a custom `geofenceTemplate` so the SDK posts our exact existing schema. From `Config.d.ts` lines 1065-1157:

  > ```
  > BackgroundGeolocation.ready({
  >   geofenceTemplate: '{ "lat":<%= latitude %>, "lng":<%= longitude %>, "geofence":"<%= geofence.identifier %>:<%= geofence.action %>" }'
  > });
  > ```
  >
  > Tag list for geofenceTemplate is identical to `locationTemplate` with the addition of `geofence.identifier` and `geofence.action`:
  > `latitude`, `longitude`, `speed`, `heading`, `accuracy`, `altitude`, `altitude_accuracy`, `timestamp`, `uuid`, `event`, `odometer`, `activity.type`, `activity.confidence`, `battery.level`, `battery.is_charging`, `mock`, `is_moving`, `timestampMeta`.

  **Note on `extras`:** the `geofenceTemplate` doc table does NOT list an `<%= extras %>` tag. Inference (not a vendor quote): to include our `user_id` via the template, we may need to use `httpRootProperty: "."` + a flatter custom template + include extras as JSON, OR fall back to default-schema Path A where `location.extras` is included automatically. **Path A is the safer default until we can confirm with the maintainer or test.**

**Recommendation: Path A.** The default schema includes `extras` automatically (vendor: *"[[extras]] are appended to each recorded location and persisted to the database record"*), gives us the activity/battery/accuracy metadata for free (useful diagnostics), and the translation work in the new Edge Function is ~15 lines.

---

## Question 2 — Filtering to geofence events only

### Vendor says (verbatim, `Config.d.ts` lines 1178-1197)

> "Allows you to specify which events to persist to the SDK's internal database:  locations | geofences | all (default).
>
> Note that all recorded location and geofence events will *always* be provided to your [BackgroundGeolocation.onLocation] and [BackgroundGeolocation.onGeofence] events, just that the persistence of those events in the SDK's internal SQLite database can be limited.  Any event which has not been persisted to the SDK's internal database will also **not** therefore be uploaded to your [url] (if configured).
>
> | Name                                                          | Description                                             |
> |---------------------------------------------------------------|---------------------------------------------------------|
> | [[BackgroundGeolocation.PERSIST_MODE_ALL]]                    | (__DEFAULT__) Persist both geofence and location events |
> | [[BackgroundGeolocation.PERSIST_MODE_LOCATION]]               | Persist only location events (ignore geofence events)   |
> | [[BackgroundGeolocation.PERSIST_MODE_GEOFENCE]]               | Persist only geofence events (ignore location events)   |
> | [[BackgroundGeolocation.PERSIST_MODE_NONE]]                   | Persist nothing (neither geofence nor location events)  |
>
> ### ⚠️ Warning
> This option is designed for specializd use-cases and should generally not be used.  For example, some might wish to run the plugin in regular tracking mode with [[BackgroundGeolocation.start]] but only record geofence events.  In this case, one would configure `persistMode: BackgroundGeolocation.PERSIST_MODE_GEOFENCE`."

Constant confirmed at `node_modules/react-native-background-geolocation/src/index.js:75` and `:139`:
```js
const PERSIST_MODE_GEOFENCE = PersistMode.Geofence;
// ...
static get PERSIST_MODE_GEOFENCE()  { return PERSIST_MODE_GEOFENCE; }
```

### Answer

Set `persistMode: BackgroundGeolocation.PERSIST_MODE_GEOFENCE` in `ready({...})`. The vendor's "⚠️ Warning" applies to people in motion-tracking mode who only want geofence events recorded — that IS our exact situation (we use `startGeofences()`, not `start()`, but the proximity-radius location pings the SDK does to maintain the active pool would otherwise also be uploaded). Setting this mode ensures the SDK posts only geofence transitions, not the periodic location samples.

**Observation:** Even without `persistMode`, the SDK in `startGeofences()` mode (which our code uses, `useGeofencing.ts:604`) primarily records geofence events. But it does also record `motionchange` events and provider-change events per the `event` tag in `geofenceTemplate`. PERSIST_MODE_GEOFENCE is the only documented way to guarantee geofence-only HTTP posts.

---

## Question 3 — Auth pattern when JWT-per-user isn't an option

### Vendor says (verbatim, `Authorization.d.ts` lines 4-5, 62-66, 1227-1231)

From `Authorization.d.ts`:
> "Configures the SDK for authorization wtih your server's [[accessToken]] token (eg: [JSON Web Token](https://jwt.io/)) and automatically requests new tokens when server returns HTTP status `"401 Unauthorized"`.
>
> __Note:__ Only *[JSON Web Token](https://jwt.io/)* (JWT) is currently supported."

> ```ts
> interface Authorization {
>   strategy: string;     // "JWT"
>   accessToken: string;
>   refreshToken?: string;
>   refreshUrl?: string;
>   refreshPayload?: any;
>   refreshHeaders?: any;
>   expires?: number;
> }
> ```

From `Config.d.ts` lines 1227-1235 (the `authorization` config slot):
> "Configures the SDK for [[Authorization]] with your server (eg: [JSON Web Token](https://jwt.io/)).
>
> ### ⚠️ Only [JWT](https://jwt.io/) is currently supported."

### Vendor says about plain `headers` (verbatim, `Config.d.ts` lines 734-767)

> "Optional HTTP headers applied to each HTTP request.
>
> ```typescript
> BackgroundGeolocation.ready({
>   url: "https://my.server.com",
>   headers: {
>     "authorization": "Bearer <a secret key>",
>     "X-FOO": "BAR"
>   }
> });
> ```
>
> ### ℹ️ Note:
> - The plugin automatically applies a number of required headers, including `"content-type": "application/json"`"

### Answer

Two viable paths, both vendor-documented:

1. **Static bearer in `headers`** — set once at `ready()` time. Pros: no token refresh, no expiry, no per-user dependency. Cons: one secret protects all users; if leaked, must rotate everywhere. The new Edge Function validates this static secret server-side and looks up the user via the `extras.user_id` baked into each geofence.
2. **JWT via `authorization`** — would require persisting Supabase JWT to native storage with refresh URL pointing at Supabase's token endpoint. Cons: Supabase access tokens are short-lived (~1 hour); the refresh-token rotation flow doesn't cleanly map to `refreshPayload` (Supabase uses a different request shape than the SDK's templated FORM POST); on app reinstall the refresh token is gone.

**Recommendation: option 1 (static bearer).** It's the simplest path that fits the constraint that the SDK fires from killed/suspended states where there's no live JS session to mint a JWT. New env var: `NAAVI_TSOFT_INGEST_KEY` (server-only secret; mobile reads via `EXPO_PUBLIC_…` only if we deliberately expose it via Expo config — but since the value ships baked into the APK, treat it as a per-build static credential, NOT a secret in the cryptographic sense, and protect it with rate-limiting + payload validation on the Edge Function side).

---

## Question 4 — Identifying the user_id from the payload

### Vendor says (verbatim, `Geofence.d.ts` lines 262-265)

> ```ts
> /**
> * Arbitrary key-values appended to the geofence event and posted to your configured [[Config.url]].
> */
> extras?: Extras;
> ```

And the example (lines 16-32):
> ```ts
> BackgroundGeolocation.addGeofence({
>   identifier: "Home",
>   radius: 200,
>   latitude: 45.51921926,
>   longitude: -73.61678581,
>   notifyOnEntry: true,
>   notifyOnExit: true,
>   extras: {
>     route_id: 1234
>   }
> }).then(...)
> ```

Confirmed in `GeofenceEvent.d.ts` lines 30-33:
> ```ts
> /**
> * Optional [[Geofence.extras]]
> */
> extras?: Extras;
> ```

### Answer

**Option (b) — bake `user_id` into each geofence's `extras` at registration time.** Vendor explicitly documents that `extras` set on `addGeofence` is *"appended to the geofence event and posted to your configured `Config.url`"*. Zero DB query for user resolution. The Edge Function reads `body.location.extras.user_id`.

In `syncGeofencesForUser` (currently `useGeofencing.ts:592-600`), the existing `tsoftGeofences.map((r) => ({...}))` needs an `extras: { user_id: userId }` field on every geofence.

Note: even with `extras.user_id`, we still need a DB lookup on the server to fetch `action_config` for the fan-out (SMS body, recipient phone, etc.). That's unavoidable. What we avoid is the *prerequisite* `action_rules.user_id` resolution — the user is now self-identified in the payload.

---

## Question 5 — SDK auto-retry on failed POSTs

### Vendor says (verbatim, `HttpEvent.d.ts` lines 47-52, 109-117)

> "## The SQLite Database
>
> The SDK immediately inserts each recorded location into its SQLite database.  This database is designed to act as a temporary buffer for the HTTP service and the SDK __strongly__ desires an *empty* database.  The only way that locations are destroyed from the database are:
> - Successful HTTP response from your server (`200`, `201`, `204`).
> - Executing [[BackgroundGeolocation.destroyLocations]].
> - [[maxDaysToPersist]] elapses and the location is destroyed.
> - [[maxRecordsToPersist]] destroys oldest record in favor of latest."

> "## HTTP Failures
>
> If your server does *not* return a `20x` response (eg: `200`, `201`, `204`), the SDK will __`UNLOCK`__ that record.  Another attempt to upload will be made in the future (until [[maxDaysToPersist]]) when:
> - When another location is recorded.
> - Application `pause` / `resume` events.
> - Application boot.
> - [[onHeartbeat]] events.
> - [[onConnectivityChange]] events.
> - __[iOS]__ Background `fetch` events."

### Answer

**Yes — built-in queue + automatic retry.** The SDK persists every recorded geofence to its own SQLite buffer, locks the row during upload, deletes on 2xx, unlocks-and-retries on anything else. Retries fire on: next location/geofence recorded, app pause/resume, app boot, heartbeat events, connectivity restoration. Records age out after `maxDaysToPersist` (default 1 day; **recommend setting to `3` for our use case** — gives a 72-hour disconnected window without losing alerts).

The server returning 500 is automatically retried. The server returning 200 deletes the record. Important consequence for our design: **the server MUST return 200 even for "skipped — already fired" responses**, otherwise the SDK will retry forever until age-out. Current `report-location-event` already does this (`return json({ ok: true, skipped: ... })`).

---

## Question 6 — Foreground/background/terminated behavior

### Vendor says (verbatim, `Config.d.ts` lines 1304-1314)

> "Controls whether to continue location-tracking after application is **terminated**.
>
> Defaults to **`true`**.  When the user terminates the app, the plugin will [[BackgroundGeolocation.stop]] tracking.  Set this to **`false`** to continue tracking after application terminate."

We already set `stopOnTerminate: false, startOnBoot: true, enableHeadless: true` (`useGeofencing.ts:259-261`).

### Vendor says (verbatim, `Geofence.d.ts` lines 124-126)

> "Once a geofence has been inserted into the SDK's database using [[addGeofence]] or [[addGeofences]], they will be monitored *forever* (as long as the plugin remains `State.enabled == true`).  If you've configured [[stopOnTerminate]] __`false`__ and [[startOnBoot]] __`true`__, geofences will continue to be monitored even if the application is terminated or device rebooted."

### Inference (NOT a vendor quote)

The vendor explicitly states the SDK *records* geofence events in all three states (foreground / background / terminated) provided `stopOnTerminate: false`. The HTTP service runs in native code on the SDK's own thread pool — it does NOT require the React Native JS engine to be alive (otherwise the entire "SQLite buffer + retry on connectivity-change" design would be pointless). This is the architectural difference that motivates V57.17.

**Caveat to flag to the user (Wael):** I could not find a vendor sentence saying *"HTTP autosync POSTs are made by native code while the app is terminated"* in plain English. The strongest evidence is structural — every documented retry trigger (`onConnectivityChange`, `onHeartbeat`, boot, app-pause) is a native-side event, not a JS-side event. The SQLite buffer + the documented retry triggers + the architectural separation between "JS event handler" and "HTTP service" together imply this works as we hope. **The empirical proof you noted today (3 queued T1s drained on foregrounding) demonstrates the JS handler is the bottleneck. The vendor's design implies the HTTP service is independent. The drive test in Step 5 of the implementation plan is the only definitive proof for our specific build.**

---

## Question 7 — Does Config.url replace the JS handler, or coexist?

### Vendor says (verbatim, `Config.d.ts` lines 1181-1183)

> "Note that all recorded location and geofence events will *always* be provided to your [BackgroundGeolocation.onLocation] and [BackgroundGeolocation.onGeofence] events, just that the persistence of those events in the SDK's internal SQLite database can be limited."

### Answer

**Coexist.** The `onGeofence` JS handler fires regardless of whether `url` is set; `url` is an independent HTTP service layered on top. If we keep both during the V57.17 rollout, every transition produces TWO POSTs to the server (one from the native HTTP service, one from the JS `handleGeofenceEvent`). The existing 30-min dedup window in `report-location-event` (`supabase/functions/report-location-event/index.ts:141`) collapses them; the second to land returns `ok: true, skipped: 'already fired within last 30 min'`.

**Race condition risk** (from the prompt — today's drive caused 2 deliveries because both T2s drained simultaneously and both passed the dedup check before either logged): the Config.url path could exhibit the same race if BOTH the native POST AND the JS POST land at the same Edge Function instance in the same second, AND both query `action_rule_log` before either insert lands. Mitigations:

1. **Move dedup check + insert into a single transaction** in `report-location-event`. This is the proper fix and applies whether or not we ship Config.url. (Action item: classify this as a separate small bug, not part of this design.)
2. **Pre-existing dedup is best-effort.** Vendor's design (server can be retried, queue idempotent) implies the server is expected to handle duplicates. The 30-min window + at-most-one alert UX intent argues for option 1 above. Today's race produced 2 deliveries — annoying but not catastrophic. The Config.url addition does not materially worsen the risk.

**V57.17 rollout decision: keep the JS handler.** Pros: belt-and-suspenders during the 1-2 week proving period; if the native HTTP service has a Samsung-specific quirk we don't yet know about, the JS path still fires when the user opens the app. Cons: 2× alert volume per geofence transition under normal operation. Since dedup already collapses them, no user-visible impact.

**V57.18 cleanup: delete the JS handler** once we have 2+ weeks of Config.url-only data showing reliable delivery. Removes a maintenance burden and the duplicate-fire scenario entirely.

---

## Question 8 — Performance / throughput

### Vendor says

No published benchmarks comparing native HTTP throughput vs JS-mediated POSTs were found in the docs I searched. The vendor's strongest performance statement is on `batchSync` (verbatim, `Config.d.ts` lines 884-908):

> "If you've enabled HTTP feature by configuring an [[url]], [[batchSync]] __`true`__ will POST *all* the locations currently stored in native SQLite database to your server in a single HTTP POST request.  With [[batchSync]] __`false`__, an HTTP POST request will be initiated for **each** location in database."

### Inference

Native HTTP service runs in the SDK's own thread pool and is unaffected by JS event loop suspension. **Inferred** latency difference vs current path: T1→T2 collapses to ~50ms (native code) instead of the multi-minute-to-multi-hour bottleneck we observed today. No vendor benchmark to cite. Drive-test in Step 5 will measure this empirically for our environment.

**Recommend `batchSync: false` for V57.17** — every geofence event POSTs immediately (one event per request). Reasons: (a) lower per-event latency than waiting for a batch threshold; (b) geofence events are rare (a few per day per user) so batching has no battery benefit; (c) single-event POSTs are simpler to debug in the server logs.

---

## Implementation design questions A-D

### A. New Edge Function vs adapt existing?

**Recommendation: NEW function `tsoft-geofence-webhook`** (Option 1).

| Aspect | Option 1: new `tsoft-geofence-webhook` | Option 2: modify `report-location-event` |
|---|---|---|
| Auth complexity | Single static-bearer auth path | Two auth paths (anon-key from JS, static-bearer from native) — easy to confuse |
| Schema | One schema (Transistorsoft `{location: {...}}`) | Two schemas (existing + Transistorsoft) — code branches on shape |
| Risk to live JS path | Zero (untouched) | Non-zero — every code change ships to the live alert path |
| Removal cost in V57.18 | Delete the file + remove from deploy list | Delete the conditional branches — error-prone, must re-test legacy path |
| Test plan | Verify new path in isolation, then add it alongside the old | Must re-run all integration tests on the merged path |

The new function is a ~50-line adapter that translates Transistorsoft's `{location: {geofence: {identifier, action}, coords: {...}, extras: {user_id: ...}}}` shape into our existing `LocationEvent` shape, then `fetch()`-es `report-location-event` internally (using the Edge-Function-to-Edge-Function pattern we already use elsewhere, with `NAAVI_ANON_KEY`). All the fan-out, dedup, dwell, direction-matching logic stays in one place.

### B. Keep JS handler as backup?

**Recommendation: keep through V57.17, delete in V57.18.** Reasoning in Q7. No vendor stance.

### C. `pending_dwell_fires` + `fire-pending-dwells` cron + dwell logic — still applies?

**Yes, unchanged.** The dwell logic lives entirely server-side (`report-location-event` lines 251-296 + the `fire-pending-dwells` cron). The Config.url path posts an enter event to `tsoft-geofence-webhook`, which forwards to `report-location-event`, which still inserts a `pending_dwell_fires` row if `dwell_seconds > 0`. The cron path is untouched.

Note: today's Wael decision (2026-05-16) set default dwell to 0 seconds (see `report-location-event:251-258` comments), so most rules will fire immediately and the dwell path is rarely exercised. The mechanism is still present for any rule that explicitly sets `trigger_config.dwell_seconds`.

### D. Server-side dedup race condition

The race exists today and is independent of whether Config.url ships. Today's drive saw it because two T2s drained simultaneously. With Config.url, the new race scenario is "native POST arrives at instant T, JS POST arrives at instant T+50ms" — same shape, slightly different actors. **Out of scope for V57.17 design**, but worth a separate spawn-task for a `report-location-event` transactional-insert fix.

---

## Recommended implementation

### Step 1 — Mobile config changes (`hooks/useGeofencing.ts`)

**File: `C:\Users\waela\OneDrive\Desktop\Naavi\hooks\useGeofencing.ts`**

#### Change 1a — augment `ensureReady()` `BackgroundGeolocation.ready({...})` call

Current location: `useGeofencing.ts:217-285`. Insert HTTP-service config alongside the existing `geolocation` / `app` / `logger` blocks.

Suggested diff (do NOT apply; review first):

```ts
// at module top (~line 53-55), add:
const TSOFT_INGEST_URL = `${SUPABASE_URL}/functions/v1/tsoft-geofence-webhook`;
const TSOFT_INGEST_KEY = process.env.EXPO_PUBLIC_NAAVI_TSOFT_INGEST_KEY ?? '';

// inside ready({...}) on ~line 217, add as top-level fields (NOT nested under `geolocation` —
// these are root-level Config fields per Config.d.ts):
const state: State = await BackgroundGeolocation.ready({
  reset: true,
  debug: true,

  // V57.17 — native HTTP autosync. Replaces the JS handler as the primary
  // event-delivery path. Native code POSTs to the URL even while JS is
  // suspended; JS handler stays as defense-in-depth through V57.17, removed
  // in V57.18.
  url: TSOFT_INGEST_URL,
  headers: {
    authorization: `Bearer ${TSOFT_INGEST_KEY}`,
  },
  autoSync: true,
  batchSync: false,
  persistMode: BackgroundGeolocation.PERSIST_MODE_GEOFENCE,
  maxDaysToPersist: 3,
  httpTimeout: 30000,

  geolocation: { /* existing */ },
  app: { /* existing */ },
  logger: { /* existing */ },
});
```

#### Change 1b — bake `user_id` into geofence `extras` at registration

Current location: `useGeofencing.ts:592-600`. Add `extras` field on every geofence in `tsoftGeofences.map(...)`:

```ts
const tsoftGeofences: Geofence[] = regions.map((r) => ({
  identifier: r.identifier,
  radius: r.radius,
  latitude: r.latitude,
  longitude: r.longitude,
  notifyOnEntry: r.notifyOnEntry,
  notifyOnExit: r.notifyOnExit,
  notifyOnDwell: false,
  extras: { user_id: userId },  // V57.17 — native HTTP path reads this
}));
```

#### Change 1c — `onHttp` listener (diagnostic only, optional but recommended)

Add an `onHttp` subscription inside `ensureReady()` next to the other event subscriptions, so failed HTTP POSTs land in `remoteLog`:

```ts
BackgroundGeolocation.onHttp((event) => {
  remoteLog(getLifecycleSession(), 'tsoft-http', {
    success: event.success,
    status: event.status,
    response_chars: (event.responseText ?? '').length,
  });
});
```

#### Change 1d — JS handler `handleGeofenceEvent` — NO CHANGE in V57.17, DELETE in V57.18

Today's `onGeofence(handleGeofenceEvent)` subscription at `useGeofencing.ts:138` stays. The JS handler continues to POST to `report-location-event` directly. When the Config.url path proves out, V57.18 removes lines 354-484 entirely.

### Step 2 — Server-side Edge Function (new)

**New file: `C:\Users\waela\OneDrive\Desktop\Naavi\supabase\functions\tsoft-geofence-webhook\index.ts`**

Sketch (~70 lines; review before writing):

```ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // 1. Validate static-bearer auth.
  const expectedKey = Deno.env.get('NAAVI_TSOFT_INGEST_KEY') ?? '';
  const auth = req.headers.get('authorization') ?? '';
  if (!expectedKey || auth !== `Bearer ${expectedKey}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    // Vendor default payload shape — Location-Data-Schema wiki:
    //   { location: { coords: {...}, geofence: { identifier, action }, extras: {...}, timestamp } }
    const loc = body?.location;
    if (!loc || !loc.geofence) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no geofence in payload' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ruleId = String(loc.geofence.identifier ?? '');
    const action = String(loc.geofence.action ?? '').toLowerCase();  // 'enter' | 'exit'
    const event = (action === 'enter' || action === 'exit' || action === 'dwell') ? action : null;
    if (!ruleId || !event) {
      return new Response(JSON.stringify({ ok: true, skipped: 'invalid payload' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = loc.extras?.user_id ?? undefined;
    const lat = loc.coords?.latitude ?? null;
    const lng = loc.coords?.longitude ?? null;
    const timestamp = loc.timestamp ?? new Date().toISOString();

    // 2. Forward to report-location-event using existing inter-function auth.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const interFnKey = Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

    const res = await fetch(`${supabaseUrl}/functions/v1/report-location-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
      body: JSON.stringify({
        ...(userId ? { user_id: userId } : {}),
        rule_id: ruleId,
        lat, lng,
        event,
        timestamp,
        event_id: `tsoft-${loc.uuid ?? crypto.randomUUID()}`,
      }),
    });

    // Vendor requires 2xx response or the SDK retries forever. Always return 200
    // unless the auth check failed.
    const responseBody = await res.text();
    return new Response(responseBody || JSON.stringify({ ok: true, forwarded: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Still return 200 so the SDK clears the queue; log the error server-side.
    console.error('[tsoft-geofence-webhook] error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200,  // intentional — see vendor retry semantics
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

**Deploy command** (matches our existing pattern):
```
npx supabase functions deploy tsoft-geofence-webhook --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx
```

### Step 3 — Auth setup

**New env vars** to add via Supabase Dashboard → Edge Functions → Secrets:

| Name | Where | Value |
|---|---|---|
| `NAAVI_TSOFT_INGEST_KEY` | Supabase Edge Functions secrets | New random 32-byte hex string (`openssl rand -hex 32`) |

**Mobile-side** — add to Expo config (`app.json` or `.env` depending on how we currently inject `EXPO_PUBLIC_*`):

| Name | Where | Value |
|---|---|---|
| `EXPO_PUBLIC_NAAVI_TSOFT_INGEST_KEY` | Expo env (read at build time, baked into APK) | Same value as the server secret |

Validation logic in `tsoft-geofence-webhook` checks exact string match on the `Authorization: Bearer <key>` header. No JWT parsing, no expiry, no refresh.

**Threat model:** the key ships baked into the APK and is recoverable by any attacker with the AAB. It is not a cryptographic secret. The webhook's job is to gate against random internet noise + amateur abuse, not nation-state actors. The defenses that matter are:

- Rate-limit at the Supabase Edge Function layer if abuse appears (vendor mention worth flagging: we don't have rate-limiting built in today).
- Server validates `rule_id` exists in `action_rules` before fan-out (already enforced by `report-location-event:111` returning 404).
- Server validates the rule's `user_id` is the same as `extras.user_id` (already enforced at `report-location-event:117`).
- An attacker who exfiltrates the key can fire a known `rule_id` for a known `user_id` — but `rule_id` and `user_id` are both UUIDs, not enumerable.

### Step 4 — Migration plan (coexist with current JS handler)

**Day 0 (this session):** ship V57.17 with:
- Config.url native HTTP wired up (Step 1a-c).
- `extras.user_id` baked into every geofence at registration (Step 1b).
- New `tsoft-geofence-webhook` deployed (Step 2).
- Existing `handleGeofenceEvent` JS handler UNCHANGED — still subscribed via `onGeofence`, still POSTs to `report-location-event` directly.

**Result:** every geofence transition produces TWO POSTs to `report-location-event` (one via webhook, one via JS handler). 30-min dedup collapses them. T2-T3 server logs distinguish the source via `event_id` prefix (`tsoft-<uuid>` for native, current `newDiagSession()` for JS).

**Day 1-14:** drive-test the same routes that previously failed. Specifically: leave app fully terminated, drive to known geofence, verify alert lands within seconds (not minutes-to-hours). Compare T1→delivery for both paths. Telemetry to watch:
- `tsoft-http` remoteLog events — count of native POSTs and their HTTP status.
- `client_diagnostics` rows for both `event_id` prefixes.
- `action_rule_log` row count vs expected.

**Day 15+ (V57.18):** if native path proves reliable, remove `handleGeofenceEvent` (lines 354-484) and the `BackgroundGeolocation.onGeofence(handleGeofenceEvent)` subscription line (138). Keep `onProviderChange` / `onMotionChange` / etc. — those are diagnostic, not delivery-critical.

### Step 5 — Test plan

1. **Unit test the webhook payload translation.** Build a fake Transistorsoft payload with a known `rule_id` in `extras.user_id`, POST to the deployed webhook with the static bearer, verify it shows up in `action_rule_log` within seconds. No drive needed.
2. **Local config sanity check.** Install V57.17 AAB on Wael's phone via Internal Testing. Open app, then force-stop. Verify the FG notification remains.
3. **Live drive test — terminated app.** With app fully terminated (force-stop confirmed), drive to a known geofence at 841 Balsam Dr or similar. Expected: alert lands within 30-60 seconds of crossing the boundary, WITHOUT opening the app. Compare to the May 15 drive baseline (minutes-to-hours).
4. **Live drive test — backgrounded app.** Same drive, but with app backgrounded (home button pressed, not force-stopped). Expected: same fast delivery.
5. **Live drive test — foregrounded app.** Same drive, app open. Expected: same fast delivery (JS handler + native handler both fire; dedup collapses to one alert).
6. **Retry test — server outage.** Take `report-location-event` offline (deploy a broken version, or temporarily 503 from `tsoft-geofence-webhook`). Trigger a geofence. Verify the SDK retries on next connectivity-change event. Restore service. Verify queued events drain.
7. **Cross-user safety test.** Confirm `user_id` baked into one user's geofence extras matches the rule's `user_id` (defense against `extras` corruption).

---

## What this design does NOT cover

- **`report-location-event` race-condition fix.** Today's 2-delivery race is independent of V57.17. Belongs in its own task.
- **Polygon geofences.** Out of scope. Vendor sells polygon support as a paid add-on; our V57.17 use case is circular.
- **iOS.** All testing has been Android-side; iOS Config.url path is symmetric per vendor docs but not validated by us.
- **JS-side `onGeofence` deletion plan in V57.18.** Schedule, regression test set, and rollout gates for the cleanup PR are future work.
- **Battery measurements.** No vendor benchmarks; we should measure empirically in V57.17 testing.
- **OS-level geofence limit (Android = 100/app).** Already handled by SDK's `geofenceProximityRadius: 5000` active-pool design. Unchanged in V57.17.
- **Rate-limiting on `tsoft-geofence-webhook`.** Not built in today. If abuse appears post-launch, add Cloudflare or Supabase API-level limits.
- **`geofenceTemplate` (Path B in Q1).** We default to Path A (vendor schema + adapter). If the adapter line-count or runtime overhead becomes annoying, revisit Path B in V57.18+ once we understand the `extras` template-tag question by talking to the maintainer.
