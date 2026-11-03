import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function HorizontalCarousel({ children, label }) {
  const trackRef = useRef(null);
  const id = useId().replace(/:/g, '');
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setCanScrollLeft(track.scrollLeft > 1);
    setCanScrollRight(track.scrollWidth - track.clientWidth - track.scrollLeft > 1);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    updateScrollButtons();
    track.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons);

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateScrollButtons);
    observer?.observe(track);
    if (track.firstElementChild) observer?.observe(track.firstElementChild);

    return () => {
      track.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
      observer?.disconnect();
    };
  }, [children, updateScrollButtons]);

  const scroll = (direction) => {
    const track = trackRef.current;
    if (!track) return;
    const firstCard = track.firstElementChild;
    const gap = Number.parseFloat(window.getComputedStyle(track).columnGap) || 0;
    const distance = firstCard ? firstCard.getBoundingClientRect().width + gap : 360;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({ left: direction * distance, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const handleKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    scroll(event.key === 'ArrowLeft' ? -1 : 1);
  };

  return (
    <div className="horizontal-carousel">
      <button
        className="horizontal-carousel-arrow horizontal-carousel-arrow-left"
        type="button"
        aria-label={`Scroll ${label} left`}
        aria-controls={`horizontal-carousel-${id}`}
        disabled={!canScrollLeft}
        onClick={() => scroll(-1)}
      >
        <ChevronLeft size={21} aria-hidden="true" />
      </button>
      <div
        className="horizontal-carousel-track"
        id={`horizontal-carousel-${id}`}
        role="region"
        aria-label={label}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        ref={trackRef}
      >
        {children}
      </div>
      <button
        className="horizontal-carousel-arrow horizontal-carousel-arrow-right"
        type="button"
        aria-label={`Scroll ${label} right`}
        aria-controls={`horizontal-carousel-${id}`}
        disabled={!canScrollRight}
        onClick={() => scroll(1)}
      >
        <ChevronRight size={21} aria-hidden="true" />
      </button>
    </div>
  );
}
