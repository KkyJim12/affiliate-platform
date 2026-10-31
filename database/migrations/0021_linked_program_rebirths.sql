-- One new rebirth payment funds a fresh position in each program. Keep the
-- positions explicitly linked: independent completions need not share cycles.
-- Existing paid placements and signed payment quotes keep their old routing.
CREATE TABLE referral_rebirth_entries (
  rebirth_id TEXT PRIMARY KEY REFERENCES referral_auto_upgrades(cycle_id),
  matrix_slot_id TEXT NOT NULL UNIQUE REFERENCES matrix_slots(id),
  unilevel_slot_id TEXT NOT NULL UNIQUE REFERENCES unilevel_slots(id)
);

CREATE OR REPLACE FUNCTION queue_referral_upgrade(completion TEXT,member TEXT,tier INTEGER,program TEXT,matrix_slot TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE job TEXT; source_cycle INTEGER; companion_cycle INTEGER; companion TEXT;
  source_slot TEXT; companion_slot TEXT; completed_cycle INTEGER; target INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(782438,2);
  IF program NOT IN ('matrix','unilevel') THEN RAISE EXCEPTION 'Unknown referral program'; END IF;
  IF EXISTS(SELECT 1 FROM referral_auto_upgrades WHERE cycle_id=completion OR cycle_id='rebirth:'||completion) THEN RETURN; END IF;
  EXECUTE format('SELECT cycle FROM %I WHERE id=$1',program||'_slots') INTO completed_cycle
    USING CASE WHEN program='unilevel' AND NOT EXISTS(SELECT 1 FROM unilevel_slots WHERE id=completion)
      THEN completion||':0' ELSE completion END;
  IF completed_cycle IS NULL THEN RAISE EXCEPTION 'Missing completed referral slot'; END IF;
  job:='rebirth:'||completion;
  -- A position created by the other program already belongs to its payment.
  -- Reuse unopened overflow, but never reuse an opened or quoted entry.
  EXECUTE format('SELECT GREATEST($3,COALESCE(MAX(cycle) FILTER (WHERE opened),0)+1) FROM %I WHERE user_id=$1 AND level=$2',program||'_slots')
    INTO source_cycle USING member,tier,completed_cycle+1;
  INSERT INTO referral_auto_upgrades(cycle_id,user_id,level,source,source_level,slot_id,kind,rebirth_cycle,created_at)
    VALUES(job,member,tier,program,tier,matrix_slot,'rebirth',source_cycle,CURRENT_TIMESTAMP::TEXT);
  source_slot:=place_program_slot(member,tier,program,source_cycle);
  EXECUTE format('UPDATE %I SET opened=TRUE WHERE id=$1',program||'_slots') USING source_slot;

  companion:=CASE WHEN program='matrix' THEN 'unilevel' ELSE 'matrix' END;
  EXECUTE format('SELECT COALESCE(MAX(cycle) FILTER (WHERE opened),0)+1 FROM %I WHERE user_id=$1 AND level=$2',companion||'_slots')
    INTO companion_cycle USING member,tier;
  companion_slot:=place_program_slot(member,tier,companion,companion_cycle);
  EXECUTE format('UPDATE %I SET opened=TRUE WHERE id=$1',companion||'_slots') USING companion_slot;
  INSERT INTO referral_rebirth_entries(rebirth_id,matrix_slot_id,unilevel_slot_id)
    VALUES(job,CASE WHEN program='matrix' THEN source_slot ELSE companion_slot END,
      CASE WHEN program='unilevel' THEN source_slot ELSE companion_slot END);
  SELECT GREATEST(
    COALESCE((SELECT MAX(level) FROM matrix_slots WHERE user_id=member AND cycle=0 AND unlocked),0),
    COALESCE((SELECT MAX(level) FROM referral_auto_upgrades WHERE user_id=member AND kind='upgrade' AND status IN ('queued','pending')),0)
  )+1 INTO target;
  IF target BETWEEN 2 AND 15 THEN
    INSERT INTO referral_auto_upgrades(cycle_id,user_id,level,source,source_level,slot_id,created_at)
      VALUES(completion,member,target,program,tier,matrix_slot,CURRENT_TIMESTAMP::TEXT);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_unilevel_slot(current_slot TEXT,enqueue BOOLEAN DEFAULT TRUE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE owner unilevel_slots%ROWTYPE; next_depth INTEGER; distance INTEGER; rebirth TEXT;
  completion TEXT; next_cycle INTEGER;
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
      completion:=CASE WHEN owner.cycle=0 THEN 'unilevel:'||owner.level||':'||owner.user_id ELSE owner.id END;
      next_cycle:=owner.cycle+1;
      IF enqueue THEN
        PERFORM queue_referral_upgrade(completion,owner.user_id,owner.level,'unilevel');
        SELECT rebirth_cycle INTO next_cycle FROM referral_auto_upgrades WHERE cycle_id='rebirth:'||completion;
      END IF;
      rebirth:=place_program_slot(owner.user_id,owner.level,'unilevel',next_cycle);
      UPDATE unilevel_slots SET opened=TRUE,unlocked=TRUE WHERE id=rebirth;
      PERFORM refresh_unilevel_slot(rebirth,enqueue);
    END IF;
    current_slot:=owner.parent_id;
  END LOOP;
END;
$$;
