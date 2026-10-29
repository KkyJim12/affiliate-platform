-- Level-up positions are assigned on entry, rather than at registration.
-- Keep paid ancestry and outstanding signed quotes stable during the transition.
WITH RECURSIVE protected AS (
  SELECT s.id,s.parent_id FROM matrix_slots s WHERE s.unlocked OR s.completed_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM referral_chain_purchases p WHERE p.user_id=s.user_id AND p.level=s.level
      AND p.status IN ('awaiting_signature','pending'))
  UNION SELECT s.id,s.parent_id FROM matrix_slots s JOIN protected p ON p.parent_id=s.id
)
UPDATE matrix_slots s SET parent_id=NULL,branch=NULL WHERE s.level>1
  AND NOT EXISTS(SELECT 1 FROM protected p WHERE p.id=s.id);

CREATE TABLE unilevel_slots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 15),
  cycle INTEGER NOT NULL CHECK(cycle>=0),
  parent_id TEXT REFERENCES unilevel_slots(id),
  branch SMALLINT CHECK(branch IN (0,1)),
  unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  opened BOOLEAN NOT NULL DEFAULT TRUE,
  complete_depth INTEGER NOT NULL DEFAULT 0 CHECK(complete_depth BETWEEN 0 AND 15),
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id,level,cycle), UNIQUE(parent_id,branch),
  CHECK((parent_id IS NULL)=(branch IS NULL)), CHECK(id<>parent_id)
);
CREATE INDEX unilevel_slots_member ON unilevel_slots(user_id,level);
INSERT INTO unilevel_slots(id,user_id,level,cycle,unlocked,complete_depth,completed_at,created_at)
  SELECT 'unilevel:'||s.level||':'||s.user_id||':0',s.user_id,s.level,0,s.unlocked,
    COALESCE(p.complete_depth,0),p.completed_at,s.created_at FROM matrix_slots s
    LEFT JOIN unilevel_progress p ON p.user_id=s.user_id AND p.level=s.level WHERE s.cycle=0;
-- Retain legacy paid unilevel ancestry, including unpaid intermediate parents.
WITH RECURSIVE protected AS (
  SELECT s.user_id,s.level FROM unilevel_slots s WHERE s.unlocked OR s.level=1
    OR EXISTS(SELECT 1 FROM users u WHERE u.id=s.user_id AND u.sponsor_id IS NULL)
    OR EXISTS(SELECT 1 FROM referral_chain_purchases p WHERE p.user_id=s.user_id AND p.level=s.level
      AND p.status IN ('awaiting_signature','pending'))
  UNION SELECT p.parent_id,s.level FROM protected s JOIN referral_placements p ON p.user_id=s.user_id
)
UPDATE unilevel_slots s SET parent_id='unilevel:'||s.level||':'||p.parent_id||':0',branch=p.slot
  FROM referral_placements p WHERE p.user_id=s.user_id AND (s.user_id,s.level) IN (SELECT * FROM protected);

CREATE TRIGGER unilevel_rebirth_requires_paid_completion BEFORE INSERT ON unilevel_slots
  FOR EACH ROW EXECUTE FUNCTION gate_matrix_rebirth();
-- The gate is shared by both slot tables.
CREATE OR REPLACE FUNCTION gate_matrix_rebirth() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cycle=0 THEN NEW.opened:=TRUE;
  ELSE EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE user_id=$1 AND level=$2 AND cycle=$3 AND completed_at IS NOT NULL)',TG_TABLE_NAME)
    INTO NEW.opened USING NEW.user_id,NEW.level,NEW.cycle-1;
  END IF;
  RETURN NEW;
END;
$$;

-- A placeholder may receive children before its owner buys the level. It has no
-- position above itself until that owner enters. Existing attached branches stay intact.
CREATE FUNCTION place_program_slot(member TEXT,tier INTEGER,program TEXT,slot_cycle INTEGER DEFAULT 0)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE slots_table TEXT; slot_id TEXT; sponsor TEXT; target TEXT; side SMALLINT;
  next_cycle INTEGER; depth_limit INTEGER; already_placed BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(782438,2);
  IF program NOT IN ('matrix','unilevel') THEN RAISE EXCEPTION 'Unknown referral program'; END IF;
  slots_table:=program||'_slots'; depth_limit:=CASE WHEN program='matrix' THEN 3 ELSE 15 END;
  slot_id:=program||':'||tier||':'||member||':'||slot_cycle;
  EXECUTE format('INSERT INTO %I(id,user_id,level,cycle,created_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP::TEXT) ON CONFLICT DO NOTHING',slots_table)
    USING slot_id,member,tier,slot_cycle;
  EXECUTE format('SELECT parent_id IS NOT NULL FROM %I WHERE id=$1',slots_table) INTO already_placed USING slot_id;
  SELECT sponsor_id INTO sponsor FROM users WHERE id=member;
  IF already_placed OR sponsor IS NULL THEN RETURN slot_id; END IF;
  EXECUTE format('INSERT INTO %I(id,user_id,level,cycle,created_at) VALUES($1,$2,$3,0,CURRENT_TIMESTAMP::TEXT) ON CONFLICT DO NOTHING',slots_table)
    USING program||':'||tier||':'||sponsor||':0',sponsor,tier;
  -- Do not put a rebirth below the member's previous slot, or below any of
  -- their existing descendants. That would create a circular member ancestry.
  EXECUTE format('WITH RECURSIVE blocked AS (
    SELECT id FROM %1$I WHERE user_id=$1 AND level=$2
    UNION SELECT s.id FROM %1$I s JOIN blocked b ON s.parent_id=b.id
  ), positions AS (
    SELECT s.id,s.cycle,0 AS depth,''''::TEXT AS path FROM %1$I s
      WHERE s.user_id=$3 AND s.level=$2 AND s.completed_at IS NULL AND NOT EXISTS(SELECT 1 FROM blocked b WHERE b.id=s.id)
    UNION ALL SELECT s.id,p.cycle,p.depth+1,p.path||s.branch::TEXT
      FROM positions p JOIN %1$I s ON s.parent_id=p.id
      WHERE p.depth<$4-1 AND NOT EXISTS(SELECT 1 FROM blocked b WHERE b.id=s.id)
  ) SELECT p.id,sides.side FROM positions p CROSS JOIN (VALUES(0::SMALLINT),(1::SMALLINT)) sides(side)
    LEFT JOIN %1$I occupied ON occupied.parent_id=p.id AND occupied.branch=sides.side
    WHERE occupied.id IS NULL ORDER BY p.cycle,p.depth,p.path,sides.side LIMIT 1',slots_table)
    INTO target,side USING member,tier,sponsor,depth_limit;
  IF target IS NULL THEN
    EXECUTE format('SELECT COALESCE(MAX(cycle),-1)+1 FROM %I WHERE user_id=$1 AND level=$2',slots_table)
      INTO next_cycle USING sponsor,tier;
    target:=program||':'||tier||':'||sponsor||':'||next_cycle;
    EXECUTE format('INSERT INTO %I(id,user_id,level,cycle,unlocked,created_at)
      SELECT $1,$2,$3,$4,BOOL_OR(unlocked),CURRENT_TIMESTAMP::TEXT FROM %I WHERE user_id=$2 AND level=$3',slots_table,slots_table)
      USING target,sponsor,tier,next_cycle;
    side:=0;
  END IF;
  EXECUTE format('UPDATE %I SET parent_id=$1,branch=$2 WHERE id=$3',slots_table) USING target,side,slot_id;
  RETURN slot_id;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_matrix_slot(member TEXT,tier INTEGER) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN RETURN place_program_slot(member,tier,'matrix'); END;
$$;

CREATE OR REPLACE FUNCTION place_registered_matrix_member() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE tier INTEGER; program TEXT; slots_table TEXT; existing RECORD;
BEGIN
  FOREACH program IN ARRAY ARRAY['matrix','unilevel'] LOOP
    slots_table:=program||'_slots';
    FOR tier IN 1..15 LOOP
      EXECUTE format('INSERT INTO %I(id,user_id,level,cycle,created_at) VALUES($1,$2,$3,0,CURRENT_TIMESTAMP::TEXT) ON CONFLICT DO NOTHING',slots_table)
        USING program||':'||tier||':'||NEW.id||':0',NEW.id,tier;
    END LOOP;
    -- Registration still previews level 1. Higher levels enter only on purchase.
    PERFORM place_program_slot(NEW.id,1,program);
    IF TG_OP='UPDATE' THEN
      FOR existing IN EXECUTE format('SELECT level,cycle FROM %I WHERE user_id=$1 AND (unlocked OR cycle>0)',slots_table) USING NEW.id LOOP
        PERFORM place_program_slot(NEW.id,existing.level,program,existing.cycle);
      END LOOP;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enter_referral_level(member TEXT,tier INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM place_program_slot(member,tier,'matrix');
  PERFORM place_program_slot(member,tier,'unilevel');
END;
$$;

CREATE OR REPLACE FUNCTION unlock_paid_matrix_slots() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE tier INTEGER; paid_tier INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(782438,2);
  IF TG_TABLE_NAME='referral_activations' THEN tier:=1;
  ELSIF TG_TABLE_NAME='referral_chain_purchases' THEN
    IF NEW.status<>'confirmed' THEN RETURN NEW; END IF; tier:=NEW.level;
  ELSE tier:=NEW.level; END IF;
  FOR paid_tier IN 1..tier LOOP PERFORM enter_referral_level(NEW.user_id,paid_tier); END LOOP;
  UPDATE matrix_slots SET unlocked=TRUE WHERE user_id=NEW.user_id AND level<=tier;
  UPDATE unilevel_slots SET unlocked=TRUE WHERE user_id=NEW.user_id AND level<=tier;
  RETURN NEW;
END;
$$;

-- Progress belongs to a particular slot, so each rebirth can complete again.
CREATE FUNCTION refresh_unilevel_slot(current_slot TEXT,enqueue BOOLEAN DEFAULT TRUE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE owner unilevel_slots%ROWTYPE; next_depth INTEGER; distance INTEGER; rebirth TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(782438,2);
  FOR distance IN 0..15 LOOP
    SELECT * INTO owner FROM unilevel_slots WHERE id=current_slot;
    EXIT WHEN NOT FOUND OR NOT owner.unlocked;
    SELECT CASE WHEN COUNT(*)=2 AND BOOL_AND(unlocked) THEN LEAST(15,MIN(complete_depth)+1) ELSE 0 END INTO next_depth
      FROM unilevel_slots WHERE parent_id=current_slot;
    UPDATE unilevel_slots SET complete_depth=next_depth WHERE id=current_slot;
    IF owner.cycle=0 THEN
      INSERT INTO unilevel_progress(user_id,level,complete_depth,completed_at) VALUES(owner.user_id,owner.level,next_depth,owner.completed_at)
        ON CONFLICT(user_id,level) DO UPDATE SET complete_depth=EXCLUDED.complete_depth;
    END IF;
    IF next_depth=15 AND owner.completed_at IS NULL AND owner.opened THEN
      UPDATE unilevel_slots SET completed_at=CURRENT_TIMESTAMP::TEXT WHERE id=current_slot;
      IF owner.cycle=0 THEN UPDATE unilevel_progress SET completed_at=CURRENT_TIMESTAMP::TEXT WHERE user_id=owner.user_id AND level=owner.level; END IF;
      rebirth:=place_program_slot(owner.user_id,owner.level,'unilevel',owner.cycle+1);
      UPDATE unilevel_slots SET opened=TRUE,unlocked=TRUE WHERE id=rebirth;
      IF enqueue THEN
        PERFORM queue_referral_upgrade(CASE WHEN owner.cycle=0 THEN 'unilevel:'||owner.level||':'||owner.user_id ELSE owner.id END,
          owner.user_id,owner.level,'unilevel');
      END IF;
      PERFORM refresh_unilevel_slot(rebirth,enqueue);
    END IF;
    current_slot:=owner.parent_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_unilevel_progress(member TEXT,tier INTEGER,enqueue BOOLEAN DEFAULT TRUE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE slot RECORD;
BEGIN
  FOR slot IN SELECT id FROM unilevel_slots WHERE user_id=member AND level=tier ORDER BY cycle LOOP
    PERFORM refresh_unilevel_slot(slot.id,enqueue);
  END LOOP;
END;
$$;

-- Refresh unilevel parents after a paid branch is linked later.
CREATE FUNCTION refresh_attached_program_branch() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='unilevel_slots' AND NEW.unlocked AND NEW.parent_id IS NOT NULL THEN
    PERFORM refresh_unilevel_slot(NEW.parent_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER unilevel_slot_attachment AFTER UPDATE OF parent_id ON unilevel_slots
  FOR EACH ROW WHEN(OLD.parent_id IS DISTINCT FROM NEW.parent_id) EXECUTE FUNCTION refresh_attached_program_branch();

-- Existing completed trees get a fresh connected cycle without charging again.
DO $$
DECLARE slot RECORD; rebirth TEXT;
BEGIN
  FOR slot IN SELECT user_id,level,cycle FROM unilevel_slots WHERE completed_at IS NOT NULL ORDER BY level,user_id,cycle LOOP
    rebirth:=place_program_slot(slot.user_id,slot.level,'unilevel',slot.cycle+1);
    UPDATE unilevel_slots SET unlocked=TRUE,opened=TRUE WHERE id=rebirth;
  END LOOP;
  FOR slot IN SELECT user_id,level,cycle FROM matrix_slots WHERE cycle>0 AND opened AND parent_id IS NULL ORDER BY level,user_id,cycle LOOP
    PERFORM place_program_slot(slot.user_id,slot.level,'matrix',slot.cycle);
  END LOOP;
END;
$$;
