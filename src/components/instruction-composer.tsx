"use client";

import { ArrowUp, CheckCircle2, CornerDownRight, LoaderCircle } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useState } from "react";

interface InstructionComposerProps {
  pendingInstruction: string | null;
  disabled: boolean;
  submitting: boolean;
  onSubmit: (instruction: string) => Promise<boolean>;
}

export function InstructionComposer({
  pendingInstruction,
  disabled,
  submitting,
  onSubmit
}: InstructionComposerProps) {
  const [instruction, setInstruction] = useState("");

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const normalizedInstruction = instruction.trim();

    if (!normalizedInstruction || disabled || submitting) {
      return;
    }

    if (await onSubmit(normalizedInstruction)) {
      setInstruction("");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="instruction-composer">
      {pendingInstruction ? (
        <div className="queued-instruction">
          <CheckCircle2 size={14} />
          <span><strong>Queued for next round</strong><span>{pendingInstruction}</span></span>
        </div>
      ) : null}
      <form onSubmit={submit}>
        <span className="instruction-composer__icon"><CornerDownRight size={16} /></span>
        <label>
          <span className="sr-only">Instruction for the next round</span>
          <textarea
            rows={1}
            value={instruction}
            disabled={disabled}
            maxLength={4000}
            placeholder={disabled ? "Start or resume the run to queue guidance" : pendingInstruction ? "Replace the queued instruction…" : "Guide the next round…"}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </label>
        <span className="instruction-shortcut">⌘ ↵</span>
        <button type="submit" aria-label="Queue instruction" disabled={disabled || submitting || !instruction.trim()}>
          {submitting ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={16} />}
        </button>
      </form>
    </div>
  );
}
