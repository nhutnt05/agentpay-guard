/**
 * Dashboard page - Policy management overview
 */

import { DashboardContent } from '@/components/dashboard/DashboardContent';
import { Navigation } from '@/components/ui/Navigation';

export default function DashboardPage() {
  return (
    <>
      <Navigation />
      <main className="flex-1 bg-gradient-to-b from-gray-950 to-gray-900">
        <DashboardContent />
      </main>
    </>
  );
}
