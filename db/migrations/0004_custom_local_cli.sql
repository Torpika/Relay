ALTER TABLE provider_connections
  DROP CONSTRAINT provider_connections_kind_check;

ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_kind_check
  CHECK (kind IN (
    'local_codex',
    'local_claude',
    'local_gemini',
    'local_kimi',
    'local_custom',
    'openai',
    'xai',
    'moonshot',
    'custom'
  ));
