# Security policy

## Reporting

Do not disclose a suspected vulnerability in a public issue. Use the repository host’s private security-advisory channel and include the affected version, impact, reproduction, and any known mitigation.

## Deployment requirements

- Use `AUTH_MODE=oidc` and a managed identity provider in production.
- Generate independent high-entropy values for `SESSION_SECRET`, `CREDENTIAL_MASTER_KEY`, and the database password.
- Terminate TLS before Relay and set `APP_URL` to the public HTTPS origin.
- Run PostgreSQL with encrypted storage, point-in-time recovery, and tested restores.
- Restrict the worker database role and network access independently from the web role.
- Set `CUSTOM_PROVIDER_HOSTS` to an explicit allowlist or leave custom providers disabled.
- Route custom-provider traffic through egress controls that deny private, link-local, metadata, and internal ranges.
- Keep provider keys in a managed KMS-backed secret flow where available and rotate them regularly.
- Redact prompt bodies, model outputs, authorization headers, and exact credential values from logs and traces.

## Trust boundaries

Model output is untrusted input. Relay renders it without raw HTML and never allows it to change provider origins, headers, membership, credentials, budgets, or lifecycle state. Adding tool execution requires a separate sandbox, capability allowlist, tenant checks, resource limits, and approval gates for irreversible actions.

Local agents are reasoning workers, not coding agents. They run in a dedicated empty Relay directory with bounded request timeouts and output sizes. Codex, Claude Code, and Gemini use non-mutating/plan modes. Kimi's prompt mode cannot be combined with its plan flag, so it is isolated to the empty runtime directory, instructed not to mutate files, and launched with telemetry disabled. Keep `RELAY_LOCAL_AI_CWD` and `RELAY_CODEX_CWD` pointed at a dedicated empty directory rather than a source tree or home directory.

Local task discovery opens only documented task indexes and transcript files for Codex, Claude Code, Gemini CLI, and Kimi Code. It does not edit source histories, return internal transcript paths to the browser, or inspect Claude Desktop/Kimi Desktop browser caches. Imports are size-bounded and include user/assistant messages only. Treat imported content as untrusted data.

Custom provider origins are validated server-side. Redirects, URL credentials, fragments, arbitrary ports, unsafe schemes, and unapproved hosts are rejected. Hosted instances do not connect directly to user-local services.

## Credential handling

Provider credentials are write-only after creation. Each secret is encrypted with a fresh data-encryption key using AES-256-GCM and context-bound additional authenticated data. The data key is wrapped by the configured master-key provider. Only the worker decrypts a credential immediately before an upstream request; plaintext is never persisted in events, audit rows, client payloads, or error details.

## Runaway work

Every provider call must be cancellable or time-bounded. Stop intent is durable, checked around every provider boundary, and fenced with a new execution epoch. Operators should configure workspace-level ceilings that a run cannot override. Authentication errors and repeated provider failures pause a run for attention instead of retrying indefinitely.
