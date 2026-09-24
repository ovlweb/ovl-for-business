import { Avatar, Empty, ErrorAlert, formatDate, PageHeader, Spinner, StatusBadge, Tabs } from '@ovl/ui';
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
        title="Tech support"
        subtitle="Overview of tickets. Moderators, admins and the owner answer them from the regular client (Support section) with their staff badge."
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'open', label: 'Open' },
          { value: 'closed', label: 'Closed' },
        ]}
      />
      <ErrorAlert error={tickets.error} />
      <div className="card pad-0 table-wrap">
        {tickets.isLoading && <Spinner center />}
        <table className="table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Requester</th>
              <th>Last message</th>
              <th>Opened</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.data?.map((t) => (
              <tr key={t.id}>
                <td className="bold">{t.title}</td>
                <td>
                  {t.support && (
                    <span className="row">
                      <Avatar name={t.support.requester.displayName} size={24} />@
                      {t.support.requester.username}
                    </span>
                  )}
                </td>
                <td className="small">
                  {t.lastMessage && (
                    <>
                      <span className="muted">{formatDate(t.lastMessage.createdAt)}</span> —{' '}
                      {t.lastMessage.body.slice(0, 80)}
                    </>
                  )}
                </td>
                <td className="small">{formatDate(t.createdAt)}</td>
                <td>{t.support && <StatusBadge status={t.support.status} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {tickets.data?.length === 0 && <Empty title="No tickets" />}
      </div>
    </div>
  );
}
