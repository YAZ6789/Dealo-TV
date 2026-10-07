import { useState } from 'react';

/** 10-segment energy-bar rating. Click a segment to rate, click the same value to clear. */
export function RatingInput({ value, onChange, size }: { value?: number; onChange: (v: number | undefined) => void; size?: 'sm' }) {
  const [hover, setHover] = useState<number>();
  const shown = hover ?? value ?? 0;
  return (
    <div className={`rating ${size === 'sm' ? 'rating--sm' : ''}`} onMouseLeave={() => setHover(undefined)}>
      <div className="rating__segs" role="radiogroup" aria-label="Your rating">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} out of 10`}
            className={`rating__seg ${n <= Math.round(value ?? 0) && hover == null ? 'on' : ''} ${hover != null && n <= hover ? 'hover' : ''}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(value === n ? undefined : n)}
          />
        ))}
      </div>
      {size !== 'sm' && <span className="rating__value">{shown ? `${shown}/10` : '—'}</span>}
    </div>
  );
}
