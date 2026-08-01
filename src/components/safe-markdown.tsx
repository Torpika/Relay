"use client";

import { ExternalLink } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function safeHref(href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }

  if (href.startsWith("#") || href.startsWith("/") || /^(https?:|mailto:)/i.test(href)) {
    return href;
  }

  return undefined;
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    const sanitizedHref = safeHref(href);

    if (!sanitizedHref) {
      return <span>{children}</span>;
    }

    const external = /^https?:/i.test(sanitizedHref);

    return (
      <a
        href={sanitizedHref}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer noopener" : undefined}
      >
        {children}
        {external ? <ExternalLink aria-label="Opens in a new tab" size={12} /> : null}
      </a>
    );
  },
  input: ({ checked, ...props }) => <input checked={checked} disabled {...props} />
};

export function SafeMarkdown({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div className={`markdown ${compact ? "markdown--compact" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
