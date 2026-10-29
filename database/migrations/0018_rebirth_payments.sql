-- New completions charge for re-entry. Previously opened cycles stay paid.
ALTER TABLE matrix_slots ADD COLUMN rebirth_paid BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE unilevel_slots ADD COLUMN rebirth_paid BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE matrix_slots SET rebirth_paid=TRUE WHERE cycle>0 AND opened;
UPDATE unilevel_slots SET rebirth_paid=TRUE WHERE cycle>0 AND opened;
UPDATE matrix_slots SET unlocked=FALSE WHERE cycle>0 AND NOT opened;
UPDATE unilevel_slots SET unlocked=FALSE WHERE cycle>0 AND NOT opened;
ALTER TABLE referral_auto_upgrades ADD COLUMN kind TEXT NOT NULL DEFAULT 'upgrade' CHECK(kind IN ('upgrade','rebirth'));
ALTER TABLE referral_auto_upgrades ADD COLUMN rebirth_cycle INTEGER CHECK(rebirth_cycle>0);
ALTER TABLE referral_auto_upgrades DROP CONSTRAINT matrix_auto_upgrades_level_check;
ALTER TABLE referral_auto_upgrades ADD CHECK(level BETWEEN 1 AND 15);
ALTER TABLE referral_auto_upgrades DROP CONSTRAINT referral_auto_upgrades_check;
ALTER TABLE referral_auto_upgrades ADD CHECK(
  (source='matrix' AND slot_id IS NOT NULL AND (slot_id=cycle_id OR kind='rebirth')) OR (source='unilevel' AND slot_id IS NULL));
ALTER TABLE referral_auto_upgrades ADD CHECK((kind='rebirth')=(rebirth_cycle IS NOT NULL));
ALTER TABLE referral_auto_upgrades ADD CHECK(kind='rebirth' OR level>=2);
ALTER TABLE referral_auto_upgrades ADD CHECK(kind='upgrade' OR level=source_level);
CREATE OR REPLACE VIEW matrix_auto_upgrades AS SELECT * FROM referral_auto_upgrades WHERE source='matrix' AND kind='upgrade';

ALTER TABLE referral_purchases ADD COLUMN rebirth_id TEXT UNIQUE REFERENCES referral_auto_upgrades(cycle_id);
ALTER TABLE referral_purchases DROP CONSTRAINT referral_purchases_user_id_level_key;
CREATE UNIQUE INDEX referral_ledger_paid_level ON referral_purchases(user_id,level) WHERE rebirth_id IS NULL;
ALTER TABLE referral_chain_purchases ADD COLUMN rebirth_id TEXT REFERENCES referral_auto_upgrades(cycle_id);
DROP INDEX referral_chain_paid_level;
CREATE UNIQUE INDEX referral_chain_paid_level ON referral_chain_purchases(user_id,level) WHERE status<>'failed' AND rebirth_id IS NULL;
CREATE UNIQUE INDEX referral_chain_paid_rebirth ON referral_chain_purchases(rebirth_id) WHERE status<>'failed';

CREATE OR REPLACE FUNCTION queue_referral_upgrade(completion TEXT,member TEXT,tier INTEGER,program TEXT,matrix_slot TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE target INTEGER; next_cycle INTEGER; slots_table TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(782438,2);
  IF EXISTS(SELECT 1 FROM referral_auto_upgrades WHERE cycle_id=completion OR cycle_id='rebirth:'||completion) THEN RETURN; END IF;
  slots_table:=program||'_slots';
  IF program NOT IN ('matrix','unilevel') THEN RAISE EXCEPTION 'Unknown referral program'; END IF;
  EXECUTE format('SELECT cycle+1 FROM %I WHERE id=$1',slots_table) INTO next_cycle
    USING CASE WHEN program='unilevel' AND matrix_slot IS NULL AND NOT EXISTS(SELECT 1 FROM unilevel_slots WHERE id=completion)
      THEN completion||':0' ELSE completion END;
  IF next_cycle IS NULL THEN RAISE EXCEPTION 'Missing completed referral slot'; END IF;
  INSERT INTO referral_auto_upgrades(cycle_id,user_id,level,source,source_level,slot_id,kind,rebirth_cycle,created_at)
    VALUES('rebirth:'||completion,member,tier,program,tier,matrix_slot,'rebirth',next_cycle,CURRENT_TIMESTAMP::TEXT);
  EXECUTE format('UPDATE %I SET unlocked=FALSE WHERE user_id=$1 AND level=$2 AND cycle=$3',slots_table)
    USING member,tier,next_cycle;
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

-- Owning the level does not pay for a new cycle. Ordinary purchase triggers,
-- overflow reservations and retries must all respect the outstanding charge.
CREATE FUNCTION guard_unpaid_rebirth() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cycle>0 AND NOT NEW.rebirth_paid THEN
    NEW.unlocked:=FALSE;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER matrix_rebirth_payment BEFORE INSERT OR UPDATE OF unlocked,rebirth_paid ON matrix_slots
  FOR EACH ROW EXECUTE FUNCTION guard_unpaid_rebirth();
CREATE TRIGGER unilevel_rebirth_payment BEFORE INSERT OR UPDATE OF unlocked,rebirth_paid ON unilevel_slots
  FOR EACH ROW EXECUTE FUNCTION guard_unpaid_rebirth();

-- Register the charge before attaching a new branch, so it cannot contribute
-- paid progress to its new parents until settlement has been confirmed.
CREATE OR REPLACE FUNCTION refresh_unilevel_slot(current_slot TEXT,enqueue BOOLEAN DEFAULT TRUE)
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
      IF enqueue THEN
        PERFORM queue_referral_upgrade(CASE WHEN owner.cycle=0 THEN 'unilevel:'||owner.level||':'||owner.user_id ELSE owner.id END,
          owner.user_id,owner.level,'unilevel');
      END IF;
      rebirth:=place_program_slot(owner.user_id,owner.level,'unilevel',owner.cycle+1);
      UPDATE unilevel_slots SET opened=TRUE,unlocked=TRUE WHERE id=rebirth;
      PERFORM refresh_unilevel_slot(rebirth,enqueue);
    END IF;
    current_slot:=owner.parent_id;
  END LOOP;
END;
$$;
