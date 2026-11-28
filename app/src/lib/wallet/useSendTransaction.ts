/**
 * Hook for sending owner transactions with the connected wallet (sign, send, confirm).
 *
 * Merge of `main` and `frontend`: `sendTransaction(tx)` (dashboard) and `send(instruction)`
 * (policy pages) share one state: `loading`, `error`, `signature`, `reset`.
 */

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction, type TransactionInstruction, type TransactionSignature } from "@solana/web3.js";
import { useState } from "react";

export interface SendTransactionState {
  loading: boolean;
  error: string | null;
  signature: TransactionSignature | null;
}

export interface SendTransactionResult extends SendTransactionState {
  /** Signs and sends `tx`; resolves to the signature once confirmed, or null on error. */
  sendTransaction: (tx: Transaction) => Promise<TransactionSignature | null>;
  /** Policy-pages variant: one instruction → `{ signature, confirmed }` or null on error. */
  send: (instruction: TransactionInstruction) => Promise<{ signature: TransactionSignature; confirmed: boolean } | null>;
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
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      // The wallet signs; the app never sees the owner key.
      const signature = await walletSendTransaction(tx, connection);

      const confirmation = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
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

  const send = async (instruction: TransactionInstruction) => {
    const signature = await sendTransaction(new Transaction().add(instruction));
    return signature ? { signature, confirmed: true } : null;
  };

  const reset = () => {
    setState({ loading: false, error: null, signature: null });
  };

  return {
    ...state,
    sendTransaction,
    send,
    reset,
  };
}
