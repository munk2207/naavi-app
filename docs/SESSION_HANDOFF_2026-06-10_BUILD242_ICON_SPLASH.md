# Session Handoff — 2026-06-10 — Build 242 — Icon & Splash

## Status at close

- **Auto-tester:** 234/234 green ✅
- **Firebase Test Lab:** Console confirmed green ✅ (Pixel 6 + Galaxy S22)
- **Latest commit on main:** `5553062` — reduce home icon brain size
- **Production AAB:** NOT YET BUILT — icon and splash still need fixing

---

## What was completed this session

- ✅ Removed `puppeteer` from `package.json` (was breaking EAS builds)
- ✅ Added `icon.png` — 1024x1024, teal brain, black circular background, baked in
- ✅ Added `adaptive-icon.png` — 1024x1024, transparent background, teal brain 400px (needs fix — see below)
- ✅ Added `splash.png` — brain + MyNaavi text centered as one unit
- ✅ `app.json` — added `icon`, `splash`, `adaptiveIcon` config
- ✅ Updated CLAUDE.md Rule 15b — Firebase console must be checked, not SMS alone
- ✅ Closed B4k (HubSpot retired)
- ✅ Discussed 4 YouTube demo videos (no scripting — live Naavi responses only)

---

## TWO THINGS TO FIX NEXT SESSION (before production AAB)

### 1. Home screen icon — background not black

**What Wael sees:** Teal-colored icon on home screen instead of black background with teal brain.

**Root cause (observation):** `adaptive-icon.png` has transparent background + `backgroundColor: "#0D0D0D"` in app.json. The emulator/launcher is NOT applying the backgroundColor reliably — showing teal instead of black.

**Fix ready but not committed:** `adaptive-icon.png` was regenerated with **dark background baked in** (same as `icon.png`) — no longer relying on `backgroundColor`. The change is in `git stash` — run `git stash pop` then commit.

```
git -C "C:\Users\waela\OneDrive\Desktop\Naavi" stash pop
git -C "C:\Users\waela\OneDrive\Desktop\Naavi" add assets/adaptive-icon.png
git -C "C:\Users\waela\OneDrive\Desktop\Naavi" commit -m "fix adaptive icon — bake dark background in, no longer relies on backgroundColor"
git -C "C:\Users\waela\OneDrive\Desktop\Naavi" push origin main
```

### 2. Splash screen — text not showing (only brain)

**What Wael sees:** Only the brain logo on splash, no "MyNaavi" text.

**Root cause (inference):** On Android 12+ (API 34 = emulator), the **native** splash screen shows only an icon. The **Expo JS splash** (which renders the full `splash.png` with text) only appears if `SplashScreen.hideAsync()` is called from JS after fonts/assets load. If the app loads fast, the native splash is what users see.

**Investigate first:** Check `app/_layout.tsx` for `SplashScreen.preventAutoHideAsync()` and `SplashScreen.hideAsync()`. If missing, add them. Also check if `expo-splash-screen` is wired up in `app.json` plugins.

**`splash.png` file is correct** — brain + MyNaavi text centered as one unit, confirmed with pixel analysis (6,570 non-background pixels in text area).

---

## Files committed this session (on main)

| Commit | Description |
|--------|-------------|
| `5553062` | reduce home icon brain size — more padding from circle edge |
| `51c9b51` | fix splash — center brain+text as one unit to prevent Android crop |
| `8ed87b7` | reduce adaptive icon brain size — 400px on 1024px canvas |
| `023be16` | reduce splash brain size |
| `d1133f0` | fix adaptive icon padding + splash text |
| `a8d4922` | fix adaptive icon — transparent foreground |
| `39a53e9` | update Rule 15b — Firebase console verification |
| `bb507b1` | remove puppeteer from package.json |
| `2b0036d` | build 242 — all B6/B3/F2 fixes + icon/splash assets |

---

## Production AAB sequence (when icon + splash confirmed)

1. `npm run test:auto` — must be 100% green
2. Build preview APK → install on emulator → confirm icon (black bg, teal brain) + splash (brain + MyNaavi text)
3. Firebase Test Lab → console verified green
4. From `C:\Users\waela\naavi-mobile`:
   ```
   npx eas build --platform android --profile production --auto-submit --non-interactive
   ```

---

## Holding list review (next session agenda)

- Review `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md`
- Priority items: B6h (DELETE_RULE silent failure), B4w ("Here's my best reading" still firing), B6g (voice location alert missing coordinates)

---

## 4 YouTube demo videos (discussed, not started)

All 4 videos: live Naavi responses, no scripting, no Wael on camera.

1. **Multi-App Chain** — "Send Hussein the grocery list" (contacts + lists + WhatsApp)
2. **Location Alert** — geofence demo via Android emulator GPS mock
3. **Email Intelligence** — "What bills do I have coming up?"
4. **Morning Brief** — live call recording

Geofence demo approach: Android emulator → Extended Controls (⋮) → Location → manually set GPS coordinates to trigger arrival alert. No real drive needed.
