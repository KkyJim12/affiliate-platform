-- Overflow registrations reserve future cycles without opening a rebirth.
-- Preserve existing placement and completion/payment evidence.
ALTER TABLE matrix_slots ADD COLUMN opened BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE matrix_slots s SET opened = FALSE
  WHERE s.cycle > 0 AND s.completed_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM matrix_slots previous WHERE previous.user_id = s.user_id
      AND previous.level = s.level AND previous.cycle = s.cycle - 1
      AND previous.completed_at IS NOT NULL
  );

CREATE FUNCTION gate_matrix_rebirth() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.opened := NEW.cycle = 0 OR EXISTS (
    SELECT 1 FROM matrix_slots previous WHERE previous.user_id = NEW.user_id
      AND previous.level = NEW.level AND previous.cycle = NEW.cycle - 1
      AND previous.completed_at IS NOT NULL
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER matrix_rebirth_requires_paid_completion BEFORE INSERT ON matrix_slots
  FOR EACH ROW EXECUTE FUNCTION gate_matrix_rebirth();
