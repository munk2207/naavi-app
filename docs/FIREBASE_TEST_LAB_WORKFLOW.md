# MyNaavi — Firebase Test Lab Workflow

*Last updated: 2026-05-28. Update this doc whenever the robo scripts or notification setup changes.*

---

## Two test systems — what each one does

### Auto-tester (`npm run test:auto`)

**What it tests:** The SERVER — Claude's brain, the database, and the Edge Functions.

Examples of what it catches:
- Does Claude emit the right action when Wael says "alert me at Walmart"?
- Does the database reject a duplicate location alert?
- Does multi-user data stay isolated (Wael's data never leaks to Huss)?
- Is the prompt version correct after a deploy?
- Does the confirm-then-act gate block unauthorized state changes?

**What it does NOT test:** The mobile app itself. It never installs the APK. It never taps a screen. It never renders a pixel.

**How it runs:** On Wael's Windows machine. Makes HTTP calls to Supabase Edge Functions. Takes ~4 minutes. 165 tests. Must be 100% green before any AAB build (CLAUDE.md Rule 15).

---

### Firebase Test Lab

**What it tests:** The MOBILE APP (the APK) — on real Android devices inside Google's cloud.

Examples of what it catches:
- Does the app install cleanly on a Samsung Galaxy vs a Pixel?
- Does the UI render correctly on a small screen vs a large one?
- Does the app crash on Android 12 vs Android 14?
- Do the buttons tap? Do the scrolls work?
- Does the sign-in flow complete without hanging?

**What it does NOT test:** Server logic, Claude prompt behavior, database rules, or Edge Functions. It only sees what a user sees on screen.

**How it runs:** You upload the APK to Firebase Console, select the robo script, pick the test devices, and submit. Google runs the test on real hardware in their data center. Takes 15–30 minutes. Sends you an SMS when done.

---

## When to run each

| Build event | Auto-tester | Firebase Test Lab |
|---|---|---|
| Server-side change only (Edge Function deploy, prompt update) | ✅ Run | ❌ Skip (no app change) |
| New AAB / APK build | ✅ Run first | ✅ Run after APK is ready |
| Keyboard / UI fix | ✅ Run | ✅ Run (device rendering matters) |
| New feature with both server + mobile changes | ✅ Run | ✅ Run |

**Order:** Auto-tester first (fast, catches server bugs). Firebase Test Lab second (slow, catches device bugs). Never submit AAB to Google Play until both pass.

---

## Firebase Test Lab — step-by-step workflow

### What you need (already set up — no action required)

- **APK file** — built via `eas build --profile preview`
- **Robo scripts** — `firebase/robo-script-onboarding.json` (full flow) or `firebase/robo-script.json` (minimal)
- **Service account** — `firebase/service-account.json`
- **SMS notification script** — `scripts/notify-on-test-complete.js`
- **Credentials** — `scripts/.env` (Twilio + Firebase project ID)

---

### Step 1 — Open Firebase Console

Go to: **https://console.firebase.google.com/project/mynaavi-3b74b/testlab**

---

### Step 2 — Run a new test

1. Click **Run a test**
2. Select **Robo test**
3. Upload the APK (the `.apk` file from the EAS build link)
4. Under **Robo script**, click **Add files** → upload `firebase/robo-script-onboarding.json`
5. Under **Select devices**, choose the reference devices (Samsung Galaxy S series + Pixel recommended)
6. Click **Start tests**

---

### Step 3 — Copy the Matrix ID

After starting, the Firebase Console URL will look like:

```
https://console.firebase.google.com/project/mynaavi-3b74b/testlab/histories/.../matrices/matrix-XXXXXXXXX/...
```

Copy the **Matrix ID** from the URL — it looks like `matrix-38et6ig33rjpf`.

---

### Step 4 — Start the SMS notification

On Wael's Windows machine, open PowerShell in the Naavi project folder and run:

```
node scripts/notify-on-test-complete.js matrix-XXXXXXXXX
```

Replace `matrix-XXXXXXXXX` with the Matrix ID you copied in Step 3.

The script will:
- Poll Firebase Test Lab every 30 seconds
- Print the state in the terminal
- Send you an SMS from Naavi (+1 249 523 5394) to your phone (+1 613 769 7957) when done

---

### Step 5 — Read the SMS

You will receive one of:

- `MyNaavi Firebase Test Lab ✅ PASSED — matrix-XXXXXXXXX` → safe to proceed to AAB
- `MyNaavi Firebase Test Lab ❌ FAILED — matrix-XXXXXXXXX` → open Firebase Console, review the failure screenshots and logs, fix before AAB

---

### Step 6 — Review results in Firebase Console

Whether passed or failed, open the matrix in Firebase Console and check:
- **Screenshots** — does every screen render correctly?
- **Crash log** — any ANR (App Not Responding) or crash?
- **Robo actions** — did the script reach the chat input and type the test message?

---

## Test user

Firebase Test Lab uses a dedicated app account so real user data is never touched:

- **Email:** `firebase-testlab@mynaavi.com`
- **Name:** Test Lab
- **No phone, no morning call, no Google OAuth** — SMS alert channel only

The app has a **"Test Lab Sign In"** button (visible only during Test Lab runs) that signs in as this user automatically — bypassing the Google OAuth flow which Test Lab cannot complete.

If this user is ever deleted from Supabase, re-create it:

```
node tmp/create-testlab-user.js
```

---

## Files reference

| File | Purpose |
|---|---|
| `firebase/robo-script-onboarding.json` | Full 12-step Robo test (sign in → settings → chat) |
| `firebase/robo-script.json` | Minimal Robo test (sign in only) |
| `firebase/service-account.json` | Google Cloud service account for polling the Test Lab API |
| `scripts/notify-on-test-complete.js` | SMS notification script — run after submitting a test |
| `scripts/.env` | Twilio + Firebase credentials (gitignored) |
| `tmp/create-testlab-user.js` | One-time script to create the test user in Supabase |

---

## Known history

- **matrix-38et6ig33rjpf** — first confirmed successful run. SMS received by Wael. ✅ PASSED.
- The workflow was built and worked but was never documented until 2026-05-28.
