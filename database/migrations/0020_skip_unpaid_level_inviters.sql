-- Higher levels use the original invitation chain and skip unpaid inviters.
-- Keep existing placements and outstanding quote recipients unchanged.
ALTER TABLE matrix_slots ADD COLUMN placement_reserved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE unilevel_slots ADD COLUMN placement_reserved BOOLEAN NOT NULL DEFAULT FALSE;
DO $$
DECLARE slots_table TEXT;
BEGIN
  FOREACH slots_table IN ARRAY ARRAY['matrix_slots','unilevel_slots'] LOOP
    EXECUTE format('UPDATE %I s SET placement_reserved=TRUE WHERE s.level>1 AND (
      s.parent_id IS NOT NULL OR s.unlocked OR s.completed_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM referral_chain_purchases p WHERE p.user_id=s.user_id AND p.level=s.level
        AND p.status IN (''awaiting_signature'',''pending'') AND (
          (p.rebirth_id IS NULL AND s.cycle=0) OR EXISTS(SELECT 1 FROM referral_auto_upgrades j
            WHERE j.cycle_id=p.rebirth_id AND s.id=j.source||'':''||j.level||'':''||j.user_id||'':''||j.rebirth_cycle))))',slots_table);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION place_program_slot(member TEXT,tier INTEGER,program TEXT,slot_cycle INTEGER DEFAULT 0)
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
  EXECUTE format('SELECT parent_id IS NOT NULL OR ($2>1 AND placement_reserved) FROM %I WHERE id=$1',slots_table)
    INTO already_placed USING slot_id,tier;
  IF already_placed THEN RETURN slot_id; END IF;
  IF tier=1 THEN
    SELECT sponsor_id INTO sponsor FROM users WHERE id=member;
  ELSE
    -- Keep even a parentless quote stable if an inviter upgrades before it settles.
    EXECUTE format('UPDATE %I SET placement_reserved=TRUE WHERE id=$1',slots_table) USING slot_id;
    -- Always follow original invitations, never the previous level's compressed
    -- tree: 2 -> 18 -> 49 becomes 2 -> 49 when 18 does not own this level.
    EXECUTE format('WITH RECURSIVE ancestors AS (
      SELECT u.id,u.sponsor_id,1 AS depth,ARRAY[$1,u.id] AS path
        FROM users child JOIN users u ON u.id=child.sponsor_id WHERE child.id=$1 AND u.id<>$1
      UNION ALL SELECT u.id,u.sponsor_id,a.depth+1,a.path||u.id
        FROM ancestors a JOIN users u ON u.id=a.sponsor_id WHERE NOT u.id=ANY(a.path)
    ) SELECT a.id FROM ancestors a JOIN %I paid
      ON paid.user_id=a.id AND paid.level=$2 AND paid.cycle=0 AND paid.unlocked
      ORDER BY a.depth LIMIT 1',slots_table) INTO sponsor USING member,tier;
  END IF;
  IF sponsor IS NULL THEN RETURN slot_id; END IF;
  EXECUTE format('INSERT INTO %I(id,user_id,level,cycle,created_at) VALUES($1,$2,$3,0,CURRENT_TIMESTAMP::TEXT) ON CONFLICT DO NOTHING',slots_table)
    USING program||':'||tier||':'||sponsor||':0',sponsor,tier;
  -- Do not put a rebirth below the member's previous slot, or below any of
  -- their existing descendants. That would create a circular member ancestry.
  EXECUTE format('WITH RECURSIVE blocked AS (
    SELECT id FROM %1$I WHERE user_id=$1 AND level=$2
    UNION SELECT s.id FROM %1$I s JOIN blocked b ON s.parent_id=b.id
  ), positions AS (
    SELECT s.id,s.user_id,s.cycle,0 AS depth,''''::TEXT AS path FROM %1$I s
      WHERE s.user_id=$3 AND s.level=$2 AND s.completed_at IS NULL AND NOT EXISTS(SELECT 1 FROM blocked b WHERE b.id=s.id)
    UNION ALL SELECT s.id,s.user_id,p.cycle,p.depth+1,p.path||s.branch::TEXT
      FROM positions p JOIN %1$I s ON s.parent_id=p.id
      WHERE p.depth<$4-1 AND NOT EXISTS(SELECT 1 FROM blocked b WHERE b.id=s.id)
  ) SELECT p.id,sides.side FROM positions p CROSS JOIN (VALUES(0::SMALLINT),(1::SMALLINT)) sides(side)
    LEFT JOIN %1$I occupied ON occupied.parent_id=p.id AND occupied.branch=sides.side
    WHERE occupied.id IS NULL AND ($2=1 OR EXISTS(SELECT 1 FROM %1$I paid
      WHERE paid.user_id=p.user_id AND paid.level=$2 AND paid.cycle=0 AND paid.unlocked)) ORDER BY p.cycle,p.depth,p.path,sides.side LIMIT 1',slots_table)
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
