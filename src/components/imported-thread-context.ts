import type { LocalThreadImport } from "@/local/threads/types";

export function buildImportedThreadSessionValues(thread: LocalThreadImport): { title: string; objective: string } {
  return {
    title: `Review · ${thread.title}`.slice(0, 90),
    objective: [
      "Review and improve this task imported from a local AI conversation.",
      `Source: ${thread.provider}`,
      "Relay does not include the source workspace path in this session.",
      thread.truncated ? "The middle of the original transcript was shortened to fit this session." : null,
      "Imported transcript:",
      thread.content || thread.preview || thread.title,
      "Identify errors and disagreements, propose fixes, and iterate until the selected reviewers approve."
    ].filter(Boolean).join("\n\n")
  };
}
