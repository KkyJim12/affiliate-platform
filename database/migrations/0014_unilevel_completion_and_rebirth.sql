-- Keep existing matrix jobs and their transaction evidence. Both programs now
-- use the same queue; the compatibility view retains the old matrix-only API.
ALTER TABLE matrix_auto_upgrades RENAME TO referral_auto_upgrades;
ALTER TABLE referral_auto_upgrades DROP CONSTRAINT matrix_auto_upgrades_cycle_id_fkey;
ALTER TABLE referral_auto_upgrades ADD COLUMN source TEXT NOT NULL DEFAULT 'matrix'
  CHECK (source IN ('matrix','unilevel'));
ALTER TABLE referral_auto_upgrades ADD COLUMN source_level INTEGER CHECK (source_level BETWEEN 1 AND 15);
ALTER TABLE referral_auto_upgrades ADD COLUMN slot_id TEXT REFERENCES matrix_slots(id);
UPDATE referral_auto_upgrades j SET source_level = s.level, slot_id = s.id FROM matrix_slots s WHERE s.id = j.cycle_id;
ALTER TABLE referral_auto_upgrades ALTER COLUMN source_level SET NOT NULL;
ALTER TABLE referral_auto_upgrades ADD CHECK (
  (source = 'matrix' AND slot_id IS NOT NULL AND slot_id = cycle_id) OR (source = 'unilevel' AND slot_id IS NULL));
CREATE INDEX referral_auto_upgrade_queue ON referral_auto_upgrades(status,last_attempt_at,created_at);
CREATE INDEX referral_auto_upgrade_member ON referral_auto_upgrades(user_id,level);
CREATE VIEW matrix_auto_upgrades AS SELECT * FROM referral_auto_upgrades WHERE source = 'matrix';

-- A complete depth of n means this paid member and every position in the next
-- n binary rows own the level. Two children with complete depth n-1 establish
-- depth n. Updating one payment requires at most sixteen small indexed reads,
-- rather than repeatedly scanning all 65,534 descendants of a full tree.
CREATE TABLE unilevel_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 15),
  complete_depth INTEGER NOT NULL DEFAULT 0 CHECK (complete_depth BETWEEN 0 AND 15),
  completed_at TEXT,
  PRIMARY KEY(user_id,level)
);

CREATE FUNCTION queue_referral_upgrade(completion TEXT, member TEXT, tier INTEGER, program TEXT, matrix_slot TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE target INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(782438, 2);
  IF EXISTS(SELECT 1 FROM referral_auto_upgrades WHERE cycle_id = completion) THEN RETURN; END IF;
  -- Reserve distinct successive levels when several slots finish together.
  -- A manually purchased reserved level supersedes that job without charging.
  SELECT GREATEST(
    COALESCE((SELECT MAX(level) FROM matrix_slots WHERE user_id = member AND cycle = 0 AND unlocked),0),
    COALESCE((SELECT MAX(level) FROM referral_auto_upgrades WHERE user_id = member AND status IN ('queued','pending')),0)
  ) + 1 INTO target;
  IF target BETWEEN 2 AND 15 THEN
    INSERT INTO referral_auto_upgrades(cycle_id,user_id,level,source,source_level,slot_id,created_at)
      VALUES(completion,member,target,program,tier,matrix_slot,CURRENT_TIMESTAMP::TEXT) ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

CREATE FUNCTION refresh_unilevel_progress(member TEXT, tier INTEGER, enqueue BOOLEAN DEFAULT TRUE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE current_member TEXT := member; previous_depth INTEGER; next_depth INTEGER; distance INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(782438, 2);
  FOR distance IN 0..15 LOOP
    EXIT WHEN current_member IS NULL;
    -- An unpaid intermediate member prevents a paid full subtree above it.
    EXIT WHEN NOT EXISTS(SELECT 1 FROM matrix_slots WHERE user_id = current_member AND level = tier AND cycle = 0 AND unlocked);
    SELECT complete_depth INTO previous_depth FROM unilevel_progress WHERE user_id = current_member AND level = tier;
    SELECT CASE WHEN COUNT(*) = 2 THEN LEAST(15,MIN(c.complete_depth) + 1) ELSE 0 END INTO next_depth
      FROM referral_placements p JOIN unilevel_progress c ON c.user_id = p.user_id AND c.level = tier
      WHERE p.parent_id = current_member;
    INSERT INTO unilevel_progress(user_id,level,complete_depth) VALUES(current_member,tier,next_depth)
      ON CONFLICT(user_id,level) DO UPDATE SET complete_depth = EXCLUDED.complete_depth;
    IF next_depth = 15 AND EXISTS(SELECT 1 FROM unilevel_progress WHERE user_id = current_member AND level = tier AND completed_at IS NULL) THEN
      UPDATE unilevel_progress SET completed_at = CURRENT_TIMESTAMP::TEXT WHERE user_id = current_member AND level = tier;
      IF enqueue THEN
        PERFORM queue_referral_upgrade('unilevel:' || tier || ':' || current_member,current_member,tier,'unilevel');
      END IF;
    END IF;
    EXIT WHEN previous_depth IS NOT DISTINCT FROM next_depth;
    SELECT parent_id INTO current_member FROM referral_placements WHERE user_id = current_member;
  END LOOP;
END;
$$;

-- Reconstruct progress without retroactive automatic debits.
INSERT INTO unilevel_progress(user_id,level)
  SELECT user_id,level FROM matrix_slots WHERE cycle = 0 AND unlocked;
DO $$
DECLARE depth INTEGER;
BEGIN
  FOR depth IN 1..15 LOOP
    UPDATE unilevel_progress parent SET complete_depth = children.depth FROM (
      SELECT p.parent_id,c.level,LEAST(15,MIN(c.complete_depth) + 1) AS depth
      FROM referral_placements p JOIN unilevel_progress c ON c.user_id = p.user_id
      GROUP BY p.parent_id,c.level HAVING COUNT(*) = 2
    ) children WHERE parent.user_id = children.parent_id AND parent.level = children.level
      AND parent.complete_depth < children.depth;
  END LOOP;
END;
$$;
UPDATE unilevel_progress SET completed_at = CURRENT_TIMESTAMP::TEXT WHERE complete_depth = 15;

-- A previously paid branch may be linked to its sponsor later.
CREATE FUNCTION refresh_attached_unilevel_branch() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE tier INTEGER;
BEGIN
  FOR tier IN SELECT level FROM unilevel_progress WHERE user_id = NEW.user_id LOOP
    PERFORM refresh_unilevel_progress(NEW.parent_id,tier);
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER referral_placement_refreshes_unilevel AFTER INSERT ON referral_placements
  FOR EACH ROW EXECUTE FUNCTION refresh_attached_unilevel_branch();
