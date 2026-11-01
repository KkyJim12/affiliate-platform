-- Retain previously issued IDs. New members receive an ID only when their
-- first payment completes, except the initial account, which bootstraps ID 1.
ALTER TABLE users ALTER COLUMN referral_code DROP NOT NULL;

CREATE OR REPLACE FUNCTION assign_numeric_referral_id() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(782438, 2);
  IF NEW.referral_code ~ '^(LOOP|UNXO)-[A-Z0-9]{8}$' THEN
    INSERT INTO referral_code_aliases (code, user_id)
    VALUES (regexp_replace(NEW.referral_code, '^LOOP-', 'UNXO-'), NEW.id);
  END IF;
  NEW.referral_code := NULL;
  -- The persistent counter prevents deleting account 1 from creating another
  -- signup exemption. Failed registrations roll back the counter as well.
  UPDATE referral_id_counter SET last_id = 1 WHERE last_id = 0;
  IF FOUND THEN NEW.referral_code := '1'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assign_paid_member_id() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE assigned_id BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'referral_chain_purchases' THEN
    IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'referral_purchases' THEN
    IF NOT EXISTS (SELECT 1 FROM wallet_transactions
      WHERE id = NEW.transaction_id AND type = 'referral_purchase' AND status = 'completed') THEN
      RETURN NEW;
    END IF;
  ELSE
    -- Activation is also used to import historical completed purchases.
    IF NOT EXISTS (SELECT 1 FROM wallet_transactions
        WHERE id = NEW.transaction_id AND type = 'referral_purchase' AND status = 'completed')
      AND NOT EXISTS (SELECT 1 FROM referral_chain_purchases
        WHERE id = NEW.chain_purchase_id AND status = 'confirmed') THEN
      RETURN NEW;
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(782438, 2);
  IF EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND referral_code IS NULL) THEN
    UPDATE referral_id_counter SET last_id = last_id + 1 RETURNING last_id INTO assigned_id;
    UPDATE users SET referral_code = assigned_id::TEXT WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER referral_purchases_assign_member_id AFTER INSERT ON referral_purchases
FOR EACH ROW EXECUTE FUNCTION assign_paid_member_id();
CREATE TRIGGER referral_chain_purchases_assign_member_id AFTER INSERT OR UPDATE OF status ON referral_chain_purchases
FOR EACH ROW EXECUTE FUNCTION assign_paid_member_id();
CREATE TRIGGER referral_activations_assign_member_id AFTER INSERT ON referral_activations
FOR EACH ROW EXECUTE FUNCTION assign_paid_member_id();
