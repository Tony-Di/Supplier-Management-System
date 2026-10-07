-- Up to two documents a supplier keeps besides its W-9 and bank/payment info
-- file. The limit is checked by the API; existing suppliers start with none.

ALTER TABLE suppliers ADD COLUMN other_file_ids text[] NOT NULL DEFAULT '{}';
