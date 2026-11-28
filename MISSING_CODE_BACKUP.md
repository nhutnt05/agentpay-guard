# Missing Code Backup - Wallet Integration Files

**Trạng thái**: Code này được tạo trong session nhưng CÓ LỖI TYPESCRIPT và không build được.  
**Lý do**: UI component props không khớp với code đã viết.

## Files đã tạo thành công:

1. ✅ `app/src/lib/wallet/transactions.ts` - 7 transaction builders
2. ✅ `app/src/lib/wallet/useSendTransaction.ts` - Hook gửi transaction
3. ✅ `app/src/lib/wallet/program.ts` - Browser-safe program init
4. ✅ `app/src/components/wallet/WalletProviders.tsx` - Wallet provider wrapper
5. ✅ `app/src/components/ui/Navigation.tsx` - Navigation với wallet button
6. ✅ `app/src/app/dashboard/page.tsx` - Dashboard page

## Files CẦN TẠO (nhưng sẽ có lỗi):

### 7. `app/src/components/dashboard/DashboardContent.tsx`

```typescript
/**
 * Dashboard content - Policy list and stats
 * WARNING: Code này có lỗi TypeScript vì UI components có props khác
 */

'use client';

import { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { ExplorerLink } from '@/components/ui/ExplorerLink';
import { getBrowserProgram } from '@/lib/wallet/program';
import { formatBaseUnits } from '@/lib/solana/amounts';
import { MINT_DECIMALS } from '@/lib/anchor/constants';

interface PolicyData {
  address: string;
  owner: string;
  paused: boolean;
  spendingLimit: number;
  dailyLimit: number;
  vaultBalance: number;
  totalSpent: number;
}

export function DashboardContent() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [policyAddress, setPolicyAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<PolicyData | null>(null);

  const loadPolicy = async () => {
    if (!publicKey) {
      setError('Please connect your wallet first');
      return;
    }

    if (!policyAddress) {
      setError('Please enter a policy address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const program = getBrowserProgram(connection);
      const policyPubkey = new PublicKey(policyAddress);
      
      // NOTE: This will fail - program.account.policy doesn't exist
      // Need to use correct account name from IDL
      const policyAccount = await program.account.policy.fetch(policyPubkey);
      
      const vaultBalance = await connection.getBalance(policyAccount.vault);

      setPolicy({
        address: policyAddress,
        owner: policyAccount.owner.toBase58(),
        paused: policyAccount.paused,
        spendingLimit: policyAccount.spendingLimit.toNumber(),
        dailyLimit: policyAccount.dailyLimit.toNumber(),
        vaultBalance,
        totalSpent: policyAccount.totalSpent.toNumber(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load policy';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-4">
            Connect Your Wallet
          </h1>
          <p className="text-gray-400">
            Connect your Phantom or Solflare wallet to manage your payment policies
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">
          Manage your payment policies and monitor agent spending
        </p>
      </div>

      {/* Stats - NOTE: StatCard props might be wrong */}
      {policy && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <StatCard
            label="Vault Balance"
            value={formatBaseUnits(BigInt(policy.vaultBalance), MINT_DECIMALS)}
            variant="primary"
          />
          <StatCard
            label="Total Spent"
            value={formatBaseUnits(BigInt(policy.totalSpent), MINT_DECIMALS)}
            variant="default"
          />
          <StatCard
            label="Daily Limit"
            value={formatBaseUnits(BigInt(policy.dailyLimit), MINT_DECIMALS)}
            variant="default"
          />
          <StatCard
            label="Per-Tx Limit"
            value={formatBaseUnits(BigInt(policy.spendingLimit), MINT_DECIMALS)}
            variant="default"
          />
        </div>
      )}

      {/* Load Policy Section */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Load Policy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Policy Address
              </label>
              <Input
                type="text"
                placeholder="Enter policy public key..."
                value={policyAddress}
                onChange={(e) => setPolicyAddress(e.target.value)}
                disabled={loading}
              />
              <p className="mt-2 text-sm text-gray-500">
                Enter a policy address to view details, or{' '}
                <Link href="/dashboard/new" className="text-[#14F195] hover:underline">
                  create a new policy
                </Link>
              </p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500 rounded-lg p-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* NOTE: Button props might be wrong (fullWidth) */}
            <Button
              onClick={loadPolicy}
              disabled={loading || !policyAddress}
              fullWidth
            >
              {loading ? 'Loading...' : 'Load Policy'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Policy Details */}
      {policy && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Policy Details</CardTitle>
              {/* NOTE: Badge props might be wrong */}
              <Badge variant={policy.paused ? 'danger' : 'success'}>
                {policy.paused ? 'Paused' : 'Active'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Policy Address
                  </label>
                  {/* NOTE: ExplorerLink props might be wrong */}
                  <ExplorerLink address={policy.address} type="account" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Owner
                  </label>
                  <ExplorerLink address={policy.owner} type="account" />
                </div>
              </div>

              <div className="pt-4">
                <Link href={\`/dashboard/policy/\${policy.address}\`}>
                  <Button variant="primary" fullWidth>
                    View Full Details & Manage
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create New Policy CTA */}
      {!policy && !loading && (
        <Card>
          <CardContent className="text-center py-12">
            <h3 className="text-xl font-semibold text-white mb-2">
              No Policy Loaded
            </h3>
            <p className="text-gray-400 mb-6">
              Create a new payment policy to get started with AgentPay Guard
            </p>
            <Link href="/dashboard/new">
              <Button variant="primary">Create New Policy</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

## Vấn Đề Với Code Trên:

1. **UI Component Props sai**:
   - `StatCard` không có prop `variant`
   - `Button` không có prop `fullWidth`
   - `Badge` không có prop `variant`
   - `ExplorerLink` props khác (không phải `address` và `type`)

2. **Anchor Account Name sai**:
   - `program.account.policy` không tồn tại
   - Cần check IDL để biết tên đúng

3. **Missing MINT_DECIMALS**:
   - Cần thêm vào `lib/anchor/constants.ts`

## Khuyến Nghị:

**ĐỪNG dùng code này trực tiếp!** 

Thay vào đó:
1. Đọc UI components có sẵn để hiểu props đúng
2. Check IDL để biết account names
3. Fix từng file một

Hoặc làm **Option 2** (read-only viewer đơn giản) như đã đề xuất trong `docs/CURRENT_STATUS_AND_NEXT_STEPS.md`

## Files còn lại cần tạo:

8. `app/src/app/dashboard/new/page.tsx`
9. `app/src/components/dashboard/CreatePolicyForm.tsx`
10. `app/src/app/dashboard/policy/[policyId]/page.tsx`
11. `app/src/components/policy/PolicyDetailsContent.tsx`
12. Update `app/src/app/layout.tsx` để wrap WalletProviders
13. Update `app/src/app/page.tsx` với design mới
14. Update `app/src/lib/anchor/constants.ts` thêm MINT và MINT_DECIMALS

Tất cả đều có lỗi tương tự!
