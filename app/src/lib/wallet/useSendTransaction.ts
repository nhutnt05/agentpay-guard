import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Transaction, TransactionSignature } from "@solana/web3.js";
import { useState } from "react";

export interface SendTransactionState {
  loading: boolean;
  error: string | null;
  signature: TransactionSignature | null;
}

export interface SendTransactionResult extends SendTransactionState {
  sendTransaction: (tx: Transaction) => Promise<TransactionSignature | null>;
  reset: () => void;
}

export function useSendTransaction(): SendTransactionResult {
  const { connection } = useConnection();
  const { publicKey, sendTransaction: walletSendTransaction } = useWallet();
  const [state, setState] = useState<SendTransactionState>({
    loading: false,
    error: null,
    signature: null,
  });

  const sendTransaction = async (tx: Transaction): Promise<TransactionSignature | null> => {
    if (!publicKey) {
      setState({ loading: false, error: "Wallet not connected", signature: null });
      return null;
    }

    setState({ loading: true, error: null, signature: null });

    try {
      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      // Send transaction
      const signature = await walletSendTransaction(tx, connection);

      // Confirm transaction
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      setState({ loading: false, error: null, signature });
      return signature;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Transaction failed";
      setState({ loading: false, error: errorMessage, signature: null });
      return null;
    }
  };

  const reset = () => {
    setState({ loading: false, error: null, signature: null });
  };

  return {
    ...state,
    sendTransaction,
    reset,
  };
}
