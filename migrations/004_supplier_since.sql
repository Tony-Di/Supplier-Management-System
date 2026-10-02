-- The day a supplier relationship began. Optional: suppliers created before
-- this column have none.

ALTER TABLE suppliers ADD COLUMN supplier_since date;
