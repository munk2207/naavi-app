-- T4 Pass 3 (continued) — the three knowledge_fragments value rules.
--
-- Parity is about what the system can DO, not about which rows sit in it.
-- Staging is supposed to hold different data, different users, different
-- volumes. What has to match is capability. These three CHECK constraints are
-- capability: they are rules the database enforces, and staging not having
-- them is a genuine functional gap.
--
-- They are added NOT VALID, deliberately.
--
-- Staging holds 35 rows whose `source` production would refuse ('conversation'
-- x34, 'demo-seed' x1), plus 3 with a `type` and 1 with a `classification`
-- outside the allowed sets. Those rows are the manual-testing account's
-- memories — a doctor, a prescription, a blood test, a follow-up appointment.
-- They are DATA. They belong to whoever tests this system and are out of scope
-- for a parity pass; deleting or rewriting them to close a schema line item
-- would be the wrong trade twice over.
--
-- NOT VALID resolves the collision honestly: the rule applies to every row
-- written from now on, and existing rows are left exactly as they are and
-- never examined. Function copied, data untouched.
--
-- ⚠️ This CHANGES staging's behaviour, on purpose. Whatever has been writing
-- source='conversation' will now be REFUSED on staging, exactly as it would be
-- on production. If that path is still live, memories that used to save on
-- staging will stop saving — which is the point: staging stops disagreeing with
-- production about what is allowed, and a failure that production would have
-- had becomes visible where it can be seen. Nothing in the shipped code sends
-- that value (the voice server sends no `source` at all, so ingest-note's
-- default of 'notes' applies), and what does write it is not identified in this
-- repo.
--
-- Production already holds all three, fully validated, so this is a no-op there
-- — the name check below skips it. The definitions will therefore differ by the
-- NOT VALID marker, and the drift check will report that as "defined
-- differently" rather than closed. That is accurate: it IS slightly different,
-- and a truthful difference is worth more than a silence.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_fragments_classification_check') THEN
    ALTER TABLE public.knowledge_fragments
      ADD CONSTRAINT knowledge_fragments_classification_check
      CHECK (classification = ANY (ARRAY['PUBLIC'::text, 'PERSONAL'::text, 'SENSITIVE'::text, 'MEDICAL'::text, 'FINANCIAL'::text]))
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_fragments_source_check') THEN
    ALTER TABLE public.knowledge_fragments
      ADD CONSTRAINT knowledge_fragments_source_check
      CHECK (source = ANY (ARRAY['voice_memo'::text, 'notes'::text, 'stated'::text, 'inferred'::text]))
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_fragments_type_check') THEN
    ALTER TABLE public.knowledge_fragments
      ADD CONSTRAINT knowledge_fragments_type_check
      CHECK (type = ANY (ARRAY['life_story'::text, 'important_date'::text, 'preference'::text, 'relationship'::text, 'place'::text, 'routine'::text, 'concern'::text]))
      NOT VALID;
  END IF;
END $$;

COMMIT;
