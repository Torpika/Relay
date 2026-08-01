import type { RunPhase, RunStatus } from "@/lib/contracts";

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) {
    return "—";
  }

  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  return `${(milliseconds / 1000).toFixed(milliseconds >= 10000 ? 0 : 1)} s`;
}

export function formatRelativeTime(value: string): string {
  const milliseconds = new Date(value).getTime() - Date.now();
  const absoluteMilliseconds = Math.abs(milliseconds);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absoluteMilliseconds < 60_000) {
    return formatter.format(Math.round(milliseconds / 1000), "second");
  }

  if (absoluteMilliseconds < 3_600_000) {
    return formatter.format(Math.round(milliseconds / 60_000), "minute");
  }

  if (absoluteMilliseconds < 86_400_000) {
    return formatter.format(Math.round(milliseconds / 3_600_000), "hour");
  }

  return formatter.format(Math.round(milliseconds / 86_400_000), "day");
}

export function formatStatus(status: RunStatus | "idle"): string {
  return status.replaceAll("_", " ");
}

export function formatPhase(phase: RunPhase): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function safeAgentColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#c7ff5b";
}
