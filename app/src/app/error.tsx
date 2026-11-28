"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { IconAlert } from "@/components/ui/icons";

// Route-level error boundary: any unexpected render error lands here instead of a blank page.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Container size="sm" className="flex items-center">
      <div className="mx-auto py-16 text-center animate-fade-up">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-danger/30 bg-danger/10 text-danger">
          <IconAlert size={28} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Something went wrong</h1>
        <p className="mt-3 text-muted">The page failed to render. Your funds are unaffected — every payment rule lives on-chain.</p>
        {error.digest && <p className="mt-2 font-mono text-xs text-subtle">Reference: {error.digest}</p>}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/" variant="secondary">
            Back to home
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
