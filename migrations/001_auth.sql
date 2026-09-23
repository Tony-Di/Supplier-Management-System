CREATE TABLE users (
  id             serial PRIMARY KEY,
  entra_oid      text NOT NULL UNIQUE,
  email          text NOT NULL,
  name           text NOT NULL,
  role           text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active         boolean NOT NULL DEFAULT true,
  session_epoch  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE INDEX users_email_idx ON users (lower(email));

-- connect-pg-simple's table, created here so migrations own the whole schema.
CREATE TABLE session (
  sid    varchar NOT NULL COLLATE "default" PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX session_expire_idx ON session (expire);
