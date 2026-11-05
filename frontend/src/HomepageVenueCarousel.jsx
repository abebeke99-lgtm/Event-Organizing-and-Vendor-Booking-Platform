import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ChevronLeft, ChevronRight, MapPin, X } from 'lucide-react';
import { translate, useLanguage } from './language.js';
import HomepageImage from './HomepageImage.jsx';
import { homepageInspirationImages } from './homepageVenueUtils.js';

export default function HomepageVenueCarousel({ venues, loading, error, onRetry, onNavigate }) {
  const language = useLanguage();
  const galleryRef = useRef(null);
  const [activeImageIndex, setActiveImageIndex] = useState(null);
  const t = (key) => translate(key, language);
  const venueItems = Array.isArray(venues) ? venues : [];
  const venueImages = venueItems.filter((venue) => typeof venue.image === 'string' && venue.image.trim());
  const previewImages = [
    ...homepageInspirationImages.map((image) => ({ src: image.src, alt: t(image.categoryKey) })),
    ...venueImages.map((venue) => ({ src: venue.image, alt: venue.name })),
  ];

  useEffect(() => {
    if (activeImageIndex === null) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setActiveImageIndex(null);
      if (event.key === 'ArrowLeft') {
        setActiveImageIndex((index) => (index + previewImages.length - 1) % previewImages.length);
      }
      if (event.key === 'ArrowRight') {
        setActiveImageIndex((index) => (index + 1) % previewImages.length);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeImageIndex, previewImages.length]);

  const previewAt = (index) => setActiveImageIndex((index + previewImages.length) % previewImages.length);
  const scrollToGallery = () => galleryRef.current?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  });
  const liveVenuePreviewIndex = (venue) => previewImages.findIndex((image) => image.src === venue.image);
  const currentPreview = activeImageIndex === null ? null : previewImages[activeImageIndex];

  return <section className="homepage-venues" aria-labelledby="homepage-venues-title">
    <header className="homepage-inspiration-hero">
      <img className="homepage-inspiration-hero-image" src="/images%20(4).jfif" alt="" fetchpriority="high" />
      <div className="homepage-inspiration-hero-content">
        <p className="homepage-inspiration-eyebrow">{t('publicHomeVenueEyebrow')}</p>
        <h2 id="homepage-venues-title">{t('publicHomeInspirationHeading')}</h2>
        <p>{t('publicHomeInspirationDescription')}</p>
        <button className="homepage-inspiration-cta" type="button" onClick={scrollToGallery}>
          {t('exploreEvents')}<ArrowDown size={17} aria-hidden="true"/>
        </button>
      </div>
    </header>

    <div className="homepage-inspiration-content" ref={galleryRef} id="homepage-inspiration-gallery">
      <div className="homepage-inspiration-heading">
        <p className="eyebrow">{t('publicHomeVenueEyebrow')}</p>
        <h3>{t('publicHomeInspirationGalleryTitle')}</h3>
        <p>{t('publicHomeVenueGalleryCaption')}</p>
      </div>
      <div className="homepage-inspiration-grid">
        {homepageInspirationImages.map((image, index) => <button
          className={`homepage-inspiration-card${index === 0 ? ' homepage-inspiration-card-featured' : ''}`}
          key={image.src}
          type="button"
          onClick={() => previewAt(index)}
          aria-label={`${t('publicHomeOpenInspiration')} ${t(image.categoryKey)}`}
          style={{ '--inspiration-index': index }}
        >
          <img src={image.src} alt={t(image.categoryKey)} loading={index === 0 ? 'eager' : 'lazy'} width="900" height="650" />
          <span className="homepage-inspiration-card-shade" aria-hidden="true"/>
          <span className="homepage-inspiration-card-label">{t(image.categoryKey)}</span>
          <span className="homepage-inspiration-card-action" aria-hidden="true">{t('publicHomeViewImage')}</span>
        </button>)}
      </div>

      <section className="homepage-live-venues" aria-labelledby="homepage-live-venues-title">
        <div className="homepage-inspiration-heading homepage-live-venues-heading">
          <p className="eyebrow">{t('publicHomeVenueEyebrow')}</p>
          <h3 id="homepage-live-venues-title">{t('publicHomeLiveVenues')}</h3>
        </div>
        {loading
          ? <p className="homepage-venue-data-status" role="status">{t('publicHomeVenuesLoading')}</p>
          : error
            ? <p className="home-data-error" role="alert">{t('publicHomeVenuesUnavailable')} <button type="button" onClick={onRetry}>{t('publicHomeRetry')}</button></p>
            : venueItems.length
              ? <div className="homepage-live-venue-grid">
                {venueItems.map((venue, index) => {
                  const previewIndex = venue.image ? liveVenuePreviewIndex(venue) : -1;
                  return <article className="homepage-live-venue-card" key={`${venue.name}-${venue.city}-${index}`}>
                    {previewIndex >= 0 && <button className="homepage-live-venue-image" type="button" onClick={() => setActiveImageIndex(previewIndex)} aria-label={`${t('publicHomeOpenInspiration')} ${venue.name}`}>
                      <HomepageImage src={venue.image} alt={venue.name} fallbackLabel={t('publicHomeVenueImageUnavailable')} loading="lazy" width="600" height="400" />
                    </button>}
                    <div className="homepage-live-venue-copy">
                      <h4>{venue.name}</h4>
                      {venue.city && <p><MapPin size={14} aria-hidden="true"/>{venue.city}</p>}
                      <span>{venue.eventCount.toLocaleString(language === 'am' ? 'am-ET' : 'en-US')} {t('publicHomeVenueEvents')}</span>
                      <button type="button" className="button secondary small" onClick={() => onNavigate(`/events?location=${encodeURIComponent(venue.name)}`)}>{t('publicHomeViewVenueEvents')}</button>
                    </div>
                  </article>;
                })}
              </div>
              : <p className="homepage-venue-data-status" role="status">{t('publicHomeNoVenues')} <button type="button" className="button secondary small" onClick={() => onNavigate('/events')}>{t('exploreEvents')}</button></p>}
      </section>
    </div>

    {currentPreview && <div className="homepage-image-preview" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setActiveImageIndex(null)}>
      <section className="homepage-image-preview-dialog" role="dialog" aria-modal="true" aria-label={t('publicHomeImagePreview')}>
        <button className="homepage-image-preview-close" type="button" onClick={() => setActiveImageIndex(null)} aria-label={t('close')} autoFocus><X size={22} aria-hidden="true"/></button>
        {previewImages.length > 1 && <button className="homepage-image-preview-arrow homepage-image-preview-previous" type="button" onClick={() => previewAt(activeImageIndex - 1)} aria-label={t('publicHomePreviousImage')}><ChevronLeft size={26} aria-hidden="true"/></button>}
        <img src={currentPreview.src} alt={currentPreview.alt} />
        <p>{currentPreview.alt}</p>
        {previewImages.length > 1 && <button className="homepage-image-preview-arrow homepage-image-preview-next" type="button" onClick={() => previewAt(activeImageIndex + 1)} aria-label={t('publicHomeNextImage')}><ChevronRight size={26} aria-hidden="true"/></button>}
      </section>
    </div>}
  </section>;
}
