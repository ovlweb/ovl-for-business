import { Empty, ErrorAlert, Icon, PageHeader, Spinner } from '@ovl/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import {
  CashRequestModal,
  CashRequests,
  ConvertModal,
  OpenWalletForm,
  Statement,
  TransferModal,
  WalletCards,
} from '../components/WalletPanel';

export function WalletPage() {
  const queryClient = useQueryClient();
  const wallets = useQuery({ queryKey: ['wallets'], queryFn: api.wallets.list });
  const [selectedId, setSelectedId] = useState<string>();
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [cash, setCash] = useState<'deposit' | 'withdrawal' | null>(null);
  const selected = wallets.data?.find((w) => w.id === selectedId) ?? wallets.data?.[0];

  return (
    <div className="page stack-lg">
      <PageHeader
        icon="wallet"
        title="Wallet"
        subtitle="Your personal balances in any world currency."
        actions={
          selected && (
            <>
              <button className="btn" onClick={() => setCash('deposit')}>
                <Icon name="incoming" size={16} /> Deposit
              </button>
              <button className="btn" onClick={() => setCash('withdrawal')}>
                <Icon name="outgoing" size={16} /> Withdraw
              </button>
              <button className="btn" onClick={() => setConverting(true)}>
                <Icon name="refresh" size={16} /> Convert
              </button>
              <button className="btn primary" onClick={() => setSending(true)}>
                <Icon name="send" size={16} /> Send money
              </button>
            </>
          )
        }
      />
      <div className="alert info small">
        <Icon name="info" size={17} />
        <span>
          Deposits and payouts are handled by finance managers, by bank transfer or at the cash desk. Ask for
          one with <b>Deposit</b> or <b>Withdraw</b>; a payout holds the amount until it is paid out.
        </span>
      </div>
      {wallets.isLoading && <Spinner center />}
      <ErrorAlert error={wallets.error} />
      {wallets.data && wallets.data.length === 0 && (
        <div className="card">
          <Empty title="No balances yet">Open a balance in a currency to receive transfers.</Empty>
        </div>
      )}
      {wallets.data && wallets.data.length > 0 && (
        <WalletCards wallets={wallets.data} selected={selected?.id} onSelect={setSelectedId} />
      )}
      <div className="card stack-sm">
        <h3>Open a balance in another currency</h3>
        <OpenWalletForm
          onOpen={async (currency) => {
            const wallet = await api.wallets.open(currency);
            await queryClient.invalidateQueries({ queryKey: ['wallets'] });
            setSelectedId(wallet.id);
          }}
        />
      </div>
      {selected && <CashRequests wallet={selected} />}
      {selected && <Statement wallet={selected} />}
      {sending && selected && <TransferModal wallet={selected} onClose={() => setSending(false)} />}
      {converting && selected && <ConvertModal wallet={selected} onClose={() => setConverting(false)} />}
      {cash && selected && <CashRequestModal wallet={selected} type={cash} onClose={() => setCash(null)} />}
    </div>
  );
}
