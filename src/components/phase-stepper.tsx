"use client";

import { Check } from "lucide-react";
import type { RunPhase, RunStatus } from "@/lib/contracts";
import { formatPhase } from "@/components/formatters";

const visiblePhases: RunPhase[] = [
  "preparing",
  "drafting",
  "reviewing",
  "synthesizing",
  "checkpointing"
];

export function PhaseStepper({ phase, status }: { phase: RunPhase; status: RunStatus | "idle" }) {
  const currentIndex = visiblePhases.indexOf(phase);
  const isTerminal = ["stopped", "failed"].includes(status);

  return (
    <ol className="phase-stepper" aria-label="Run progress">
      {visiblePhases.map((candidate, index) => {
        const complete = !isTerminal && currentIndex > index;
        const current = currentIndex === index && !isTerminal;

        return (
          <li
            className={`phase-stepper__step ${complete ? "is-complete" : ""} ${current ? "is-current" : ""}`}
            key={candidate}
            aria-current={current ? "step" : undefined}
          >
            <span className="phase-stepper__marker" aria-hidden="true">
              {complete ? <Check size={11} strokeWidth={3} /> : index + 1}
            </span>
            <span>{formatPhase(candidate)}</span>
          </li>
        );
      })}
    </ol>
  );
}
