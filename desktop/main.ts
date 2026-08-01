import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { app, BrowserWindow, Menu, session, shell } from "electron";
import { startEmbeddedDatabase, type EmbeddedDatabaseRuntime } from "./embedded-database";

const developmentUrl = process.env.RELAY_DESKTOP_URL ?? "http://127.0.0.1:3000";
const managedProcesses = new Set<ChildProcess>();
let mainWindow: BrowserWindow | null = null;
let quitting = false;
let shutdownComplete = false;
let shutdownPromise: Promise<void> | null = null;
let embeddedDatabase: EmbeddedDatabaseRuntime | null = null;

if (process.env.RELAY_DESKTOP_USER_DATA) {
  app.setPath("userData", resolve(process.env.RELAY_DESKTOP_USER_DATA));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
  app.whenReady().then(startDesktopApp).catch((error: unknown) => void handleStartupFailure(error));
}

app.on("activate", () => showMainWindow());

app.on("before-quit", (event) => {
  quitting = true;

  if (shutdownComplete) {
    return;
  }

  event.preventDefault();
  shutdownPromise ??= stopPackagedRuntime().finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});

app.on("window-all-closed", () => undefined);

async function startDesktopApp(): Promise<void> {
  configureApplicationMenu();
  configureSessionSecurity();
  const applicationUrl = app.isPackaged ? await startPackagedRuntime() : developmentUrl;
  mainWindow = createMainWindow();
  await mainWindow.loadURL(applicationUrl);
  mainWindow.show();
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: "#080a0d",
    title: "Relay",
    trafficLightPosition: { x: 18, y: 17 },
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  });

  window.on("close", (event) => {
    if (quitting) {
      return;
    }

    event.preventDefault();
    window.hide();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const currentOrigin = new URL(window.webContents.getURL()).origin;

    if (new URL(url).origin !== currentOrigin) {
      event.preventDefault();
    }
  });

  return window;
}

async function startPackagedRuntime(): Promise<string> {
  const port = process.env.RELAY_DESKTOP_PORT ?? "3210";
  const applicationUrl = `http://127.0.0.1:${port}`;
  const nextRoot = join(process.resourcesPath, "next");
  const serverEntry = join(nextRoot, "server.js");
  const workerEntry = join(process.resourcesPath, "relay", "worker.cjs");
  const databaseAssetsDirectory = join(process.resourcesPath, "relay", "pglite");
  const migrationsDirectory = join(process.resourcesPath, "relay", "migrations");
  const environmentPath = process.env.RELAY_ENV_FILE ?? join(app.getPath("userData"), ".env");

  assertPackagedFile(serverEntry);
  assertPackagedFile(workerEntry);

  embeddedDatabase = await startEmbeddedDatabase({
    dataDirectory: join(app.getPath("userData"), "database"),
    migrationsDirectory,
    assetsDirectory: databaseAssetsDirectory
  });
  const configuredEnvironment = ensureRuntimeEnvironment(environmentPath, app.getPath("userData"));
  const runtimeEnvironment = {
    ...configuredEnvironment,
    DATABASE_URL: embeddedDatabase.connectionString,
    HOST_DATABASE_URL: embeddedDatabase.connectionString,
    DATABASE_SSL: "disable",
    DATABASE_POOL_SIZE: "8",
    APP_URL: applicationUrl
  };

  startNodeProcess(serverEntry, [], {
    cwd: nextRoot,
    environment: {
      HOSTNAME: "127.0.0.1",
      PORT: port,
      ...runtimeEnvironment,
      APP_URL: applicationUrl,
      RELAY_ENV_FILE: environmentPath
    }
  });
  await waitForHealthyRuntime(`${applicationUrl}/api/health`, 30_000);
  startNodeProcess(workerEntry, [], {
    cwd: app.getPath("userData"),
    environment: { ...runtimeEnvironment, RELAY_ENV_FILE: environmentPath }
  });
  return applicationUrl;
}

function startNodeProcess(
  entry: string,
  argumentsValue: string[],
  options: { cwd: string; environment: Record<string, string> }
): void {
  const child = spawn(process.execPath, [entry, ...argumentsValue], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.environment,
      ELECTRON_RUN_AS_NODE: "1"
    },
    stdio: app.isPackaged ? "inherit" : "ignore"
  });
  managedProcesses.add(child);
  child.once("exit", () => managedProcesses.delete(child));
}

async function waitForHealthyRuntime(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });

      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }

  throw new Error("Relay did not become healthy before the desktop startup deadline");
}

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function configureApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Relay",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Show Relay", accelerator: "CmdOrCtrl+Shift+R", click: showMainWindow },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ]));
}

function showMainWindow(): void {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

async function stopManagedProcesses(): Promise<void> {
  const children = [...managedProcesses];

  for (const child of children) {
    child.kill("SIGTERM");
  }

  await Promise.race([
    Promise.all(children.map((child) => child.exitCode === null
      ? new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()))
      : Promise.resolve())),
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 3_000))
  ]);

  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }

  managedProcesses.clear();
}

async function stopPackagedRuntime(): Promise<void> {
  await stopManagedProcesses();

  if (embeddedDatabase) {
    await embeddedDatabase.close();
    embeddedDatabase = null;
  }
}

async function handleStartupFailure(error: unknown): Promise<void> {
  console.error(error instanceof Error ? error.stack ?? error.message : "Relay failed to start");
  await stopPackagedRuntime();
  app.exit(1);
}

function assertPackagedFile(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Required packaged runtime file is missing: ${path}`);
  }
}

function loadRuntimeEnvironment(environmentPath: string): Record<string, string> {
  if (!existsSync(environmentPath)) {
    return {};
  }

  const environment = Object.fromEntries(
    readFileSync(environmentPath, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        const key = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : line;
        const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : "";
        return [key, value.replace(/^(['"])(.*)\1$/u, "$2")];
      })
  );

  if (environment.HOST_DATABASE_URL) {
    environment.DATABASE_URL = environment.HOST_DATABASE_URL;
  }

  return environment;
}

function ensureRuntimeEnvironment(environmentPath: string, userDataPath: string): Record<string, string> {
  const environment = loadRuntimeEnvironment(environmentPath);
  let changed = !existsSync(environmentPath);
  const defaults: Record<string, string> = {
    SESSION_SECRET: randomBytes(48).toString("base64url"),
    CREDENTIAL_MASTER_KEY: randomBytes(32).toString("base64"),
    AUTH_MODE: "development",
    ALLOW_LOCAL_DEVELOPMENT_AUTH: "true",
    WORKER_CONCURRENCY: "4",
    WORKER_POLL_INTERVAL_MS: "750",
    JOB_LEASE_MS: "180000",
    RELAY_CODEX_SANDBOX: "read-only",
    RELAY_CODEX_CWD: join(userDataPath, "runtime"),
    RELAY_LOCAL_AI_CWD: join(userDataPath, "runtime"),
    CODEX_BINARY: findCodexBinary() ?? "codex"
  };
  const optionalLocalBinaries = {
    CLAUDE_BINARY: findCommandBinary("claude"),
    GEMINI_BINARY: findCommandBinary("gemini"),
    KIMI_BINARY: findCommandBinary("kimi")
  };

  for (const [key, value] of Object.entries(optionalLocalBinaries)) {
    if (value) {
      defaults[key] = value;
    }
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (!environment[key]) {
      environment[key] = value;
      changed = true;
    }
  }

  mkdirSync(environment.RELAY_LOCAL_AI_CWD, { recursive: true });

  if (changed) {
    mkdirSync(dirname(environmentPath), { recursive: true });
    const serializedEnvironment = Object.entries(environment)
      .filter(([key]) => !["DATABASE_URL", "HOST_DATABASE_URL", "APP_URL"].includes(key))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n");
    writeFileSync(environmentPath, `${serializedEnvironment}\n`, { mode: 0o600 });
    chmodSync(environmentPath, 0o600);
  }

  delete environment.DATABASE_URL;
  delete environment.HOST_DATABASE_URL;
  delete environment.APP_URL;
  return environment;
}

function findCodexBinary(): string | null {
  const applicationRoots = ["/Applications", join(app.getPath("home"), "Applications")];
  const candidates = ["/Applications/ChatGPT.app/Contents/Resources/codex"];

  for (const applicationRoot of applicationRoots) {
    if (!existsSync(applicationRoot)) {
      continue;
    }

    for (const applicationName of readdirSync(applicationRoot)) {
      if (applicationName.endsWith(".app")) {
        candidates.push(join(applicationRoot, applicationName, "Contents", "Resources", "codex"));
      }
    }
  }

  return candidates.find(existsSync) ?? findCommandBinary("codex");
}

function findCommandBinary(command: string): string | null {
  const searchDirectories = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(app.getPath("home"), ".local", "bin"),
    join(app.getPath("home"), ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ].filter(Boolean);

  return searchDirectories
    .map((directory) => join(directory, command))
    .find(existsSync) ?? null;
}

function isTrustedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export const desktopRuntimeInternals = {
  isTrustedExternalUrl,
  ensureRuntimeEnvironment,
  findCodexBinary,
  findCommandBinary,
  loadRuntimeEnvironment,
  waitForHealthyRuntime,
  resolveProjectRoot: () => resolve(__dirname, "..")
};
