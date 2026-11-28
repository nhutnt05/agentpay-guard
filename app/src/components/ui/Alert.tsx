import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { IconAlert, IconCircleCheck, IconCircleX, IconInfo, IconX } from "./icons";

type AlertTone = "success" | "danger" | "warning" | "info";

const TONES: Record<AlertTone, { box: string; icon: ReactNode }> = {
  success: { box: "border-brand/30 bg-brand/7 text-fg", icon: <IconCircleCheck className="text-brand" /> },
  danger: { box: "border-danger/35 bg-danger/8 text-fg", icon: <IconCircleX className="text-danger" /> },
  warning: { box: "border-warning/35 bg-warning/8 text-fg", icon: <IconAlert className="text-warning" /> },
  info: { box: "border-info/30 bg-info/7 text-fg", icon: <IconInfo className="text-info" /> },
};

interface AlertProps {
  tone: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function Alert({ tone, title, children, action, onDismiss, className = "" }: AlertProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm animate-fade-up", TONES[tone].box, className)}
    >
      <span className="mt-0.5 shrink-0">{TONES[tone].icon}</span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn("break-words text-muted", title ? "mt-0.5" : "")}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-subtle transition-base hover:bg-elevated hover:text-fg"
        >
          <IconX size={16} />
        </button>
      )}
    </div>
  );
}
