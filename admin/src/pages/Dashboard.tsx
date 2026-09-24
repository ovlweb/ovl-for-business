import { ROLE_LABELS, ROLES } from '@ovl/shared';
import { ErrorAlert, formatMoney, PageHeader, Spinner } from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';

export function DashboardPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.admin.stats, refetchInterval: 30_000 });
  const s = stats.data;
  return (
    <div className="page stack-lg">
      <PageHeader title="Dashboard" subtitle="Platform overview" />
      {stats.isLoading && <Spinner center />}
      <ErrorAlert error={stats.error} />
      {s && (
        <>
          <div className="grid-3">
            <Link to="/applications" className="card kpi" style={{ color: 'inherit' }}>
              <span className="kpi-label">Pending applications</span>
              <span className="kpi-value">{s.pendingApplications}</span>
            </Link>
            <Link to="/support" className="card kpi" style={{ color: 'inherit' }}>
              <span className="kpi-label">Open support tickets</span>
              <span className="kpi-value">{s.openTickets}</span>
            </Link>
            <Link to="/organizations" className="card kpi" style={{ color: 'inherit' }}>
              <span className="kpi-label">Organizations</span>
              <span className="kpi-value">{s.organizations}</span>
            </Link>
            <Link to="/stock" className="card kpi" style={{ color: 'inherit' }}>
              <span className="kpi-label">Active listings</span>
              <span className="kpi-value">{s.activeListings}</span>
            </Link>
            <Link to="/registry" className="card kpi" style={{ color: 'inherit' }}>
              <span className="kpi-label">Registry entries</span>
              <span className="kpi-value">{s.registryEntries}</span>
            </Link>
            <div className="card kpi">
              <span className="kpi-label">Accounts</span>
              <span className="kpi-value">{Object.values(s.users).reduce((a, b) => a + b, 0)}</span>
            </div>
          </div>
          <div className="grid-2">
            <div className="card stack-sm">
              <h3>Accounts by role</h3>
              <table className="table">
                <tbody>
                  {ROLES.map((r) => (
                    <tr key={r}>
                      <td>{ROLE_LABELS[r]}</td>
                      <td className="right num">{s.users[r] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card stack-sm">
              <h3>Money on the platform</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th className="right">Total</th>
                    <th className="right">Wallets</th>
                  </tr>
                </thead>
                <tbody>
                  {s.balances.map((b) => (
                    <tr key={b.currency}>
                      <td>{b.currency}</td>
                      <td className="right num">{formatMoney(b.total, b.currency, false)}</td>
                      <td className="right num">{b.wallets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.balances.length === 0 && <p className="small muted">No balances yet.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
