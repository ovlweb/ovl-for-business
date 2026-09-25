import { t } from '@ovl/ui';
export function Pager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  return (
    <div className="pager">
      <button
        className="btn sm"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        {t('Previous')}
      </button>
      <span className="small muted">
        {t('{0}–{1} of {2}', offset + 1, Math.min(offset + limit, total), total)}
      </span>
      <button className="btn sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        {t('Next')}
      </button>
    </div>
  );
}
