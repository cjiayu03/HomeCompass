-- Local email/password identities and opaque database-backed sessions.
-- Existing user_account rows are intentionally left unchanged and unlinked.

CREATE TABLE IF NOT EXISTS local_auth_identity (
  user_id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_auth_identity_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE CASCADE,
  CONSTRAINT local_auth_identity_email_unique UNIQUE (email),
  CONSTRAINT local_auth_identity_email_normalized_check
    CHECK (email = lower(btrim(email))),
  CONSTRAINT local_auth_identity_password_hash_check
    CHECK (btrim(password_hash) <> '')
);

CREATE TABLE IF NOT EXISTS local_auth_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT local_auth_session_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE CASCADE,
  CONSTRAINT local_auth_session_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT local_auth_session_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS local_auth_session_user_active_idx
  ON local_auth_session (user_id, expires_at)
  WHERE revoked_at IS NULL;
