import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

type CardVariant = "default" | "success" | "danger" | "warning" | "brand";

const VARIANTS: Record<CardVariant, string> = {
  default: "border-line",
  success: "border-brand/35",
  danger: "border-danger/40",
  warning: "border-warning/40",
  brand: "border-brand/30 shadow-[0_0_0_1px_rgb(20_241_149/0.08),0_20px_60px_-30px_rgb(20_241_149/0.35)]",
};

interface CardProps {
  variant?: CardVariant;
  children: ReactNode;
  className?: string;
  /** Adds a hover lift (for clickable cards). */
  interactive?: boolean;
  as?: "div" | "section" | "article";
}

export function Card({ variant = "default", children, className = "", interactive, as: Tag = "div" }: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-[var(--radius-card)] border bg-surface/80 p-5 backdrop-blur-sm",
        VARIANTS[variant],
        interactive && "transition-base hover:-translate-y-0.5 hover:border-line-strong hover:bg-elevated/80",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

/** Either pass `title`/`description`/`action`, or custom children. */
export function CardHeader({ children, className = "", title, description, action, icon }: CardHeaderProps) {
  if (children) return <div className={cn("mb-4", className)}>{children}</div>;
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-elevated text-brand">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("text-base font-semibold text-fg", className)}>{children}</h2>;
}

export function CardContent({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
