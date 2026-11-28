import type { SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  label?: string;
  children: React.ReactNode;
}

export function Select({ error, label, className = "", id, children, ...props }: SelectProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-zinc-300">
          {label}
        </label>
      )}
      <select
        id={inputId}
        className={`rounded border bg-zinc-900 px-3 py-2 text-zinc-100 transition-base focus:border-[#14F195] focus:outline-none focus:ring-1 focus:ring-[#14F195] disabled:cursor-not-allowed disabled:bg-zinc-950 disabled:text-zinc-600 ${
          error ? "border-red-500" : "border-zinc-700"
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
