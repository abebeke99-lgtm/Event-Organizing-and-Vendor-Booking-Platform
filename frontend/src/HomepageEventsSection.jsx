import React from 'react';
import { translate, useLanguage } from './language.js';
import HomepageEventCard from './HomepageEventCard.jsx';
import { getHomepageSectionState } from './homepageUtils.js';

export default function HomepageEventsSection({ title, events, loading, error, onRetry, onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const state = getHomepageSectionState({ loading, error, items: events });
  return <>
    <div className="section-header compact-header">
      <div>
        <p className="eyebrow">{t('publicEventDiscovery')}</p>
        <h2>{title}</h2>
      </div>
      <button className="button secondary small" type="button" onClick={() => onNavigate('/events')}>{t('viewAll')}</button>
    </div>
    {state === 'error' && <div className="home-data-error" role="alert">{t('publicHomeDataUnavailable')}<button type="button" onClick={onRetry}>{t('publicHomeRetry')}</button></div>}
    <div className="event-grid">
      {state === 'loading' ? <div className="home-card-skeletons" role="status" aria-label={t('publicHomeEventsLoading')}><span/><span/><span/><span/></div>
        : state === 'error' ? null
          : state === 'populated' ? events.slice(0, 3).map((event) => <HomepageEventCard key={event.id} event={event} onNavigate={onNavigate}/>)
            : <div className="empty-card">{t('noPublicEvents')} <button type="button" className="button secondary small" onClick={() => onNavigate('/events')}>{t('exploreEvents')}</button></div>}
    </div>
  </>;
}
