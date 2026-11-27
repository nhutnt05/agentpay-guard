import { APP_NAME, APP_TAGLINE } from "@/config/app";

// Placeholder home (T-M4-01 scaffold). Real pages — Dashboard, Create Policy, Policy
// Details, Merchants, Payment History, Agent Playground, Security Demo — arrive in
// T-M4-07, T-M4-08 and T-M4-12 (docs/07). No blockchain data is shown here yet.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">{APP_TAGLINE}</p>
      <p className="text-sm text-zinc-500">
        App scaffold only. The on-chain program is deployed on devnet; the dashboard is
        not built yet.
      </p>
    </main>
  );
}
