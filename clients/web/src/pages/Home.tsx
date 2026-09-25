import { WORKFLOWS } from '@ovl/shared';
import {
  AnimatedNumber,
  Avatar,
  Empty,
  formatMoney,
  Icon,
  shortTime,
  Skeleton,
  Stagger,
  StaggerItem,
  StatusBadge,
  WorkflowStepper,
  type IconName,
  plural,
  intlLocale,
  t,
} from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useMe } from '../auth';
import { StoriesBar } from '../components/Stories';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return t('Good night');
  if (h < 12) return t('Good morning');
  if (h < 18) return t('Good afternoon');
  return t('Good evening');
}

function QuickAction({ to, icon, label, tone }: { to: string; icon: IconName; label: string; tone: string }) {
  return (
    <Link to={to} className="quick-action">
      <motion.span
        className={`qa-icon ${tone}`}
        whileHover={{ scale: 1.08, rotate: -4 }}
        whileTap={{ scale: 0.95 }}
      >
        <Icon name={icon} size={20} />
      </motion.span>
      <span>{label}</span>
    </Link>
  );
}

export function HomePage() {
  const me = useMe();
  const isReviewer = ['moderator', 'council', 'admin', 'owner'].includes(me.role);
  const wallets = useQuery({ queryKey: ['wallets'], queryFn: api.wallets.list });
  const chats = useQuery({ queryKey: ['chats'], queryFn: api.chats.list });
  const applications = useQuery({ queryKey: ['applications', 'mine'], queryFn: api.applications.mine });
  const orgs = useQuery({ queryKey: ['orgs', 'mine'], queryFn: api.organizations.mine });
  const portfolio = useQuery({ queryKey: ['portfolio'], queryFn: api.stock.portfolio });
  const listings = useQuery({ queryKey: ['listings'], queryFn: () => api.stock.listings('active') });
  const queue = useQuery({
    queryKey: ['applications', 'queue'],
    queryFn: api.applications.queue,
    enabled: isReviewer,
  });

  const unread = chats.data?.reduce((s, c) => s + c.unreadCount, 0) ?? 0;
  const pending = applications.data?.filter((a) => a.status === 'pending') ?? [];
  const primary = wallets.data?.slice().sort((a, b) => Number(b.balance) - Number(a.balance))[0];
  const portfolioValue = portfolio.data?.holdings[0];
  const topListings =
    listings.data
      ?.slice()
      .sort((a, b) => Number(b.raised) - Number(a.raised))
      .slice(0, 4) ?? [];

  return (
    <div className="page stack-lg home">
      <motion.div
        className="home-hero"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mesh hero-mesh">
          <span className="blob b1" />
          <span className="blob b2" />
        </div>
        <div className="home-hero-content">
          <div className="stack-sm">
            <span className="hero-date">
              {new Date().toLocaleDateString(intlLocale(), {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </span>
            <h1>
              {greeting()}, {me.displayName.split(' ')[0]}
            </h1>
            <p>
              {unread > 0 ? plural(unread, 'unread message') : t('You are all caught up')}
              {pending.length > 0 && ` ${t('· {0} in review', plural(pending.length, 'application'))}`}
            </p>
          </div>
          <div className="hero-balance">
            <span className="hero-balance-label">
              <Icon name="wallet" size={15} /> {primary ? t('{0} balance', primary.currency) : t('Balance')}
            </span>
            {wallets.isLoading ? (
              <Skeleton width={180} height={34} />
            ) : primary ? (
              <span className="hero-balance-value">
                <AnimatedNumber value={primary.balance} format={(v) => formatMoney(v, primary.currency)} />
              </span>
            ) : (
              <span className="hero-balance-value">—</span>
            )}
            {wallets.data && wallets.data.length > 1 && (
              <span className="hero-balance-more">{t('+{0} more currencies', wallets.data.length - 1)}</span>
            )}
          </div>
        </div>
      </motion.div>

      <div className="quick-actions">
        <QuickAction to="/wallet" icon="send" label={t('Send money')} tone="blue" />
        <QuickAction to="/chats" icon="chat" label={t('Messages')} tone="violet" />
        <QuickAction to="/exchange" icon="chart" label={t('Invest')} tone="green" />
        <QuickAction to="/applications?new=company" icon="building" label={t('New company')} tone="amber" />
        <QuickAction to="/registry" icon="book" label={t('Registry')} tone="teal" />
        <QuickAction to="/support" icon="support" label={t('Support')} tone="pink" />
      </div>

      <StoriesBar />

      <Stagger className="grid-4" gap={0.06}>
        <StaggerItem className="card kpi">
          <span className="kpi-label">
            <span className="kpi-icon">
              <Icon name="chat" size={16} />
            </span>
            {t('Unread')}
          </span>
          <span className="kpi-value">
            <AnimatedNumber value={String(unread)} />
          </span>
        </StaggerItem>
        <StaggerItem className="card kpi">
          <span className="kpi-label">
            <span className="kpi-icon">
              <Icon name="briefcase" size={16} />
            </span>
            {t('Companies')}
          </span>
          <span className="kpi-value">
            <AnimatedNumber value={String(orgs.data?.length ?? 0)} />
          </span>
        </StaggerItem>
        <StaggerItem className="card kpi">
          <span className="kpi-label">
            <span className="kpi-icon">
              <Icon name="pie" size={16} />
            </span>
            {t('Portfolio')}
          </span>
          <span className="kpi-value">
            {portfolioValue ? (
              <AnimatedNumber
                value={portfolioValue.currentValue}
                format={(v) => formatMoney(v, portfolioValue.currency)}
              />
            ) : (
              '—'
            )}
          </span>
        </StaggerItem>
        <StaggerItem className="card kpi">
          <span className="kpi-label">
            <span className="kpi-icon">
              <Icon name="file" size={16} />
            </span>
            {t('In review')}
          </span>
          <span className="kpi-value">
            <AnimatedNumber value={String(pending.length)} />
          </span>
        </StaggerItem>
      </Stagger>

      {isReviewer && (queue.data?.length ?? 0) > 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <Link to="/review" className="card interactive staff-banner">
            <span className="kpi-icon" style={{ background: 'var(--council-soft)', color: 'var(--council)' }}>
              <Icon name="review" size={18} />
            </span>
            <div className="grow">
              <b>{t('{0} waiting for your decision', plural(queue.data!.length, 'application'))}</b>
              <div className="small muted">
                {t('Companies, licenses and staff candidates in your review queue.')}
              </div>
            </div>
            <Icon name="chevronRight" />
          </Link>
        </motion.div>
      )}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card pad-0">
          <div className="card-header padded">
            <h3>{t('Recent conversations')}</h3>
            <Link to="/chats" className="small">
              {t('All chats')}
            </Link>
          </div>
          {chats.isLoading && (
            <div style={{ padding: 16 }} className="stack">
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          )}
          <div className="list">
            {chats.data?.slice(0, 5).map((c) => (
              <Link key={c.id} to={`/chats/${c.id}`} className="list-item">
                <Avatar name={c.title} url={c.peer?.avatarUrl} size={36} />
                <div className="grow">
                  <div className="bold ellipsis">{c.title}</div>
                  <div className="small muted ellipsis">{c.lastMessage?.body ?? t('No messages yet')}</div>
                </div>
                <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                  <span className="tiny muted">
                    {c.lastMessage ? shortTime(c.lastMessage.createdAt) : ''}
                  </span>
                  {c.unreadCount > 0 && <span className="count">{c.unreadCount}</span>}
                </div>
              </Link>
            ))}
          </div>
          {chats.data?.length === 0 && <Empty icon="chat" title={t('No conversations yet')} />}
        </div>

        <div className="stack-lg">
          <div className="card stack">
            <div className="spread">
              <h3>{t('Your applications')}</h3>
              <Link to="/applications" className="small">
                {t('View all')}
              </Link>
            </div>
            {applications.data?.slice(0, 3).map((a) => (
              <Link key={a.id} to="/applications" className="app-row">
                <div className="spread">
                  <b className="ellipsis">
                    {String(a.payload.name ?? a.payload.title ?? WORKFLOWS[a.type].label)}
                  </b>
                  <StatusBadge status={a.status} />
                </div>
                <WorkflowStepper application={a} />
              </Link>
            ))}
            {applications.data?.length === 0 && (
              <div className="small muted">
                {t('Nothing submitted yet.')}{' '}
                <Link to="/applications?new=company">{t('Register a company')}</Link> {t('or')}{' '}
                <Link to="/applications?new=license">{t('request a license')}</Link>.
              </div>
            )}
          </div>

          <div className="card pad-0">
            <div className="card-header padded">
              <h3>{t('Exchange')}</h3>
              <Link to="/exchange" className="small">
                {t('Open market')}
              </Link>
            </div>
            <div className="list">
              {topListings.map((l) => (
                <Link key={l.id} to={`/exchange/${l.ticker}`} className="list-item">
                  <span className="ticker-badge">{l.ticker}</span>
                  <div className="grow">
                    <div className="bold ellipsis">{l.organization.name}</div>
                    <div className="tiny muted">
                      {t('{0} investors · raised {1}', l.investorsCount, formatMoney(l.raised, l.currency))}
                    </div>
                  </div>
                  <span className="num bold">{formatMoney(l.sharePrice, l.currency)}</span>
                </Link>
              ))}
            </div>
            {listings.data?.length === 0 && <Empty icon="chart" title={t('No listed companies yet')} />}
          </div>
        </div>
      </div>
    </div>
  );
}
