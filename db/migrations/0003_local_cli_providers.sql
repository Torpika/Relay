ALTER TABLE provider_connections
  DROP CONSTRAINT provider_connections_kind_check;

ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_kind_check
  CHECK (kind IN (
    'local_codex',
    'local_claude',
    'local_gemini',
    'local_kimi',
    'openai',
    'xai',
    'moonshot',
    'custom'
  ));

ALTER TABLE provider_connections
  DROP CONSTRAINT provider_connections_protocol_check;

ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_protocol_check
  CHECK (protocol IN ('codex_mcp', 'local_cli', 'responses', 'chat_completions'));
