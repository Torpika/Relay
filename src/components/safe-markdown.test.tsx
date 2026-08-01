import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SafeMarkdown } from "@/components/safe-markdown";

afterEach(cleanup);

describe("SafeMarkdown", () => {
  it("renders supported markdown while dropping raw HTML", () => {
    render(<SafeMarkdown content={'## Result\n\n<script>alert("unsafe")</script>\n\n- verified'} />);

    expect(screen.getByRole("heading", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
  });

  it("does not create links for unsafe protocols", () => {
    render(<SafeMarkdown content="[do not open](javascript:alert('unsafe'))" />);

    expect(screen.getByText("do not open")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "do not open" })).not.toBeInTheDocument();
  });

  it("marks external links to open in a separate browsing context", () => {
    render(<SafeMarkdown content="[Reference](https://example.com/reference)" />);

    expect(screen.getByRole("link", { name: /Reference/ })).toHaveAttribute("rel", "noreferrer noopener");
    expect(screen.getByRole("link", { name: /Reference/ })).toHaveAttribute("target", "_blank");
  });
});
