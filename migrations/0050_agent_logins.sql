-- A member's terminal sign-in between the member approving it in the browser and the CLI
-- redeeming it: who approved it, the challenge only the CLI's verifier answers, the label the
-- issued token will carry, and until when. It holds no credential. The one-time code is kept
-- only as its SHA-256 digest, so a database read cannot be redeemed; the agent token it yields
-- is issued at redemption and goes to the member's keyring, its digest to `user_mcp_tokens`.
--
-- The TTL, per-member cap and value shapes live in code (`src/domain/agent-login.ts`).
CREATE TABLE agent_logins (
  code_digest    TEXT PRIMARY KEY,
  -- A pending sign-in dies with the account, exactly as an agent token does.
  user_id        TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  label          TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);

CREATE INDEX agent_logins_user_id ON agent_logins (user_id);
CREATE INDEX agent_logins_expires_at ON agent_logins (expires_at);
