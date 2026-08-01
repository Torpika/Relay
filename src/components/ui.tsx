"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  LoaderCircle,
  X
} from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef
} from "react";
import type { RunStatus } from "@/lib/contracts";
import { formatStatus } from "@/components/formatters";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
}

export function IconButton({ label, icon, className = "", ...props }: IconButtonProps) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {icon}
    </button>
  );
}

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  size?: "small" | "medium" | "large";
}

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
  size = "medium"
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousActiveElement = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusableElements = dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const preferredFocus = dialog?.querySelector<HTMLElement>("[autofocus]");
    (preferredFocus ?? focusableElements?.[0])?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !focusableElements?.length) {
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.classList.add("has-overlay");

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("has-overlay");
      previousActiveElement?.focus();
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={`dialog dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__header">
          <div>
            <p className="eyebrow">Relay setup</p>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <IconButton label="Close dialog" icon={<X size={18} />} onClick={onClose} />
        </header>
        <div className="dialog__body">{children}</div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: RunStatus | "idle" }) {
  const active = ["starting", "running", "pausing", "resuming", "stopping"].includes(status);

  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className={active ? "status-pulse" : "status-dot"} aria-hidden="true" />
      {formatStatus(status)}
    </span>
  );
}

export function InlineNotice({
  tone,
  children,
  className = ""
}: {
  tone: "danger" | "success" | "info";
  children: ReactNode;
  className?: string;
}) {
  const icon =
    tone === "danger" ? (
      <AlertTriangle size={16} />
    ) : tone === "success" ? (
      <CheckCircle2 size={16} />
    ) : (
      <Check size={16} />
    );

  return (
    <div className={`inline-notice inline-notice--${tone} ${className}`} role="status">
      {icon}
      <span>{children}</span>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = ""
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`skeleton ${className}`} aria-hidden="true" {...props} />;
}

export interface ToastMessage {
  id: number;
  tone: "success" | "danger" | "info";
  title: string;
  detail?: string;
}

export function ToastRegion({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className={`toast toast--${toast.tone}`} key={toast.id}>
          {toast.tone === "success" ? (
            <CheckCircle2 aria-hidden="true" size={17} />
          ) : toast.tone === "danger" ? (
            <AlertTriangle aria-hidden="true" size={17} />
          ) : (
            <Check aria-hidden="true" size={17} />
          )}
          <div>
            <strong>{toast.title}</strong>
            {toast.detail ? <p>{toast.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
