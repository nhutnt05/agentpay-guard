import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[#14F195] text-black hover:bg-[#0de083] active:bg-[#0bc973] disabled:bg-zinc-700 disabled:text-zinc-500",
  secondary:
    "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 active:bg-zinc-600 border border-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 disabled:border-zinc-800",
  danger:
    "bg-red-600 text-white hover:bg-red-500 active:bg-red-700 disabled:bg-zinc-800 disabled:text-zinc-600",
  ghost:
    "bg-transparent text-zinc-100 hover:bg-zinc-800 active:bg-zinc-700 disabled:text-zinc-600",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-base",
  lg: "px-6 py-3 text-lg",
};

export function Button({
  variant = "primary",
  size = "md",
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded font-medium transition-base disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
