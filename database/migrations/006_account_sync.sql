-- Idempotency records for authenticated guest-workspace merges.
-- This migration is additive; earlier schema and data are unchanged.

CREATE TABLE IF NOT EXISTS account_sync_event (
  user_id uuid NOT NULL,
  sync_key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_sync_event_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE CASCADE,
  CONSTRAINT account_sync_event_user_sync_key_unique UNIQUE (user_id, sync_key)
);
