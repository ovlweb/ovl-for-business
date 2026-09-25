import type { Chat } from '@ovl/shared';
import { Avatar, Empty, ErrorAlert, Field, Modal, shortTime, Spinner, StatusBadge, Tabs, t } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Conversation } from '../components/Conversation';
import { Icon } from '../components/Icon';

type View = 'mine' | 'open' | 'closed';

function TicketRow({ ticket, active, staffView }: { ticket: Chat; active: boolean; staffView: boolean }) {
  return (
    <Link to={`/support/${ticket.id}`} className={`chat-item${active ? ' active' : ''}`}>
      {staffView && ticket.support ? (
        <Avatar
          name={ticket.support.requester.displayName}
          url={ticket.support.requester.avatarUrl}
          size={40}
        />
      ) : (
        <span className="avatar" style={{ width: 40, height: 40, background: 'var(--support)' }}>
          <Icon name="support" size={20} />
        </span>
      )}
      <div className="grow">
        <div className="bold ellipsis">{ticket.title}</div>
        <div className="preview ellipsis">
          {staffView && ticket.support ? `@${ticket.support.requester.username} · ` : ''}
          {ticket.lastMessage?.body ?? ''}
        </div>
      </div>
      <div className="meta">
        <span>{ticket.lastMessage ? shortTime(ticket.lastMessage.createdAt) : ''}</span>
        {ticket.support && <StatusBadge status={ticket.support.status} />}
      </div>
    </Link>
  );
}

function NewTicketModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ subject: '', body: '' });
  const create = useMutation({
    mutationFn: () => api.support.create(form.subject, form.body),
    onSuccess: (chat) => {
      queryClient.invalidateQueries({ queryKey: ['support'] });
      onClose();
      navigate(`/support/${chat.id}`);
    },
  });
  return (
    <Modal title={t('Contact tech support')} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('Subject')}>
          <input
            className="input"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            required
            minLength={3}
            maxLength={128}
          />
        </Field>
        <Field label={t('How can we help?')}>
          <textarea
            className="textarea"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            required
          />
        </Field>
        <ErrorAlert error={create.error} />
        <button className="btn primary" disabled={create.isPending}>
          {t('Open ticket')}
        </button>
      </form>
    </Modal>
  );
}

export function SupportPage() {
  const { chatId } = useParams();
  const { can } = useAuth();
  const isStaff = can('support.answer');
  const [view, setView] = useState<View>(isStaff ? 'open' : 'mine');
  const [creating, setCreating] = useState(false);
  const mine = useQuery({
    queryKey: ['support', 'mine'],
    queryFn: api.support.mine,
    enabled: view === 'mine',
  });
  const desk = useQuery({
    queryKey: ['support', 'desk', view],
    queryFn: () => api.support.desk(view as 'open' | 'closed'),
    enabled: isStaff && view !== 'mine',
  });
  const list = view === 'mine' ? mine : desk;

  return (
    <div className={`messenger${chatId ? ' has-chat' : ''}`}>
      <aside className="chat-list-pane">
        <div className="pane-header">
          <h2 className="grow">{isStaff ? t('Support desk') : t('Tech support')}</h2>
          <button className="btn primary sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> {t('Ticket')}
          </button>
        </div>
        {isStaff && (
          <div style={{ padding: '0 10px' }}>
            <Tabs<View>
              value={view}
              onChange={setView}
              tabs={[
                { value: 'open', label: t('Open') },
                { value: 'closed', label: t('Closed') },
                { value: 'mine', label: t('My tickets') },
              ]}
            />
          </div>
        )}
        <div className="chat-list-scroll">
          {list.isLoading && <Spinner center />}
          <ErrorAlert error={list.error} />
          {list.data?.map((ticket) => (
            <TicketRow
              key={ticket.id}
              ticket={ticket}
              active={ticket.id === chatId}
              staffView={view !== 'mine'}
            />
          ))}
          {list.data?.length === 0 && (
            <Empty title={view === 'mine' ? t('No tickets yet') : t('No tickets here')}>
              {view === 'mine' && t('Questions about deposits, applications or your account? Open a ticket.')}
            </Empty>
          )}
        </div>
      </aside>
      {chatId ? (
        <Conversation key={chatId} chatId={chatId} backTo="/support" />
      ) : (
        <div className="conversation">
          <div className="center grow">
            <Empty title={isStaff ? t('Pick a ticket to answer') : t('We are here to help')}>
              {isStaff
                ? t('Your replies carry a support badge; the owner’s replies carry the owner badge.')
                : t('Moderators and administrators answer tickets here.')}
            </Empty>
          </div>
        </div>
      )}
      {creating && <NewTicketModal onClose={() => setCreating(false)} />}
    </div>
  );
}
