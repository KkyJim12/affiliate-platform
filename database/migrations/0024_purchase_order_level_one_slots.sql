-- Linking an inviter records the invitation only. All program positions,
-- including level 1, are assigned when the member enters a purchase.
-- Keep locked catalog placeholders without occupying an upline's branches.
SELECT pg_advisory_xact_lock(782438,2);

CREATE OR REPLACE FUNCTION place_registered_matrix_member() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE tier INTEGER; program TEXT; slots_table TEXT; existing RECORD;
BEGIN
  FOREACH program IN ARRAY ARRAY['matrix','unilevel'] LOOP
    slots_table:=program||'_slots';
    FOR tier IN 1..15 LOOP
      EXECUTE format('INSERT INTO %I(id,user_id,level,cycle,created_at) VALUES($1,$2,$3,0,CURRENT_TIMESTAMP::TEXT) ON CONFLICT DO NOTHING',slots_table)
        USING program||':'||tier||':'||NEW.id||':0',NEW.id,tier;
    END LOOP;
    IF TG_OP='UPDATE' THEN
      -- Historical paid roots can still attach their existing branches later.
      FOR existing IN EXECUTE format('SELECT level,cycle FROM %I WHERE user_id=$1 AND (unlocked OR cycle>0)',slots_table) USING NEW.id LOOP
        PERFORM place_program_slot(NEW.id,existing.level,program,existing.cycle);
      END LOOP;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION place_registered_referral() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(782438,2);
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT NEW.sponsor_id AS id
      UNION SELECT u.sponsor_id FROM users u JOIN ancestors a ON u.id=a.id
    ) SELECT 1 FROM ancestors WHERE id=NEW.id
  ) THEN
    RAISE EXCEPTION 'This referral would create a circular network.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM matrix_slots WHERE user_id=NEW.id AND level=1 AND cycle=0 AND unlocked) THEN
    PERFORM place_binary_referral(NEW.id,NEW.sponsor_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enter_referral_level(member TEXT,tier INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF tier=1 THEN
    PERFORM place_binary_referral(member,(SELECT sponsor_id FROM users WHERE id=member));
  END IF;
  PERFORM place_program_slot(member,tier,'matrix');
  PERFORM place_program_slot(member,tier,'unilevel');
END;
$$;

-- Release unused registration positions. Retain every ancestor of paid entries,
-- completed cycles, rebirths and outstanding quotes so their routing is stable.
DO $$
DECLARE slots_table TEXT;
BEGIN
  FOREACH slots_table IN ARRAY ARRAY['matrix_slots','unilevel_slots'] LOOP
    EXECUTE format('WITH RECURSIVE protected AS (
      SELECT s.id,s.parent_id FROM %1$I s WHERE s.level=1 AND (
        s.unlocked OR s.completed_at IS NOT NULL OR s.cycle>0
        OR EXISTS(SELECT 1 FROM referral_chain_purchases p WHERE p.user_id=s.user_id
          AND p.level=1 AND p.status IN (''awaiting_signature'',''pending'')))
      UNION SELECT s.id,s.parent_id FROM %1$I s JOIN protected p ON p.parent_id=s.id
    ) UPDATE %1$I s SET parent_id=NULL,branch=NULL,placement_reserved=FALSE
      WHERE s.level=1 AND s.cycle=0 AND NOT EXISTS(SELECT 1 FROM protected p WHERE p.id=s.id)',slots_table);
  END LOOP;
END;
$$;

WITH RECURSIVE protected AS (
  SELECT user_id FROM matrix_slots WHERE level=1 AND (unlocked OR parent_id IS NOT NULL)
  UNION SELECT user_id FROM unilevel_slots WHERE level=1 AND (unlocked OR parent_id IS NOT NULL)
  UNION SELECT p.parent_id FROM referral_placements p JOIN protected a ON a.user_id=p.user_id
)
DELETE FROM referral_placements p WHERE NOT EXISTS(SELECT 1 FROM protected a WHERE a.user_id=p.user_id);
