# Session Handoff — 2026-06-01 | Build 220

## Build 220 (V57.36.0) — What Shipped

### Mobile (AAB + APK)
- `app/help.tsx` — "Report a problem" row removed from Help screen
- `app/settings.tsx` — "Open Support" button removed (staff use staff.mynaavi.com directly)
- Briefings settings page wired (Settings → Manage Briefings → staff.mynaavi.com)

### Server-side (no AAB needed — already live)
- **HubSpot fully removed** — Postmark replaces it for all ticket emails
- `ingest-ticket` — sends customer acknowledgment email + staff notification via Postmark
- `analyze-ticket` — draft saved to Supabase only (no HubSpot)
- `send-ticket-reply` — staff sends reply to customer via Postmark
- `check-ticket-replies` — cron every minute, reads Support label in Gmail, appends customer replies to ticket thread
- `dispatch-ticket-analysis` — skip test domain emails, skip already-drafted tickets
- `hubspot-ticket-closed` — webhook deployed (kept for cleanup reference, HubSpot no longer primary)
- DB: `replies JSONB` + `assigned_to` columns added to `tickets`
- DB: `brief_windows JSONB` column added to `user_settings`
- DB: `support_staff` table — `mynaavi2207@gmail.com` is sole authorized staff

### Staff Portal (staff.mynaavi.com — separate Vercel deployment)
- `staff.mynaavi.com` — staff portal home, walled: token + support_staff check required
- `staff.mynaavi.com/support` — ticket management: list, detail, reply, close
- GitHub repo: `munk2207/naavi-staff` (private)
- DNS: Cloudflare auto-configured via Vercel

### Website (mynaavi.com)
- "Report a problem" removed from all page footers (shared.js)
- "Report a problem" removed from faq.html
- `support.html` removed (moved to staff.mynaavi.com)

### Ticket system — end-to-end flow (no HubSpot)
1. Customer submits via web form OR staff creates via Naavi chat
2. `ingest-ticket` → saves ticket → Postmark sends acknowledgment to customer + staff notification
3. `dispatch-ticket-analysis` → `analyze-ticket` → draft saved to `tickets.draft_response`
4. Staff opens `staff.mynaavi.com/support` → reads draft → edits → Send Reply
5. `send-ticket-reply` → Postmark sends to customer → appends to `tickets.replies`
6. Customer replies → lands in Support Gmail label → `check-ticket-replies` picks it up → appends to thread → notifies staff
7. Staff closes ticket → status = 'closed'

### Postmark status
- Account under review (test mode). Outbound to `support@mynaavi.com` (staff) works.
- Customer emails (external addresses) will deliver once Postmark approves the account.
- No code changes needed when approved — it will just work.

### Briefings
- `brief_windows JSONB` in `user_settings` — 4 windows (morning/midday/evening/night)
- `trigger-morning-call` generalized to fire all enabled windows
- `mynaavi.com/briefings` — web settings page for channel + time per window

---

## Priority 1 — Test Build 220

Install from Google Play Internal Testing. Verify:

1. **Help screen** — "Report a problem" is gone
2. **Settings** — "Open Support" button is gone, "Manage Briefings" button is present
3. **Briefings page** — opens `mynaavi.com/briefings`, loads 4 windows with correct settings
4. **Ticket creation** — say "Open a ticket for wael.aggan@gmail.com — test" in chat:
   - Confirmation bubble shows clean text only (no JSON, no PENDING_INTENT visible)
   - No pre-search card (blue magnifier) shown after confirmation
   - Say yes → "Done. Ticket #XXXX created"
5. **Version** — Settings shows V57.36.0 (build 220)

---

## Priority 2 — WebView Migration (Alerts, Lists, Notes)

⭐⭐⭐ **CRITICAL RULE — NO MODIFICATION BETWEEN MOBILE AND WEBVIEW**

The web pages must be **pixel-for-pixel identical** to the current native mobile screens in:
- Layout and structure
- All data displayed
- All actions available (add, edit, delete, toggle)
- All labels and copy

**Do NOT:**
- Add features the native screen doesn't have
- Remove features the native screen has
- Change the visual design, colors, or font sizes
- Reorder items or sections
- Change any label text

**The only difference allowed:** the web page renders in a browser; the native screen renders in the app. Everything else is identical.

**Implementation pattern** (same as briefings.html and staff portal):
- Auth via token in URL (JWT from `supabase.auth.getSession()`)
- Supabase REST API for data reads/writes
- Same CSS variables and font stack as mynaavi.com
- Mobile three-dot menu items route to WebView via `Linking.openURL`

**Screens to migrate (in order):**
1. **Alerts** — list of `action_rules`, toggle enabled/disabled, delete
2. **Lists** — list of lists, view items, add/remove items
3. **Notes** — list of Drive notes, view content

**Each screen requires:**
- New web page on `mynaavi.com` (or subdomain TBD with Wael)
- Read the CURRENT native screen code before writing a single line of web code
- Mobile three-dot menu item → opens web page via `Linking.openURL` with token
- Auto-tester test for the page load

**AAB required** for the mobile three-dot menu wiring.

---

## Open items

- Postmark account approval (no action needed — waiting)
- Firebase Test Lab — still on hold (Rule 15b)
- HubSpot trial ends ~June 3 — no action needed, system is fully off HubSpot
- `staff.mynaavi.com` DNS propagation — should be complete

## Repos
- Mobile app: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: main)
- Staff portal: `C:\Users\waela\OneDrive\Desktop\naavi-staff` (branch: main)
- Website: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website` (branch: main)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (branch: main)
