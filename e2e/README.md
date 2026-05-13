# MyNaavi — Maestro mobile UI tests

Mobile-runtime tests that catch bugs the server-side `npm run test:auto` cannot.

## Setup

See `docs/MAESTRO_SETUP.docx` (Word) for the one-time install of Android
Studio + emulator + Maestro CLI.

## Running

```powershell
# Make sure the Naavi-Test emulator is running.
# Make sure MyNaavi (the production AAB) is installed on it.
maestro test e2e/

# Or one specific scenario:
maestro test e2e/02-five-consecutive-typed-sends.yaml

# With a fresh launch each time and screenshots on failure:
maestro test e2e/ --format junit
```

## What each scenario catches

| Scenario | Bug class it would have caught |
|----------|-------------------------------|
| `01-smoke-launch.yaml` | App fails to render home / brief |
| `02-five-consecutive-typed-sends.yaml` | **V57.9.5 connection-pool leak** |
| `03-typed-then-voice-then-typed.yaml` | Mode-switching state issues |
| `04-voice-record-stop-transcribe.yaml` | Voice path latency / audio focus |
| `05-force-close-survive-auth.yaml` | **V57.9.7 auth-cache-empty-after-install** |
| `06-spend-summary-anthropic.yaml` | SPEND_SUMMARY action wiring + answer correctness |
| `07-collapse-expand-toggle.yaml` | **V57.9.7 collapse one-way bug** |
| `08-create-list.yaml` | LIST_CREATE prompt routing (caught by prompt v47 too) |
| `09-clear-chat.yaml` | Clear-chat action lock state |
| `10-settings-version-line.yaml` | Settings page renders + version string correct |
| `11-draftcard-send-regression.yaml` | DRAFT card send button regression |
| `12-multi-location-picker.yaml` | Multi-candidate location picker UI |
| `13-bubble-no-truncation.yaml` | Chat bubble text-truncation cosmetic |
| `14-lists-screen-tabs.yaml` | **Wave 2 Phase B** — Lists screen + All/Attached/Standalone tabs render & respond to taps |
| `15-list-detail-attached-section.yaml` | **Wave 2 Phase B** — list-detail Items + Attached to + Delete sections |
| `16-alerts-attached-card.yaml` | **Wave 2 Phase C** — alert-detail "Attached list(s)" card in expanded row |
| `17-settings-multi-phone.yaml` | **Wave 2 Phase E** — Settings shows pluralised "Your Phone Numbers" + Primary + Add a backup phone |

Bugs that **Maestro still cannot catch** (need real-device manual testing):
- OS-level Doze / battery optimization (geofence delay)
- Twilio voice call flow (different surface)
- Cellular vs Wi-Fi network conditions

## Conventions

- Each scenario starts with `appId: ca.naavi.app`.
- Always begin with `clearState` so prior runs don't pollute the test.
- Use `assertVisible` with stable text (button labels, headings) — avoid
  exact timestamps or other dynamic strings.
- Wait timeouts default to 10s. Override with `optional: true` for
  best-effort assertions.
- All scenarios assume the `Wael (auto-tester)` Google account is signed
  into the emulator's Google account. The first run after a clean
  install requires a manual sign-in.
