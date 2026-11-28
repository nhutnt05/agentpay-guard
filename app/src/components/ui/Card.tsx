import type { ReactNode } from "react";

type CardVariant = "default" | "success" | "danger" | "warning";

interface CardProps {
  variant?: CardVariant;
  children: ReactNode;
  className?: string;
}

const VARIANTS: Record<CardVariant, string> = {
  default: "border-zinc-800 bg-zinc-950",
  success: "border-emerald-800 bg-zinc-950",
  danger: "border-red-800 bg-zinc-950",
  warning: "border-amber-800 bg-zinc-950",
};

export function Card({ variant = "default", children, className = "" }: CardProps) {
  return (
    <div className={`rounded-lg border p-4 ${VARIANTS[variant]} ${className}`}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children: ReactNode;
  className?: string;
}

export function CardHeader({ children, className = "" }: CardHeaderProps) {
  return <div className={`mb-3 ${className}`}>{children}</div>;
}

interface CardTitleProps {
  children: ReactNode;
  className?: string;
}

export function CardTitle({ children, className = "" }: CardTitleProps) {
  return <h3 className={`text-lg font-semibold ${className}`}>{children}</h3>;
}

interface CardContentProps {
  children: ReactNode;
  className?: string;
}

export function CardContent({ children, className = "" }: CardContentProps) {
  return <div className={className}>{children}</div>;
}
