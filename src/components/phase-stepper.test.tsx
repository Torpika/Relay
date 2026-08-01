import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PhaseStepper } from "@/components/phase-stepper";

afterEach(cleanup);

describe("PhaseStepper", () => {
  it("identifies the active phase and completed phases accessibly", () => {
    render(<PhaseStepper phase="reviewing" status="running" />);

    const progress = screen.getByRole("list", { name: "Run progress" });
    const steps = within(progress).getAllByRole("listitem");

    expect(steps).toHaveLength(5);
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(steps[0]).toHaveClass("is-complete");
    expect(steps[1]).toHaveClass("is-complete");
    expect(steps[3]).not.toHaveClass("is-complete");
  });

  it("does not present a failed phase as current", () => {
    render(<PhaseStepper phase="reviewing" status="failed" />);

    expect(screen.queryByRole("listitem", { current: "step" })).not.toBeInTheDocument();
  });
});
