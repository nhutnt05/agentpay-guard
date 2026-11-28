import { redirect } from "next/navigation";

// Superseded by /policies (next.config.ts also redirects this path before it renders).
export default function DashboardPage() {
  redirect("/policies");
}
