"use client";

import {
  Bot,
  ChevronDown,
  Import,
  LogOut,
  Plus,
  Search,
  Settings2,
  X
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationSummary, Viewer } from "@/lib/contracts";
import { formatCompactNumber, formatRelativeTime, initials } from "@/components/formatters";
import { Button, IconButton } from "@/components/ui";

interface SessionRailProps {
  viewer: Viewer;
  canOperate: boolean;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelectConversation: (conversationId: string) => void;
  onCreateSession: () => void;
  onImportThread: () => void;
  onAddAgent: () => void;
  onLogout: () => void;
}

export function SessionRail({
  viewer,
  canOperate,
  conversations,
  activeConversationId,
  mobileOpen,
  onCloseMobile,
  onSelectConversation,
  onCreateSession,
  onImportThread,
  onAddAgent,
  onLogout
}: SessionRailProps) {
  const [query, setQuery] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return conversations;
    }

    return conversations.filter((conversation) =>
      `${conversation.title} ${conversation.objective}`.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [conversations, query]);

  useEffect(() => {
    const focusSessionSearch = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (!event.metaKey && !event.ctrlKey) || event.key.toLocaleLowerCase() !== "k") {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener("keydown", focusSessionSearch);
    return () => window.removeEventListener("keydown", focusSessionSearch);
  }, []);

  return (
    <>
      {mobileOpen ? (
        <button className="drawer-backdrop" aria-label="Dismiss session navigation" onClick={onCloseMobile} />
      ) : null}
      <aside className={`session-rail ${mobileOpen ? "is-open" : ""}`} aria-label="Session navigation">
        <header className="session-rail__header">
          <Link className="relay-lockup" href="/" aria-label="Relay home">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            <span>RELAY</span>
          </Link>
          <IconButton
            className="session-rail__close"
            label="Close session navigation"
            icon={<X size={18} />}
            onClick={onCloseMobile}
          />
        </header>

        <Button
          variant="primary"
          className="session-rail__new"
          icon={<Plus size={16} />}
          onClick={onCreateSession}
          disabled={!canOperate}
          title={canOperate ? undefined : "Viewer access is read-only"}
        >
          New session
        </Button>
        <Button
          className="session-rail__import"
          icon={<Import size={16} />}
          onClick={onImportThread}
          disabled={!canOperate}
        >
          Import local task
        </Button>

        <label className="session-search">
          <Search aria-hidden="true" size={15} />
          <span className="sr-only">Search sessions</span>
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Search sessions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>⌘ K</kbd>
        </label>

        <div className="session-rail__label">
          <span>Sessions</span>
          <span>{filteredConversations.length}</span>
        </div>

        <nav className="session-list" aria-label="Sessions">
          {filteredConversations.length ? (
            filteredConversations.map((conversation) => (
              <button
                className={`session-item ${activeConversationId === conversation.id ? "is-active" : ""}`}
                key={conversation.id}
                onClick={() => {
                  onSelectConversation(conversation.id);
                  onCloseMobile();
                }}
                aria-current={activeConversationId === conversation.id ? "page" : undefined}
              >
                <span className={`session-item__signal session-item__signal--${conversation.status}`} />
                <span className="session-item__body">
                  <strong>{conversation.title}</strong>
                  <span>{conversation.status === "idle" ? "Ready to start" : `Round ${conversation.iteration} · ${conversation.phase}`}</span>
                  <span className="session-item__meta">
                    <span>{formatRelativeTime(conversation.updatedAt)}</span>
                    <span>{formatCompactNumber(conversation.totalTokens)} tok</span>
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="session-list__empty">
              <span className="session-list__empty-icon"><Search size={17} /></span>
              <p>{conversations.length ? "No matching sessions" : "No sessions yet"}</p>
              <span>{conversations.length ? "Try a different search." : "Create one to start a run."}</span>
            </div>
          )}
        </nav>

        <div className="session-rail__footer">
          <button className="manage-agents" onClick={onAddAgent} disabled={!canOperate} title={canOperate ? undefined : "Viewer access is read-only"}>
            <span className="manage-agents__icon"><Bot size={16} /></span>
            <span><strong>Add an AI</strong><small>Providers & agents</small></span>
            <Plus size={15} />
          </button>

          <div className="account-menu">
            {accountOpen ? (
              <div className="account-menu__popover">
                <button onClick={onAddAgent}><Settings2 size={15} /> Workspace setup</button>
                <button onClick={onLogout}><LogOut size={15} /> Sign out</button>
              </div>
            ) : null}
            <button
              className="account-button"
              onClick={() => setAccountOpen((open) => !open)}
              aria-expanded={accountOpen}
            >
              <span className="avatar">{initials(viewer.name)}</span>
              <span><strong>{viewer.name}</strong><small>{viewer.workspaceName}</small></span>
              <ChevronDown size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
