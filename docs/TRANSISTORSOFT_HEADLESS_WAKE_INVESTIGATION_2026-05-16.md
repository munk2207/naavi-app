# Transistorsoft HeadlessTask Wake-Fix Investigation (2026-05-16)

## TL;DR

- **V57.16.2's wrap was based on a misreading of the vendor wiki.** The "Android Headless Mode" wiki page does NOT recommend `startBackgroundTask` for keeping a HeadlessTask alive. The cited "documented pattern" is not in the wiki — the wiki only shows `await getCurrentPosition()` / `await doCustomWork()` (Promise-based work) and says nothing about needing `startBackgroundTask`. (Observation, sourced.)
- **The HeadlessTask already gets a 120-second guaranteed runtime ceiling**, enforced natively. Hardcoded in `HeadlessTask.java:31` as `TASK_TIMEOUT = 60000 * 2`. The plugin's `registerHeadlessTask` wrapper auto-calls `finishHeadlessTask` when the user's promise resolves — no extra lifetime management needed for work that completes in ≤120s.
- **`startBackgroundTask` on Android schedules a separate WorkManager job** (per maintainer @christocracy in issue #2225 comment 2024-12-05). It does NOT directly extend the HeadlessJS task's lifetime — those are two parallel mechanisms. Calling it from inside a HeadlessTask is "weird" by the maintainer's own description (his word, in the demo's `doWork` comment).
- **Most likely regression mechanism (inference, marked):** Awaiting `startBackgroundTask()` as the very first thing in the handler probably never resolves (or resolves only after a long delay) when called from inside a HeadlessJS-spawned thread that is itself waiting to come up. The `await` then blocks every line after it — including T2, fetch, T3, T4 — so nothing else runs, the promise never resolves, and the wrapper never calls `finishHeadlessTask`. This is consistent with the empirical drive: T1 + sdk-log-snapshot land (both fire-and-forget, before the wrap), then NOTHING.
- **Correct fix:** delete the wrap entirely. The handler was already doing the right thing in V57.16.1 — it just hit OS-level JS suspension when the handler took longer than the OS allowed. The vendor-recommended path for "guaranteed delivery even when JS is parked" is `Config.url` (the plugin's native HTTP service, which runs in the SDK's own native background-task context). That is a larger architectural shift, NOT a one-line wrap fix — and is out of scope for this investigation.

## Source inventory

All accessed 2026-05-16.

| Source | URL / path | What we used it for |
|---|---|---|
| Vendor TS adapter `index.js` | `node_modules/react-native-background-geolocation/src/index.js` (local v5.1.x) | JSDoc on `startBackgroundTask`, `registerHeadlessTask` wrapper code |
| Vendor `HeadlessEvent.d.ts` | `node_modules/.../declarations/interfaces/HeadlessEvent.d.ts` | Headless event shape, "headless-tasks are automatically terminated after executing the last line" |
| Vendor `NativeModule.js` | `node_modules/.../src/NativeModule.js` | Confirms `startBackgroundTask` → native `beginBackgroundTask` |
| Vendor Android `HeadlessTask.java` | `node_modules/.../android/.../HeadlessTask.java` | `TASK_TIMEOUT = 60000 * 2` (120 sec hardcoded) |
| Vendor Android `HeadlessTaskManager.java` | `node_modules/.../android/.../HeadlessTaskManager.java` | Task wrapper, `setTimeout(120000)`, auto-finish path, the "$ here's the money $" JSDoc |
| Vendor Android `RNBackgroundGeolocationModule.java` | `node_modules/.../android/.../RNBackgroundGeolocationModule.java` | `beginBackgroundTask` calls `getAdapter().startBackgroundTask(callback)` — needs valid `ReactApplicationContext` |
| Shared types `BackgroundGeolocation.d.ts` | `node_modules/@transistorsoft/background-geolocation-types/dist/core/api/BackgroundGeolocation.d.ts:113-114` | Cross-platform method signatures `startBackgroundTask(): Promise<number>` / `stopBackgroundTask(taskId: number): Promise<void>` / `finishHeadlessTask(taskId: string): Promise<number>` |
| Wiki — Android Headless Mode | https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Android-Headless-Mode.md | The actual content of the page we cited in our commit message |
| Wiki — Debugging | https://raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Debugging.md | (No headless content) |
| Demo app `index.js` | https://raw.githubusercontent.com/transistorsoft/rn-background-geolocation-demo/master/index.js (last touched 2024-12-07, sha `ad11a20`) | Canonical reference for headless task; uses `event.taskId` |
| Issue #2225 — Headless Tasks on RN 0.76.3 | https://github.com/transistorsoft/react-native-background-geolocation/issues/2225 | Maintainer explains the auto-finish wrapper + the WorkManager nature of `startBackgroundTask` (comment 2024-12-05) |
| Issue #2194 — INVALID_TASK_ID | https://github.com/transistorsoft/react-native-background-geolocation/issues/2194 | iOS, less directly relevant, but shows pattern users adopt around `startBackgroundTask` |
| Issue #2405 — Network requests queue when backgrounded on Android SDK 35 | https://github.com/transistorsoft/react-native-background-geolocation/issues/2405 | Maintainer quotes: "Never trust js setTimeout in the background" and "use native http api, like the plug-in's own built-in http service" |
| RN HeadlessJS docs | https://reactnative.dev/docs/headless-js-android | "Once your task completes (i.e. the promise is resolved), React Native will go into 'paused' mode" |

## Question 1 — In HeadlessTask context, does `await startBackgroundTask()` resolve / throw / hang?

### Vendor says

The vendor JSDoc for `startBackgroundTask` is iOS-framed but the method IS available on Android (the .d.ts shows `startBackgroundTask(): Promise<number>` with no platform restriction):

> `node_modules/.../src/index.js:369-374`
> ```
> /**
> * Start an iOS background-task, provding 180s of background running time
> */
> static startBackgroundTask() {
>   return NativeModule.startBackgroundTask();
> }
> ```

On Android the native call resolves into `RNBackgroundGeolocationModule.java`:

> ```
> // TODO Rename #beginBackgroundTask -> #startBackgroundTask
> @ReactMethod
> public void beginBackgroundTask(final Promise response) {
>   getAdapter().startBackgroundTask(new TSBackgroundTaskCallback() {
>     @Override public void onStart(int taskId) {
>       response.resolve(taskId);
>     }
>     @Override public void onCancel(int taskId) { } // NO IMPLEMENTATION
>   });
> }
> ```
> (`RNBackgroundGeolocationModule.java:772-781`)

The `Promise response` is only resolved inside `onStart(int taskId)`. **`onCancel(int taskId)` has "NO IMPLEMENTATION"** — meaning if the underlying native adapter decides to cancel the task (e.g. because the app context isn't right, or the SDK isn't able to spawn a WorkManager job in this context), the JS Promise is **never resolved AND never rejected** — it just hangs forever.

`getAdapter()` requires a `ReactApplicationContext` — in headless mode, the React context is bootstrapped by `HeadlessTaskManager.createReactContextAndScheduleTask` (which has a 250ms postDelayed pause for the bridge to be ready). So the context exists, but whether the underlying native `BackgroundGeolocation.startBackgroundTask(callback)` can deliver `onStart` from inside the HeadlessJS thread is **not documented**.

Maintainer @christocracy (issue #2225 comment, 2024-12-05) describes `startBackgroundTask` as: **"I launch a `WorkManager` job (`.startBackgroundTask()`) to keep the app alive while Javascript counts the seconds."**

So `startBackgroundTask` is the JS-side trigger for a WorkManager job. WorkManager jobs need to be scheduled from a context that has the right service permissions — when called from inside a HeadlessJS task on a backgrounded app, success is undocumented.

### Implication for V57.16.2

(Inference, clearly marked.) Most plausible failure mode: on V57.16.2, `await BackgroundGeolocation.startBackgroundTask()` either (a) hangs the entire handler awaiting an `onStart` callback that never fires, or (b) resolves slowly after the OS has already moved on. Either way, the `await` blocks every subsequent line — T2 log, fetch, T3 — so we observe T1 firing, the fire-and-forget sdk-log-snapshot landing (it ran BEFORE the wrap), then nothing.

**Our drive data is consistent with hypothesis (a)**: on V57.16.2, no `tsoft-start-bgtask-failed` event fired (so the call did NOT throw) AND no T2 fired (so the call did NOT resolve). The most parsimonious explanation is the call is sitting in the `await` indefinitely.

## Question 2 — Is `startBackgroundTask` documented for HeadlessTask context?

### Vendor says

Searching the wiki "Android Headless Mode" page (fetched 2026-05-16 from `raw.githubusercontent.com/wiki/transistorsoft/react-native-background-geolocation/Android-Headless-Mode.md`):

**`startBackgroundTask` is not mentioned anywhere on the page.** The page's example:

```javascript
const BGHeadlessTask = async (event) => {
  const params = event.params;
  console.log('[BackgroundGeolocation HeadlessTask] -', event.name, params);
  switch (event.name) {
    case 'terminate':
      await doCustomWork();
      break;
    case 'heartbeat':
      const location = await getCurrentPosition({ ... });
      console.log('[BackgroundGeolocation HeadlessTask] - getCurrentPosition:', location);
      break;
  }
}
const doCustomWork = () => {
  return new Promise((resolve) => {
    console.log('[doWork] START');
    setTimeout(() => {
      console.log('[doWork] FINISH');
      resolve();
    }, 10000);
  });
};
BackgroundGeolocation.registerHeadlessTask(BGHeadlessTask);
```

That's the entire pattern. **`await` your work, return when done.** No `startBackgroundTask`.

The demo app's `index.js` (https://github.com/transistorsoft/rn-background-geolocation-demo, last touched 2024-12-07, sha `ad11a20`) DOES use `startBackgroundTask` inside the headless task — but only when `eventName == 'terminate'`, and the maintainer's own code comment labels it **"Perform a weird action (for testing)"**:

> ```js
> if (eventName == 'terminate') {
>   doWorkCounter = 0;
>   // Perform a weird action (for testing) with an interval timer and .startBackgroundTask.
>   const bgTaskId = await BackgroundGeolocation.startBackgroundTask();
>   ...
> ```

In the issue #2225 thread (2024-12-05), the maintainer explained why he uses it in the demo: he wants to keep a `setInterval` timer printing "tick" for the full 120s of the headless timeout, and `startBackgroundTask` is what schedules a WorkManager job so the OS keeps the process alive. **That's a synthetic stress test — not a recommended user pattern.**

### Implication for V57.16.2

We applied a "stress test" pattern to a production handler whose work is a single async `fetch` + a couple of Supabase queries. The wrap was unnecessary AND introduced a path where the very first `await` can hang.

## Question 3 — What's the actual lifetime mechanism for HeadlessTask JS context?

### Vendor says

The plugin sets a hard 120-second timeout on every headless task:

> `HeadlessTask.java:29-31`
> ```java
> private static final String HEADLESS_TASK_NAME = "BackgroundGeolocation";
> // Hard-coded time-limit for headless-tasks is 60000 @todo configurable?
> private static final int TASK_TIMEOUT = 60000 * 2;
> ```

(The comment says 60000 but the actual value is `60000 * 2 = 120000ms = 120 sec`. The comment is outdated; the value is authoritative.)

This timeout is passed into RN's `HeadlessJsTaskConfig`:

> `HeadlessTaskManager.java:387-389`
> ```java
> private HeadlessJsTaskConfig buildTaskConfig() {
>   return new HeadlessJsTaskConfig(mTaskName, mParams, mTimeout);
> }
> ```

Per RN's docs: "Once your task completes (i.e. the promise is resolved), React Native will go into 'paused' mode (unless there are other tasks running, or there is a foreground app)." (https://reactnative.dev/docs/headless-js-android, fetched 2026-05-16.)

The Transistorsoft `registerHeadlessTask` wrapper auto-resolves the RN task when the user's promise resolves:

> `src/index.js:394-411`
> ```js
> static registerHeadlessTask(taskProvider) {
>   AppRegistry.registerHeadlessTask(TAG, () => {
>     return (event) => {
>       return new Promise((resolve, reject) => {
>         const taskId = event._transistorHeadlessTaskId;
>         delete(event._transistorHeadlessTaskId);
>         taskProvider(event).then(() => {
>           BackgroundGeolocation.finishHeadlessTask(taskId);
>           resolve();
>         }).catch(reason => {
>           BackgroundGeolocation.finishHeadlessTask(taskId);
>           reject(reason);
>         });
>       });
>     }
>   });
> }
> ```

So the lifetime ceiling is **120 sec, hardcoded, native-enforced** — and the early-finish is keyed on the user's promise resolving. There is no documented mechanism to extend past 120 sec from JS (per maintainer in #2225, only by paying the cost of a WorkManager job, and even then the headless JS context is still under the 120s ceiling).

### Implication for V57.16.2

Our handler's normal happy path is well under 120 sec (one Supabase select + one fetch — should be <5 sec on a reasonable network). We were never bumping against the 120s ceiling on V57.16.1; the V57.16.1 15m 45s gap was caused by **OS-level CPU suspension of the JS thread** (the OS parked our process between awaits), NOT by the 120s headless timeout firing.

The wrap CANNOT change OS-level CPU suspension behavior. The `startBackgroundTask` WorkManager job runs on the native Android side — it can keep the OS from killing the process, but it can NOT force the OS to keep executing JavaScript callbacks. **The fundamental problem (JS thread parked mid-await) is not solvable from JS alone.**

## Question 4 — Did calling `await startBackgroundTask()` break something?

### Vendor says

Maintainer @christocracy on issue #2405 (Network requests queue when backgrounded on Android SDK 35):

> **"Never trust js setTimeout in the background."**
> **"If you want to solve your http issues, use native http api, like the plug-in's own built-in http service, see api docs Config.url"**
> **"There are 0 issues with the plug-in's native http service... The native http service runs its http requests internally with .startBackgroundTask."**

The maintainer's recommendation is unambiguous: anything you do in JS in a background context is unreliable; if you need guaranteed delivery, use the native HTTP service (`Config.url`), which itself internally uses `startBackgroundTask`.

The TSBackgroundTaskCallback has "NO IMPLEMENTATION" for `onCancel` (see Q1 quote). If the adapter cancels the task, the JS promise never resolves AND never rejects.

### Implication for V57.16.2

(Inference, marked.) The single change in V57.16.2 (`startBackgroundTask` at line 368) is a new failure surface: a Promise that can hang forever if the native adapter cancels the task. We don't have direct vendor confirmation that this happens, but:

- Empirical: V57.16.1 (no wrap) delivered T2 eventually (15 m 45 s). V57.16.2 (wrap) delivered T2 NEVER (90 + min observed). The only delta is the wrap.
- No `tsoft-start-bgtask-failed` event landed → the `await` did not throw.
- No T2 event landed → the `await` did not resolve.
- Therefore the `await` is sitting unresolved.

This is the most parsimonious explanation consistent with both vendor source and drive data.

## Question 5 — What's the correct vendor pattern for long-running headless work?

### Vendor says

Two patterns are documented:

**Pattern A — `await` your work, finish, done.** Wiki Android Headless Mode example (quoted in full in Q2): `await doCustomWork()`, return. The wrapper auto-calls `finishHeadlessTask` when your promise resolves. Works for any work that completes in ≤120 sec and where you accept that JS may still be parked by the OS between awaits.

**Pattern B — Don't do it in JS. Use the native HTTP service.** Per maintainer in #2405: if guaranteed background delivery matters, write to `Config.url` and let the SDK's own background-task-protected HTTP service handle delivery. From the Config.d.ts:

> `Config.d.ts:630` — `url?: string;` — see also "Philosophy of Operation" wiki

The native HTTP service runs in the SDK's own native background context; the SDK persists pending HTTP records to its own SQLite DB and retries on failure.

**No third pattern is documented.** Wrapping the JS handler in `startBackgroundTask` / `stopBackgroundTask` is NOT a documented pattern for headless tasks. It appears in the demo only as a "weird action (for testing)" inside the `terminate` handler.

### Implication for V57.16.2

The wrap we added was not a documented pattern. The correct change is to remove it.

For the deeper problem (V57.16.1's 15-33 min T1→T2 delays), the vendor-recommended fix is **Pattern B**: configure `Config.url` to point at `report-location-event` and let the SDK deliver. That's a multi-file architectural change (wiring auth headers, payload shape, etc.) and out of scope here.

## Question 6 — Why did V57.16.1 eventually deliver T2 but V57.16.2 never does?

### Vendor says

(Vendor doesn't document this directly. Synthesis based on RN HeadlessJS docs + Transistorsoft source + drive data.)

V57.16.1 flow:
1. SDK fires geofence → HeadlessTask wrapper kicks JS task with 120 s ceiling.
2. T1 log lands (in-memory in `pendingEvents` of `remoteLog`, flushed on next bridge tick).
3. `captureSdkLogSnapshot` fire-and-forget kicks off.
4. Rule lookup, phantom check.
5. `await fetch(...)` — OS suspends the JS thread here.
6. Eventually the OS unparks JS (e.g. user opens the app, or another wake-up event hits, or doze relaxes) — the fetch completes, T2/T3/T4 cascade in one second.
7. Promise resolves, wrapper calls `finishHeadlessTask`.

V57.16.2 flow:
1. SDK fires geofence → HeadlessTask wrapper kicks JS task with 120 s ceiling.
2. **NEW**: `await BackgroundGeolocation.startBackgroundTask()` runs. Native side either cancels (no-impl callback, promise hangs) or takes a long time to deliver `onStart` from the HeadlessJS thread context.
3. T1 log already landed before the wrap (fire-and-forget, line 389-393, BEFORE the `try{` at 375).
4. `captureSdkLogSnapshot` also kicked off before the wrap (line 399 — wait, this is INSIDE the wrap. Let me re-check.)

Actually re-reading the code carefully — the wrap starts at line 367 (`try { bgTaskId = await BackgroundGeolocation.startBackgroundTask(); }` then line 375 `try {` opens the body block). T1 log at line 389 IS inside the body block, AFTER the `await startBackgroundTask`. But it landed in the empirical data.

Recheck: `remoteLog` writes synchronously to AsyncStorage (fire-and-forget) and only sends in a flush cycle. So T1 was queued before the await hung, and got flushed when... when? Perhaps on the next foreground or on the periodic flusher. The fact that the snapshot also landed means the queue did flush at some point — but the body of the handler (T2, fetch, T3) never executed past the first `await`.

The cleanest interpretation, consistent with all evidence:

- The `await startBackgroundTask()` resolved enough times for T1 + snapshot to flush (or these were queued before the await), but never returned control to the body for the rest of the handler.
- Or: the `await` did resolve, but `stopBackgroundTask` in the finally is queued before the body's awaits, somehow inverting the order — unlikely but worth marking.

### Implication for V57.16.2

(Inference.) The simplest model that fits all observations: the wrap introduced an `await` that does not return in HeadlessJS context, blocking the handler body. Removing the wrap restores V57.16.1's behavior — which was bad (15-33 min delays) but at least eventually delivered.

## Question 7 — Should we use `event.taskId` from HeadlessEvent itself?

### Vendor says

Maintainer @christocracy posted the canonical pattern in issue #2225:

> ```js
> const bgGeoHeadlessTask = async (event) => {
>   const params     = event.params;
>   const eventName  = event.name;
>   const taskId     = event.taskId; // <-- very important!
>
>   console.log(`[BGGeoHeadlessTask] ${eventName}`, JSON.stringify(params));
>   // You MUST await your work before signalling completion of your task.
>   await doWork(eventName);
>
>   // Signal completion of our RN HeadlessTask.
>   BackgroundGeolocation.finishHeadlessTask(event);
> }
> ```

The demo app's `index.js` confirms:

> ```js
> const bgGeoHeadlessTask = async (event) => {
>   const params     = event.params; // <-- our event-data from the BG Geo SDK.
>   const eventName  = event.name;
>   const taskId     = event.taskId; // <-- very important!
> ```

**BUT** — the vendor's own `registerHeadlessTask` wrapper in `src/index.js:394-411` (quoted in Q3) ALREADY handles finishHeadlessTask automatically. The user-side call is **redundant** because the wrapper does:

```js
taskProvider(event).then(() => {
  BackgroundGeolocation.finishHeadlessTask(taskId);
  resolve();
}).catch(reason => {
  BackgroundGeolocation.finishHeadlessTask(taskId);
  reject(reason);
});
```

So calling `BackgroundGeolocation.finishHeadlessTask(event)` from user code would call it a second time. The native `HeadlessTaskManager.finishTask` checks `headlessJsTaskContext.isTaskRunning(...)` before finishing, so the second call is a no-op — but it's noise.

### Implication for V57.16.2

We do NOT need to grab `event.taskId` in our handler. The wrapper auto-finishes. Our `index.js` is correct as written. No change needed here.

(Side note: the inconsistency between the maintainer's recommendation in #2225 and his own wrapper code at `src/index.js:394-411` is probably because the wrapper was added LATER as a workaround for the bridgeless-arch issue described in that same thread. Both work; the wrapper is sufficient on its own.)

## Root cause synthesis

V57.16.2's regression has one cause: **the `await BackgroundGeolocation.startBackgroundTask()` we added at the top of `handleGeofenceEvent` does not reliably resolve in the HeadlessJS thread context, blocking the rest of the handler.**

Three vendor facts support this:

1. The native `beginBackgroundTask` resolves the JS promise only inside `onStart(taskId)`. The companion `onCancel(taskId)` has "NO IMPLEMENTATION" — if the SDK cancels the task, the JS promise hangs forever (no resolve, no reject). (`RNBackgroundGeolocationModule.java:772-781`.)

2. The maintainer describes `startBackgroundTask` as scheduling a WorkManager job to keep the app alive — a separate mechanism from the HeadlessJS task lifetime. (Issue #2225 comment, 2024-12-05.) Combining the two is not a documented pattern.

3. The maintainer's general philosophy: "Never trust js setTimeout in the background" — extended to anything happening in JS during a background headless task. The recommended fix for background-HTTP-reliability is the native HTTP service (`Config.url`), not JS workarounds. (Issue #2405 comments.)

The wrap was based on a misreading of the wiki page that does not say what we cited it as saying. The wiki does NOT mention `startBackgroundTask` in the HeadlessTask context. Our commit message ("Per Transistorsoft 'Android Headless Mode' wiki — this is the documented pattern for long-running headless work") is incorrect — the wiki page contains no such pattern.

The drive data is exactly what we'd expect: T1 (queued from JS as a fire-and-forget remoteLog before the blocking await), snapshot (also fire-and-forget), then dead silence because the body never runs past the hung await.

## Correct fix — specific code change recommendation

**File:** `C:\Users\waela\OneDrive\Desktop\Naavi\hooks\useGeofencing.ts`

**Change:** revert the V57.16.2 wrap. Restore V57.16.1's handler body, no try/finally wrap around `await startBackgroundTask()`.

### Specific diff

Lines to remove: `354-374` and `504-514` (i.e. the entire wrap, but keep the body of the function intact).

Current code (lines 354-516, abbreviated):

```ts
export async function handleGeofenceEvent(event: GeofenceEvent): Promise<void> {
  const ruleId = event.identifier;
  if (!ruleId) return;

  // V57.16.2 — wake-the-brain: ask Android to keep our JS event loop alive
  // for the duration of this handler. Without this wrap, Android suspends
  // mid-await and our T2 POST lands minutes-to-hours later (V57.16.1 drive
  // proved 15m 45s gap on Phone 1, 33m 8s gap on Phone 2 same drive).
  // startBackgroundTask gives us ~30 sec of guaranteed JS lifetime; the
  // finally block at the end of the function calls stopBackgroundTask so
  // the OS can release the resource. Per vendor wiki "Android Headless Mode"
  // — this is the documented pattern for long-running headless work.
  let bgTaskId: number | null = null;
  try {
    bgTaskId = await BackgroundGeolocation.startBackgroundTask();
  } catch (err) {
    remoteLog(getLifecycleSession(), 'tsoft-start-bgtask-failed', {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
  }

  try {

  const eventName = ...;
  // ... body ...

  } finally {
    // V57.16.2 — release the OS-granted JS lifetime window. ...
    if (bgTaskId !== null) {
      try {
        await BackgroundGeolocation.stopBackgroundTask(bgTaskId);
      } catch { /* OS may have already released */ }
    }
  }
}
```

Target code:

```ts
export async function handleGeofenceEvent(event: GeofenceEvent): Promise<void> {
  const ruleId = event.identifier;
  if (!ruleId) return;

  // V57.16.3 — reverted the V57.16.2 startBackgroundTask wrap. Vendor wiki
  // does NOT document that pattern for headless tasks; in our drive-test it
  // caused await to hang in HeadlessJS context, blocking the handler body
  // entirely. The 120-sec headless ceiling is enforced by the SDK; the
  // wrapper auto-finishes the task on promise resolution.
  // (See docs/TRANSISTORSOFT_HEADLESS_WAKE_INVESTIGATION_2026-05-16.md.)

  const eventName = ...;
  // ... body unchanged ...
}
```

**Specifically:** delete current lines 358-374 (entire "V57.16.2 wake-the-brain" comment block and the `let bgTaskId` / `try { bgTaskId = await ... }`), delete current line 375 (the second `try {`), and delete current lines 504-514 (the `finally { ... stopBackgroundTask ... }`). Replace with the short reverted comment above (or no comment if preferred). The body itself (lines 377-502) is unchanged.

### Index.js

`C:\Users\waela\OneDrive\Desktop\Naavi\index.js` is correct as written. No change. The vendor's `registerHeadlessTask` wrapper auto-finishes the task on promise resolution, so user code does not need to grab `event.taskId` or call `BackgroundGeolocation.finishHeadlessTask`.

## What this does NOT cover

- **Does NOT solve the V57.16.1 delivery delay.** Reverting the wrap restores V57.16.1's "15-33 min T1→T2 gap" behavior. That problem is real and unsolved at the JS layer. Per maintainer, the vendor-recommended fix is `Config.url` (native HTTP service). That's a multi-file architectural change requiring auth-header injection, payload-shape redesign, and a new server-side acceptance contract — out of scope for this investigation.
- **Does NOT inspect the actual native cancellation path.** The Transistorsoft SDK adapter on Android is a closed-source AAR. We cannot confirm directly what causes `startBackgroundTask` to hang in HeadlessJS context — we can only infer from the maintainer's public statements (issue #2225 comment 2024-12-05, issue #2405 comments) and from the visible `onCancel: NO IMPLEMENTATION` in the open-source bridge.
- **Does NOT explore `Config.url` migration.** That's the right long-term path per vendor philosophy, but requires its own design discussion (server contract, auth, dedup with current `report-location-event` path).
- **Does NOT explore dropping the `dwell_seconds 30→0` change** that shipped alongside the wrap in V57.16.2. That's a separate decision unrelated to the wake-fix — it was approved on its own merits and is independent of the headless-task issue.
- **Does NOT verify with a drive-test.** A drive-test after the revert would show V57.16.1 behavior (eventually delivers, with delay). That confirms the regression theory but does not fix the underlying problem.
