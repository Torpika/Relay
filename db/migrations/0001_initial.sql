CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL,
  subject text NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE UNIQUE INDEX users_email_per_issuer_idx ON users (issuer, lower(email));

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_memberships_user_idx ON workspace_memberships (user_id);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selected_workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);

CREATE TABLE oidc_login_attempts (
  state_hash text PRIMARY KEY,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  return_to text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oidc_login_attempts_expiry_idx ON oidc_login_attempts (expires_at);

CREATE TABLE provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('openai', 'xai', 'moonshot', 'custom')),
  protocol text NOT NULL CHECK (protocol IN ('responses', 'chat_completions')),
  base_url text NOT NULL,
  credential_envelope jsonb NOT NULL,
  credential_hint text NOT NULL,
  status text NOT NULL DEFAULT 'untested' CHECK (status IN ('untested', 'healthy', 'unhealthy', 'disabled')),
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name)
);

CREATE INDEX provider_connections_workspace_idx ON provider_connections (workspace_id, created_at);

CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  name text NOT NULL,
  model text NOT NULL,
  roles text[] NOT NULL,
  instructions text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  color text NOT NULL DEFAULT '#64748b',
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES provider_connections(workspace_id, id) ON DELETE RESTRICT,
  CHECK (cardinality(roles) > 0 AND roles <@ ARRAY['draft', 'review', 'synthesize']::text[])
);

CREATE INDEX agents_workspace_idx ON agents (workspace_id, enabled, created_at);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  objective text NOT NULL,
  pending_instruction text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

CREATE INDEX conversations_workspace_updated_idx ON conversations (workspace_id, updated_at DESC);

CREATE TABLE conversation_agents (
  conversation_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, agent_id),
  UNIQUE (conversation_id, position),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, agent_id) REFERENCES agents(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX conversation_agents_workspace_idx ON conversation_agents (workspace_id, conversation_id, position);

CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'starting', 'running', 'pausing', 'paused', 'resuming', 'stopping', 'stopped', 'needs_attention', 'failed')),
  desired_state text NOT NULL DEFAULT 'running' CHECK (desired_state IN ('running', 'paused', 'stopped')),
  phase text NOT NULL DEFAULT 'preparing' CHECK (phase IN ('preparing', 'drafting', 'reviewing', 'synthesizing', 'checkpointing', 'idle')),
  current_iteration integer NOT NULL DEFAULT 0 CHECK (current_iteration >= 0),
  synthesizer_agent_id uuid NOT NULL,
  review_topology text NOT NULL DEFAULT 'all_to_all' CHECK (review_topology IN ('all_to_all', 'round_robin')),
  max_iterations integer CHECK (max_iterations IS NULL OR max_iterations > 0),
  max_total_tokens bigint CHECK (max_total_tokens IS NULL OR max_total_tokens > 0),
  total_input_tokens bigint NOT NULL DEFAULT 0 CHECK (total_input_tokens >= 0),
  total_output_tokens bigint NOT NULL DEFAULT 0 CHECK (total_output_tokens >= 0),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  stop_mode text CHECK (stop_mode IS NULL OR stop_mode IN ('graceful', 'immediate')),
  control_version bigint NOT NULL DEFAULT 0 CHECK (control_version >= 0),
  started_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, synthesizer_agent_id) REFERENCES agents(workspace_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX runs_one_active_per_conversation_idx
  ON runs (conversation_id)
  WHERE status IN ('created', 'starting', 'running', 'pausing', 'paused', 'resuming', 'stopping', 'needs_attention');
CREATE INDEX runs_workspace_conversation_idx ON runs (workspace_id, conversation_id, created_at DESC);

CREATE TABLE run_agents (
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  config_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, agent_id),
  UNIQUE (run_id, position),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, agent_id) REFERENCES agents(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX run_agents_workspace_idx ON run_agents (workspace_id, run_id, position);

CREATE TABLE iterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  phase text NOT NULL DEFAULT 'preparing' CHECK (phase IN ('preparing', 'drafting', 'reviewing', 'synthesizing', 'checkpointing', 'idle')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed', 'cancelled')),
  synthesis text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (run_id, number),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX iterations_workspace_run_idx ON iterations (workspace_id, run_id, number DESC);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  iteration_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('draft', 'review', 'synthesis')),
  agent_id uuid,
  target_agent_id uuid,
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'complete', 'failed', 'cancelled')),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE NULLS NOT DISTINCT (iteration_id, kind, agent_id, target_agent_id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, iteration_id) REFERENCES iterations(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, agent_id) REFERENCES agents(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, target_agent_id) REFERENCES agents(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX artifacts_workspace_iteration_idx ON artifacts (workspace_id, iteration_id, created_at);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  iteration_id uuid NOT NULL,
  draft_artifact_id uuid NOT NULL,
  reviewer_agent_id uuid NOT NULL,
  review_artifact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (draft_artifact_id, reviewer_agent_id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, iteration_id) REFERENCES iterations(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, draft_artifact_id) REFERENCES artifacts(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, reviewer_agent_id) REFERENCES agents(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, review_artifact_id) REFERENCES artifacts(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX reviews_workspace_iteration_idx ON reviews (workspace_id, iteration_id);

CREATE TABLE jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  iteration_id uuid,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'complete', 'failed', 'cancelled')),
  priority integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, iteration_id) REFERENCES iterations(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX jobs_claim_idx ON jobs (status, available_at, priority DESC, id)
  WHERE status = 'queued';
CREATE INDEX jobs_lease_expiry_idx ON jobs (lease_expires_at)
  WHERE status = 'leased';
CREATE INDEX jobs_workspace_run_idx ON jobs (workspace_id, run_id, id DESC);

CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id uuid,
  run_id uuid,
  iteration_id uuid,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, iteration_id) REFERENCES iterations(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX events_workspace_cursor_idx ON events (workspace_id, id);
CREATE INDEX events_conversation_cursor_idx ON events (workspace_id, conversation_id, id);
CREATE INDEX events_run_cursor_idx ON events (workspace_id, run_id, id);

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workspace_memberships_set_updated_at BEFORE UPDATE ON workspace_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER provider_connections_set_updated_at BEFORE UPDATE ON provider_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER agents_set_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER runs_set_updated_at BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER iterations_set_updated_at BEFORE UPDATE ON iterations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER artifacts_set_updated_at BEFORE UPDATE ON artifacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION notify_relay_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('relay_events', NEW.workspace_id::text || ':' || NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_notify AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION notify_relay_event();

ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE iterations ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

ALTER TABLE provider_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE runs FORCE ROW LEVEL SECURITY;
ALTER TABLE run_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE iterations FORCE ROW LEVEL SECURITY;
ALTER TABLE artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;

CREATE FUNCTION relay_workspace_access(candidate uuid) RETURNS boolean AS $$
  SELECT current_setting('relay.workspace_id', true) = '*'
    OR candidate::text = current_setting('relay.workspace_id', true)
$$ LANGUAGE sql STABLE;

CREATE POLICY provider_connections_workspace_policy ON provider_connections USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
CREATE POLICY agents_workspace_policy ON agents USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
CREATE POLICY conversations_workspace_policy ON conversations USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
CREATE POLICY conversation_agents_workspace_policy ON conversation_agents USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
CREATE POLICY runs_workspace_policy ON runs USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
CREATE POLICY run_agents_workspace_policy ON run_agents USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
CREATE POLICY iterations_workspace_policy ON iterations USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
CREATE POLICY artifacts_workspace_policy ON artifacts USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
CREATE POLICY reviews_workspace_policy ON reviews USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
CREATE POLICY jobs_workspace_policy ON jobs USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
CREATE POLICY events_workspace_policy ON events USING (relay_workspace_access(workspace_id)) WITH CHECK (relay_workspace_access(workspace_id));
