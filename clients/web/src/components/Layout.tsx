import { ORG_FINANCE_ROLES, ROLE_LABELS, type SecurityPolicy } from '@ovl/shared';
import { Avatar, Badges, Icon, Logo, PageTransition, Popover, useToast, type IconName } from '@ovl/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { useRealtime } from '../realtime';
import { CommandPalette } from './CommandPalette';

interface NavItem {
  to: string;
  icon: IconName;
  label: string;
  count?: number;
  /** Shown in the phone bottom bar; everything else lives in "More". */
  primary?: boolean;
}

function NavItemLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.to}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => `nav-link${isActive ? ' active' : ''}${item.primary ? '' : ' secondary'}`}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="nav-active"
              className="nav-active"
              transition={{ type: 'spring', stiffness: 480, damping: 38 }}
            />
          )}
          <Icon name={item.icon} size={19} />
          <span className="nav-label">{item.label}</span>
          {!!item.count && <span className="count">{item.count > 99 ? '99+' : item.count}</span>}
        </>
      )}
    </NavLink>
  );
}

/** Only show the banner when the connection has been down for a while, not on every blip. */
function useConnectionLost(status: string): boolean {
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (status === 'open') {
      setLost(false);
      return;
    }
    const t = setTimeout(() => setLost(true), 4000);
    return () => clearTimeout(t);
  }, [status]);
  return lost;
}

/** Things the account should do: confirm the email, turn on two-step verification where required. */
function AccountNotices() {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity });
  const orgs = useQuery({ queryKey: ['orgs', 'mine'], queryFn: api.organizations.mine });
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem('ovl.hideEmailNotice') === me.id;
    } catch {
      return false;
    }
  });
  const resend = useMutation({
    mutationFn: api.me.resendVerification,
    onSuccess: () => toast.success(`Link sent to ${me.email}`),
    onError: (e) => toast.error((e as Error).message),
  });
  const policy = meta.data?.security as SecurityPolicy | undefined;
  const handlesMoney = orgs.data?.some((o) => o.myRole && ORG_FINANCE_ROLES.includes(o.myRole));
  const needsTwoFactor =
    !me.twoFactorEnabled &&
    ((policy?.twoFactorForStaff && me.role !== 'user') ||
      (policy?.twoFactorForCompanyFinance && handlesMoney));
  if (!needsTwoFactor && (me.emailVerified || hidden)) return null;
  return (
    <div className="account-notices">
      {needsTwoFactor && (
        <div className="alert warning small">
          <Icon name="shield" size={17} />
          <span className="grow">
            {me.role !== 'user'
              ? `As ${ROLE_LABELS[me.role].toLowerCase()} you need two-step verification before you can use staff tools.`
              : 'Turn on two-step verification before moving company money.'}
          </span>
          <button className="btn sm" onClick={() => navigate('/settings?section=security')}>
            Set it up
          </button>
        </div>
      )}
      {!me.emailVerified && !hidden && (
        <div className="alert info small">
          <Icon name="send" size={17} />
          <span className="grow">
            Confirm your email address: we sent a link to <b>{me.email}</b>.
          </span>
          <button className="btn sm" disabled={resend.isPending} onClick={() => resend.mutate()}>
            Send again
          </button>
          <button
            className="btn ghost icon sm"
            aria-label="Hide"
            onClick={() => {
              setHidden(true);
              try {
                sessionStorage.setItem('ovl.hideEmailNotice', me.id);
              } catch {
                /* private mode */
              }
            }}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function AccountSwitcher({ collapsed }: { collapsed: boolean }) {
  const me = useMe();
  const { accounts, switchAccount, startAddAccount, logout } = useAuth();
  const { status } = useRealtime();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const others = accounts.filter((a) => a.id !== me.id);
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="account-button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span style={{ position: 'relative' }}>
          <Avatar name={me.displayName} url={me.avatarUrl} size={34} />
          <span className={`presence ${status}`} title={`Realtime: ${status}`} />
        </span>
        {!collapsed && (
          <>
            <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
              <span className="bold ellipsis" style={{ display: 'block' }}>
                {me.displayName}
              </span>
              <span className="tiny ellipsis sidebar-muted" style={{ display: 'block' }}>
                {ROLE_LABELS[me.role]}
              </span>
            </span>
            <Icon name="chevronDown" size={16} />
          </>
        )}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="top"
        style={{ bottom: 'calc(100% + 8px)', left: 0, width: 280 }}
      >
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
        {others.length > 0 && (
          <>
            <div className="menu-sep" />
            <div className="tiny muted" style={{ padding: '4px 10px' }}>
              Switch account
            </div>
            {others.map((a) => (
              <button
                key={a.id}
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  switchAccount(a.id);
                }}
              >
                <Avatar name={a.displayName} url={a.avatarUrl} size={26} />
                <span className="grow ellipsis">{a.displayName}</span>
                <span className="tiny muted">@{a.username}</span>
              </button>
            ))}
          </>
        )}
        <div className="menu-sep" />
        <button
          className="menu-item"
          onClick={() => {
            setOpen(false);
            startAddAccount();
          }}
        >
          <Icon name="userPlus" size={17} /> Add another account
        </button>
        <button
          className="menu-item"
          onClick={() => {
            setOpen(false);
            navigate('/settings?section=appearance');
          }}
        >
          <Icon name="palette" size={17} /> Themes
        </button>
        <button
          className="menu-item"
          onClick={() => {
            setOpen(false);
            navigate('/settings');
          }}
        >
          <Icon name="settings" size={17} /> Settings
        </button>
        <div className="menu-sep" />
        <button className="menu-item danger" onClick={() => logout()}>
          <Icon name="logout" size={17} /> Sign out
        </button>
      </Popover>
    </div>
  );
}

export function Layout() {
  const me = useMe();
  const { can, updatePreferences } = useAuth();
  const { status } = useRealtime();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(!!me.preferences.compactSidebar);
  const connectionLost = useConnectionLost(status);
  const isReviewer = ['moderator', 'council', 'admin', 'owner'].includes(me.role);

  const chats = useQuery({ queryKey: ['chats'], queryFn: api.chats.list });
  const queue = useQuery({
    queryKey: ['applications', 'queue'],
    queryFn: api.applications.queue,
    enabled: isReviewer,
  });
  const desk = useQuery({
    queryKey: ['support', 'desk', 'open'],
    queryFn: () => api.support.desk('open'),
    enabled: can('support.answer'),
  });
  const toPay = useQuery({
    queryKey: ['invoices', 'incoming', 'open'],
    queryFn: () => api.invoices.list({ direction: 'incoming', status: 'open' }),
  });
  const unread = chats.data?.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0;
  const inbox = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api.notifications.list({ unread: true, limit: 1 }),
  });

  useEffect(() => {
    document.title = unread ? `(${unread}) OVL For Business` : 'OVL For Business';
  }, [unread]);
  useEffect(() => setMoreOpen(false), [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Workspace',
      items: [
        { to: '/home', icon: 'home', label: 'Home', primary: true },
        { to: '/chats', icon: 'chat', label: 'Chats', count: unread, primary: true },
        { to: '/contacts', icon: 'users', label: 'Contacts' },
        { to: '/notifications', icon: 'bell', label: 'Notifications', count: inbox.data?.unreadCount },
      ],
    },
    {
      title: 'Finance',
      items: [
        { to: '/wallet', icon: 'wallet', label: 'Wallet', primary: true },
        { to: '/invoices', icon: 'receipt', label: 'Invoices', count: toPay.data?.length },
        { to: '/companies', icon: 'building', label: 'Companies' },
        { to: '/exchange', icon: 'chart', label: 'Exchange', primary: true },
      ],
    },
    {
      title: 'Registry',
      items: [
        { to: '/registry', icon: 'book', label: 'Public registry' },
        { to: '/applications', icon: 'file', label: 'Applications' },
      ],
    },
    {
      title: 'Help',
      items: [{ to: '/support', icon: 'support', label: 'Tech support', count: desk.data?.length }],
    },
    ...(isReviewer
      ? [
          {
            title: 'Staff',
            items: [
              { to: '/review', icon: 'review' as const, label: 'Review queue', count: queue.data?.length },
            ],
          },
        ]
      : []),
  ];
  const all = groups.flatMap((g) => g.items);
  const secondary = [
    ...all.filter((i) => !i.primary),
    { to: '/settings', icon: 'settings' as const, label: 'Settings' },
  ];
  const secondaryCount = secondary.reduce((sum, i) => sum + (i.count ?? 0), 0);
  const moreActive = secondary.some((i) => location.pathname.startsWith(i.to));
  const sectionKey = location.pathname.split('/')[1] ?? '';

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    void updatePreferences({ compactSidebar: !collapsed }).catch(() => undefined);
  };

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}`}>
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <Logo size={34} />
          <div className="brand-text">
            OVL For Business
            <small>Corporate platform</small>
          </div>
          <button
            className="btn ghost icon sm collapse-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name="sidebar" size={17} />
          </button>
        </div>
        <button className="search-button" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" size={16} />
          <span className="nav-label grow">Search…</span>
          <kbd className="nav-label">Ctrl K</kbd>
        </button>
        <div className="nav-scroll">
          {groups.map((g) => (
            <div key={g.title} className="nav-group">
              <div className="nav-section">{g.title}</div>
              {g.items.map((item) => (
                <NavItemLink key={item.to} item={item} collapsed={collapsed} />
              ))}
            </div>
          ))}
        </div>
        <button
          className={`nav-link more-button${moreActive ? ' active' : ''}`}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
        >
          <Icon name="more" size={19} />
          <span className="nav-label">More</span>
          {secondaryCount > 0 && (
            <span className="count">{secondaryCount > 99 ? '99+' : secondaryCount}</span>
          )}
        </button>
        <div className="sidebar-footer">
          <AccountSwitcher collapsed={collapsed} />
        </div>
      </nav>

      <main className="main">
        <AnimatePresence>
          {connectionLost && (
            <motion.div
              className="offline-banner"
              role="status"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              <Icon name="refresh" size={14} /> Connection lost — reconnecting… Messages appear as soon as you
              are back online.
            </motion.div>
          )}
        </AnimatePresence>
        <AccountNotices />
        {/* Enter-only: an exiting copy of the old page would stay clickable (and keep marking chats read). */}
        <PageTransition key={sectionKey}>
          <Outlet />
        </PageTransition>
      </main>

      <AnimatePresence>
        {moreOpen && (
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(e) => e.target === e.currentTarget && setMoreOpen(false)}
          >
            <motion.div
              className="sheet"
              role="dialog"
              aria-modal="true"
              aria-label="More"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            >
              <div className="sheet-handle" />
              <div className="row" style={{ padding: '4px 8px 12px' }}>
                <Avatar name={me.displayName} url={me.avatarUrl} size={40} />
                <div className="grow">
                  <div className="bold">{me.displayName}</div>
                  <div className="small muted">@{me.username}</div>
                </div>
              </div>
              {secondary.map((item) => (
                <NavLink key={item.to} to={item.to} className="nav-link sheet-link">
                  <Icon name={item.icon} size={19} />
                  <span>{item.label}</span>
                  {!!item.count && <span className="count">{item.count}</span>}
                </NavLink>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={[...all, { to: '/settings', icon: 'settings', label: 'Settings' }]}
      />
    </div>
  );
}
