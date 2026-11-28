"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { WalletButton } from "@/components/wallet/WalletButton";
import { APP_NAME } from "@/config/app";
import { cn } from "@/lib/ui/cn";
import { IconMenu, IconShield, IconX } from "./icons";

const LINKS = [
  { href: "/policies", label: "Policies" },
  { href: "/agent", label: "AI Playground" },
  { href: "/security", label: "Security Demo" },
];

export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-brand to-accent text-brand-ink shadow-[0_0_24px_-6px_rgb(20_241_149/0.7)] transition-base group-hover:scale-105">
        <IconShield size={18} strokeWidth={2.2} />
      </span>
      <span className="hidden text-[15px] font-semibold tracking-tight text-fg sm:inline">{APP_NAME}</span>
    </Link>
  );
}

export function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu after navigation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/75 backdrop-blur-xl">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-ink"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Logo />
          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={isActive(l.href) ? "page" : undefined}
                    className={cn(
                      "relative rounded-lg px-3 py-2 text-sm font-medium transition-base",
                      isActive(l.href) ? "text-fg" : "text-muted hover:bg-elevated hover:text-fg",
                    )}
                  >
                    {l.label}
                    {isActive(l.href) && (
                      <span className="absolute inset-x-3 -bottom-3.25 h-0.5 rounded-full bg-brand" aria-hidden="true" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted lg:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
            Devnet
          </span>
          <WalletButton />
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-line text-muted transition-base hover:bg-elevated hover:text-fg md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <IconX /> : <IconMenu />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-line bg-canvas/95 px-4 py-3 md:hidden animate-fade-in">
          <ul className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={isActive(l.href) ? "page" : undefined}
                  className={cn(
                    "block rounded-lg px-3 py-2.5 text-sm font-medium transition-base",
                    isActive(l.href) ? "bg-elevated text-fg" : "text-muted hover:bg-elevated hover:text-fg",
                  )}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
