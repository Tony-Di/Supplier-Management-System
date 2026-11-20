-- Database-level checks for what the API already validates, so a row that
-- skipped the API (a manual fix, a script, a future bug) cannot hold a value
-- the app does not understand.
--
-- This migration must never stop a deployment. Each check is added only when
-- every existing row already satisfies it; otherwise it is skipped with a
-- WARNING in the migration output and the table is left exactly as it was.
-- The allowed values mirror server/schemas.ts; server/db/constraints.test.ts
-- fails when the two drift apart.

CREATE FUNCTION pg_temp.add_check(tbl text, name text, expression text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', tbl, name, expression);
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'Check % on % was not added: existing rows do not satisfy it.', name, tbl;
END $$;

CREATE FUNCTION pg_temp.add_value_check(tbl text, col text, allowed text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.add_check(
    tbl,
    tbl || '_' || col || '_check',
    format('%I IN (%s)', col, (SELECT string_agg(quote_literal(value), ', ') FROM unnest(allowed) AS value))
  );
END $$;

-- Record lifecycle. NULL stays allowed: older rows have no state and are treated as Active.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'suppliers', 'models', 'items', 'drawing_sets', 'projects', 'quotes', 'quote_case_links',
    'source_assignments', 'inspections', 'incoming_defects', 'price_changes', 'purchase_prices'
  ] LOOP
    PERFORM pg_temp.add_value_check(tbl, 'record_state', ARRAY['Draft', 'Active', 'Void']);
  END LOOP;
END $$;

SELECT pg_temp.add_value_check('suppliers', 'status', ARRAY['Prospect', 'Sample Stage', 'Approved', 'Active', 'On Hold', 'Rejected']);
SELECT pg_temp.add_value_check('suppliers', 'type', ARRAY['Manufacturer', 'Distributor', 'Service', 'Other']);

SELECT pg_temp.add_value_check('models', 'status', ARRAY['Active', 'Inactive']);

SELECT pg_temp.add_value_check('items', 'status', ARRAY['Active', 'Inactive']);
SELECT pg_temp.add_value_check('items', 'uom', ARRAY['pcs', 'set', 'bundle', 'lb', 'kg']);

SELECT pg_temp.add_value_check('drawing_sets', 'status', ARRAY['Draft', 'Active', 'Superseded', 'Obsolete']);
SELECT pg_temp.add_value_check('drawing_items', 'status', ARRAY['Active', 'Superseded', 'Obsolete']);
SELECT pg_temp.add_value_check('drawing_items', 'drawing_source', ARRAY['Package PDF', 'Item-specific PDF']);

SELECT pg_temp.add_value_check('projects', 'type', ARRAY['New Supplier Development', 'Requote', 'Re-source', 'Backup Supplier', 'Price Check', 'Model Change']);
SELECT pg_temp.add_value_check('projects', 'case_reason', ARRAY['New Supplier Intro', 'Change Work Order', 'Requote', 'Re-source', 'Backup Supplier', 'Price Check']);
SELECT pg_temp.add_value_check('projects', 'status', ARRAY['Planning', 'Quoting', 'Sample Stage', 'Comparison', 'Closed']);

SELECT pg_temp.add_value_check('quotes', 'quote_type', ARRAY['Standalone', 'Case-linked']);
SELECT pg_temp.add_value_check('quotes', 'quote_reason', ARRAY['New Quote', 'Requote', 'Price Check', 'Change Work Order', 'Model Change']);
SELECT pg_temp.add_value_check('quotes', 'extra_cost_type', ARRAY['None', 'Freight', 'Sample', 'Tooling', 'Packaging Test', 'Other']);
SELECT pg_temp.add_value_check('quotes', 'status', ARRAY['Received', 'Sample Requested', 'Selected', 'No Further Action', 'Expired']);
SELECT pg_temp.add_value_check('quotes', 'status_basis', ARRAY['QC Pass', 'QC Closed Fail', 'Existing Supplier', 'Previous Orders', 'Migration']);

SELECT pg_temp.add_value_check('quote_case_links', 'link_type', ARRAY['Origin Case', 'Reused Existing Quote']);
SELECT pg_temp.add_value_check('quote_case_links', 'sample_requirement', ARRAY['Not Reviewed', 'Not Required - Existing QC Pass', 'Required', 'Sample Requested', 'QC Passed', 'QC Failed']);

SELECT pg_temp.add_value_check('source_assignments', 'role', ARRAY['Primary', 'Secondary', 'Tertiary', 'Backup']);

SELECT pg_temp.add_value_check('inspections', 'result', ARRAY['Pass', 'Fail', 'Conditional', 'Not Submitted']);
SELECT pg_temp.add_value_check('inspections', 'disposition', ARRAY['Pending', 'Accepted', 'Re-sample Required', 'Conditional Approval', 'No Further Action']);

SELECT pg_temp.add_value_check('incoming_defects', 'defect_type', ARRAY['Damage', 'Dimension', 'Quantity Shortage', 'Material', 'Labeling', 'Other']);
SELECT pg_temp.add_value_check('incoming_defects', 'defect_action', ARRAY['Request Replacement', 'Request Credit']);

SELECT pg_temp.add_value_check('price_changes', 'source_type', ARRAY['Manual', 'Requote', 'New Quote', 'Purchase']);
SELECT pg_temp.add_value_check('price_changes', 'reason', ARRAY['Material', 'Freight', 'Labor', 'Negotiated', 'Model Change', 'Drawing Change', 'Requote', 'Change Work Order', 'Other']);
SELECT pg_temp.add_value_check('price_changes', 'status', ARRAY['Pending', 'Approved', 'Rejected']);

SELECT pg_temp.add_value_check('purchase_prices', 'source_type', ARRAY['ERP Import', 'Manual Import']);

-- Amounts and quantities are never negative.
SELECT pg_temp.add_check('quotes', 'quotes_amounts_check', 'unit_price >= 0 AND extra_cost_amount >= 0');
SELECT pg_temp.add_check('price_changes', 'price_changes_amounts_check', 'old_price >= 0 AND new_price >= 0');
SELECT pg_temp.add_check('purchase_prices', 'purchase_prices_amounts_check', 'unit_price >= 0 AND quantity >= 0');
SELECT pg_temp.add_check('inspections', 'inspections_counts_check', 'sample_round > 0 AND problem_photos >= 0');
SELECT pg_temp.add_check('incoming_defects', 'incoming_defects_quantities_check', 'defect_qty >= 0 AND po_qty >= 0 AND received_qty >= 0 AND replacement_qty >= 0');
SELECT pg_temp.add_check('score_weights', 'score_weights_amounts_check', 'sample_quality >= 0 AND incoming_quality >= 0 AND pricing >= 0 AND responsiveness >= 0 AND scope_fit >= 0 AND setup >= 0');

-- One Item Code is one item: no two usable items share a code, whatever its
-- case or surrounding spaces. This is the rule ensureUniqueItemCode applies.
DO $$
BEGIN
  CREATE UNIQUE INDEX items_item_code_unique
    ON items (lower(btrim(item_code, E' \t\n\r\f\v')))
    WHERE record_state IS DISTINCT FROM 'Void';
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'Index items_item_code_unique was not created: two usable items already share an Item Code.';
END $$;

-- When each record was created and last changed. The audit trail says who and
-- what; these answer "when" from the row itself. Existing rows take their
-- times from the audit trail where it has them and stay empty where it does not.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'suppliers', 'models', 'items', 'drawing_sets', 'drawing_items', 'projects', 'quotes', 'quote_case_links',
    'source_assignments', 'inspections', 'incoming_defects', 'price_changes', 'purchase_prices'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN created_at timestamptz, ADD COLUMN updated_at timestamptz', tbl);
    EXECUTE format(
      'UPDATE %I AS record
       SET created_at = history.created_at, updated_at = history.updated_at
       FROM (
         SELECT entity_id,
                min(timestamp) FILTER (WHERE action IN (''Create'', ''Import'')) AS created_at,
                max(timestamp) AS updated_at
         FROM audit_logs
         GROUP BY entity_id
       ) AS history
       WHERE history.entity_id = record.id',
      tbl
    );
    EXECUTE format('ALTER TABLE %I ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN updated_at SET DEFAULT now()', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', tbl || '_set_updated_at', tbl);
  END LOOP;
END $$;

DROP FUNCTION pg_temp.add_value_check(text, text, text[]);
DROP FUNCTION pg_temp.add_check(text, text, text);
