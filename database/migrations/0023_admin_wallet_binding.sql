-- Account 1 keeps its original wallet even if a future code path attempts to
-- replace, transfer or remove the binding directly.
CREATE FUNCTION protect_admin_wallet_binding() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND referral_code = '1') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'The wallet bound to ID 1 cannot be removed.';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR lower(NEW.address) IS DISTINCT FROM lower(OLD.address) THEN
      RAISE EXCEPTION 'The wallet bound to ID 1 cannot be changed.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER connected_wallets_protect_admin_binding
BEFORE UPDATE OR DELETE ON connected_wallets
FOR EACH ROW EXECUTE FUNCTION protect_admin_wallet_binding();
