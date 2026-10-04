import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { WalletLedger } from '@/components/wallet/wallet-ledger';

export const metadata: Metadata = { title: 'Wallet' };

export default function WalletPage() {
  return (
    <>
      <PageHeader
        title="Wallet"
        description="Your coins, and every transaction that moved them, newest first."
      />
      <WalletLedger />
    </>
  );
}
