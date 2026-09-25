import type { Story } from '@ovl/shared';
import { Avatar, Badges, ErrorAlert, Field, Modal, plural, timeAgo, t } from '@ovl/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from './Icon';

const STORY_MS = 6000;

function StoryViewer({ stories, start, onClose }: { stories: Story[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const queryClient = useQueryClient();
  const story = stories[index];

  useEffect(() => {
    if (!story) return;
    if (!story.viewed) {
      api.stories
        .view(story.id)
        .then(() => queryClient.invalidateQueries({ queryKey: ['stories'] }))
        .catch(() => undefined);
    }
    const t = setTimeout(() => (index + 1 < stories.length ? setIndex(index + 1) : onClose()), STORY_MS);
    return () => clearTimeout(t);
  }, [index, story, stories.length, onClose, queryClient]);

  if (!story) return null;
  return (
    <div className="story-viewer" onClick={onClose}>
      <div
        className="story-card"
        style={{ background: story.background }}
        onClick={(e) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          if (e.clientX - rect.left < rect.width / 3) setIndex(Math.max(0, index - 1));
          else if (index + 1 < stories.length) setIndex(index + 1);
          else onClose();
        }}
      >
        <div className="story-progress">
          {stories.map((s, i) => (
            <span key={s.id} className={i <= index ? 'done' : ''} />
          ))}
        </div>
        <div className="row">
          <Avatar name={story.author.displayName} url={story.author.avatarUrl} size={34} />
          <div className="grow">
            <div className="row" style={{ gap: 6 }}>
              <span className="bold">{story.author.displayName}</span>
              <Badges badges={story.author.badges} />
            </div>
            <div className="tiny" style={{ opacity: 0.8 }}>
              {t('{0} · {1} views', timeAgo(story.createdAt), story.viewsCount)}
            </div>
          </div>
        </div>
        {story.mediaUrl && <img src={story.mediaUrl} alt="" style={{ marginTop: 16 }} />}
        <div className="story-text">{story.text}</div>
        {story.linkUrl && (
          <a
            className="btn"
            href={story.linkUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ alignSelf: 'center' }}
          >
            {t('Open link')}
          </a>
        )}
      </div>
    </div>
  );
}

function PublishStoryModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    text: '',
    mediaUrl: '',
    linkUrl: '',
    background: '#2d6cdf',
    durationHours: 24,
  });
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
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      onClose();
    },
  });
  return (
    <Modal title={t('Publish a service story')} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          publish.mutate();
        }}
      >
        <p className="small muted">
          {t('Service stories are shown to every user on every platform until they expire.')}
        </p>
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
          <Field label={t('Visible for')}>
            <select
              className="select"
              value={form.durationHours}
              onChange={(e) => setForm({ ...form, durationHours: Number(e.target.value) })}
            >
              {[6, 12, 24, 48, 72, 168].map((h) => (
                <option key={h} value={h}>
                  {h < 48 ? plural(h, 'hour') : plural(h / 24, 'day')}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ErrorAlert error={publish.error} />
        <button className="btn primary" disabled={publish.isPending}>
          {t('Publish')}
        </button>
      </form>
    </Modal>
  );
}

export function StoriesBar() {
  const { can } = useAuth();
  const stories = useQuery({ queryKey: ['stories'], queryFn: api.stories.list });
  const [viewing, setViewing] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const canPublish = can('stories.publish');
  // Viewer order groups each author's stories together; the bar shows one bubble per author.
  const list = useMemo(() => {
    const data = stories.data ?? [];
    const order = [...new Set(data.map((s) => s.author.id))];
    return order.flatMap((id) => data.filter((s) => s.author.id === id));
  }, [stories.data]);
  const authors = useMemo(() => {
    const out: { author: (typeof list)[number]['author']; start: number; seen: boolean }[] = [];
    list.forEach((s, i) => {
      const last = out[out.length - 1];
      if (last?.author.id === s.author.id) last.seen &&= s.viewed;
      else out.push({ author: s.author, start: i, seen: s.viewed });
    });
    return out;
  }, [list]);
  if (!list.length && !canPublish) return null;

  return (
    <>
      <div className="stories-bar">
        {canPublish && (
          <button className="story-bubble" onClick={() => setPublishing(true)}>
            <span className="story-add">
              <Icon name="plus" />
            </span>
            {t('New story')}
          </button>
        )}
        {authors.map(({ author, start, seen }) => (
          <button
            key={author.id}
            className="story-bubble"
            onClick={() => setViewing(start)}
            title={author.displayName}
          >
            <span className={`story-ring${seen ? ' seen' : ''}`}>
              <Avatar name={author.displayName} url={author.avatarUrl} size={48} />
            </span>
            <span className="ellipsis" style={{ maxWidth: 58 }}>
              {author.displayName}
            </span>
          </button>
        ))}
      </div>
      {viewing !== null && <StoryViewer stories={list} start={viewing} onClose={() => setViewing(null)} />}
      {publishing && <PublishStoryModal onClose={() => setPublishing(false)} />}
      {stories.error && <ErrorAlert error={stories.error} />}
    </>
  );
}
