import type { Permission } from '@ovl/shared';
import { ROLE_LABELS, type SecurityPolicy } from '@ovl/shared';
import {
  Avatar,
  Badges,
  Icon,
  Logo,
  PageTransition,
  Popover,
  ThemeMenu,
  TwoFactorSetupForm,
  type IconName,
} from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { useAdmin, useAdminAuth } from './auth';
import { ApiKeysPage } from './pages/ApiKeys';
import { ApplicationsPage } from './pages/Applications';
import { AuditPage } from './pages/Audit';
import { CashDeskPage } from './pages/CashDesk';
import { DashboardPage } from './pages/Dashboard';
import { IdentityPage } from './pages/Identity';
import { LoginPage } from './pages/Login';
import { OrganizationsPage } from './pages/Organizations';
import { RegistryPage } from './pages/Registry';
import { StockPage } from './pages/Stock';
import { StoriesPage } from './pages/Stories';
import { SupportPage } from './pages/Support';
import { UsersPage } from './pages/Users';
import { useAdminTheme } from './theme';

type CountKey = 'pendingApplications' | 'openTickets' | 'pendingCashRequests' | 'pendingIdentityChecks';

interface Section {
  path: string;
  label: string;
  icon: IconName;
  group: string;
  permission: Permission;
  element: React.ReactNode;
  count?: CountKey;
}

export const SECTIONS: Section[] = [
  {
    path: 'dashboard',
    label: 'Dashboard',
    icon: 'activity',
    group: 'Overview',
    permission: 'admin.panel',
    element: <DashboardPage />,
  },
  {
    path: 'users',
    label: 'Users & roles',
    icon: 'users',
    group: 'People & money',
    permission: 'users.view',
    element: <UsersPage />,
  },
  {
    path: 'cash',
    label: 'Cash desk',
    icon: 'wallet',
    group: 'People & money',
    permission: 'wallet.view_all',
    element: <CashDeskPage />,
    count: 'pendingCashRequests',
  },
  {
    path: 'identity',
    label: 'Identity checks',
    icon: 'shield',
    group: 'People & money',
    permission: 'identity.review',
    element: <IdentityPage />,
    count: 'pendingIdentityChecks',
  },
  {
    path: 'applications',
    label: 'Applications',
    icon: 'review',
    group: 'Business',
    permission: 'applications.view_all',
    element: <ApplicationsPage />,
    count: 'pendingApplications',
  },
  {
    path: 'organizations',
    label: 'Organizations',
    icon: 'building',
    group: 'Business',
    permission: 'admin.panel',
    element: <OrganizationsPage />,
  },
  {
    path: 'registry',
    label: 'Registry',
    icon: 'book',
    group: 'Business',
    permission: 'admin.panel',
    element: <RegistryPage />,
  },
  {
    path: 'stock',
    label: 'Stock exchange',
    icon: 'chart',
    group: 'Business',
    permission: 'admin.panel',
    element: <StockPage />,
  },
  {
    path: 'support',
    label: 'Tech support',
    icon: 'support',
    group: 'Communication',
    permission: 'support.answer',
    element: <SupportPage />,
    count: 'openTickets',
  },
  {
    path: 'stories',
    label: 'Service stories',
    icon: 'sparkles',
    group: 'Communication',
    permission: 'stories.publish',
    element: <StoriesPage />,
  },
  {
    path: 'audit',
    label: 'Audit log',
    icon: 'shield',
    group: 'System',
    permission: 'audit.view',
    element: <AuditPage />,
  },
  {
    path: 'api-keys',
    label: 'API keys',
    icon: 'key',
    group: 'System',
    permission: 'apikeys.manage',
    element: <ApiKeysPage />,
  },
];

function NavGroups({ sections, counts }: { sections: Section[]; counts?: Record<CountKey, number> }) {
  const groups = [...new Set(sections.map((s) => s.group))];
  return (
    <div className="admin-nav-scroll">
      {groups.map((g) => (
        <div key={g} className="admin-group">
          <div className="admin-group-title">{g}</div>
          {sections
            .filter((s) => s.group === g)
            .map((s) => {
              const count = s.count ? (counts?.[s.count] ?? 0) : 0;
              return (
                <NavLink
                  key={s.path}
                  to={`/${s.path}`}
                  className={({ isActive }) => `admin-link${isActive ? ' active' : ''}`}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="admin-nav-active"
                          className="admin-link-bg"
                          transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                        />
                      )}
                      <Icon name={s.icon} size={18} />
                      <span className="grow">{s.label}</span>
                      {count > 0 && <span className="admin-count">{count > 99 ? '99+' : count}</span>}
                    </>
                  )}
                </NavLink>
              );
            })}
        </div>
      ))}
    </div>
  );
}

function ThemeButton() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useAdminTheme();
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn ghost icon"
        onClick={() => setOpen(!open)}
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="palette" size={19} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} style={{ right: 0, top: 46, width: 250 }}>
        <div className="tiny muted" style={{ padding: '6px 10px' }}>
          Console theme · this device
        </div>
        <ThemeMenu value={theme} onChange={(id, origin) => setTheme(id, origin)} />
      </Popover>
    </div>
  );
}

function UserMenu() {
  const { me, logout } = useAdmin();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className="admin-user" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={me.displayName} url={me.avatarUrl} size={32} />
        <span className="admin-user-text">
          <b className="ellipsis">{me.displayName}</b>
          <span className="tiny muted">{ROLE_LABELS[me.role]}</span>
        </span>
        <Icon name="chevronDown" size={16} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} style={{ right: 0, top: 50, width: 260 }}>
        <div className="row" style={{ padding: '8px 10px 10px' }}>
          <Avatar name={me.displayName} url={me.avatarUrl} size={40} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}>
              <b className="ellipsis">{me.displayName}</b>
              <Badges badges={me.badges} />
            </div>
            <div className="small muted ellipsis">@{me.username}</div>
          </div>
        </div>
        <div className="menu-sep" />
        <button className="menu-item danger" onClick={() => logout()}>
          <Icon name="logout" size={17} /> Sign out
        </button>
      </Popover>
    </div>
  );
}

function Shell() {
  const { can } = useAdmin();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const sections = SECTIONS.filter((s) => can(s.permission));
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.admin.stats, refetchInterval: 30_000 });
  const current = sections.find((s) => location.pathname.startsWith(`/${s.path}`));
  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => {
    document.title = current ? `${current.label} · OVL Admin` : 'OVL Admin';
  }, [current]);

  const sidebar = (
    <>
      <div className="admin-brand">
        <Logo size={34} />
        <div>
          OVL For Business
          <small>Admin console</small>
        </div>
      </div>
      <NavGroups sections={sections} counts={stats.data} />
      <div className="admin-env">
        <span className="dot" /> Connected to{' '}
        {api.baseUrl.replace(/^https?:\/\//, '') || window.location.host}
      </div>
    </>
  );

  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Admin">
        {sidebar}
      </nav>
      <AnimatePresence>
        {drawer && (
          <motion.div
            className="admin-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawer(false)}
          >
            <motion.nav
              className="admin-nav drawer"
              aria-label="Admin"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              onClick={(e) => e.stopPropagation()}
            >
              {sidebar}
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="admin-body">
        <header className="admin-topbar">
          <button
            className="btn ghost icon admin-menu-button"
            onClick={() => setDrawer(true)}
            aria-label="Menu"
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="admin-crumbs">
            <span className="muted">Admin</span>
            <Icon name="chevronRight" size={14} />
            <b>{current?.label ?? 'Dashboard'}</b>
          </div>
          <div className="grow" />
          <ThemeButton />
          <UserMenu />
        </header>
        <main className="admin-main">
          <PageTransition key={current?.path ?? 'home'}>
            <Outlet />
          </PageTransition>
        </main>
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div className="admin-splash">
      <Logo size={56} animated />
    </div>
  );
}

/** Staff must turn on two-step verification before the console opens (when the server requires it). */
function TwoFactorGate() {
  const { reload, logout, me } = useAdminAuth();
  return (
    <div className="admin-login">
      <div className="admin-login-panel" style={{ gridColumn: '1 / -1' }}>
        <div className="admin-login-card stack-lg" style={{ width: 'min(520px, 100%)' }}>
          <div className="stack-sm">
            <Logo size={44} />
            <h2 style={{ marginTop: 10 }}>Turn on two-step verification</h2>
            <p className="small muted">
              Staff accounts need a code from an authenticator app at every sign-in. Set it up once, then the
              console opens.
            </p>
          </div>
          <TwoFactorSetupForm
            load={api.me.twoFactor.setup}
            enable={api.me.twoFactor.enable}
            onDone={reload}
          />
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => void logout()}>
            <Icon name="logout" size={15} /> Sign out {me?.username}
          </button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const { me, loading, can } = useAdminAuth();
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity, enabled: !!me });
  if (loading) return <Splash />;
  if (!me) return <LoginPage />;
  const policy = meta.data?.security as SecurityPolicy | undefined;
  if (!meta.data) return <Splash />;
  if (policy?.twoFactorForStaff && !me.twoFactorEnabled) return <TwoFactorGate />;
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
