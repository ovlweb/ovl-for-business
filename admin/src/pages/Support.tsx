import { Avatar, Empty, ErrorAlert, formatDate, PageHeader, Spinner, StatusBadge, Tabs, t } from '@ovl/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';

export function SupportPage() {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const tickets = useQuery({
    queryKey: ['desk', status],
    queryFn: () => api.support.desk(status),
    refetchInterval: 20_000,
  });
  return (
    <div className="page">
      <PageHeader
        icon="support"
        title={t('Tech support')}
        subtitle={t(
          'Overview of tickets. Moderators, admins and the owner answer them from the regular client (Support section) with their staff badge.',
        )}
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'open', label: t('Open') },
          { value: 'closed', label: t('Closed') },
        ]}
      />
      <ErrorAlert error={tickets.error} />
      <div className="card pad-0 table-wrap">
        {tickets.isLoading && <Spinner center />}
        <table className="table">
          <thead>
            <tr>
              <th>{t('Subject')}</th>
              <th>{t('Requester')}</th>
              <th>{t('Last message')}</th>
              <th>{t('Opened')}</th>
              <th>{t('Status')}</th>
            </tr>
          </thead>
          <tbody>
            {tickets.data?.map((ticket) => (
              <tr key={ticket.id}>
                <td className="bold">{ticket.title}</td>
                <td>
                  {ticket.support && (
                    <span className="row">
                      <Avatar name={ticket.support.requester.displayName} size={24} />@
                      {ticket.support.requester.username}
                    </span>
                  )}
                </td>
                <td className="small">
                  {ticket.lastMessage && (
                    <>
                      <span className="muted">{formatDate(ticket.lastMessage.createdAt)}</span> —{' '}
                      {ticket.lastMessage.body.slice(0, 80)}
                    </>
                  )}
                </td>
                <td className="small">{formatDate(ticket.createdAt)}</td>
                <td>{ticket.support && <StatusBadge status={ticket.support.status} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {tickets.data?.length === 0 && <Empty title={t('No tickets')} />}
      </div>
    </div>
  );
}
