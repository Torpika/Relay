"use client";

import {
  Bot,
  Check,
  Eye,
  EyeOff,
  Infinity as InfinityIcon,
  KeyRound,
  Network,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Zap
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type {
  AgentRole,
  AgentSummary,
  ConversationDetail,
  ProviderConnectionSummary,
  ProviderKind,
  ProviderProtocol,
  ReasoningEffort,
  RunDetail
} from "@/lib/contracts";
import { getProviderPreset, providerPresets } from "@/lib/provider-presets";
import { relayApi, verifyProviderConnections } from "@/components/api-client";
import { initials } from "@/components/formatters";
import { Button, Dialog, Field, InlineNotice } from "@/components/ui";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

const agentColors = ["#c7ff5b", "#58d6ff", "#a58cff", "#ff8a65", "#f6c85f", "#ef7cac"];

interface AddAgentDialogProps {
  open: boolean;
  connections: ProviderConnectionSummary[];
  onClose: () => void;
  onCreated: (agent: AgentSummary) => void;
}

export function AddAgentDialog({ open, connections, onClose, onCreated }: AddAgentDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [connectionMode, setConnectionMode] = useState<"new" | "existing">(
    connections.length ? "existing" : "new"
  );
  const [selectedConnectionId, setSelectedConnectionId] = useState(connections[0]?.id ?? "");
  const [providerKind, setProviderKind] = useState<ProviderKind>("local_codex");
  const preset = getProviderPreset(providerKind);
  const localProvider = providerKind.startsWith("local_");
  const [connectionName, setConnectionName] = useState(preset.name);
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl);
  const [protocol, setProtocol] = useState<ProviderProtocol>(preset.protocol);
  const [credential, setCredential] = useState("");
  const [localCommand, setLocalCommand] = useState("");
  const [localArguments, setLocalArguments] = useState("");
  const [showCredential, setShowCredential] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [model, setModel] = useState(preset.modelPlaceholder);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [roles, setRoles] = useState<AgentRole[]>(["draft", "review", "synthesize"]);
  const [instructions, setInstructions] = useState("");
  const [color, setColor] = useState(agentColors[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId);
  const customLocalProvider = providerKind === "local_custom";

  const chooseProvider = (kind: ProviderKind) => {
    const nextPreset = getProviderPreset(kind);
    setProviderKind(kind);
    setConnectionName(nextPreset.name);
    setBaseUrl(nextPreset.baseUrl);
    setProtocol(nextPreset.protocol);
    setModel(nextPreset.modelPlaceholder);
  };

  const toggleRole = (role: AgentRole) => {
    setRoles((currentRoles) =>
      currentRoles.includes(role)
        ? currentRoles.filter((currentRole) => currentRole !== role)
        : [...currentRoles, role]
    );
  };

  const advance = () => {
    setError(null);

    if (connectionMode === "existing" && !selectedConnectionId) {
      setError("Choose a provider connection before continuing.");
      return;
    }

    if (connectionMode === "new" && !connectionName.trim()) {
      setError("Give the local runtime a connection name.");
      return;
    }

    if (connectionMode === "new" && customLocalProvider && !localCommand.trim()) {
      setError("Enter the absolute path to the trusted local AI command.");
      return;
    }

    if (connectionMode === "new" && !localProvider && (!baseUrl.trim() || !credential.trim())) {
      setError("Connection name, base URL, and API key are required.");
      return;
    }

    setStep(2);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!agentName.trim() || !model.trim() || !roles.length) {
      setError("Agent name, model, and at least one role are required.");
      return;
    }

    setSubmitting(true);

    try {
      const connection =
        connectionMode === "new"
          ? await relayApi.createProvider({
              name: connectionName.trim(),
              kind: providerKind,
              protocol,
              baseUrl: baseUrl.trim(),
              ...(customLocalProvider ? {
                localCommand: localCommand.trim(),
                localArgs: localArguments.split(/\r?\n/u).map((argument) => argument.trim()).filter(Boolean)
              } : localProvider ? {} : { credential: credential.trim() })
            })
          : selectedConnection;

      if (!connection) {
        throw new Error("The selected provider connection is no longer available.");
      }

      const agent = await relayApi.createAgent({
        name: agentName.trim(),
        model: model.trim(),
        connectionId: connection.id,
        roles,
        instructions: instructions.trim(),
        color,
        enabled: true,
        parameters: { reasoningEffort }
      });
      onCreated(agent);
      onClose();
    } catch (caughtError) {
      setError(errorMessage(caughtError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Add an AI"
      description="Connect a local AI runtime, then define how this agent contributes to each round."
      onClose={onClose}
      size="large"
    >
      <div className="dialog-progress" aria-label={`Step ${step} of 2`}>
        <span className="is-complete">1</span>
        <span className={step === 2 ? "is-complete" : ""}>2</span>
        <div><strong>{step === 1 ? "Provider connection" : "Agent profile"}</strong><small>Step {step} of 2</small></div>
      </div>

      {step === 1 ? (
        <div className="setup-step">
          {connections.length ? (
            <div className="segmented-control" aria-label="Connection source">
              <button
                type="button"
                className={connectionMode === "existing" ? "is-active" : ""}
                onClick={() => setConnectionMode("existing")}
              >
                Existing connection
              </button>
              <button
                type="button"
                className={connectionMode === "new" ? "is-active" : ""}
                onClick={() => setConnectionMode("new")}
              >
                New connection
              </button>
            </div>
          ) : null}

          {connectionMode === "existing" ? (
            <div className="connection-options" role="radiogroup" aria-label="Provider connections">
              {connections.map((connection) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedConnectionId === connection.id}
                  className={`connection-option ${selectedConnectionId === connection.id ? "is-selected" : ""}`}
                  key={connection.id}
                  onClick={() => {
                    setSelectedConnectionId(connection.id);
                    setModel(getProviderPreset(connection.kind).modelPlaceholder);
                  }}
                >
                  <span className="provider-glyph">{connection.kind.slice(0, 1).toUpperCase()}</span>
                  <span><strong>{connection.name}</strong><small>{connection.maskedCredential}</small></span>
                  <span className={`connection-health connection-health--${connection.status}`}>{connection.status}</span>
                  {selectedConnectionId === connection.id ? <Check size={16} /> : null}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="provider-grid" role="radiogroup" aria-label="AI provider">
                {providerPresets.filter((provider) => provider.kind.startsWith("local_")).map((provider) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={providerKind === provider.kind}
                    className={`provider-option ${providerKind === provider.kind ? "is-selected" : ""}`}
                    key={provider.kind}
                    onClick={() => chooseProvider(provider.kind)}
                  >
                    <span className="provider-glyph">{provider.kind.slice(0, 1).toUpperCase()}</span>
                    <span><strong>{provider.name}</strong><small>{provider.description}</small></span>
                    {providerKind === provider.kind ? <Check size={15} /> : null}
                  </button>
                ))}
              </div>

              <div className="form-grid form-grid--two">
                <Field label="Connection name">
                  <input value={connectionName} onChange={(event) => setConnectionName(event.target.value)} />
                </Field>
                {customLocalProvider ? (
                  <>
                    <Field className="form-grid__wide" label="Command" hint="Use an absolute executable path. Relay invokes it without a shell.">
                      <input
                        value={localCommand}
                        placeholder="/absolute/path/to/your-ai-cli"
                        onChange={(event) => setLocalCommand(event.target.value)}
                      />
                    </Field>
                    <Field className="form-grid__wide" label="Arguments" hint="One argument per line. Use {prompt} in an argument, or leave it out to receive the prompt through standard input.">
                      <textarea
                        rows={4}
                        value={localArguments}
                        placeholder={"--model\nyour-model\n--prompt\n{prompt}"}
                        onChange={(event) => setLocalArguments(event.target.value)}
                      />
                    </Field>
                  </>
                ) : localProvider ? (
                  <Field label="Runtime">
                    <input value={providerKind === "local_codex" ? "Codex Desktop · MCP" : `${preset.name} · local CLI`} readOnly />
                  </Field>
                ) : (
                  <>
                    <Field label="Protocol">
                      <select value={protocol} onChange={(event) => setProtocol(event.target.value as ProviderProtocol)}>
                        <option value="responses">Responses API</option>
                        <option value="chat_completions">Chat Completions</option>
                      </select>
                    </Field>
                    <Field className="form-grid__wide" label="Base URL" hint="HTTPS endpoints only in production.">
                      <input
                        type="url"
                        inputMode="url"
                        value={baseUrl}
                        placeholder="https://api.example.com/v1"
                        onChange={(event) => setBaseUrl(event.target.value)}
                      />
                    </Field>
                    <Field className="form-grid__wide" label="API key">
                      <span className="input-with-action">
                        <KeyRound aria-hidden="true" size={15} />
                        <input
                          type={showCredential ? "text" : "password"}
                          autoComplete="new-password"
                          value={credential}
                          placeholder="Paste provider credential"
                          onChange={(event) => setCredential(event.target.value)}
                        />
                        <button
                          type="button"
                          aria-label={showCredential ? "Hide API key" : "Show API key"}
                          onClick={() => setShowCredential((visible) => !visible)}
                        >
                          {showCredential ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </span>
                    </Field>
                  </>
                )}
              </div>
              <div className="security-note"><ShieldCheck size={15} /><span>{customLocalProvider ? "Relay runs only this exact command, without a shell, from its isolated local AI directory. Command configuration stays encrypted in Relay." : localProvider ? `Uses the existing ${preset.name} login on this Mac. No API key is stored in Relay.` : "Encrypted at rest. Relay never returns the raw credential."}</span></div>
            </>
          )}

          {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
          <footer className="dialog-actions">
            <Button type="button" variant="quiet" onClick={onClose}>Cancel</Button>
            <Button type="button" variant="primary" onClick={advance}>Continue</Button>
          </footer>
        </div>
      ) : (
        <form className="setup-step" onSubmit={submit}>
          <div className="agent-connection-summary">
            <span className="provider-glyph">
              {(connectionMode === "new" ? providerKind : selectedConnection?.kind ?? "A").slice(0, 1).toUpperCase()}
            </span>
            <span><small>Connected through</small><strong>{connectionMode === "new" ? connectionName : selectedConnection?.name}</strong></span>
            <button type="button" onClick={() => setStep(1)}>Change</button>
          </div>

          <div className="form-grid form-grid--two">
            <Field label="Agent name">
              <input
                autoFocus
                value={agentName}
                placeholder="e.g. Systems critic"
                onChange={(event) => setAgentName(event.target.value)}
              />
            </Field>
            <Field label="Model ID">
              <input value={model} placeholder={preset.modelPlaceholder} onChange={(event) => setModel(event.target.value)} />
            </Field>
            <Field label="Thinking level" hint="Higher levels trade speed and usage for deeper reasoning.">
              <select
                value={reasoningEffort}
                onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
              >
                <option value="minimal">Quick · minimal</option>
                <option value="low">Fast · low</option>
                <option value="medium">Balanced · medium</option>
                <option value="high">Deep · high</option>
                <option value="xhigh">Maximum · xhigh</option>
              </select>
            </Field>
            <fieldset className="field form-grid__wide">
              <legend className="field__label">Roles in the loop</legend>
              <div className="role-options">
                {([
                  ["draft", Sparkles, "Produces an independent answer"],
                  ["review", UsersRound, "Critiques peer drafts"],
                  ["synthesize", Zap, "Builds the final consensus"]
                ] as const).map(([role, Icon, description]) => (
                  <label className={`role-option ${roles.includes(role) ? "is-selected" : ""}`} key={role}>
                    <input
                      type="checkbox"
                      checked={roles.includes(role)}
                      onChange={() => toggleRole(role)}
                    />
                    <Icon size={17} />
                    <span><strong>{role}</strong><small>{description}</small></span>
                    <span className="role-option__check"><Check size={12} /></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field className="form-grid__wide" label="Standing instructions" hint="Optional guidance applied every round.">
              <textarea
                rows={4}
                value={instructions}
                placeholder="Focus on correctness, call out assumptions, and cite evidence…"
                onChange={(event) => setInstructions(event.target.value)}
              />
            </Field>
            <fieldset className="field form-grid__wide">
              <legend className="field__label">Agent color</legend>
              <div className="color-options">
                {agentColors.map((candidate) => (
                  <label key={candidate} style={{ "--agent-color": candidate } as React.CSSProperties}>
                    <input type="radio" name="agent-color" checked={color === candidate} onChange={() => setColor(candidate)} />
                    <span>{color === candidate ? <Check size={13} /> : null}</span>
                    <span className="sr-only">Use {candidate}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
          <footer className="dialog-actions">
            <Button type="button" variant="quiet" onClick={() => setStep(1)} disabled={submitting}>Back</Button>
            <Button type="submit" variant="primary" loading={submitting} icon={<Bot size={16} />}>Add agent</Button>
          </footer>
        </form>
      )}
    </Dialog>
  );
}

interface CreateSessionDialogProps {
  open: boolean;
  agents: AgentSummary[];
  onClose: () => void;
  onCreated: (conversation: ConversationDetail) => void;
  onNeedsAgent: () => void;
  initialValues?: { title: string; objective: string } | null;
}

export function CreateSessionDialog({ open, agents, onClose, onCreated, onNeedsAgent, initialValues }: CreateSessionDialogProps) {
  const enabledAgents = useMemo(() => agents.filter((agent) => agent.enabled), [agents]);
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [objective, setObjective] = useState(initialValues?.objective ?? "");
  const [agentIds, setAgentIds] = useState<string[]>(() => enabledAgents.map((agent) => agent.id));
  const [synthesizerAgentId, setSynthesizerAgentId] = useState(
    () => enabledAgents.find((agent) => agent.roles.includes("synthesize"))?.id ?? ""
  );
  const [reviewTopology, setReviewTopology] = useState<"all_to_all" | "round_robin">("all_to_all");
  const [limitIterations, setLimitIterations] = useState(false);
  const [maxIterations, setMaxIterations] = useState("10");
  const [maxTotalTokens, setMaxTotalTokens] = useState("");
  const [startImmediately, setStartImmediately] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const synthesizerOptions = enabledAgents.filter(
    (agent) => agentIds.includes(agent.id) && agent.roles.includes("synthesize")
  );

  const toggleAgent = (agentId: string) => {
    setAgentIds((currentAgentIds) => {
      const nextAgentIds = currentAgentIds.includes(agentId)
        ? currentAgentIds.filter((currentAgentId) => currentAgentId !== agentId)
        : [...currentAgentIds, agentId];

      if (!nextAgentIds.includes(synthesizerAgentId)) {
        setSynthesizerAgentId(
          enabledAgents.find(
            (agent) => nextAgentIds.includes(agent.id) && agent.roles.includes("synthesize")
          )?.id ?? ""
        );
      }

      return nextAgentIds;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!title.trim() || !objective.trim()) {
      setError("Give the session a title and clear objective.");
      return;
    }

    if (agentIds.length < 2) {
      setError("Choose at least two agents so they can review each other.");
      return;
    }

    if (!synthesizerAgentId || !synthesizerOptions.some((agent) => agent.id === synthesizerAgentId)) {
      setError("No selected agent can synthesize. Edit an agent to add the synthesize role, then try again.");
      return;
    }

    setSubmitting(true);

    try {
      if (startImmediately) {
        await verifyProviderConnections(
          enabledAgents.filter((agent) => agentIds.includes(agent.id)).map((agent) => agent.connectionId)
        );
      }

      const conversation = await relayApi.createConversation({
        title: title.trim(),
        objective: objective.trim(),
        agentIds
      });

      if (startImmediately) {
        const { run } = await relayApi.startRun(conversation.id, {
          synthesizerAgentId,
          reviewTopology,
          maxIterations: limitIterations ? Number(maxIterations) : null,
          maxTotalTokens: maxTotalTokens ? Number(maxTotalTokens) : null
        });
        onCreated({
          ...conversation,
          run,
          status: run.status,
          phase: run.phase,
          iteration: run.currentIteration,
          totalTokens: run.totalInputTokens + run.totalOutputTokens
        });
      } else {
        onCreated(conversation);
      }

      onClose();
    } catch (caughtError) {
      setError(errorMessage(caughtError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Create a session"
      description="Choose the team, objective, and guardrails. Relay will coordinate every round."
      onClose={onClose}
      size="large"
    >
      {enabledAgents.length < 2 ? (
        <div className="configuration-empty">
          <span><UsersRound size={22} /></span>
          <h3>Add at least two agents</h3>
          <p>A Relay session needs peers that can draft independently and review one another.</p>
          <Button variant="primary" icon={<Bot size={16} />} onClick={() => { onClose(); onNeedsAgent(); }}>
            Add an AI
          </Button>
        </div>
      ) : (
        <form className="session-form" onSubmit={submit}>
          <div className="form-grid form-grid--two">
            <Field className="form-grid__wide" label="Session title">
              <input
                autoFocus
                value={title}
                maxLength={90}
                placeholder="e.g. Launch readiness review"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field className="form-grid__wide" label="Objective" hint="Be specific about the decision or deliverable you need.">
              <textarea
                rows={4}
                value={objective}
                placeholder="Evaluate the launch plan, identify material risks, and produce a prioritized recommendation…"
                onChange={(event) => setObjective(event.target.value)}
              />
            </Field>
          </div>

          <fieldset className="field">
            <legend className="field__label">Agent team <span>{agentIds.length} selected</span></legend>
            <div className="agent-picker">
              {enabledAgents.map((agent) => (
                <label className={`agent-picker__item ${agentIds.includes(agent.id) ? "is-selected" : ""}`} key={agent.id}>
                  <input type="checkbox" checked={agentIds.includes(agent.id)} onChange={() => toggleAgent(agent.id)} />
                  <span className="agent-avatar" style={{ "--agent-color": agent.color } as React.CSSProperties}>{initials(agent.name)}</span>
                  <span><strong>{agent.name}</strong><small>{agent.model}</small></span>
                  <span className="agent-picker__roles">{agent.roles.join(" · ")}</span>
                  <span className="role-option__check"><Check size={12} /></span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="form-grid form-grid--two">
            <Field label="Round synthesizer">
              <select value={synthesizerAgentId} onChange={(event) => setSynthesizerAgentId(event.target.value)}>
                {synthesizerOptions.length ? synthesizerOptions.map((agent) => (
                  <option value={agent.id} key={agent.id}>{agent.name} · {agent.model}</option>
                )) : <option value="">No selected agent has this role</option>}
              </select>
            </Field>
            <Field label="Review pattern">
              <select value={reviewTopology} onChange={(event) => setReviewTopology(event.target.value as "all_to_all" | "round_robin")}>
                <option value="all_to_all">All-to-all · highest coverage</option>
                <option value="round_robin">Round robin · lower cost</option>
              </select>
            </Field>
          </div>

          <div className="run-guardrails">
            <div className="run-guardrails__heading">
              <span><Network size={17} /></span>
              <div><strong>Loop guardrails</strong><small>Continuous by default. You can pause or stop at any time.</small></div>
            </div>
            <label className="toggle-row">
              <span className="toggle"><input type="checkbox" checked={limitIterations} onChange={(event) => setLimitIterations(event.target.checked)} /><span /></span>
              <span><strong>Limit rounds</strong><small>{limitIterations ? "Stop after a fixed number" : "Run until manually stopped"}</small></span>
              {limitIterations ? (
                <input
                  className="compact-input"
                  type="number"
                  min="1"
                  max="10000"
                  value={maxIterations}
                  aria-label="Maximum rounds"
                  onChange={(event) => setMaxIterations(event.target.value)}
                />
              ) : <InfinityIcon aria-label="No round limit" size={19} />}
            </label>
            <label className="toggle-row">
              <span className="toggle"><input type="checkbox" checked={Boolean(maxTotalTokens)} onChange={(event) => setMaxTotalTokens(event.target.checked ? "1000000" : "")} /><span /></span>
              <span><strong>Token ceiling</strong><small>{maxTotalTokens ? "Stop before exceeding the budget" : "No token ceiling"}</small></span>
              {maxTotalTokens ? (
                <input
                  className="compact-input compact-input--wide"
                  type="number"
                  min="1000"
                  step="1000"
                  value={maxTotalTokens}
                  aria-label="Maximum total tokens"
                  onChange={(event) => setMaxTotalTokens(event.target.value)}
                />
              ) : <InfinityIcon aria-label="No token limit" size={19} />}
            </label>
          </div>

          <label className="start-toggle">
            <span className="toggle"><input type="checkbox" checked={startImmediately} onChange={(event) => setStartImmediately(event.target.checked)} /><span /></span>
            <span><strong>Start immediately</strong><small>Check each selected runtime, then begin round one.</small></span>
          </label>

          {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
          <footer className="dialog-actions">
            <Button type="button" variant="quiet" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant="primary" loading={submitting} icon={<Zap size={16} />}>
              {startImmediately ? "Create & start" : "Create session"}
            </Button>
          </footer>
        </form>
      )}
    </Dialog>
  );
}

export function StopRunDialog({
  run,
  open,
  onClose,
  onStopped
}: {
  run: RunDetail | null;
  open: boolean;
  onClose: () => void;
  onStopped: (run: RunDetail) => void;
}) {
  const [mode, setMode] = useState<"graceful" | "immediate">("graceful");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = async () => {
    if (!run) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      onStopped(await relayApi.stopRun(run.id, mode));
      onClose();
    } catch (caughtError) {
      setError(errorMessage(caughtError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} title="Stop this run?" description="Choose how Relay should halt the active round." onClose={onClose} size="small">
      <div className="stop-options" role="radiogroup" aria-label="Stop mode">
        <button type="button" role="radio" aria-checked={mode === "graceful"} className={mode === "graceful" ? "is-selected" : ""} onClick={() => setMode("graceful")}>
          <span><ShieldCheck size={17} /></span>
          <span><strong>Finish current work</strong><small>Let active calls complete, save the checkpoint, then stop.</small></span>
          <span className="radio-mark" />
        </button>
        <button type="button" role="radio" aria-checked={mode === "immediate"} className={mode === "immediate" ? "is-selected" : ""} onClick={() => setMode("immediate")}>
          <span><Zap size={17} /></span>
          <span><strong>Stop immediately</strong><small>Cancel in-flight work. Partial artifacts may be retained.</small></span>
          <span className="radio-mark" />
        </button>
      </div>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      <footer className="dialog-actions">
        <Button type="button" variant="quiet" onClick={onClose} disabled={submitting}>Keep running</Button>
        <Button type="button" variant="danger" loading={submitting} onClick={stop}>Stop run</Button>
      </footer>
    </Dialog>
  );
}
