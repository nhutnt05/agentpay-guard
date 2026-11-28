import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

interface StatCardProps {
  label: string;
  value: string | number | ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  /** Highlights the value in the brand color. */
  accent?: boolean;
  className?: string;
  children?: ReactNode;
}

export function StatCard({ label, value, subtitle, icon, accent, className = "", children }: StatCardProps) {
  return (
    <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface/80 p-4 backdrop-blur-sm", className)}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wider text-subtle">
        {label}
        {icon && <span className="text-subtle">{icon}</span>}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", accent ? "text-brand" : "text-fg")}>{value}</div>
      {subtitle && <div className="mt-1 text-xs text-muted">{subtitle}</div>}
      {children}
    </div>
  );
}

/** Horizontal meter (e.g. spent today vs daily limit). Turns amber/red as it fills. */
export function Meter({ value, max, label }: { value: bigint; max: bigint; label?: string }) {
  const pct = max > 0n ? Number((value * 1000n) / max) / 10 : 0;
  const clamped = Math.min(100, Math.max(0, pct));
  const color = clamped >= 90 ? "bg-danger" : clamped >= 70 ? "bg-warning" : "bg-brand";
  return (
    <div className="mt-3">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-elevated"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label={label ?? "Usage"}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", color)} style={{ width: `${clamped}%` }} />
      </div>
      <div className="mt-1 text-right text-[11px] tabular-nums text-subtle">{clamped.toFixed(clamped < 10 && clamped > 0 ? 1 : 0)}%</div>
    </div>
  );
}
