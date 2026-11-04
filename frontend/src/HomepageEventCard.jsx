import React, { useState } from 'react';
import { Share2 } from 'lucide-react';
import { translate, translateText, useLanguage } from './language.js';
import { formatEventBudget, formatEventDate } from './eventUtils.js';
import HomepageImage from './HomepageImage.jsx';

export default function HomepageEventCard({ event, onNavigate }) {
  const language = useLanguage();
  const [shareMessage, setShareMessage] = useState('');
  const eventPath = `/events/${encodeURIComponent(event.id)}`;
  const price = formatEventBudget(event.startingPrice ?? event.budget, language);
  const location = [event.venue, event.location || event.city].filter(Boolean).join(' · ');

  async function shareEvent() {
    setShareMessage('');
    const url = new URL(eventPath, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: event.title, url });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareMessage(translate('publicHomeShareCopied', language));
      } else {
        setShareMessage(translate('publicHomeShareUnavailable', language));
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setShareMessage(translate('publicHomeShareUnavailable', language));
    }
  }

  return <article className="event-card homepage-event-card">
    <HomepageImage className="event-card-image" src={event.coverImage || event.image} alt={translateText(event.title || '', language)} fallbackLabel={translate('publicHomeImageUnavailable', language).replace('{name}', event.title || translate('publicHomeEventService', language))} width="800" height="500" />
    <div className="event-content">
      <span className="event-tag">{event.type ? translateText(event.type, language) : translate('publicHomeEventType', language)}</span>
      <h3>{event.title}</h3>
      <p>{formatEventDate(event.startDate || event.date, language) || translate('dateTbd', language)}</p>
      {location && <small>{location}</small>}
      {price && <strong className="homepage-event-price">{price}</strong>}
      <div className="card-actions">
        <a className="button secondary small" href={eventPath} onClick={(clickEvent) => { clickEvent.preventDefault(); onNavigate(eventPath); }}>{translate('publicHomeViewDetails', language)}</a>
        <button type="button" className="icon-button homepage-share-button" aria-label={`${translate('publicHomeShareEvent', language)}: ${event.title}`} title={translate('publicHomeShareEvent', language)} onClick={shareEvent}><Share2 size={16} aria-hidden="true"/></button>
      </div>
      {shareMessage && <span className="homepage-share-message" role="status">{shareMessage}</span>}
    </div>
  </article>;
}
