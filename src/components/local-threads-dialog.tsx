"use client";

import { Archive, Bot, CircleAlert, FolderOpen, Import, LoaderCircle, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LocalThreadDiscoveryPayload, LocalThreadImport, LocalThreadSummary } from "@/local/threads/types";
import { relayApi } from "@/components/api-client";
import { formatRelativeTime } from "@/components/formatters";
import { Button, Dialog } from "@/components/ui";

export function LocalThreadsDialog({
  open,
  onClose,
  onSelect
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (thread: LocalThreadImport) => void;
}) {
  const [payload, setPayload] = useState<LocalThreadDiscoveryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importingThreadId, setImportingThreadId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    void relayApi.getLocalThreads()
      .then((result) => {
        if (active) {
          setPayload(result);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : "Local task discovery failed.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open]);

  const filteredThreads = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    if (!payload || !normalizedQuery) {
      return payload?.threads ?? [];
    }

    return payload.threads.filter((thread) =>
      `${thread.title} ${thread.preview} ${thread.provider} ${thread.workingDirectory ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    );
  }, [payload, query]);

  const importThread = async (thread: LocalThreadSummary) => {
    setImportError(null);
    setImportingThreadId(thread.id);

    try {
      onSelect(await relayApi.importLocalThread(thread.id));
    } catch (caughtError) {
      setImportError(caughtError instanceof Error ? caughtError.message : "The local task could not be imported.");
    } finally {
      setImportingThreadId(null);
    }
  };

  return (
    <Dialog
      open={open}
      title="Import a local AI task"
      description="Relay reads supported local task indexes without modifying the source application."
      onClose={onClose}
      size="large"
    >
      {loading ? (
        <div className="local-threads-state"><LoaderCircle className="spin" size={24} /><strong>Scanning local AI tasks…</strong></div>
      ) : error ? (
        <div className="local-threads-state"><CircleAlert size={24} /><strong>Discovery failed</strong><p>{error}</p></div>
      ) : payload ? (
        <div className="local-threads">
          <div className="local-thread-sources" aria-label="Local AI sources">
            {payload.sources.map((source) => (
              <div className={`local-thread-source local-thread-source--${source.status}`} key={source.provider} title={source.detail}>
                <Bot size={15} />
                <span><strong>{source.name}</strong><small>{source.status === "available" ? `${source.threadCount} tasks` : source.status.replace("_", " ")}</small></span>
              </div>
            ))}
          </div>

          <label className="local-thread-search">
            <Search size={15} />
            <span className="sr-only">Search local AI tasks</span>
            <input autoFocus value={query} placeholder="Search local tasks" onChange={(event) => setQuery(event.target.value)} />
          </label>

          <div className="local-thread-list" aria-label="Discovered local AI tasks">
            {filteredThreads.length ? filteredThreads.map((thread) => (
              <button
                type="button"
                className="local-thread-item"
                key={thread.id}
                disabled={Boolean(importingThreadId)}
                onClick={() => void importThread(thread)}
              >
                <span className="local-thread-item__icon">{thread.archived ? <Archive size={16} /> : <FolderOpen size={16} />}</span>
                <span className="local-thread-item__body">
                  <strong>{thread.title}</strong>
                  <small>{thread.preview || "No preview is available for this task."}</small>
                  <span>{providerName(thread.provider)} · {formatRelativeTime(thread.updatedAt)}{thread.workingDirectory ? ` · ${thread.workingDirectory}` : ""}</span>
                </span>
                {importingThreadId === thread.id ? <LoaderCircle className="spin" size={16} /> : <Import size={16} />}
              </button>
            )) : (
              <div className="local-threads-state"><Search size={22} /><strong>No matching local tasks</strong><p>Install or use a supported AI CLI, or try another search.</p></div>
            )}
          </div>

          {importError ? <p className="local-thread-import-error"><CircleAlert size={14} />{importError}</p> : null}

          <footer className="dialog-actions">
            <Button type="button" variant="quiet" onClick={onClose}>Cancel</Button>
          </footer>
        </div>
      ) : null}
    </Dialog>
  );
}

function providerName(provider: LocalThreadSummary["provider"]): string {
  return {
    codex: "Codex",
    claude_code: "Claude Code",
    gemini_cli: "Gemini CLI",
    kimi_cli: "Kimi Code",
    claude_desktop: "Claude Desktop",
    kimi_desktop: "Kimi Desktop"
  }[provider];
}
