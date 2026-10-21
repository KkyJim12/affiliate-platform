-- Public member IDs are separate from the immutable internal account UUIDs.
CREATE TABLE referral_code_aliases (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

INSERT INTO referral_code_aliases (code, user_id)
SELECT regexp_replace(referral_code, '^LOOP-', 'UNXO-'), id FROM users
WHERE referral_code ~ '^(LOOP|UNXO)-[A-Z0-9]{8}$';

CREATE TABLE referral_id_counter (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_id BIGINT NOT NULL CHECK (last_id BETWEEN 0 AND 9007199254740991)
);
INSERT INTO referral_id_counter (last_id) SELECT COUNT(*) FROM users;

-- Use a temporary namespace so existing numeric values cannot collide mid-update.
UPDATE users SET referral_code = 'MIGRATING-' || id;
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id)::TEXT AS code FROM users
)
UPDATE users u SET referral_code = n.code FROM numbered n WHERE n.id = u.id;
ALTER TABLE users ADD CONSTRAINT users_numeric_referral_code
  CHECK (referral_code ~ '^[1-9][0-9]{0,15}$' AND referral_code::NUMERIC <= 9007199254740991);

CREATE FUNCTION assign_numeric_referral_id() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE assigned_id BIGINT;
BEGIN
  -- Use the same lock order as sponsor changes and purchases. The counter update
  -- rolls back with registration, so a failed registration consumes no ID.
  PERFORM pg_advisory_xact_lock(782438, 2);
  IF NEW.referral_code ~ '^(LOOP|UNXO)-[A-Z0-9]{8}$' THEN
    INSERT INTO referral_code_aliases (code, user_id)
    VALUES (regexp_replace(NEW.referral_code, '^LOOP-', 'UNXO-'), NEW.id);
  END IF;
  UPDATE referral_id_counter SET last_id = last_id + 1 RETURNING last_id INTO assigned_id;
  NEW.referral_code := assigned_id::TEXT;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_assign_numeric_referral_id BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION assign_numeric_referral_id();

-- Placement is a binary tree. Commission ancestry continues to use sponsor_id.
CREATE TABLE referral_placements (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL CHECK (slot IN (0, 1)),
  UNIQUE (parent_id, slot),
  CHECK (user_id <> parent_id)
);

CREATE FUNCTION place_binary_referral(member_id TEXT, sponsor TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE target_parent TEXT; target_slot SMALLINT;
BEGIN
  PERFORM pg_advisory_xact_lock(782438, 2);
  IF sponsor IS NULL OR EXISTS (SELECT 1 FROM referral_placements WHERE user_id = member_id) THEN RETURN; END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT sponsor AS id
      UNION SELECT p.parent_id FROM referral_placements p JOIN ancestors a ON p.user_id = a.id
    ) SELECT 1 FROM ancestors WHERE id = member_id
  ) THEN
    RAISE EXCEPTION 'This referral would create a circular placement tree.' USING ERRCODE = '23514';
  END IF;
  -- Breadth first, left before right, throughout this sponsor's subtree.
  WITH RECURSIVE positions AS (
    SELECT sponsor AS id, ''::TEXT AS path
    UNION ALL
    SELECT p.user_id, positions.path || p.slot::TEXT
    FROM positions JOIN referral_placements p ON p.parent_id = positions.id
  )
  SELECT positions.id, slots.slot INTO target_parent, target_slot
  FROM positions CROSS JOIN (VALUES (0::SMALLINT), (1::SMALLINT)) slots(slot)
  LEFT JOIN referral_placements occupied ON occupied.parent_id = positions.id AND occupied.slot = slots.slot
  WHERE occupied.user_id IS NULL
  ORDER BY length(positions.path), positions.path, slots.slot LIMIT 1;
  INSERT INTO referral_placements (user_id, parent_id, slot) VALUES (member_id, target_parent, target_slot);
END;
$$;

-- Replay existing links in registration order; a branch can be attached later
-- without changing the slots already assigned within it.
DO $$
DECLARE member RECORD;
BEGIN
  FOR member IN SELECT id, sponsor_id FROM users WHERE sponsor_id IS NOT NULL ORDER BY created_at, id LOOP
    PERFORM place_binary_referral(member.id, member.sponsor_id);
  END LOOP;
END;
$$;

CREATE FUNCTION place_registered_referral() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM place_binary_referral(NEW.id, NEW.sponsor_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_place_binary_referral AFTER INSERT OR UPDATE OF sponsor_id ON users
FOR EACH ROW EXECUTE FUNCTION place_registered_referral();
