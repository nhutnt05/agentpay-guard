import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number | ReactNode;
  subtitle?: string;
  className?: string;
}

export function StatCard({ label, value, subtitle, className = "" }: StatCardProps) {
  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-950 p-4 ${className}`}>
      <div className="text-sm text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>}
    </div>
  );
}
