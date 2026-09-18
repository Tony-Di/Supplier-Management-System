CREATE TABLE audit_logs (
  id               bigserial PRIMARY KEY,
  timestamp        timestamptz NOT NULL,
  actor_user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  actor_label      text NOT NULL,
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        text NOT NULL,
  entity_label     text NOT NULL,
  before           jsonb,
  after            jsonb,
  reason           text,
  source           text NOT NULL DEFAULT 'UI',
  linked_record_id text
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_timestamp_idx ON audit_logs (timestamp DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id);
