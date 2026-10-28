-- A member owns independent slots at each paid level. Sponsor identity remains
-- unchanged; unilevel uses the continuous binary referral_placements tree.
CREATE TABLE matrix_slots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 15),
  cycle INTEGER NOT NULL CHECK (cycle >= 0),
  parent_id TEXT REFERENCES matrix_slots(id),
  branch SMALLINT CHECK (branch IN (0, 1)),
  unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, level, cycle),
  UNIQUE(parent_id, branch),
  CHECK ((parent_id IS NULL) = (branch IS NULL)),
  CHECK (id <> parent_id)
);
CREATE INDEX matrix_slots_member ON matrix_slots(user_id, level);

CREATE TABLE matrix_auto_upgrades (
  cycle_id TEXT PRIMARY KEY REFERENCES matrix_slots(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  level INTEGER NOT NULL CHECK (level BETWEEN 2 AND 15),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','pending','completed','superseded')),
  purchase_id TEXT REFERENCES referral_chain_purchases(id),
  last_error TEXT,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE referral_chain_purchases DROP CONSTRAINT referral_chain_purchases_signing_mode_check;
ALTER TABLE referral_chain_purchases ADD CONSTRAINT referral_chain_purchases_signing_mode_check
  CHECK (signing_mode IN ('external','embedded','automatic'));

CREATE FUNCTION ensure_matrix_slot(member TEXT, tier INTEGER) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE primary_id TEXT; sponsor TEXT; target TEXT; side SMALLINT; next_cycle INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(782438, 2);
  SELECT sponsor_id INTO sponsor FROM users WHERE id = member;
  SELECT id INTO primary_id FROM matrix_slots WHERE user_id = member AND level = tier AND cycle = 0;
  IF primary_id IS NOT NULL AND (sponsor IS NULL OR EXISTS(SELECT 1 FROM matrix_slots WHERE id = primary_id AND parent_id IS NOT NULL)) THEN
    RETURN primary_id;
  END IF;
  primary_id := 'matrix:' || tier || ':' || member || ':0';
  IF sponsor IS NOT NULL THEN
    PERFORM ensure_matrix_slot(sponsor, tier);
    -- Search the inviter's cycles in order, breadth first and left before right.
    -- Parents at depth 2 produce the final row at depth 3 (four rows with root).
    WITH RECURSIVE positions AS (
      SELECT id, cycle, 0 AS depth, ''::TEXT AS path FROM matrix_slots WHERE user_id = sponsor AND level = tier
      UNION ALL
      SELECT child.id, p.cycle, p.depth + 1, p.path || child.branch::TEXT
      FROM positions p JOIN matrix_slots child ON child.parent_id = p.id WHERE p.depth < 2
    ) SELECT p.id, sides.side INTO target, side FROM positions p
      CROSS JOIN (VALUES (0::SMALLINT),(1::SMALLINT)) sides(side)
      LEFT JOIN matrix_slots occupied ON occupied.parent_id = p.id AND occupied.branch = sides.side
      WHERE occupied.id IS NULL ORDER BY p.cycle, p.depth, p.path, sides.side LIMIT 1;
    IF target IS NULL THEN
      SELECT COALESCE(MAX(cycle), -1) + 1 INTO next_cycle FROM matrix_slots WHERE user_id = sponsor AND level = tier;
      target := 'matrix:' || tier || ':' || sponsor || ':' || next_cycle;
      INSERT INTO matrix_slots(id,user_id,level,cycle,unlocked,created_at)
        SELECT target,sponsor,tier,next_cycle,BOOL_OR(unlocked),CURRENT_TIMESTAMP::TEXT
        FROM matrix_slots WHERE user_id = sponsor AND level = tier;
      side := 0;
    END IF;
  END IF;
  INSERT INTO matrix_slots(id,user_id,level,cycle,parent_id,branch,created_at)
    VALUES(primary_id,member,tier,0,target,side,CURRENT_TIMESTAMP::TEXT)
    ON CONFLICT(id) DO UPDATE SET parent_id = EXCLUDED.parent_id,branch = EXCLUDED.branch;
  RETURN primary_id;
END;
$$;

-- Preserve all paid levels. Historical payments are never redistributed and
-- pre-migration full matrices do not create retroactive wallet debits.
DO $$
DECLARE member RECORD; tier INTEGER;
BEGIN
  FOR member IN SELECT id FROM users ORDER BY created_at,id LOOP
    FOR tier IN 1..15 LOOP PERFORM ensure_matrix_slot(member.id,tier); END LOOP;
  END LOOP;
END;
$$;
UPDATE matrix_slots s SET unlocked = TRUE WHERE s.level <= GREATEST(
  COALESCE((SELECT MAX(level) FROM referral_purchases p WHERE p.user_id = s.user_id),0),
  COALESCE((SELECT MAX(level) FROM referral_chain_purchases p WHERE p.user_id = s.user_id AND p.status = 'confirmed'),0),
  CASE WHEN EXISTS(SELECT 1 FROM referral_activations a WHERE a.user_id = s.user_id) THEN 1 ELSE 0 END
);
WITH RECURSIVE descendants AS (
  SELECT id AS root,id,0 AS depth,unlocked FROM matrix_slots
  UNION ALL SELECT d.root,s.id,d.depth+1,s.unlocked FROM descendants d JOIN matrix_slots s ON s.parent_id = d.id WHERE d.depth < 3
) UPDATE matrix_slots s SET completed_at = CURRENT_TIMESTAMP::TEXT
  WHERE s.unlocked AND s.id IN (SELECT root FROM descendants WHERE depth > 0 GROUP BY root HAVING COUNT(*) = 14 AND BOOL_AND(unlocked));
INSERT INTO matrix_slots(id,user_id,level,cycle,unlocked,created_at)
  SELECT 'matrix:' || level || ':' || user_id || ':' || (cycle + 1),user_id,level,cycle+1,TRUE,CURRENT_TIMESTAMP::TEXT
  FROM matrix_slots WHERE completed_at IS NOT NULL
  ON CONFLICT(user_id,level,cycle) DO NOTHING;

CREATE FUNCTION place_registered_matrix_member() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE tier INTEGER;
BEGIN
  FOR tier IN 1..15 LOOP PERFORM ensure_matrix_slot(NEW.id,tier); END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_place_matrix_slots AFTER INSERT OR UPDATE OF sponsor_id ON users
  FOR EACH ROW EXECUTE FUNCTION place_registered_matrix_member();

-- Keep slot eligibility synchronized even for administrative imports. The app
-- evaluates completions only after the surrounding purchase is confirmed.
CREATE FUNCTION unlock_paid_matrix_slots() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE tier INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(782438, 2);
  IF TG_TABLE_NAME = 'referral_activations' THEN tier := 1;
  ELSIF TG_TABLE_NAME = 'referral_chain_purchases' THEN
    IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
    tier := NEW.level;
  ELSE tier := NEW.level;
  END IF;
  UPDATE matrix_slots SET unlocked = TRUE WHERE user_id = NEW.user_id AND level <= tier;
  RETURN NEW;
END;
$$;
CREATE TRIGGER referral_activation_unlocks_slots AFTER INSERT ON referral_activations
  FOR EACH ROW EXECUTE FUNCTION unlock_paid_matrix_slots();
CREATE TRIGGER referral_ledger_unlocks_slots AFTER INSERT ON referral_purchases
  FOR EACH ROW EXECUTE FUNCTION unlock_paid_matrix_slots();
CREATE TRIGGER referral_chain_unlocks_slots AFTER INSERT OR UPDATE OF status ON referral_chain_purchases
  FOR EACH ROW EXECUTE FUNCTION unlock_paid_matrix_slots();
