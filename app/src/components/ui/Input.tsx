import { type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, useId } from "react";
import { cn } from "@/lib/ui/cn";

export const fieldClasses =
  "w-full rounded-[10px] border bg-canvas/60 px-3.5 py-2.5 text-sm text-fg placeholder:text-subtle transition-base hover:border-line-strong focus:border-brand/70 focus:bg-canvas focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-50";

interface FieldShellProps {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Element shown on the right of the label (e.g. a "Max" button). */
  labelAction?: ReactNode;
  children: ReactNode;
}

export function FieldShell({ id, label, hint, error, labelAction, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {(label || labelAction) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label htmlFor={id} className="text-sm font-medium text-fg">
              {label}
            </label>
          )}
          {labelAction}
        </div>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger animate-fade-in" role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string | null;
  label?: ReactNode;
  hint?: ReactNode;
  labelAction?: ReactNode;
  /** Text shown inside the field on the right (e.g. a token symbol). */
  suffix?: ReactNode;
}

export function Input({ error, label, hint, labelAction, suffix, className = "", id, ...props }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <FieldShell id={inputId} label={label} hint={hint} error={error} labelAction={labelAction}>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(fieldClasses, error ? "border-danger/70" : "border-line", suffix ? "pr-16" : "", className)}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-subtle">
            {suffix}
          </span>
        )}
      </div>
    </FieldShell>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string | null;
  label?: ReactNode;
  hint?: ReactNode;
}

export function TextArea({ error, label, hint, className = "", id, rows = 4, ...props }: TextAreaProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell id={inputId} label={label} hint={hint} error={error}>
      <textarea
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={cn(fieldClasses, "resize-y leading-relaxed", error ? "border-danger/70" : "border-line", className)}
        {...props}
      />
    </FieldShell>
  );
}
