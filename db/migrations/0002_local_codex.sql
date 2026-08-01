ALTER TABLE provider_connections
  DROP CONSTRAINT provider_connections_kind_check;

ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_kind_check
  CHECK (kind IN ('local_codex', 'openai', 'xai', 'moonshot', 'custom'));

ALTER TABLE provider_connections
  DROP CONSTRAINT provider_connections_protocol_check;

ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_protocol_check
  CHECK (protocol IN ('codex_mcp', 'responses', 'chat_completions'));
