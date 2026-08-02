const maximumDiagnosticLength = 500;

export function sanitizeDiagnostic(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Provider request failed without an error message.";
  }

  return normalized
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replace(/((?:api[_ -]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/giu, "$1[redacted]")
    .replace(/\/(?:Users|home)\/[^\s:/]+/gu, "~")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/giu, "%USERPROFILE%")
    .slice(0, maximumDiagnosticLength);
}
