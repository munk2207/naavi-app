-- F25 — FAQ rebuild: one stored record replacing three hand-written copies.
-- (2026-09-02. Phases 0/1/1A/2/3 approved; Phase 2 §7a carries the Phase 3
-- mandated amendments this file implements.)
--
-- ── What this replaces ─────────────────────────────────────────────────────
-- The FAQ is authored as markup, in three places, with no source of record:
--   mynaavi-website/faq.html   23 answers as HTML, plus the SAME 23 again as
--                              flat text in a hidden block (lines 17-208)
--   lib/faq.ts                 12 of them again, as a TypeScript keyword table
--
-- Its own header (lib/faq.ts:6-12) instructs a human to keep it in sync.
-- Nothing enforces that. Eleven questions added since were never added there,
-- so the app's support forms cannot suggest them at all.
--
-- ── Layers, per CLAUDE.md DATA INTEGRITY ───────────────────────────────────
-- L1  UNIQUE on the LOGICAL key (slug), not just the surrogate id. The slug is
--     also the public anchor: mynaavi.com/faq#<slug>. The mobile app deep-links
--     12 of them (lib/faq.ts:126 FAQ_BASE_URL + faqUrl()), so a slug is a
--     published address, not an internal detail. NOT NULL + CHECKs on every
--     column the application logic depends on.
-- L2  ONE write entry point: the manage-faq Edge Function. No client INSERTs.
-- L3  RLS denies every client role. Reads go through get-faq, writes through
--     manage-faq, both service_role. This is Phase 1A option B, chosen over an
--     RLS public-read policy so that what is public is stated in code and
--     cannot drift by someone adding a column.
-- L4  categories is an array on the row, not a join table with one row per
--     category — a question genuinely belongs to several at once (Wael,
--     2026-09-02) and the one-row-per-value shape is the footgun L4 exists to
--     remove.
-- L5  tests/catalogue/faq.ts (Rule 15a).
--
-- ── Idempotent; safe to run twice. ─────────────────────────────────────────

-- ── Categories: data, not code ─────────────────────────────────────────────
-- Wael, 2026-09-02: "avoid limitation if we need to add more classes". A fixed
-- list in a page would cap them; a table does not. The classifier SELECTS from
-- this table and never invents a name — staff own the list.
CREATE TABLE IF NOT EXISTS faq_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 100,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT faq_categories_name_not_blank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS faq_categories_name_key
  ON faq_categories (lower(btrim(name)));

-- The six Wael approved on 2026-09-02. Extensible; nothing here caps the list.
INSERT INTO faq_categories (name, sort_order) VALUES
  ('Getting started',      10),
  ('Talking to MyNaavi',   20),
  ('Alerts & reminders',   30),
  ('Messages & lists',     40),
  ('Calls & briefings',    50),
  ('Privacy & help',       60)
ON CONFLICT DO NOTHING;

-- ── The answers ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS faq_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The public anchor. Migrated verbatim from each existing <details id="...">
  -- so every published mynaavi.com/faq#<slug> keeps working.
  slug                  text        NOT NULL,

  question              text        NOT NULL,
  answer_html           text        NOT NULL,

  -- Several per item, by design (Wael, 2026-09-02). Values are names from
  -- faq_categories; not FK-enforced because the classifier writes them as a
  -- set and a rename should not orphan a row mid-edit. manage-faq validates
  -- membership on write.
  categories            text[]      NOT NULL DEFAULT '{}',

  -- What the local filter on the FAQ page matches against, so a customer's
  -- word need not be MyNaavi's word.
  search_terms          text[]      NOT NULL DEFAULT '{}',

  -- Phase 2 §3: re-classify when the WORDS change, not on a schedule and not
  -- never. Wael, 2026-09-02: an answer improved after review can deserve
  -- different categories, and keeping the original would lose that.
  content_hash          text        NOT NULL,

  -- Phase 3 A2 — fail-open. A classifier outage must never cost a staffer the
  -- answer they just wrote, and must never silently drop the row from view.
  -- Set true when classification failed; the row is still published and still
  -- searchable, it simply has no categories yet.
  needs_classification  boolean     NOT NULL DEFAULT false,

  active                boolean     NOT NULL DEFAULT true,

  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT faq_items_slug_shape       CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT faq_items_question_present CHECK (btrim(question)    <> ''),
  CONSTRAINT faq_items_answer_present   CHECK (btrim(answer_html) <> ''),
  CONSTRAINT faq_items_hash_present     CHECK (btrim(content_hash) <> '')
);

-- L1: the logical key. Two rows for one published address are impossible.
CREATE UNIQUE INDEX IF NOT EXISTS faq_items_slug_key ON faq_items (slug);

-- get-faq's only query shape: active rows, stable order.
CREATE INDEX IF NOT EXISTS faq_items_active_idx
  ON faq_items (active, created_at) WHERE active;

-- ── Phase 3 A1(e) — result cache ───────────────────────────────────────────
-- match-faq is unauthenticated and bills the Anthropic key on every call.
-- Caching by normalised input means a repeated identical request — a real one
-- or a probe — costs nothing.
CREATE TABLE IF NOT EXISTS faq_match_cache (
  input_hash  text PRIMARY KEY,
  result      jsonb       NOT NULL,
  hit_count   integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS faq_match_cache_created_idx ON faq_match_cache (created_at);

-- ── Phase 3 A1(b) — per-IP rate limit ──────────────────────────────────────
-- The IP is stored HASHED, never raw: this table exists to stop abuse, not to
-- build a record of who read the FAQ. Nothing else in the system needs to know
-- which address asked a question.
CREATE TABLE IF NOT EXISTS faq_rate_limit (
  ip_hash       text        NOT NULL,
  window_start  timestamptz NOT NULL,
  request_count integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_start)
);

CREATE INDEX IF NOT EXISTS faq_rate_limit_window_idx ON faq_rate_limit (window_start);

-- ── L3 — RLS: every client role denied on all four tables ──────────────────
-- No policies are created deliberately. With RLS enabled and no policy, anon
-- and authenticated can do nothing; service_role bypasses RLS entirely. So
-- reads flow through get-faq and writes through manage-faq, and there is no
-- second path either could drift from.
ALTER TABLE faq_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE faq_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE faq_match_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE faq_rate_limit  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE faq_items IS
  'F25 (2026-09-02). The single source of record for the customer-facing FAQ, '
  'replacing three hand-written copies. slug is the published anchor '
  '(mynaavi.com/faq#<slug>) and the mobile app deep-links 12 of them, so slugs '
  'are addresses and must not be changed casually. RLS is on with no policies '
  'by design: read via get-faq, write via manage-faq, both service_role.';

COMMENT ON COLUMN faq_items.needs_classification IS
  'True when the classifier could not run. The row stays published and '
  'searchable regardless — Phase 3 A2 fail-open: an outage degrades '
  'findability, never availability.';

COMMENT ON COLUMN faq_items.content_hash IS
  'Hash of question + answer. Re-classification is triggered by this changing, '
  'so an improved answer gets the categories it now deserves and an untouched '
  'one never drifts.';

COMMENT ON TABLE faq_rate_limit IS
  'F25 Phase 3 A1(b). IP is hashed, never stored raw — this exists to bound '
  'abuse of an unauthenticated AI endpoint, not to record who read the FAQ.';
