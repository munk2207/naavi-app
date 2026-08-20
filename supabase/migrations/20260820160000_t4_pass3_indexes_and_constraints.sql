-- T4 Pass 3 — indexes and constraints production has and staging does not.
--
-- These are the quiet ones. A missing unique index does not fail; it lets a
-- duplicate land that production would have refused, and the two environments
-- drift apart in their DATA rather than their schema. The same import run
-- produces one row on production and two on staging, and nothing anywhere
-- reports a problem.
--
-- Checked against staging's existing rows before writing this, because a unique
-- index will not build over duplicates and a check constraint will not build
-- over a row that violates it. Two of those checks were misleading and are
-- worth recording:
--
--   documents — a GROUP BY found seven duplicate (user, message, filename)
--   groups, which looked blocking. It is not: all 36 rows have a NULL
--   gmail_message_id, and Postgres treats NULLs as distinct in a unique index.
--   Zero real violations. Grouping and uniqueness disagree about NULL, and only
--   one of them is the rule the database will enforce.
--
--   knowledge_fragments — 35 rows carry a `source` production would reject
--   ('conversation' x34, 'demo-seed' x1), plus 3 bad `type` and 1 bad
--   `classification`. All belong to the manual-testing account, and nothing in
--   the codebase writes those values. They are test debris from ad-hoc scripts,
--   not something the product produces. The three knowledge_fragments CHECK
--   constraints are therefore NOT in this migration — adding them means
--   deleting rows from a live testing account, which is Wael's call and not a
--   side effect of a parity pass.
--
-- Everything below is idempotent and matches production's definition exactly,
-- so applying it to production is a no-op.

BEGIN;

-- ── Unique constraints (each creates its index) ───────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_user_name_email_unique') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_user_name_email_unique UNIQUE (user_id, name, email);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_user_message_filename_unique') THEN
    ALTER TABLE public.documents ADD CONSTRAINT documents_user_message_filename_unique UNIQUE (user_id, gmail_message_id, file_name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'epic_tokens_patient_id_unique') THEN
    ALTER TABLE public.epic_tokens ADD CONSTRAINT epic_tokens_patient_id_unique UNIQUE (patient_id);
  END IF;
END $$;

-- ── Bare indexes (expression and non-constraint) ──────────────────────────
-- Unique on an expression, so it cannot be a table constraint.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_fragments_user_content_unique
  ON public.knowledge_fragments USING btree (user_id, md5(content));

CREATE UNIQUE INDEX IF NOT EXISTS reminders_user_title_datetime_unique
  ON public.reminders USING btree (user_id, title, datetime);

-- Vector similarity index behind knowledge search. Without it the search still
-- works and simply scans, so its absence shows up as staging being slower
-- rather than wrong — the kind of difference that never announces itself.
CREATE INDEX IF NOT EXISTS knowledge_fragments_embedding_idx
  ON public.knowledge_fragments USING ivfflat (embedding vector_cosine_ops) WITH (lists = '100');

-- ── Check constraint (no violating rows on staging) ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gmail_messages_signal_strength_check') THEN
    ALTER TABLE public.gmail_messages ADD CONSTRAINT gmail_messages_signal_strength_check
      CHECK (signal_strength = ANY (ARRAY['personal'::text, 'institutional'::text, 'ambient'::text]));
  END IF;
END $$;

COMMIT;
