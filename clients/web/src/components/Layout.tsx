import { Avatar } from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { useRealtime } from '../realtime';
import { Icon, type IconName } from './Icon';

interface NavItem {
  to: string;
  icon: IconName;
  label: string;
  count?: number;
  /** Shown in the phone bottom bar; everything else goes into "More". */
  primary?: boolean;
}

function Link({ item, className = '' }: { item: NavItem; className?: string }) {
  return (
    <NavLink to={item.to} className={({ isActive }) => `nav-link ${className}${isActive ? ' active' : ''}`}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {!!item.count && <span className="count">{item.count > 99 ? '99+' : item.count}</span>}
    </NavLink>
  );
}

/** Show the banner only when the connection has been down for a while, not on every blip. */
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

export function Layout() {
  const me = useMe();
  const { can } = useAuth();
  const { status } = useRealtime();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
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
  const unread = chats.data?.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0;

  useEffect(() => {
    document.title = unread ? `(${unread}) OVL For Business` : 'OVL For Business';
  }, [unread]);
  useEffect(() => setMoreOpen(false), [location.pathname]);

  const items: NavItem[] = [
    { to: '/chats', icon: 'chat', label: 'Chats', count: unread, primary: true },
    { to: '/contacts', icon: 'users', label: 'Contacts' },
    { to: '/wallet', icon: 'wallet', label: 'Wallet', primary: true },
    { to: '/companies', icon: 'briefcase', label: 'Companies', primary: true },
    { to: '/exchange', icon: 'chart', label: 'Exchange', primary: true },
    { to: '/registry', icon: 'book', label: 'Registry' },
    { to: '/applications', icon: 'file', label: 'Applications' },
    { to: '/support', icon: 'support', label: 'Support', count: desk.data?.length },
  ];
  const staffItems: NavItem[] = isReviewer
    ? [{ to: '/review', icon: 'review', label: 'Review queue', count: queue.data?.length }]
    : [];
  const profile: NavItem = { to: '/profile', icon: 'user', label: 'Profile' };
  const secondary = [...items.filter((i) => !i.primary), ...staffItems, profile];
  const secondaryCount = secondary.reduce((sum, i) => sum + (i.count ?? 0), 0);
  const moreActive = secondary.some((i) => location.pathname.startsWith(i.to));

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <div>
            OVL For Business
            <small>Corporate platform</small>
          </div>
        </div>
        {items.map((item) => (
          <Link key={item.to} item={item} className={item.primary ? '' : 'secondary'} />
        ))}
        {staffItems.length > 0 && <div className="nav-section">Staff</div>}
        {staffItems.map((item) => (
          <Link key={item.to} item={item} className="secondary" />
        ))}
        <Link item={profile} className="secondary desktop-hidden" />
        <button
          className={`nav-link more-button${moreActive ? ' active' : ''}`}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
        >
          <Icon name="more" />
          <span>More</span>
          {secondaryCount > 0 && (
            <span className="count">{secondaryCount > 99 ? '99+' : secondaryCount}</span>
          )}
        </button>
        <div className="sidebar-footer">
          <NavLink to="/profile" className="nav-link">
            <Avatar name={me.displayName} url={me.avatarUrl} size={28} />
            <span className="grow ellipsis">{me.displayName}</span>
            <span className={`connection-dot ${status}`} title={`Realtime: ${status}`} />
          </NavLink>
        </div>
      </nav>
      <main className="main">
        {connectionLost && (
          <div className="offline-banner" role="status">
            Connection lost — reconnecting… Messages will appear as soon as you are back online.
          </div>
        )}
        <Outlet />
      </main>

      {moreOpen && (
        <div
          className="sheet-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setMoreOpen(false)}
        >
          <div className="sheet" role="dialog" aria-modal="true" aria-label="More">
            <div className="sheet-handle" />
            <div className="row" style={{ padding: '4px 8px 12px' }}>
              <Avatar name={me.displayName} url={me.avatarUrl} size={40} />
              <div className="grow">
                <div className="bold">{me.displayName}</div>
                <div className="small muted">@{me.username}</div>
              </div>
            </div>
            {secondary.map((item) => (
              <Link key={item.to} item={item} className="sheet-link" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
