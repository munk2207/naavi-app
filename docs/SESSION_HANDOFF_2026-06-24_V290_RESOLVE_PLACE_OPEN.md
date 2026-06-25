# Session Handoff — 2026-06-24 — V290 APK Resolve-Place + Geofence

## Status at session end

- Active APK: **V290 staging** (`ca.naavi.app.staging`)
- Production AAB: V290 (submitted last session — geofence broken due to Battery Optimization reset, not a code bug)
- Branch: `main`

---

## What was done this session

### 1. resolve-place — three fixes deployed to staging (NOT yet working)

Root cause investigated: commit `fb29387` (2026-05-16) added a 3-check gate to `geocodeBestCandidate`. Gate 2 was rejecting legitimate addresses.

**Commits deployed to staging (`xugvnfudofuskxoknhve`):**

| Commit | Fix |
|--------|-----|
| `5322244` | Remove `partial_match` from Gate 2 — was rejecting valid ROOFTOP/RANGE_INTERPOLATED results when query text didn't exactly match canonical name ("Jeanne d'arc blvd" vs "Jeanne-d'Arc Blvd N") |
| `9929029` | Add `region=ca` to geocode HTTP request so Google biases to Canada. Fix retry logic: `parts.slice(-2)` on 2-part home_address ("962 Terranova Dr, Ottawa") returned full string instead of city only |

**Result: still returning `not_found` for "8210 Jeanne d'arc blvd".** Three attempts, all failed.

### 2. Settings address verification — SHIPPED (commit `d0be27f`)

`app/settings.tsx` — `verifyAndSaveAddress` helper now calls `resolve-place` with `use_geocoding: true` before saving home/work address. Previously accepted any text including "ABC". Needs a new staging APK build to test.

### 3. Production Battery Optimization — NOT a code bug

Production AAB V290 geofence broke immediately after install. Root cause: Android resets Battery Optimization to "Optimized" when a new AAB is installed. Fix: Settings → Battery → Battery Optimization → Naavi → Unrestricted. No code change needed.

---

## OPEN — Primary task for next session

### Fix geofence in APK V290 (staging)

User confirmed: production was working perfectly before V290 APK. V290 APK didn't touch geofence code. But after V290 → production AAB migration, geofence broke.

**Two separate issues:**
1. **Production AAB geofence** — Battery Optimization reset to Optimized on install. Fix: set Unrestricted manually. *(not a code bug)*
2. **Staging APK V290 geofence** — unknown if broken. Next session should verify: does the geofence actually fire correctly on the staging APK?

---

## OPEN — resolve-place still broken for numeric addresses

**Symptom:** "Alert me when I arrive at 8210 Jeanne d'arc blvd" → "I couldn't find it"

**What's been ruled out:**
- Staging APK IS calling staging Supabase (eas.json confirmed: `EXPO_PUBLIC_SUPABASE_URL = xugvnfudofuskxoknhve`)
- Mobile orchestrator calls resolve-place directly via `fetchWithTimeout` with `user_id` + `place_name`
- Gate 2 partial_match removed ✓
- Region hint added ✓
- Retry city extraction fixed ✓

**Still unknown:** What does Google actually return for "8210 Jeanne d'arc blvd" with region=ca? Need to see staging Supabase logs for resolve-place to know which gate is failing. Check: Supabase Dashboard → project `xugvnfudofuskxoknhve` → Edge Functions → resolve-place → Logs.

**Next session approach:**
1. Check staging resolve-place logs immediately after a test call to see the exact gate rejection log line
2. If Google returns APPROXIMATE (not ROOFTOP/RANGE_INTERPOLATED), add a fallback to Places Text Search WITH location bias (home coords) for numeric addresses that fail geocoding
3. Location bias prevents the wrong-address problem that motivated fb29387 in the first place

**Key code location:** `supabase/functions/resolve-place/index.ts` — `geocodeBestCandidate` function (~line 370)

---

## Website (seo-preview-3 branch)

- `/discover/remember-important-things.html` — committed on `seo-preview-3` branch
- Remaining 9 SEO feature pages still to build
- Branch NOT merged to main yet

---

## Build needed

A new staging APK build is needed after resolve-place is confirmed working to pick up:
- Settings address verification fix (`d0be27f`)
- Any resolve-place changes from next session

Do NOT build production AAB until:
1. Staging APK geofence confirmed working
2. resolve-place numeric address confirmed working
3. All four gates pass
