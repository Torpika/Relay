import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { Viewer } from "@/lib/contracts";
import { getDatabase, type Queryable, withTransaction } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import { readCookie, sessionCookieName } from "@/server/auth/cookies";

interface Identity {
  issuer: string;
  subject: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

interface ViewerRow {
  session_id: string;
  id: string;
  name: string;
  email: string;
  workspace_id: string;
  workspace_name: string;
  role: Viewer["role"];
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  viewer: Viewer;
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function workspaceSlug(name: string): string {
  const prefix = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36) || "workspace";

  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

async function upsertIdentity(transaction: Queryable, identity: Identity): Promise<{ id: string; name: string; email: string }> {
  const [user] = await transaction<{ id: string; name: string; email: string }[]>`
    INSERT INTO users (issuer, subject, email, name, avatar_url)
    VALUES (${identity.issuer}, ${identity.subject}, ${identity.email}, ${identity.name}, ${identity.avatarUrl ?? null})
    ON CONFLICT (issuer, subject) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      avatar_url = EXCLUDED.avatar_url
    RETURNING id, name, email
  `;

  if (!user) {
    throw new Error("Failed to persist authenticated user");
  }

  return user;
}

async function ensureWorkspace(transaction: Queryable, user: { id: string; name: string }): Promise<{ id: string; name: string; role: Viewer["role"] }> {
  const [membership] = await transaction<{ id: string; name: string; role: Viewer["role"] }[]>`
    SELECT w.id, w.name, m.role
    FROM workspace_memberships m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${user.id}
    ORDER BY m.created_at
    LIMIT 1
  `;

  if (membership) {
    return membership;
  }

  const workspaceName = `${user.name}'s workspace`;
  const [workspace] = await transaction<{ id: string; name: string }[]>`
    INSERT INTO workspaces (name, slug)
    VALUES (${workspaceName}, ${workspaceSlug(user.name)})
    RETURNING id, name
  `;

  if (!workspace) {
    throw new Error("Failed to create user workspace");
  }

  await transaction`
    INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES (${workspace.id}, ${user.id}, 'owner')
  `;

  return { ...workspace, role: "owner" };
}

function requestIp(request: Request): string | null {
  const candidate = request.headers.get("x-forwarded-for")?.split(",", 1)[0].trim() ?? request.headers.get("x-real-ip")?.trim();
  return candidate && isIP(candidate) ? candidate : null;
}

export async function createAuthenticatedSession(identity: Identity, request: Request): Promise<CreatedSession> {
  const token = randomBytes(32).toString("base64url");
  const ttlSeconds = Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 14);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  return withTransaction(async (transaction) => {
    const user = await upsertIdentity(transaction, identity);
    const workspace = await ensureWorkspace(transaction, user);

    await transaction`
      INSERT INTO auth_sessions (
        token_hash,
        user_id,
        selected_workspace_id,
        expires_at,
        user_agent,
        ip_address
      ) VALUES (
        ${hashOpaqueToken(token)},
        ${user.id},
        ${workspace.id},
        ${expiresAt},
        ${request.headers.get("user-agent")?.slice(0, 500) ?? null},
        ${requestIp(request)}
      )
    `;

    return {
      token,
      expiresAt,
      viewer: {
        id: user.id,
        name: user.name,
        email: user.email,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        role: workspace.role
      }
    };
  });
}

export function sessionToken(request: Request): string | null {
  return readCookie(request, sessionCookieName());
}

export async function getViewer(request: Request): Promise<Viewer | null> {
  const token = sessionToken(request);

  if (!token) {
    return null;
  }

  const sql = getDatabase();
  const [row] = await sql<ViewerRow[]>`
    SELECT
      s.id AS session_id,
      u.id,
      u.name,
      u.email,
      w.id AS workspace_id,
      w.name AS workspace_name,
      m.role
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN workspace_memberships m
      ON m.user_id = s.user_id
      AND m.workspace_id = s.selected_workspace_id
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE s.token_hash = ${hashOpaqueToken(token)}
      AND s.expires_at > now()
    LIMIT 1
  `;

  if (!row) {
    return null;
  }

  await sql`
    UPDATE auth_sessions
    SET last_seen_at = now()
    WHERE id = ${row.session_id}
      AND last_seen_at < now() - interval '5 minutes'
  `;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    role: row.role
  };
}

export async function requireViewer(request: Request): Promise<Viewer> {
  const viewer = await getViewer(request);

  if (!viewer) {
    throw new ApiError(401, "authentication_required", "Authentication is required");
  }

  return viewer;
}

export function requireRole(viewer: Viewer, allowedRoles: Viewer["role"][]): void {
  if (!allowedRoles.includes(viewer.role)) {
    throw new ApiError(403, "insufficient_role", "Your workspace role does not allow this action");
  }
}

export async function revokeSession(request: Request): Promise<void> {
  const token = sessionToken(request);

  if (token) {
    await getDatabase()`DELETE FROM auth_sessions WHERE token_hash = ${hashOpaqueToken(token)}`;
  }
}
