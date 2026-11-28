/**
 * Hook for sending transactions with wallet
 * Handles transaction signing and confirmation
 */

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  Transaction,
  TransactionInstruction,
  TransactionSignature,
} from '@solana/web3.js';
import { useState } from 'react';

export interface SendTransactionResult {
  signature: TransactionSignature;
  confirmed: boolean;
}

export function useSendTransaction() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (
    instruction: TransactionInstruction
  ): Promise<SendTransactionResult | null> => {
    if (!publicKey) {
      setError('Wallet not connected');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const transaction = new Transaction().add(instruction);

      // Get latest blockhash
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Send transaction (wallet will sign)
      const signature = await sendTransaction(transaction, connection);

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      setLoading(false);
      return { signature, confirmed: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setLoading(false);
      return null;
    }
  };

  return { send, loading, error };
}
