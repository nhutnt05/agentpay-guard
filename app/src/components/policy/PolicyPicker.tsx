"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { short } from "@/components/ui/ExplorerLink";
import { fieldClasses } from "@/components/ui/Input";
import { cn } from "@/lib/ui/cn";
import { useOwnerPolicies } from "@/lib/wallet/useOwnerPolicies";
import { isBase58Address } from "./shared";

/** Policy address input synced to `?policy=` (read-only views work without a wallet). */
export function PolicyPicker({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { publicKey } = useWallet();
  const { policies } = useOwnerPolicies(publicKey);
  const [value, setValue] = useState(current);
  const [touched, setTouched] = useState(false);
  const invalid = touched && value.trim() !== "" && !isBase58Address(value);

  function load(address: string) {
    setValue(address);
    router.replace(`${pathname}?policy=${encodeURIComponent(address.trim())}`);
  }

  return (
    <div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (isBase58Address(value)) load(value);
        }}
      >
        <label className="sr-only" htmlFor="policy">
          Policy address
        </label>
        <input
          id="policy"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Policy address (base58)"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "policy-error" : undefined}
          className={cn(fieldClasses, "min-w-0 flex-1 font-mono", invalid ? "border-danger/70" : "border-line")}
          spellCheck={false}
          autoComplete="off"
        />
        <Button type="submit" variant="secondary" disabled={!value.trim()}>
          Load policy
        </Button>
      </form>
      {invalid && (
        <p id="policy-error" className="mt-1.5 text-xs text-danger">
          Not a valid Solana address.
        </p>
      )}
      {policies.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-subtle">
          Your policies:
          {policies.map((p) => (
            <button
              key={p.address}
              type="button"
              onClick={() => load(p.address)}
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono transition-base",
                p.address === current ? "border-brand/50 bg-brand/10 text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {short(p.address)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
