import { ErrorAlert, Field, formatDate, PageHeader, Spinner, t } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';

export function StoriesPage() {
  const queryClient = useQueryClient();
  const stories = useQuery({ queryKey: ['stories'], queryFn: api.stories.list });
  const [form, setForm] = useState({
    text: '',
    mediaUrl: '',
    linkUrl: '',
    background: '#2d6cdf',
    durationHours: 24,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['stories'] });
  const publish = useMutation({
    mutationFn: () =>
      api.stories.publish({
        text: form.text,
        background: form.background,
        durationHours: form.durationHours,
        mediaUrl: form.mediaUrl || undefined,
        linkUrl: form.linkUrl || undefined,
      }),
    onSuccess: () => {
      setForm({ ...form, text: '', mediaUrl: '', linkUrl: '' });
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: api.stories.delete, onSuccess: refresh });

  return (
    <div className="page stack-lg">
      <PageHeader
        icon="sparkles"
        title={t('Service stories')}
        subtitle={t('Short announcements shown in every client (web, mobile, desktop) until they expire.')}
      />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            publish.mutate();
          }}
        >
          <h3>{t('Publish')}</h3>
          <Field label={t('Text')}>
            <textarea
              className="textarea"
              maxLength={500}
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              required
            />
          </Field>
          <Field label={t('Image URL (optional)')}>
            <input
              className="input"
              type="url"
              value={form.mediaUrl}
              onChange={(e) => setForm({ ...form, mediaUrl: e.target.value })}
            />
          </Field>
          <Field label={t('Link (optional)')}>
            <input
              className="input"
              type="url"
              value={form.linkUrl}
              onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
            />
          </Field>
          <div className="grid-2">
            <Field label={t('Background')}>
              <input
                className="input"
                type="color"
                value={form.background}
                onChange={(e) => setForm({ ...form, background: e.target.value })}
              />
            </Field>
            <Field label={t('Hours visible')}>
              <input
                className="input"
                type="number"
                min={1}
                max={168}
                value={form.durationHours}
                onChange={(e) => setForm({ ...form, durationHours: Number(e.target.value) })}
              />
            </Field>
          </div>
          <ErrorAlert error={publish.error} />
          <button className="btn primary" disabled={publish.isPending}>
            {t('Publish story')}
          </button>
        </form>
        <div className="stack">
          {stories.isLoading && <Spinner center />}
          <ErrorAlert error={stories.error ?? remove.error} />
          {stories.data?.map((s) => (
            <div key={s.id} className="card stack-sm" style={{ borderLeft: `6px solid ${s.background}` }}>
              <div className="spread">
                <b>{s.author.displayName}</b>
                <button className="btn sm ghost" onClick={() => remove.mutate(s.id)}>
                  {t('Delete')}
                </button>
              </div>
              <p>{s.text}</p>
              <span className="small muted">
                {t('{0} views · expires {1}', s.viewsCount, formatDate(s.expiresAt))}
              </span>
            </div>
          ))}
          {stories.data?.length === 0 && <p className="muted">{t('No active stories.')}</p>}
        </div>
      </div>
    </div>
  );
}
