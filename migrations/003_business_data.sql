-- Business records, previously data/store.json and uploads/. Each column is a
-- record field in snake_case; server/storeTables.ts lists them. Foreign keys
-- are checked at commit, so a request's writes may go in any order.

CREATE TABLE files (
  id                 text PRIMARY KEY,
  file_name          text NOT NULL,
  mime_type          text NOT NULL,
  size               integer NOT NULL,
  uploaded_at        timestamptz NOT NULL,
  purpose            text NOT NULL,
  linked_record_type text,
  linked_record_id   text,
  content            bytea NOT NULL
);

CREATE TABLE suppliers (
  id                   text PRIMARY KEY,
  record_state         text,
  void_reason          text,
  name                 text NOT NULL,
  erp_vendor_id        text,
  status               text NOT NULL,
  type                 text NOT NULL,
  country              text NOT NULL,
  region               text NOT NULL,
  capable_items        text[] NOT NULL,
  primary_contact      text NOT NULL,
  email                text NOT NULL,
  phone                text NOT NULL,
  payment_terms        text NOT NULL,
  has_w9               boolean NOT NULL,
  has_payment_info     boolean NOT NULL,
  w9_file_id           text REFERENCES files(id) DEFERRABLE INITIALLY DEFERRED,
  payment_info_file_id text REFERENCES files(id) DEFERRABLE INITIALLY DEFERRED,
  notes                text NOT NULL
);

CREATE TABLE models (
  id             text PRIMARY KEY,
  record_state   text,
  void_reason    text,
  name           text NOT NULL,
  product_family text NOT NULL,
  status         text NOT NULL,
  notes          text NOT NULL
);

CREATE TABLE items (
  id              text PRIMARY KEY,
  record_state    text,
  void_reason     text,
  item_code       text NOT NULL,
  item_name       text NOT NULL,
  type            text NOT NULL,
  used_for_models text[] NOT NULL,
  uom             text NOT NULL,
  status          text NOT NULL
);

CREATE TABLE drawing_sets (
  id                text PRIMARY KEY,
  record_state      text,
  void_reason       text,
  model_id          text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  name              text NOT NULL,
  revision          text NOT NULL,
  status            text NOT NULL,
  effective_date    date NOT NULL,
  maintained_by     text NOT NULL,
  package_file_id   text REFERENCES files(id) DEFERRABLE INITIALLY DEFERRED,
  package_file_name text
);

CREATE TABLE drawing_items (
  id             text PRIMARY KEY,
  drawing_set_id text NOT NULL REFERENCES drawing_sets(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  position       integer NOT NULL,
  item_id        text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  revision       text NOT NULL,
  status         text NOT NULL,
  drawing_source text NOT NULL,
  file_name      text,
  file_id        text REFERENCES files(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE projects (
  id                text PRIMARY KEY,
  record_state      text,
  void_reason       text,
  name              text NOT NULL,
  model_ids         text[] NOT NULL,
  drawing_set_id    text NOT NULL REFERENCES drawing_sets(id) DEFERRABLE INITIALLY DEFERRED,
  type              text NOT NULL,
  case_reason       text NOT NULL,
  status            text NOT NULL,
  supplier_ids      text[] NOT NULL,
  item_ids          text[] NOT NULL,
  owner             text NOT NULL,
  open_date         date NOT NULL,
  target_close_date date
);

-- drawing_item_id has no foreign key: editing a packaging set rebuilds its
-- item rows, and a quote may keep pointing at one that was removed.
CREATE TABLE quotes (
  id                 text PRIMARY KEY,
  record_state       text,
  void_reason        text,
  supplier_id        text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  project_id         text REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  quote_type         text NOT NULL,
  quote_reason       text NOT NULL,
  previous_quote_id  text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  model_id           text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  item_id            text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  drawing_set_id     text NOT NULL REFERENCES drawing_sets(id) DEFERRABLE INITIALLY DEFERRED,
  drawing_item_id    text NOT NULL,
  quote_date         date NOT NULL,
  effective_from     date NOT NULL,
  effective_to       date,
  valid_until        date,
  currency           text NOT NULL,
  uom                text NOT NULL,
  unit_price         numeric NOT NULL,
  moq                text NOT NULL,
  lead_time          text NOT NULL,
  extra_cost_type    text NOT NULL,
  extra_cost_amount  numeric NOT NULL,
  status             text NOT NULL,
  attachment_file_id text REFERENCES files(id) DEFERRABLE INITIALLY DEFERRED,
  notes              text NOT NULL
);

CREATE TABLE quote_case_links (
  id                 text PRIMARY KEY,
  record_state       text,
  void_reason        text,
  quote_id           text NOT NULL REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  project_id         text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  supplier_id        text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  item_id            text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  model_id           text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  link_type          text NOT NULL,
  sample_requirement text NOT NULL
);

CREATE TABLE source_assignments (
  id              text PRIMARY KEY,
  record_state    text,
  void_reason     text,
  project_id      text REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  model_id        text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  item_id         text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  supplier_id     text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  source_quote_id text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  role            text NOT NULL,
  effective_from  date NOT NULL,
  notes           text NOT NULL
);

CREATE TABLE inspections (
  id                   text PRIMARY KEY,
  record_state         text,
  void_reason          text,
  supplier_id          text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  project_id           text REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  related_quote_id     text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  model_id             text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  drawing_set_id       text NOT NULL REFERENCES drawing_sets(id) DEFERRABLE INITIALLY DEFERRED,
  item_id              text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  drawing_item_id      text NOT NULL,
  sample_round         integer NOT NULL,
  sample_received_date date NOT NULL,
  inspection_date      date,
  inspector            text,
  result               text NOT NULL,
  disposition          text NOT NULL,
  problem_photos       integer NOT NULL,
  photo_file_ids       text[] NOT NULL,
  notes                text NOT NULL,
  signed_date          date
);

CREATE TABLE incoming_defects (
  id                    text PRIMARY KEY,
  record_state          text,
  void_reason           text,
  supplier_id           text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  model_id              text REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  item_id               text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  po_number             text,
  po_qty                integer,
  defect_type           text NOT NULL,
  defect_date           date NOT NULL,
  defect_qty            integer NOT NULL,
  received_qty          integer,
  defect_action         text NOT NULL,
  replacement_qty       integer,
  replacement_receipts  jsonb NOT NULL,
  action_completed      boolean NOT NULL,
  action_completed_date date,
  material_returned     boolean NOT NULL,
  return_date           date,
  notes                 text NOT NULL,
  photo_file_ids        text[] NOT NULL,
  attachment_file_ids   text[] NOT NULL
);

CREATE TABLE purchase_prices (
  id              text PRIMARY KEY,
  record_state    text,
  void_reason     text,
  supplier_id     text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  model_id        text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  item_id         text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  po_number       text NOT NULL,
  order_date      date NOT NULL,
  unit_price      numeric NOT NULL,
  quantity        numeric NOT NULL,
  currency        text NOT NULL,
  uom             text NOT NULL,
  source_type     text NOT NULL,
  linked_quote_id text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  buyer           text NOT NULL,
  notes           text NOT NULL
);

CREATE TABLE price_changes (
  id                         text PRIMARY KEY,
  record_state               text,
  void_reason                text,
  supplier_id                text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  model_id                   text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  item_id                    text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  source_quote_id            text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  previous_quote_id          text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  source_purchase_price_id   text REFERENCES purchase_prices(id) DEFERRABLE INITIALLY DEFERRED,
  previous_purchase_price_id text REFERENCES purchase_prices(id) DEFERRABLE INITIALLY DEFERRED,
  source_type                text NOT NULL,
  old_price                  numeric NOT NULL,
  new_price                  numeric NOT NULL,
  currency                   text NOT NULL,
  effective_date             date NOT NULL,
  reason                     text NOT NULL,
  status                     text NOT NULL
);

CREATE TABLE score_weights (
  id               smallint PRIMARY KEY CHECK (id = 1),
  sample_quality   numeric NOT NULL,
  incoming_quality numeric NOT NULL,
  pricing          numeric NOT NULL,
  responsiveness   numeric NOT NULL,
  scope_fit        numeric NOT NULL,
  setup            numeric NOT NULL
);

INSERT INTO score_weights (id, sample_quality, incoming_quality, pricing, responsiveness, scope_fit, setup)
VALUES (1, 25, 20, 20, 15, 10, 10);

-- The last number issued for each ID prefix, so a deleted record's ID is never reused.
CREATE TABLE id_counters (
  prefix text PRIMARY KEY,
  value  integer NOT NULL
);
