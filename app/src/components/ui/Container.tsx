import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

const WIDTHS = { sm: "max-w-2xl", md: "max-w-4xl", lg: "max-w-6xl", xl: "max-w-7xl" } as const;

/** Standard page body: centered, responsive gutters, consistent vertical rhythm. */
export function Container({ children, size = "lg", className = "" }: { children: ReactNode; size?: keyof typeof WIDTHS; className?: string }) {
  return <main className={cn("mx-auto w-full flex-1 px-4 py-10 sm:px-6 lg:px-8", WIDTHS[size], className)}>{children}</main>;
}
