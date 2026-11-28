/**
 * Top navigation bar with wallet connect
 */

'use client';

import Link from 'next/link';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export function Navigation() {
  return (
    <nav className="border-b border-gray-800 bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-[#14F195] to-green-600 rounded-lg flex items-center justify-center">
              <span className="text-black font-bold text-sm">AG</span>
            </div>
            <span className="text-white font-semibold text-lg">AgentPay Guard</span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center space-x-8">
            <Link
              href="/dashboard"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/security"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Security Demo
            </Link>
            <Link
              href="/agent"
              className="text-gray-300 hover:text-white transition-colors"
            >
              AI Playground
            </Link>
          </div>

          {/* Wallet Button */}
          <div className="flex items-center">
            <WalletMultiButton className="!bg-[#14F195] !text-black hover:!bg-green-400 !font-semibold !rounded-lg !h-10" />
          </div>
        </div>
      </div>
    </nav>
  );
}
