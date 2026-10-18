CREATE TABLE evm_wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  address TEXT NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  public_key TEXT NOT NULL CHECK (public_key ~ '^0x04[0-9a-fA-F]{128}$'),
  encrypted_keystore TEXT NOT NULL CHECK (
    ((encrypted_keystore::jsonb ->> 'version') = '3'
    AND (encrypted_keystore::jsonb -> 'Crypto' ->> 'ciphertext') ~ '^[0-9a-fA-F]{64}$') IS TRUE
  ),
  chain_id INTEGER NOT NULL DEFAULT 80002 CHECK (chain_id = 80002),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX evm_wallets_address_unique ON evm_wallets(lower(address));
