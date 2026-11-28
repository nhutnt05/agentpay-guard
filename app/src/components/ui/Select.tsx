import { type ReactNode, type SelectHTMLAttributes, useId } from "react";
import { cn } from "@/lib/ui/cn";
import { FieldShell, fieldClasses } from "./Input";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string | null;
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

export function Select({ error, label, hint, className = "", id, children, ...props }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <FieldShell id={selectId} label={label} hint={hint} error={error}>
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          className={cn(fieldClasses, "appearance-none pr-10", error ? "border-danger/70" : "border-line", className)}
          {...props}
        >
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </FieldShell>
  );
}
