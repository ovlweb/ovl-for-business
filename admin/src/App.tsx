import type { Permission } from '@ovl/shared';
import { ROLE_LABELS } from '@ovl/shared';
import { Badges, Spinner } from '@ovl/ui';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAdmin, useAdminAuth } from './auth';
import { ApiKeysPage } from './pages/ApiKeys';
import { ApplicationsPage } from './pages/Applications';
import { AuditPage } from './pages/Audit';
import { CashDeskPage } from './pages/CashDesk';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { OrganizationsPage } from './pages/Organizations';
import { RegistryPage } from './pages/Registry';
import { StockPage } from './pages/Stock';
import { StoriesPage } from './pages/Stories';
import { SupportPage } from './pages/Support';
import { UsersPage } from './pages/Users';

const SECTIONS: { path: string; label: string; permission: Permission; element: React.ReactNode }[] = [
  { path: 'dashboard', label: 'Dashboard', permission: 'admin.panel', element: <DashboardPage /> },
  { path: 'users', label: 'Users & roles', permission: 'users.view', element: <UsersPage /> },
  { path: 'cash', label: 'Cash desk', permission: 'wallet.view_all', element: <CashDeskPage /> },
  {
    path: 'organizations',
    label: 'Organizations',
    permission: 'admin.panel',
    element: <OrganizationsPage />,
  },
  {
    path: 'applications',
    label: 'Applications',
    permission: 'applications.view_all',
    element: <ApplicationsPage />,
  },
  { path: 'registry', label: 'Registry', permission: 'admin.panel', element: <RegistryPage /> },
  { path: 'stock', label: 'Stock exchange', permission: 'admin.panel', element: <StockPage /> },
  { path: 'support', label: 'Tech support', permission: 'support.answer', element: <SupportPage /> },
  { path: 'stories', label: 'Service stories', permission: 'stories.publish', element: <StoriesPage /> },
  { path: 'audit', label: 'Audit log', permission: 'audit.view', element: <AuditPage /> },
  { path: 'api-keys', label: 'API keys', permission: 'apikeys.manage', element: <ApiKeysPage /> },
];

function Shell() {
  const { me, can, logout } = useAdmin();
  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Admin">
        <div className="admin-brand">
          <img src="./icon.svg" alt="" width={30} height={30} />
          <div>
            OVL For Business
            <small>Admin panel</small>
          </div>
        </div>
        {SECTIONS.filter((s) => can(s.permission)).map((s) => (
          <NavLink
            key={s.path}
            to={`/${s.path}`}
            className={({ isActive }) => `admin-link${isActive ? ' active' : ''}`}
          >
            {s.label}
          </NavLink>
        ))}
        <div className="who stack-sm">
          <div className="row-wrap">
            <b style={{ color: '#fff' }}>{me.displayName}</b>
            <Badges badges={me.badges} />
          </div>
          <span>{ROLE_LABELS[me.role]}</span>
          <button className="btn sm" onClick={() => logout()}>
            Sign out
          </button>
        </div>
      </nav>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  const { me, loading, can } = useAdminAuth();
  if (loading) return <Spinner center />;
  if (!me) return <LoginPage />;
  return (
    <Routes>
      <Route element={<Shell />}>
        {SECTIONS.filter((s) => can(s.permission)).map((s) => (
          <Route key={s.path} path={`/${s.path}`} element={s.element} />
        ))}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
