"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

/** Policy address input synced to `?policy=` (read-only views work without a wallet). */
export function PolicyPicker({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(current);
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        router.replace(`${pathname}?policy=${encodeURIComponent(value.trim())}`);
      }}
    >
      <label className="sr-only" htmlFor="policy">
        Policy address
      </label>
      <input
        id="policy"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Policy PDA address (base58)"
        className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
        spellCheck={false}
      />
      <button type="submit" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
        Load policy
      </button>
    </form>
  );
}
