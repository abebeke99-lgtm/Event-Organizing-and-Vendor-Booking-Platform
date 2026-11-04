import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import apiClient from './api/axios.js';
import { translate, useLanguage } from './language.js';
import { getNextHeroSlideIndex, normalizeHeroSlides } from './heroSlidesUtils.js';

function resolveImageUrl(path) {
  if (!path?.startsWith('/api/')) return '';
  const baseUrl = apiClient.defaults.baseURL;
  return !baseUrl || baseUrl.startsWith('/') ? path : new URL(path, baseUrl).toString();
}

export default function HomeHeroSlider({ onNavigate }) {
  const language = useLanguage();
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const draggedRef = useRef(false);
  const [slides, setSlides] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedIds, setFailedIds] = useState(() => new Set());
  const [pausedByUser, setPausedByUser] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiClient.get('/hero-slides', { signal: controller.signal }).then(({ data }) => {
      const activeSlides = normalizeHeroSlides(data?.data);
      setSlides(activeSlides);
      setActiveIndex(0);
    }).catch((error) => {
      if (error.name !== 'AbortError' && !controller.signal.aborted) setSlides([]);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setDocumentHidden(document.hidden);
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  const autoplaying = slides.length > 1 && !pausedByUser && !interactionPaused && !documentHidden && !reducedMotion;
  const scrollToSlide = useCallback((index) => {
    const boundedIndex = Math.max(0, Math.min(index, slides.length - 1));
    const track = trackRef.current;
    const slide = track?.children[boundedIndex];
    if (!track || !slide) return;
    setActiveIndex(boundedIndex);
    track.scrollTo({ left: slide.offsetLeft, behavior: reducedMotion ? 'instant' : 'smooth' });
  }, [reducedMotion, slides.length]);

  useEffect(() => {
    if (!autoplaying) return undefined;
    const timer = window.setInterval(() => {
      scrollToSlide(getNextHeroSlideIndex(activeIndex, slides.length));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeIndex, autoplaying, scrollToSlide, slides.length]);

  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    const nextIndex = Math.round(track.scrollLeft / track.clientWidth);
    setActiveIndex(Math.max(0, Math.min(nextIndex, slides.length - 1)));
  }, [slides.length]);

  function handleKeyDown(event) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      scrollToSlide(getNextHeroSlideIndex(activeIndex, slides.length, -1));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      scrollToSlide(getNextHeroSlideIndex(activeIndex, slides.length));
    }
  }

  function handlePointerDown(event) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft };
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    const distance = event.clientX - dragRef.current.startX;
    if (Math.abs(distance) > 4) draggedRef.current = true;
    if (draggedRef.current) event.currentTarget.scrollLeft = dragRef.current.scrollLeft - distance;
  }

  function handlePointerUp(event) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  if (!slides.length || failedIds.size > 0) return null;

  return <div
    className="home-hero-carousel"
    role="region"
    aria-roledescription="carousel"
    aria-label={translate('heroCarouselLabel', language)}
    tabIndex={0}
    onKeyDown={handleKeyDown}
    onMouseEnter={() => setInteractionPaused(true)}
    onMouseLeave={() => setInteractionPaused(false)}
    onFocus={() => setInteractionPaused(true)}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setInteractionPaused(false);
    }}
  >
    <div
      className="home-hero-carousel-track"
      ref={trackRef}
      onScroll={handleScroll}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-live={autoplaying ? 'off' : 'polite'}
    >
      {slides.map((slide, index) => {
        const image = !failedIds.has(slide.id) && <img
          className="home-hero-slide-image"
          src={resolveImageUrl(slide.imageUrl)}
          alt={slide.altText}
          width="1920"
          height="900"
          loading={index === 0 ? 'eager' : 'lazy'}
          fetchPriority={index === 0 ? 'high' : 'auto'}
          draggable="false"
          onError={() => setFailedIds((current) => new Set(current).add(slide.id))}
        />;
        return <div
          className="home-hero-slide"
          role="group"
          aria-roledescription="slide"
          aria-label={translate('heroSlidePosition', language).replace('{current}', String(index + 1)).replace('{total}', String(slides.length))}
          key={slide.id}
        >
          {image && slide.linkUrl
            ? <a className="home-hero-slide-link" href={slide.linkUrl} tabIndex={index === activeIndex ? 0 : -1} aria-label={slide.altText} onClick={(event) => {
              if (draggedRef.current) {
                event.preventDefault();
                draggedRef.current = false;
              } else if (slide.linkUrl.startsWith('/') && onNavigate) {
                event.preventDefault();
                onNavigate(slide.linkUrl);
              }
            }}>{image}</a>
            : image}
        </div>;
      })}
    </div>
    <div className="home-hero-carousel-controls">
      <button type="button" className="home-hero-carousel-button" onClick={() => scrollToSlide(getNextHeroSlideIndex(activeIndex, slides.length, -1))} aria-label={translate('heroPreviousSlide', language)} title={translate('heroPreviousSlide', language)}><ChevronLeft size={20}/></button>
      <button type="button" className="home-hero-carousel-button" onClick={() => scrollToSlide(getNextHeroSlideIndex(activeIndex, slides.length))} aria-label={translate('heroNextSlide', language)} title={translate('heroNextSlide', language)}><ChevronRight size={20}/></button>
      <button type="button" className="home-hero-carousel-button" onClick={() => setPausedByUser((current) => !current)} aria-label={translate(pausedByUser ? 'heroPlaySlides' : 'heroPauseSlides', language)} title={translate(pausedByUser ? 'heroPlaySlides' : 'heroPauseSlides', language)} aria-pressed={pausedByUser}>{pausedByUser ? <Play size={17}/> : <Pause size={17}/>}</button>
    </div>
    <div className="home-hero-carousel-dots" role="group" aria-label={translate('heroChooseSlide', language)}>
      {slides.map((slide, index) => <button
        key={slide.id}
        type="button"
        className={`home-hero-carousel-dot ${index === activeIndex ? 'active' : ''}`}
        aria-label={translate('heroSlidePosition', language).replace('{current}', String(index + 1)).replace('{total}', String(slides.length))}
        aria-current={index === activeIndex ? 'true' : undefined}
        onClick={() => scrollToSlide(index)}
      />)}
    </div>
  </div>;
}
