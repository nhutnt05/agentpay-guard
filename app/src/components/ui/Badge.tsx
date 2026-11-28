import type { Tone } from "@/lib/demo/labels";
import { cn } from "@/lib/ui/cn";

const TONES: Record<Tone, string> = {
  success: "bg-brand/10 text-brand border-brand/25",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  info: "bg-info/10 text-info border-info/30",
  neutral: "bg-elevated text-muted border-line-strong",
};

const DOTS: Record<Tone, string> = {
  success: "bg-brand",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-subtle",
};

export function Badge({
  tone,
  children,
  className = "",
  dot = false,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  /** Leading status dot (pulses for success). */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {tone === "success" && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", DOTS[tone])} />}
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", DOTS[tone])} />
        </span>
      )}
      {children}
    </span>
  );
}
