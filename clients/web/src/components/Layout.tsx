import { Avatar } from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { useRealtime } from '../realtime';
import { Icon, type IconName } from './Icon';

function Link({ to, icon, label, count }: { to: string; icon: IconName; label: string; count?: number }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
      <Icon name={icon} />
      <span>{label}</span>
      {!!count && <span className="count">{count > 99 ? '99+' : count}</span>}
    </NavLink>
  );
}

export function Layout() {
  const me = useMe();
  const { can } = useAuth();
  const { status } = useRealtime();
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
        <Link to="/chats" icon="chat" label="Chats" count={unread} />
        <Link to="/contacts" icon="users" label="Contacts" />
        <Link to="/wallet" icon="wallet" label="Wallet" />
        <Link to="/companies" icon="briefcase" label="Companies" />
        <Link to="/exchange" icon="chart" label="Exchange" />
        <Link to="/registry" icon="book" label="Registry" />
        <Link to="/applications" icon="file" label="Applications" />
        <Link to="/support" icon="support" label="Support" count={desk.data?.length} />
        {isReviewer && (
          <>
            <div className="nav-section">Staff</div>
            <Link to="/review" icon="review" label="Review queue" count={queue.data?.length} />
          </>
        )}
        <Link to="/profile" icon="user" label="Profile" />
        <div className="sidebar-footer">
          <NavLink to="/profile" className="nav-link">
            <Avatar name={me.displayName} url={me.avatarUrl} size={28} />
            <span className="grow ellipsis">{me.displayName}</span>
            <span className={`connection-dot ${status}`} title={`Realtime: ${status}`} />
          </NavLink>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
