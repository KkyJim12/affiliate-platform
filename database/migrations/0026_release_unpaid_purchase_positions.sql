-- Quotes retain their signed recipient snapshots, not a place in the tree.
-- Release unused initial positions, including abandoned/failed purchase quotes.
-- Keep historical paid ancestry and completion/rebirth evidence intact.
SELECT pg_advisory_xact_lock(782438,2);

DO $$
DECLARE slots_table TEXT;
BEGIN
  FOREACH slots_table IN ARRAY ARRAY['matrix_slots','unilevel_slots'] LOOP
    EXECUTE format('WITH RECURSIVE protected AS (
      SELECT s.id,s.parent_id FROM %1$I s
        WHERE s.unlocked OR s.completed_at IS NOT NULL OR s.cycle>0
      UNION SELECT s.id,s.parent_id FROM %1$I s JOIN protected p ON p.parent_id=s.id
    ) UPDATE %1$I s SET parent_id=NULL,branch=NULL,placement_reserved=FALSE
      WHERE s.cycle=0 AND NOT EXISTS(SELECT 1 FROM protected p WHERE p.id=s.id)',slots_table);
  END LOOP;
END;
$$;

WITH RECURSIVE protected AS (
  SELECT user_id FROM matrix_slots WHERE level=1 AND (unlocked OR parent_id IS NOT NULL)
  UNION SELECT user_id FROM unilevel_slots WHERE level=1 AND (unlocked OR parent_id IS NOT NULL)
  UNION SELECT p.parent_id FROM referral_placements p JOIN protected a ON a.user_id=p.user_id
)
DELETE FROM referral_placements p WHERE NOT EXISTS(SELECT 1 FROM protected a WHERE a.user_id=p.user_id);
