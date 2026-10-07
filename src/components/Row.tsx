import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Horizontal, snap-scrolling shelf with arrow buttons. */
export function Row({ title, count, sub, more, children }: { title: ReactNode; count?: number; sub?: string; more?: string; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ l: false, r: false });

  const update = () => {
    const t = track.current;
    if (!t) return;
    setEdges({ l: t.scrollLeft > 8, r: t.scrollLeft + t.clientWidth < t.scrollWidth - 8 });
  };
  useEffect(() => {
    update();
    const t = track.current;
    if (!t) return;
    const ro = new ResizeObserver(update);
    ro.observe(t);
    return () => ro.disconnect();
  }, [children]);

  const scroll = (dir: number) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: 'smooth' });

  return (
    <section className="row">
      <div className="row__head">
        <h2 className="section-title">
          {title}
          {count != null && <span className="count">{count}</span>}
        </h2>
        {more && (
          <Link className="more" to={more}>
            See all →
          </Link>
        )}
      </div>
      {sub && <p className="row__sub">{sub}</p>}
      <button className="row__arrow row__arrow--l" hidden={!edges.l} onClick={() => scroll(-1)} aria-label="Scroll left">
        <ChevronLeft />
      </button>
      <div className="row__track" ref={track} onScroll={update}>
        {children}
      </div>
      <button className="row__arrow row__arrow--r" hidden={!edges.r} onClick={() => scroll(1)} aria-label="Scroll right">
        <ChevronRight />
      </button>
    </section>
  );
}
