import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { Spinner } from "./Spinner";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-brand-ink shadow-[0_0_0_1px_rgb(20_241_149/0.4),0_8px_24px_-8px_rgb(20_241_149/0.55)] hover:bg-brand-strong hover:-translate-y-px active:translate-y-0",
  secondary: "bg-elevated text-fg border border-line-strong hover:bg-hover hover:border-subtle/60",
  outline: "bg-transparent text-fg border border-line-strong hover:bg-elevated",
  danger: "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25",
  ghost: "bg-transparent text-muted hover:text-fg hover:bg-elevated",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
};

const BASE =
  "inline-flex select-none items-center justify-center font-semibold whitespace-nowrap transition-base disabled:pointer-events-none disabled:opacity-45";

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  children,
  className = "",
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size={size === "lg" ? 18 : 15} /> : icon}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children: ReactNode;
  /** External links open in a new tab. */
  external?: boolean;
}

/** A link that looks like a button (never nest <button> inside <a>). */
export function ButtonLink({ href, variant = "primary", size = "md", icon, children, className = "", external, ...props }: ButtonLinkProps) {
  const cls = buttonClasses(variant, size, className);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cls} {...props}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...props}>
      {icon}
      {children}
    </Link>
  );
}
