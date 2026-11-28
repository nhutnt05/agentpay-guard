import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardContent } from "@/components/dashboard/DashboardContent";

export const metadata: Metadata = { title: "Dashboard — AgentPay Guard" };

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8">
      <header>
        <h1 className="text-3xl font-bold text-zinc-100">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Manage your payment policies and monitor agent activity
        </p>
      </header>
      <Suspense fallback={<div className="text-sm text-zinc-500">Loading policies...</div>}>
        <DashboardContent />
      </Suspense>
    </main>
  );
}
