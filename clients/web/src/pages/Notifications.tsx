import type { Notification, NotificationType } from '@ovl/shared';
import { Empty, ErrorAlert, PageHeader, Segmented, shortTime, Spinner } from '@ovl/ui';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Icon, type IconName } from '../components/Icon';

const ICONS: Record<NotificationType, IconName> = {
  mention: 'at',
  reply: 'reply',
  comment: 'comment',
  money: 'wallet',
  invoice: 'receipt',
  payment_approval: 'shield',
  application: 'file',
  identity: 'user',
  cash_request: 'wallet',
  licence: 'award',
  test: 'bell',
};

const PAGE = 30;

/** The notification center: mentions, replies, money, invoices, approvals and application news. */
export function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const list = useInfiniteQuery({
    queryKey: ['notifications', filter],
    queryFn: ({ pageParam }) =>
      api.notifications.list({ before: pageParam, unread: filter === 'unread' || undefined, limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.items.length === PAGE ? last.items[last.items.length - 1]!.createdAt : undefined,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({
    mutationFn: (ids?: string[]) => api.notifications.read(ids),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: api.notifications.remove, onSuccess: refresh });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = list.data?.pages[0]?.unreadCount ?? 0;

  const open = (n: Notification) => {
    if (!n.read) read.mutate([n.id]);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="page stack-lg">
      <PageHeader
        icon="bell"
        title="Notifications"
        subtitle="Mentions, replies, payments, invoices, approvals and news about your applications."
        actions={
          <button className="btn" disabled={!unread || read.isPending} onClick={() => read.mutate(undefined)}>
            <Icon name="checkCheck" size={16} /> Mark all as read
          </button>
        }
      />
      <Segmented<'all' | 'unread'>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: unread ? `Unread (${unread})` : 'Unread' },
        ]}
      />
      <ErrorAlert error={list.error ?? read.error ?? remove.error} />
      {list.isLoading && <Spinner center />}
      {list.data && !items.length && (
        <Empty title={filter === 'unread' ? 'All caught up' : 'Nothing yet'}>
          Mentions, payments and approvals show up here, and on your devices when push notifications are on
          (Settings).
        </Empty>
      )}
      {items.length > 0 && (
        <div className="card pad-0 notification-list" role="list" aria-label="Notifications">
          {items.map((n) => (
            <div key={n.id} role="listitem" className={`notification-item${n.read ? '' : ' unread'}`}>
              <button type="button" className="notification-open" onClick={() => open(n)}>
                <span className="kpi-icon">
                  <Icon name={ICONS[n.type] ?? 'bell'} size={17} />
                </span>
                <span className="grow stack-sm" style={{ gap: 2, minWidth: 0 }}>
                  <span className="bold">{n.title}</span>
                  {n.body && <span className="small muted ellipsis">{n.body}</span>}
                </span>
                <span className="tiny muted nowrap">{shortTime(n.createdAt)}</span>
              </button>
              <button
                type="button"
                className="btn ghost icon sm"
                aria-label={`Remove ${n.title}`}
                onClick={() => remove.mutate(n.id)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {list.hasNextPage && (
        <button className="btn" style={{ alignSelf: 'center' }} onClick={() => list.fetchNextPage()}>
          {list.isFetchingNextPage ? 'Loading…' : 'Older notifications'}
        </button>
      )}
    </div>
  );
}
