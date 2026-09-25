import type { FileInfo } from '@ovl/shared';
import { useRef, useState } from 'react';
import { ErrorAlert } from './components';
import { Icon } from './icons';
import { t } from './i18n';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const isImage = (f: FileInfo) => f.contentType.startsWith('image/');

/** Files attached to something, as chips: image thumbnails, names, sizes, open in a new tab. */
export function AttachmentList({
  files,
  href,
  onRemove,
}: {
  files: FileInfo[];
  /** Turns an API file path into a full URL (the SDK's files.url). */
  href: (path: string) => string;
  onRemove?: (file: FileInfo) => void;
}) {
  if (!files.length) return null;
  return (
    <div className="attachments">
      {files.map((f) => (
        <div key={f.id} className="attachment">
          <a href={href(f.url)} target="_blank" rel="noreferrer" className="attachment-link">
            {isImage(f) ? (
              <img src={href(f.url)} alt="" className="attachment-thumb" loading="lazy" />
            ) : (
              <span className="attachment-icon">
                <Icon name="file" size={18} />
              </span>
            )}
            <span className="attachment-meta">
              <span className="ellipsis">{f.name}</span>
              <span className="tiny muted">{formatSize(f.size)}</span>
            </span>
          </a>
          {onRemove && (
            <button
              type="button"
              className="btn ghost icon sm"
              aria-label={t('Remove {0}', f.name)}
              onClick={() => onRemove(f)}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Pick and upload files (shows progress as a spinner and errors inline). */
export function AttachmentPicker({
  value,
  onChange,
  upload,
  remove,
  href,
  max = 10,
  accept = 'image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.odt,.ods,.zip',
  label = t('Attach files'),
}: {
  value: FileInfo[];
  onChange: (files: FileInfo[]) => void;
  upload: (file: File) => Promise<FileInfo>;
  remove?: (file: FileInfo) => Promise<unknown>;
  href: (path: string) => string;
  max?: number;
  accept?: string;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="stack-sm">
      <AttachmentList
        files={value}
        href={href}
        onRemove={(f) => {
          onChange(value.filter((x) => x.id !== f.id));
          void remove?.(f).catch(() => undefined);
        }}
      />
      <ErrorAlert error={error} />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={accept}
        aria-label={label}
        onChange={async (e) => {
          const picked = [...(e.target.files ?? [])].slice(0, Math.max(0, max - value.length));
          e.target.value = '';
          if (!picked.length) return;
          setBusy(true);
          setError(null);
          const added: FileInfo[] = [];
          try {
            for (const file of picked) added.push(await upload(file));
          } catch (err) {
            setError(err);
          } finally {
            onChange([...value, ...added]);
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        className="btn sm"
        style={{ alignSelf: 'flex-start' }}
        disabled={busy || value.length >= max}
        onClick={() => input.current?.click()}
      >
        {busy ? <span className="spinner" /> : <Icon name="plus" size={14} />} {label}
      </button>
    </div>
  );
}
