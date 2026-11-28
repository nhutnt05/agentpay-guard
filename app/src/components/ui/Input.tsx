import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}

export function Input({ error, label, className = "", id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-zinc-300">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`rounded border bg-zinc-900 px-3 py-2 text-zinc-100 placeholder-zinc-500 transition-base focus:border-[#14F195] focus:outline-none focus:ring-1 focus:ring-[#14F195] disabled:cursor-not-allowed disabled:bg-zinc-950 disabled:text-zinc-600 ${
          error ? "border-red-500" : "border-zinc-700"
        } ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

interface TextAreaProps extends InputHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  label?: string;
  rows?: number;
}

export function TextArea({ error, label, className = "", id, rows = 4, ...props }: TextAreaProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-zinc-300">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        rows={rows}
        className={`rounded border bg-zinc-900 px-3 py-2 text-zinc-100 placeholder-zinc-500 transition-base focus:border-[#14F195] focus:outline-none focus:ring-1 focus:ring-[#14F195] disabled:cursor-not-allowed disabled:bg-zinc-950 disabled:text-zinc-600 ${
          error ? "border-red-500" : "border-zinc-700"
        } ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
