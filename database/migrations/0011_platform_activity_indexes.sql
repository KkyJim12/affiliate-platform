CREATE INDEX referral_chain_contract_activity ON referral_chain_purchases(lower(contract_address), status, created_at DESC);
CREATE INDEX referral_chain_fee_activity ON referral_chain_fee_updates(lower(contract_address), status, created_at DESC);
CREATE INDEX external_fee_contract_activity ON external_wallet_operations(lower(payload->>'contract'), status, created_at DESC) WHERE kind = 'fee';
