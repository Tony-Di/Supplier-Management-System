-- Quote selection rules (docs/superpowers/specs/2026-10-07-quote-selection-and-sampling-design.md).
--
-- status_basis says why a quote holds its status when the system set it or
-- checked it; status_reference holds the PO number of a previous-order
-- selection; closed_by_quote_id names the quote whose selection closed this
-- quote's price, so the price reopens if that quote stops being Selected.

ALTER TABLE quotes
  ADD COLUMN status_basis text,
  ADD COLUMN status_reference text,
  ADD COLUMN closed_by_quote_id text;

-- Only Selected prices take effect from now on. Requote and Change Work Order
-- prices took effect without being Selected, so they become Selected and keep
-- their windows. Under Review is retired, and Not Selected is now No Further
-- Action. Each changed quote gets an audit entry.
CREATE TEMPORARY TABLE quote_status_migration AS
SELECT
  q.id,
  q.project_id,
  q.status AS old_status,
  CASE
    WHEN coalesce(q.record_state, 'Active') <> 'Void'
      AND q.quote_reason IN ('Requote', 'Change Work Order')
      AND q.status <> 'Selected' THEN 'Selected'
    WHEN q.status = 'Under Review' THEN 'Received'
    WHEN q.status = 'Not Selected' THEN 'No Further Action'
  END AS new_status,
  coalesce(s.name, 'Unknown supplier') || ' / ' || coalesce(i.item_code, 'Unknown item') AS label
FROM quotes q
LEFT JOIN suppliers s ON s.id = q.supplier_id
LEFT JOIN items i ON i.id = q.item_id;

DELETE FROM quote_status_migration WHERE new_status IS NULL;

UPDATE quotes q
SET status = m.new_status,
    status_basis = CASE WHEN m.new_status = 'Selected' THEN 'Migration' END
FROM quote_status_migration m
WHERE q.id = m.id;

INSERT INTO audit_logs (timestamp, actor_label, action, entity_type, entity_id, entity_label, before, after, reason, source, linked_record_id)
SELECT
  now(),
  'System',
  'Status Change',
  'Quote',
  m.id,
  m.label,
  jsonb_build_object('status', m.old_status),
  CASE
    WHEN m.new_status = 'Selected' THEN jsonb_build_object('status', m.new_status, 'statusBasis', 'Migration')
    ELSE jsonb_build_object('status', m.new_status)
  END,
  CASE
    WHEN m.new_status = 'Selected' THEN 'Migration: Requote and Change Work Order prices now take effect only when Selected.'
    ELSE 'Migration: quote statuses changed by the selection rules.'
  END,
  'System',
  m.project_id
FROM quote_status_migration m;

DROP TABLE quote_status_migration;
