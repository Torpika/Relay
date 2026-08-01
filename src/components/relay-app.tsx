"use client";

import {
  Activity,
  Bot,
  ChevronDown,
  CircleAlert,
  Files,
  Plus,
  RefreshCw,
  Sparkles,
  UsersRound
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSummary,
  ArtifactSummary,
  ConversationDetail,
  DashboardPayload,
  DomainEvent,
  IterationDetail,
  RunDetail
} from "@/lib/contracts";
import { ApiError, relayApi, subscribeToConversation } from "@/components/api-client";
import {
  ArtifactView,
  ConversationWaitingView,
  type WorkspaceView,
  workspaceViews
} from "@/components/artifact-views";
import { AppLoadingScreen, AuthScreen } from "@/components/auth-screen";
import { formatPhase } from "@/components/formatters";
import { InstructionComposer } from "@/components/instruction-composer";
import { LocalThreadsDialog } from "@/components/local-threads-dialog";
import { RunHeader } from "@/components/run-header";
import { RunInspector } from "@/components/run-inspector";
import { SessionRail } from "@/components/session-rail";
import { AddAgentDialog, CreateSessionDialog, StopRunDialog } from "@/components/setup-dialogs";
import { Button, Skeleton, ToastRegion, type ToastMessage } from "@/components/ui";
import type { LocalThreadImport } from "@/local/threads/types";

type AppState = "loading" | "ready" | "signed_out" | "error";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Relay could not reach the workspace service.";
}

function createPlaceholderIteration(conversation: ConversationDetail): IterationDetail {
  return {
    id: `pending-${conversation.id}`,
    number: conversation.run?.currentIteration || 1,
    phase: conversation.run?.phase ?? "preparing",
    status: conversation.run?.status === "failed" ? "failed" : "running",
    synthesis: null,
    artifacts: [],
    startedAt: conversation.run?.startedAt ?? null,
    completedAt: null
  };
}

function ConversationLoading() {
  return (
    <div className="conversation-loading" aria-label="Loading session">
      <header><Skeleton /><Skeleton /><Skeleton /></header>
      <div className="conversation-loading__steps">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} />)}</div>
      <div className="conversation-loading__tabs">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} />)}</div>
      <div className="conversation-loading__artifacts"><Skeleton /><Skeleton /></div>
    </div>
  );
}

function EmptyWorkspace({
  hasAgents,
  onCreateSession,
  onAddAgent,
  onOpenSessions,
  canOperate
}: {
  hasAgents: boolean;
  onCreateSession: () => void;
  onAddAgent: () => void;
  onOpenSessions: () => void;
  canOperate: boolean;
}) {
  return (
    <main className="empty-workspace">
      <button className="empty-workspace__menu mobile-only" onClick={onOpenSessions}><Files size={18} /> Sessions</button>
      <div className="empty-workspace__signal" aria-hidden="true">
        <span><Bot size={25} /></span><span><Sparkles size={20} /></span><span><UsersRound size={22} /></span>
      </div>
      <p className="eyebrow">Relay control plane</p>
      <h1>{hasAgents ? "Start a new session" : "Build your agent team"}</h1>
      <p>
        {hasAgents
          ? "Set an objective, choose your agents, and let the team iterate until you tell it to stop."
          : "Create two or more local AI agents. Relay supports Codex, Claude Code, Gemini CLI, and Kimi Code without API keys."}
      </p>
      <div className="empty-workspace__actions">
        <Button
          variant="primary"
          icon={hasAgents ? <Plus size={16} /> : <Bot size={16} />}
          onClick={hasAgents ? onCreateSession : onAddAgent}
          disabled={!canOperate}
        >
          {hasAgents ? "Create session" : "Add your first AI"}
        </Button>
        {hasAgents ? <Button icon={<Bot size={16} />} onClick={onAddAgent} disabled={!canOperate}>Add another AI</Button> : null}
      </div>
      <div className="empty-workspace__flow" aria-label="Relay workflow">
        <span>Independent drafts</span><i /><span>Peer review</span><i /><span>Consensus</span><i /><span>Next round</span>
      </div>
    </main>
  );
}

function EmptyInspector({ agents }: { agents: AgentSummary[] }) {
  return (
    <aside className="run-inspector run-inspector--empty" aria-label="Workspace overview">
      <header className="run-inspector__header"><div><p className="eyebrow">Workspace</p><h2>Setup overview</h2></div></header>
      <div className="run-inspector__scroll">
        <section className="inspector-section">
          <div className="inspector-section-title"><h3>Available agents</h3><span>{agents.length}</span></div>
          {agents.length ? (
            <div className="inspector-agents">
              {agents.slice(0, 6).map((agent) => (
                <div className="inspector-agent" key={agent.id}>
                  <span className="agent-avatar">{agent.name.slice(0, 2).toUpperCase()}</span>
                  <div><strong>{agent.name}</strong><small>{agent.model} · {agent.parameters.reasoningEffort ?? "default"} thinking</small></div>
                  <span className="agent-health agent-health--healthy" />
                  <p>{agent.roles.join(" · ")}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="inspector-empty-copy">No agents are connected yet.</p>
          )}
        </section>
        <section className="inspector-section inspector-tip">
          <Activity size={17} />
          <div><strong>Continuous by design</strong><p>Rounds continue automatically. Pause to inspect or stop when the result is ready.</p></div>
        </section>
      </div>
    </aside>
  );
}

function AppError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="app-error">
      <span><CircleAlert size={24} /></span>
      <p className="eyebrow">Connection interrupted</p>
      <h1>Relay is unavailable</h1>
      <p>{message}</p>
      <Button variant="primary" icon={<RefreshCw size={16} />} onClick={onRetry}>Try again</Button>
    </main>
  );
}

export function RelayApp() {
  const [appState, setAppState] = useState<AppState>("loading");
  const [appError, setAppError] = useState("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("drafts");
  const [selectedIterationNumber, setSelectedIterationNumber] = useState<number | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [sessionRailOpen, setSessionRailOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const [localThreadsOpen, setLocalThreadsOpen] = useState(false);
  const [importedThread, setImportedThread] = useState<LocalThreadImport | null>(null);
  const [stopRunOpen, setStopRunOpen] = useState(false);
  const [commandPending, setCommandPending] = useState<"start" | "pause" | "resume" | null>(null);
  const [instructionPending, setInstructionPending] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastId = useRef(0);
  const activeConversationId = useRef<string | null>(selectedConversationId);

  useEffect(() => {
    activeConversationId.current = selectedConversationId;
  }, [selectedConversationId]);

  const showToast = useCallback((tone: ToastMessage["tone"], title: string, detail?: string) => {
    const id = ++toastId.current;
    setToasts((currentToasts) => [...currentToasts, { id, tone, title, detail }]);
    window.setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);

  const loadDashboard = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setAppState("loading");
    }

    try {
      const nextDashboard = await relayApi.getDashboard();
      setDashboard(nextDashboard);
      setSelectedConversationId((currentId) =>
        currentId && nextDashboard.conversations.some((candidate) => candidate.id === currentId)
          ? currentId
          : nextDashboard.conversations[0]?.id ?? null
      );
      setAppState("ready");
      setAppError("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setDashboard(null);
        setAppState("signed_out");
      } else {
        setAppError(getErrorMessage(error));
        setAppState("error");
      }
    }
  }, []);

  const refreshConversation = useCallback(async (conversationId: string, showLoading = false) => {
    if (showLoading) {
      setConversationLoading(true);
      setConversationError(null);
    }

    try {
      const detail = await relayApi.getConversation(conversationId);

      if (activeConversationId.current !== conversationId) {
        return null;
      }

      setConversation(detail);
      setConversationError(null);
      return detail;
    } catch (error) {
      if (showLoading && activeConversationId.current === conversationId) {
        setConversationError(getErrorMessage(error));
      }
      return null;
    } finally {
      if (showLoading && activeConversationId.current === conversationId) {
        setConversationLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConversation(null);
      setConversationError(null);
      setEvents([]);
      setSelectedArtifactId(null);
      setSelectedIterationNumber(null);
      setView("drafts");

      if (selectedConversationId) {
        void refreshConversation(selectedConversationId, true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [refreshConversation, selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    let refreshTimer: number | undefined;
    const unsubscribe = subscribeToConversation(
      selectedConversationId,
      (event) => {
        setEvents((currentEvents) =>
          currentEvents.some((candidate) => candidate.id === event.id)
            ? currentEvents
            : [event, ...currentEvents].slice(0, 150)
        );
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
          void refreshConversation(selectedConversationId);
          void loadDashboard();
        }, 350);
      },
      setStreamConnected
    );

    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribe();
      setStreamConnected(false);
    };
  }, [loadDashboard, refreshConversation, selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId || !conversation?.run || !["starting", "running", "pausing", "resuming", "stopping"].includes(conversation.run.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshConversation(selectedConversationId);
    }, 8000);

    return () => window.clearInterval(interval);
  }, [conversation?.run, refreshConversation, selectedConversationId]);

  const updateRun = (run: RunDetail) => {
    setConversation((currentConversation) =>
      currentConversation
        ? {
            ...currentConversation,
            run,
            status: run.status,
            phase: run.phase,
            iteration: run.currentIteration,
            totalTokens: run.totalInputTokens + run.totalOutputTokens
          }
        : currentConversation
    );
  };

  const startRun = async () => {
    if (!conversation) {
      return;
    }

    setCommandPending("start");

    try {
      const previousRun = conversation.run;
      const { run } = await relayApi.startRun(
        conversation.id,
        previousRun
          ? {
              synthesizerAgentId: previousRun.synthesizerAgentId,
              reviewTopology: previousRun.reviewTopology,
              maxIterations: previousRun.maxIterations,
              maxTotalTokens: previousRun.maxTotalTokens
            }
          : {}
      );
      updateRun(run);

      showToast("success", "Run started", "Round one is being prepared.");
      void refreshConversation(conversation.id);
      void loadDashboard();
    } catch (error) {
      showToast("danger", "Could not start run", getErrorMessage(error));
    } finally {
      setCommandPending(null);
    }
  };

  const pauseRun = async () => {
    if (!conversation?.run) {
      return;
    }

    setCommandPending("pause");

    try {
      updateRun(await relayApi.pauseRun(conversation.run.id));
      showToast("info", "Pause requested", "Relay will checkpoint active work safely.");
    } catch (error) {
      showToast("danger", "Could not pause run", getErrorMessage(error));
    } finally {
      setCommandPending(null);
    }
  };

  const resumeRun = async () => {
    if (!conversation?.run) {
      return;
    }

    setCommandPending("resume");

    try {
      updateRun(await relayApi.resumeRun(conversation.run.id));
      showToast("success", "Run resumed", "The team is continuing from its latest checkpoint.");
    } catch (error) {
      showToast("danger", "Could not resume run", getErrorMessage(error));
    } finally {
      setCommandPending(null);
    }
  };

  const queueInstruction = async (instruction: string): Promise<boolean> => {
    if (!conversation?.run) {
      return false;
    }

    setInstructionPending(true);

    try {
      const result = await relayApi.queueInstruction(conversation.run.id, instruction);
      setConversation((currentConversation) =>
        currentConversation ? { ...currentConversation, pendingInstruction: result.pendingInstruction } : currentConversation
      );
      showToast("success", "Instruction queued", "It will be applied at the next round boundary.");
      return true;
    } catch (error) {
      showToast("danger", "Could not queue instruction", getErrorMessage(error));
      return false;
    } finally {
      setInstructionPending(false);
    }
  };

  const logout = async () => {
    try {
      await relayApi.logout();
      setDashboard(null);
      setConversation(null);
      setAppState("signed_out");
    } catch (error) {
      showToast("danger", "Could not sign out", getErrorMessage(error));
    }
  };

  const createdAgent = (agent: AgentSummary) => {
    showToast("success", `${agent.name} added`, `${agent.model} is ready to join a session.`);
    void loadDashboard();
  };

  const createdConversation = (detail: ConversationDetail) => {
    setConversation(detail);
    setSelectedConversationId(detail.id);
    showToast("success", "Session created", detail.run ? "The first round is starting." : "The team is ready.");
    void loadDashboard();
  };

  const selectLocalThread = (thread: LocalThreadImport) => {
    setImportedThread(thread);
    setLocalThreadsOpen(false);
    setCreateSessionOpen(true);
  };

  const openCreateSession = () => {
    setImportedThread(null);
    setCreateSessionOpen(true);
  };

  const selectedIteration = useMemo(() => {
    if (!conversation) {
      return null;
    }

    return (
      conversation.iterations.find((iteration) => iteration.number === selectedIterationNumber) ??
      conversation.iterations.at(-1) ??
      (conversation.run ? createPlaceholderIteration(conversation) : null)
    );
  }, [conversation, selectedIterationNumber]);

  const selectedArtifact = useMemo(() => {
    if (!conversation || !selectedArtifactId) {
      return null;
    }

    return conversation.iterations.flatMap((iteration) => iteration.artifacts).find((artifact) => artifact.id === selectedArtifactId) ?? null;
  }, [conversation, selectedArtifactId]);

  const viewCounts = useMemo<Record<WorkspaceView, number>>(() => ({
    drafts: selectedIteration?.artifacts.filter((artifact) => artifact.kind === "draft").length ?? 0,
    reviews: selectedIteration?.artifacts.filter((artifact) => artifact.kind === "review").length ?? 0,
    synthesis: selectedIteration && (selectedIteration.synthesis || selectedIteration.artifacts.some((artifact) => artifact.kind === "synthesis")) ? 1 : 0,
    activity: events.length
  }), [events.length, selectedIteration]);

  if (appState === "loading") {
    return <AppLoadingScreen />;
  }

  if (appState === "signed_out") {
    return <AuthScreen />;
  }

  if (appState === "error" || !dashboard) {
    return <AppError message={appError} onRetry={() => void loadDashboard(true)} />;
  }

  const canOperate = dashboard.viewer.role !== "viewer";

  return (
    <>
      <div className="relay-shell">
        <SessionRail
          viewer={dashboard.viewer}
          canOperate={canOperate}
          conversations={dashboard.conversations}
          activeConversationId={selectedConversationId}
          mobileOpen={sessionRailOpen}
          onCloseMobile={() => setSessionRailOpen(false)}
          onSelectConversation={setSelectedConversationId}
          onCreateSession={openCreateSession}
          onImportThread={() => setLocalThreadsOpen(true)}
          onAddAgent={() => setAddAgentOpen(true)}
          onLogout={() => void logout()}
        />

        <section className="workspace" aria-label="Active session">
          {selectedConversationId && conversationLoading ? <ConversationLoading /> : null}
          {selectedConversationId && conversationError && !conversationLoading ? (
            <div className="conversation-error">
              <CircleAlert size={24} />
              <h2>Could not open this session</h2>
              <p>{conversationError}</p>
              <Button icon={<RefreshCw size={16} />} onClick={() => void refreshConversation(selectedConversationId, true)}>Retry</Button>
            </div>
          ) : null}
          {!selectedConversationId ? (
            <EmptyWorkspace
              hasAgents={dashboard.agents.length >= 2}
              onCreateSession={openCreateSession}
              onAddAgent={() => setAddAgentOpen(true)}
              onOpenSessions={() => setSessionRailOpen(true)}
              canOperate={canOperate}
            />
          ) : null}
          {conversation && !conversationLoading ? (
            <>
              <RunHeader
                conversation={conversation}
                canOperate={canOperate}
                streamConnected={streamConnected}
                commandPending={commandPending}
                onOpenSessions={() => setSessionRailOpen(true)}
                onOpenInspector={() => setInspectorOpen(true)}
                onStart={() => void startRun()}
                onPause={() => void pauseRun()}
                onResume={() => void resumeRun()}
                onStop={() => setStopRunOpen(true)}
              />

              {!conversation.run ? (
                <ConversationWaitingView onStart={() => void startRun()} disabled={commandPending === "start" || !canOperate} />
              ) : selectedIteration ? (
                <>
                  <div className="workspace-toolbar">
                    <nav className="view-tabs" aria-label="Session results">
                      {workspaceViews.map(({ id, label, icon: Icon }) => (
                        <button
                          className={view === id ? "is-active" : ""}
                          key={id}
                          onClick={() => setView(id)}
                          aria-current={view === id ? "page" : undefined}
                        >
                          <Icon size={15} />
                          <span>{label}</span>
                          {viewCounts[id] ? <small>{viewCounts[id]}</small> : null}
                        </button>
                      ))}
                    </nav>
                    <label className="round-select">
                      <span className="sr-only">View round</span>
                      <select value={selectedIteration.number} onChange={(event) => { setSelectedIterationNumber(Number(event.target.value)); setSelectedArtifactId(null); }}>
                        {conversation.iterations.length ? conversation.iterations.slice().reverse().map((iteration) => (
                          <option value={iteration.number} key={iteration.id}>Round {iteration.number} · {formatPhase(iteration.phase)}</option>
                        )) : <option value={selectedIteration.number}>Round {selectedIteration.number} · {formatPhase(selectedIteration.phase)}</option>}
                      </select>
                      <ChevronDown size={14} />
                    </label>
                  </div>

                  <div className="workspace-content" key={`${view}-${selectedIteration.number}`}>
                    <ArtifactView
                      view={view}
                      iteration={selectedIteration}
                      events={events}
                      selectedArtifactId={selectedArtifactId}
                      onSelectArtifact={(artifact: ArtifactSummary) => {
                        setSelectedArtifactId(artifact.id);
                        setInspectorOpen(true);
                      }}
                    />
                  </div>
                  <InstructionComposer
                    pendingInstruction={conversation.pendingInstruction}
                    disabled={!canOperate || ["stopped", "stopping", "failed"].includes(conversation.run.status)}
                    submitting={instructionPending}
                    onSubmit={queueInstruction}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </section>

        {conversation ? (
          <RunInspector
            conversation={conversation}
            connections={dashboard.connections}
            selectedArtifact={selectedArtifact}
            mobileOpen={inspectorOpen}
            onCloseMobile={() => setInspectorOpen(false)}
            onClearArtifact={() => setSelectedArtifactId(null)}
          />
        ) : <EmptyInspector agents={dashboard.agents} />}
      </div>

      {addAgentOpen ? (
        <AddAgentDialog
          open
          connections={dashboard.connections}
          onClose={() => setAddAgentOpen(false)}
          onCreated={createdAgent}
        />
      ) : null}
      {createSessionOpen ? (
        <CreateSessionDialog
          open
          agents={dashboard.agents}
          onClose={() => setCreateSessionOpen(false)}
          onCreated={createdConversation}
          onNeedsAgent={() => setAddAgentOpen(true)}
          initialValues={importedThread ? {
            title: `Review · ${importedThread.title}`.slice(0, 90),
            objective: [
              "Review and improve this task imported from a local AI conversation.",
              `Source: ${importedThread.provider}`,
              importedThread.workingDirectory ? `Original working directory: ${importedThread.workingDirectory}` : null,
              importedThread.truncated ? "The middle of the original transcript was shortened to fit this session." : null,
              "Imported transcript:",
              importedThread.content || importedThread.preview || importedThread.title,
              "Identify errors and disagreements, propose fixes, and iterate until the selected reviewers approve."
            ].filter(Boolean).join("\n\n")
          } : null}
        />
      ) : null}
      {localThreadsOpen ? (
        <LocalThreadsDialog
          open
          onClose={() => setLocalThreadsOpen(false)}
          onSelect={selectLocalThread}
        />
      ) : null}
      {stopRunOpen ? (
        <StopRunDialog
          open
          run={conversation?.run ?? null}
          onClose={() => setStopRunOpen(false)}
          onStopped={(run) => {
            updateRun(run);
            showToast("info", run.stopMode === "immediate" ? "Run stopped" : "Stop requested", run.stopMode === "immediate" ? "In-flight work was cancelled." : "Relay will stop at the next safe checkpoint.");
            void loadDashboard();
          }}
        />
      ) : null}
      <ToastRegion toasts={toasts} />
    </>
  );
}
