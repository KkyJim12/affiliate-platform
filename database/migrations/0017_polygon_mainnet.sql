ALTER TABLE evm_wallets DROP CONSTRAINT evm_wallets_chain_id_check;
ALTER TABLE evm_wallets ADD CHECK(chain_id IN (137,80002));
ALTER TABLE connected_wallets DROP CONSTRAINT connected_wallets_chain_id_check;
ALTER TABLE connected_wallets ADD CHECK(chain_id IN (137,80002));
ALTER TABLE evm_sends DROP CONSTRAINT evm_sends_chain_id_check;
ALTER TABLE evm_sends ADD CHECK(chain_id IN (137,80002));
ALTER TABLE referral_chain_purchases DROP CONSTRAINT referral_chain_purchases_chain_id_check;
ALTER TABLE referral_chain_purchases ADD CHECK(chain_id IN (137,80002));

CREATE TABLE platform_network (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
  chain_id INTEGER NOT NULL CHECK(chain_id IN (137,80002))
);
-- Every existing paid installation predates mainnet support and belongs to Amoy.
INSERT INTO platform_network(chain_id) SELECT 80002 WHERE
  EXISTS(SELECT 1 FROM evm_wallets) OR EXISTS(SELECT 1 FROM connected_wallets)
  OR EXISTS(SELECT 1 FROM referral_chain_purchases) OR EXISTS(SELECT 1 FROM evm_sends)
  OR EXISTS(SELECT 1 FROM referral_activations) OR EXISTS(SELECT 1 FROM wallet_transactions)
  OR EXISTS(SELECT 1 FROM matrix_slots WHERE unlocked);

CREATE FUNCTION enforce_platform_network() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM platform_network WHERE chain_id<>NEW.chain_id) THEN
    RAISE EXCEPTION 'Database belongs to another Polygon network.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evm_wallet_network BEFORE INSERT OR UPDATE OF chain_id ON evm_wallets
  FOR EACH ROW EXECUTE FUNCTION enforce_platform_network();
CREATE TRIGGER connected_wallet_network BEFORE INSERT OR UPDATE OF chain_id ON connected_wallets
  FOR EACH ROW EXECUTE FUNCTION enforce_platform_network();
CREATE TRIGGER send_network BEFORE INSERT OR UPDATE OF chain_id ON evm_sends
  FOR EACH ROW EXECUTE FUNCTION enforce_platform_network();
CREATE TRIGGER referral_purchase_network BEFORE INSERT OR UPDATE OF chain_id ON referral_chain_purchases
  FOR EACH ROW EXECUTE FUNCTION enforce_platform_network();
