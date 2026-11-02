-- Email and password sign-in (AUTH_MODE=password). These accounts have no
-- Entra object id, and an account with a password has proved it owns its
-- address, because a password can only be set from a link emailed to it.
ALTER TABLE users ALTER COLUMN entra_oid DROP NOT NULL;
ALTER TABLE users ADD COLUMN password_hash text;

-- One password per address. Existing Entra accounts may share an address, so
-- the index only covers accounts that have a password.
CREATE UNIQUE INDEX users_password_email_idx ON users (lower(email)) WHERE password_hash IS NOT NULL;

-- Emailed links that let the owner of an address set its password; the first
-- one creates the account. Only a hash of each link's token is stored, and an
-- address has at most one live link.
CREATE TABLE password_links (
  token_hash  text PRIMARY KEY,
  email       text NOT NULL,
  name        text,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_links_email_idx ON password_links (email);
