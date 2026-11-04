import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Heart, MapPin, Trash2 } from 'lucide-react';
import { translate, useLanguage } from './language.js';
import {
  clearComparedVendors,
  getCalendarMonthRange,
  getComparedVendorIds,
  getEventDateKey,
  getRecentlyViewed,
  toggleComparedVendor,
} from './navigationFeatureUtils.js';

function usePageText() {
  const language = useLanguage();
  return (key) => translate(key, language);
}

function PageStatus({ loading, error, onRetry }) {
  const t = usePageText();
  if (loading) return <div className="navigation-feature-skeleton-grid" role="status" aria-label={t('navigationFeatureLoading')}>
    {Array.from({ length: 3 }, (_, index) => <div className="navigation-feature-skeleton" aria-hidden="true" key={index} />)}
  </div>;
  if (error) return <div className="info-card wide danger-card" role="alert">
    <p>{error}</p><button className="button secondary" type="button" onClick={onRetry}>{t('publicNavRetry')}</button>
  </div>;
  return null;
}

function eventDate(event) {
  return getEventDateKey(event?.startDate || event?.start_date);
}

function eventCard(event, onNavigate) {
  const detailsPath = `/events/${event.id}`;
  return <article className="info-card navigation-event-card" key={event.id}>
    <p className="eyebrow">{eventDate(event)}</p>
    <h3>{event.title}</h3>
    <p>{event.location || event.city || event.venue || event.eventType || event.event_type || ''}</p>
    <a className="button secondary small" href={detailsPath} onClick={(clickEvent) => {
      clickEvent.preventDefault();
      onNavigate(detailsPath);
    }}>
      {translate('navigationViewEvent')}
    </a>
  </article>;
}

export function EventCalendarPage({ api, onNavigate }) {
  const language = useLanguage();
  const t = usePageText();
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const { startDate, endDate } = getCalendarMonthRange(month.getFullYear(), month.getMonth());
      setLoading(true);
      setError('');
      try {
        const requestPage = (page) => api(
          `/platform/events?startDate=${startDate}&endDate=${endDate}&limit=50&page=${page}`,
          { signal: controller.signal },
        );
        const firstPage = await requestPage(1);
        if (!Array.isArray(firstPage?.data)) throw new Error(t('navigationFeatureInvalidResponse'));
        const totalPages = Number.isInteger(Number(firstPage.pagination?.totalPages))
          ? Math.max(1, Number(firstPage.pagination.totalPages))
          : 1;
        const pages = [firstPage.data];
        for (let firstPageNumber = 2; firstPageNumber <= totalPages; firstPageNumber += 5) {
          const pageNumbers = Array.from(
            { length: Math.min(5, totalPages - firstPageNumber + 1) },
            (_, index) => firstPageNumber + index,
          );
          const responses = await Promise.all(pageNumbers.map(requestPage));
          if (responses.some((page) => !Array.isArray(page?.data))) throw new Error(t('navigationFeatureInvalidResponse'));
          pages.push(...responses.map((page) => page.data));
        }
        setEvents(pages.flat());
      } catch (issue) {
        if (!controller.signal.aborted) setError(issue.message || t('navigationCalendarLoadFailed'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [api, month, reload]);

  const monthEvents = useMemo(() => {
    const grouped = new Map();
    events.forEach((event) => {
      const key = eventDate(event);
      if (!key) return;
      grouped.set(key, [...(grouped.get(key) || []), event]);
    });
    return grouped;
  }, [events]);
  const selectedDateEvents = monthEvents.get(selectedDate) || [];
  useEffect(() => {
    setSelectedDate((current) => {
      const currentDate = new Date(`${current}T00:00:00`);
      if (currentDate.getFullYear() === month.getFullYear() && currentDate.getMonth() === month.getMonth()) return current;
      return getEventDateKey(new Date(month.getFullYear(), month.getMonth(), 1));
    });
  }, [month]);
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(firstDay.getFullYear(), firstDay.getMonth(), 1 - firstDay.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    return { date, key: getEventDateKey(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`) };
  });
  const locale = language === 'am' ? 'am-ET' : 'en-US';
  return <main className="page-shell navigation-feature-page"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">{t('navigationDiscover')}</p><h1>{t('navigationEventCalendar')}</h1></div>
      <div className="calendar-month-controls">
        <button className="icon-button" aria-label={t('navigationPreviousMonth')} onClick={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))}><ArrowLeft size={18}/></button>
        <strong>{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</strong>
        <button className="icon-button" aria-label={t('navigationNextMonth')} onClick={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))}><ArrowRight size={18}/></button>
      </div>
    </div>
    <PageStatus loading={loading} error={error} onRetry={() => setReload((value) => value + 1)} />
    {!loading && !error && <>
      <div className="event-calendar" role="group" aria-label={t('navigationEventCalendar')}>
        {Array.from({ length: 7 }, (_, index) => <div className="event-calendar-weekday" role="group" key={`weekday-${index}`}>
          {new Date(2024, 0, 7 + index).toLocaleDateString(locale, { weekday: 'short' })}
        </div>)}
        {days.map(({ date, key }) => <div className={`event-calendar-day ${date.getMonth() === month.getMonth() ? '' : 'outside-month'} ${monthEvents.has(key) ? 'has-events' : ''}`} role="group" aria-label={date.toLocaleDateString(locale, { dateStyle: 'full' })} key={key}>
          <button type="button" className="event-calendar-date" aria-pressed={selectedDate === key} onClick={() => {
            setSelectedDate(key);
            if (date.getMonth() !== month.getMonth()) setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
          }}>
            {date.toLocaleDateString(locale, { day: 'numeric' })}
          </button>
          {(monthEvents.get(key) || []).slice(0, 2).map((event) => <button key={event.id} type="button" title={event.title} onClick={() => onNavigate(`/events/${event.id}`)}>{event.title}</button>)}
          {(monthEvents.get(key) || []).length > 2 && <span>+{monthEvents.get(key).length - 2} {t('navigationMoreEvents')}</span>}
        </div>)}
      </div>
      {events.length === 0 && <p className="info-card" role="status">{t('navigationCalendarEmpty')}</p>}
      {events.length > 0 && <section className="card-grid navigation-calendar-events" aria-live="polite">
        <div className="navigation-calendar-selection">
          <h2>Events on {new Date(`${selectedDate}T00:00:00`).toLocaleDateString(locale, { dateStyle: 'full' })}</h2>
          {selectedDateEvents.length
            ? <div className="card-grid">{selectedDateEvents.map((event) => eventCard(event, onNavigate))}</div>
            : <p className="info-card" role="status">No published events on this date.</p>}
        </div>
      </section>}
    </>}
  </div></main>;
}

export function PopularVenuesPage({ api, onNavigate }) {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await api('/platform/events/popular-venues?limit=24', { signal: controller.signal });
        if (!Array.isArray(response?.data)) throw new Error('The server returned invalid venue listing data.');
        setVenues(response.data);
      } catch (issue) {
        if (issue.name !== 'AbortError') setError(issue.message || 'Popular venues could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [api, reload]);

  return <main className="page-shell navigation-feature-page"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">DISCOVER</p><h1>Popular Venues</h1>
      <p className="muted">Venues ranked by confirmed ticket bookings and published events.</p>
    </div></div>
    <PageStatus loading={loading} error={error} onRetry={() => setReload((value) => value + 1)} />
    {!loading && !error && (venues.length ? <section className="card-grid">
      {venues.map((venue) => <article className="info-card" key={`${venue.name}-${venue.city || ''}`}>
        <Building2 size={24} aria-hidden="true" />
        <h2>{venue.name}</h2>
        {venue.city && <p><MapPin size={15} aria-hidden="true" /> {venue.city}</p>}
        <p>{venue.eventCount} published {venue.eventCount === 1 ? 'event' : 'events'}</p>
        <p>{venue.attendeeCount} confirmed {venue.attendeeCount === 1 ? 'ticket booking' : 'ticket bookings'}</p>
        <button className="button secondary small" type="button"
          onClick={() => onNavigate(`/events?location=${encodeURIComponent(venue.name)}`)}>
          View events at this venue
        </button>
      </article>)}
    </section> : <div className="info-card wide" role="status">
      No venues are listed on published events yet.
      <button className="button secondary small" type="button" onClick={() => onNavigate('/events')}>Browse Events</button>
    </div>)}
  </div></main>;
}

export function CompareVendorsPage({ api, onNavigate }) {
  const t = usePageText();
  const [initialSelection] = useState(() => {
    try { return { ids: getComparedVendorIds(), error: '' }; }
    catch (issue) { return { ids: [], error: issue.message || 'Saved comparison data could not be read.' }; }
  });
  const [ids, setIds] = useState(initialSelection.ids);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialSelection.error);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!ids.length) { setVendors([]); return undefined; }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all(ids.map((id) => api(`/platform/vendors/${id}`, { signal: controller.signal })))
      .then((results) => {
        const values = results.map((result) => result?.data);
        if (values.some((vendor) => !vendor || typeof vendor !== 'object' || Array.isArray(vendor))) throw new Error(t('navigationFeatureInvalidResponse'));
        setVendors(values);
      })
      .catch((issue) => { if (issue.name !== 'AbortError') setError(issue.message || t('navigationCompareLoadFailed')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, ids, reload]);

  function removeVendor(id) {
    try {
      const result = toggleComparedVendor(id);
      setIds(result.ids);
    } catch (issue) {
      setError(issue.message || t('navigationCompareLoadFailed'));
    }
  }
  function clear() {
    try {
      clearComparedVendors();
      setIds([]);
      setError('');
    } catch (issue) {
      setError(issue.message || t('navigationCompareLoadFailed'));
    }
  }

  return <main className="page-shell navigation-feature-page"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">{t('navigationDiscover')}</p><h1>{t('navigationCompareVendors')}</h1></div>
      {(ids.length > 0 || error) && <button className="button secondary small" type="button" onClick={clear}><Trash2 size={16}/>{t('navigationClearCompare')}</button>}
    </div>
    <PageStatus loading={loading} error={error} onRetry={() => setReload((value) => value + 1)} />
    {!ids.length && !error && <div className="info-card wide"><p>{t('navigationCompareEmpty')}</p><button className="button" type="button" onClick={() => onNavigate('/vendors')}>{t('findVendorsNav')}</button></div>}
    {!loading && !error && vendors.length > 0 && <div className="vendor-comparison-grid" style={{ '--comparison-columns': vendors.length }}>
      {vendors.map((vendor) => <article className="info-card vendor-comparison-card" key={vendor.id}>
        <button className="icon-button comparison-remove" type="button" onClick={() => removeVendor(vendor.id)} aria-label={`${t('navigationRemove')} ${vendor.business_name || vendor.name}`}><Trash2 size={16}/></button>
        {(vendor.coverImageUrl || vendor.logoUrl) && <img src={vendor.coverImageUrl || vendor.logoUrl} alt="" loading="lazy" />}
        <h2>{vendor.business_name || vendor.name}</h2>
        <dl><dt>{t('navigationCompareCategory')}</dt><dd>{vendor.category || t('navigationNotAvailable')}</dd>
          <dt>{t('navigationCompareLocation')}</dt><dd>{vendor.city || t('navigationNotAvailable')}</dd>
          <dt>{t('navigationCompareRating')}</dt><dd>{vendor.rating ? `${Number(vendor.rating).toFixed(1)} / 5` : t('navigationNotAvailable')}</dd>
          <dt>{t('navigationCompareServices')}</dt><dd>{Array.isArray(vendor.services) ? vendor.services.length : 0}</dd></dl>
        <button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${vendor.id}`)}>{t('viewProfile')}</button>
      </article>)}
    </div>}
  </div></main>;
}

export function MyFavoritesPage({ api, onNavigate }) {
  const t = usePageText();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api('/customer/favorites', { signal: controller.signal })
      .then((response) => {
        if (!Array.isArray(response?.data)) throw new Error(t('navigationFeatureInvalidResponse'));
        setVendors(response.data);
      })
      .catch((issue) => { if (issue.name !== 'AbortError') setError(issue.message || t('navigationFavoritesLoadFailed')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, reload]);

  async function removeFavorite(id) {
    try {
      await api(`/customer/favorites/${id}`, { method: 'DELETE' });
      setVendors((items) => items.filter((vendor) => vendor.id !== id));
    } catch (issue) {
      setError(issue.message || t('navigationFavoriteRemoveFailed'));
    }
  }
  return <main className="page-shell navigation-feature-page"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">{t('myEventHub')}</p><h1>{t('navigationMyFavorites')}</h1></div></div>
    <PageStatus loading={loading} error={error} onRetry={() => setReload((value) => value + 1)} />
    {!loading && !error && (vendors.length ? <div className="card-grid">
      {vendors.map((vendor) => <article className="info-card" key={vendor.id}><p className="eyebrow">{vendor.category}</p><h2>{vendor.business_name || vendor.name}</h2><p>{vendor.city}</p><p>{vendor.description}</p>
        <div className="card-actions"><button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${vendor.id}`)}>{t('viewProfile')}</button>
          <button className="button secondary small" type="button" onClick={() => removeFavorite(vendor.id)}><Heart size={16} fill="currentColor"/>{t('navigationRemoveFavorite')}</button></div>
      </article>)}
    </div> : <div className="info-card wide" role="status"><p>{t('navigationFavoritesEmpty')}</p><button className="button" type="button" onClick={() => onNavigate('/vendors')}>{t('findVendorsNav')}</button></div>)}
  </div></main>;
}

export function RecentlyViewedPage({ api, onNavigate }) {
  const t = usePageText();
  const [initialHistory] = useState(() => {
    try { return { records: getRecentlyViewed(), error: '' }; }
    catch (issue) { return { records: [], error: issue.message || t('navigationRecentlyViewedLoadFailed') }; }
  });
  const [records, setRecords] = useState(initialHistory.records);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialHistory.error);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!records.length) { setItems([]); return undefined; }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.allSettled(records.map((record) => api(`/platform/${record.type === 'event' ? 'events' : 'vendors'}/${record.id}`, { signal: controller.signal })
      .then((response) => {
        const item = response?.data;
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(t('navigationFeatureInvalidResponse'));
        return { ...item, type: record.type };
      })))
      .then((results) => {
        const loaded = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
        setItems(loaded);
        if (results.some((result) => result.status === 'rejected')) setError(t('navigationRecentlyViewedLoadFailed'));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, records, reload]);

  function clearHistory() {
    try {
      localStorage.removeItem('eventhub:recently-viewed:v1');
      setRecords([]);
      setError('');
    } catch (issue) {
      setError(issue.message || t('navigationRecentlyViewedLoadFailed'));
    }
  }
  return <main className="page-shell navigation-feature-page"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">{t('navigationDiscover')}</p><h1>{t('navigationRecentlyViewed')}</h1></div>
      {(records.length > 0 || error) && <button className="button secondary small" type="button" onClick={clearHistory}><Trash2 size={16}/>{t('navigationClearHistory')}</button>}
    </div>
    <PageStatus loading={loading} error={error} onRetry={() => setReload((value) => value + 1)} />
    {!loading && !error && (items.length ? <div className="card-grid">
      {items.map((item) => {
        const isEvent = item.type === 'event';
        const title = isEvent ? item.title : item.business_name || item.name;
        const path = isEvent ? `/events/${item.id}` : `/vendors/${item.id}`;
        return <article className="info-card" key={`${item.type}-${item.id}`}><p className="eyebrow">{t(isEvent ? 'eventsNav' : 'findVendorsNav')}</p><h2>{title}</h2><p>{item.city || item.venue || item.category || ''}</p>
          <button className="button secondary small" type="button" onClick={() => onNavigate(path)}>{t(isEvent ? 'navigationViewEvent' : 'viewProfile')}</button>
        </article>;
      })}
    </div> : <div className="info-card wide" role="status"><p>{t('navigationRecentlyViewedEmpty')}</p><button className="button" type="button" onClick={() => onNavigate('/events')}>{t('browseEvents')}</button></div>)}
  </div></main>;
}

export function RecommendationsPage({ api, onNavigate, user }) {
  const t = usePageText();
  const [events, setEvents] = useState([]);
  const [personalized, setPersonalized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        if (user?.role === 'customer') {
          const bookings = await api('/platform/ticket-bookings/mine', { signal: controller.signal });
          if (!Array.isArray(bookings?.data)) throw new Error(t('navigationFeatureInvalidResponse'));
          const eventIds = [...new Set((bookings.data || []).map((booking) => Number(booking.eventId)).filter(Number.isSafeInteger))].slice(0, 3);
          const related = eventIds.length
            ? await Promise.allSettled(eventIds.map((id) => api(`/platform/events/${id}/related`, { signal: controller.signal })))
            : [];
          if (related.some((result) => result.status === 'fulfilled' && !Array.isArray(result.value?.data))) {
            throw new Error(t('navigationFeatureInvalidResponse'));
          }
          const personalizedEvents = [...new Map(related
            .filter((result) => result.status === 'fulfilled')
            .flatMap((result) => result.value.data || [])
            .map((event) => [event.id, event])).values()];
          if (personalizedEvents.length) {
            setEvents(personalizedEvents);
            setPersonalized(true);
            return;
          }
        }
        const discovery = await api('/platform/events?limit=6&sort=upcoming', { signal: controller.signal });
        if (!Array.isArray(discovery?.data)) throw new Error(t('navigationFeatureInvalidResponse'));
        setEvents(discovery.data);
        setPersonalized(false);
      } catch (issue) {
        if (issue.name !== 'AbortError') setError(issue.message || t('navigationRecommendationsLoadFailed'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [api, reload, user?.role]);
  return <main className="page-shell navigation-feature-page"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">{t('myEventHub')}</p><h1>{t('navigationRecommendations')}</h1></div></div>
    <PageStatus loading={loading} error={error} onRetry={() => setReload((value) => value + 1)} />
    {!loading && !error && <><p className="muted">{t(personalized ? 'navigationRecommendationsPersonalized' : 'navigationRecommendationsDiscover')}</p>
      {events.length ? <section className="card-grid">{events.map((event) => eventCard(event, onNavigate))}</section>
        : <div className="info-card wide" role="status"><p>{t('navigationRecommendationsEmpty')}</p><button className="button" type="button" onClick={() => onNavigate('/events')}>{t('browseEvents')}</button></div>}
    </>}
  </div></main>;
}
