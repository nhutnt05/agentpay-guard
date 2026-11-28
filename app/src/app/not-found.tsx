import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { IconShield } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <Container size="sm" className="flex items-center">
      <div className="mx-auto py-16 text-center animate-fade-up">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-elevated text-brand">
          <IconShield size={28} />
        </div>
        <p className="font-mono text-sm text-brand">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">This page doesn&apos;t exist</h1>
        <p className="mt-3 text-muted">The link may be outdated, or the page is only available while the demo mode is on.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/">Back to home</ButtonLink>
          <ButtonLink href="/policies" variant="secondary">
            Your policies
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
