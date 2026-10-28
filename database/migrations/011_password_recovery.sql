BEGIN;
CREATE TABLE IF NOT EXISTS password_recovery (
    user_id uuid PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_recovery_expires_idx ON password_recovery(expires_at);
COMMIT;
