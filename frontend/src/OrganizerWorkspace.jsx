import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, CalendarDays, Check, ExternalLink, Search, Trash2 } from 'lucide-react';
import './organizerWorkspace.css';

const messageFor = (error, fallback) => error?.message || fallback;
const rowsFrom = (response) => Array.isArray(response?.data) ? response.data : [];
const money = (value, currency = 'ETB') => new Intl.NumberFormat('en-ET', {
  style: 'currency', currency, maximumFractionDigits: 0,
}).format(Number(value || 0));
const displayDate = (value) => {
  if (!value) return 'Date not set';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
};
const eventStart = (event) => event.startDate || event.date;

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading organizer-workspace-heading">
    <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="muted">{description}</p></div>
    {action}
  </div>;
}

function EmptyState({ children }) {
  return <div className="empty panel"><strong>{children}</strong></div>;
}

function CalendarWorkspace({ events, onNavigate }) {
  const [mode, setMode] = useState('month');
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const firstDay = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() - offset);
  const start = mode === 'month' ? gridStart : mode === 'week'
    ? new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() - ((anchorDate.getDay() + 6) % 7))
    : new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  const dayCount = mode === 'month' ? 42 : mode === 'week' ? 7 : 1;
  const days = Array.from({ length: dayCount }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  const eventsByDay = new Map();
  for (const event of events) {
    const date = new Date(String(eventStart(event) || '').replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    eventsByDay.set(key, [...(eventsByDay.get(key) || []), event]);
  }
  function move(direction) {
    const unit = mode === 'month' ? 'month' : mode === 'week' ? 'date' : 'date';
    const amount = mode === 'week' ? direction * 7 : direction;
    setAnchorDate((current) => new Date(
      current.getFullYear(),
      current.getMonth() + (unit === 'month' ? amount : 0),
      current.getDate() + (unit === 'date' ? amount : 0),
    ));
  }
  const heading = mode === 'day'
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(anchorDate)
    : new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(anchorDate);

  return <section className="organizer-workspace">
    <PageHeading eyebrow="SCHEDULE" title="Event calendar" description="Review event dates and jump to event management." action={<button className="button" type="button" onClick={() => onNavigate('events')}>Schedule an event</button>} />
    <div className="organizer-calendar-toolbar">
      <div className="organizer-calendar-nav"><button className="icon-button" type="button" aria-label="Previous period" onClick={() => move(-1)}><ArrowLeft size={17}/></button><strong>{heading}</strong><button className="icon-button" type="button" aria-label="Next period" onClick={() => move(1)}><ArrowRight size={17}/></button></div>
      <label className="organizer-compact-field"><span>View</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
      <button className="button secondary small" type="button" onClick={() => setAnchorDate(new Date())}>Today</button>
    </div>
    <div className={`organizer-calendar-grid ${mode}`}>
      {days.map((day) => {
        const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
        const dayEvents = eventsByDay.get(key) || [];
        return <article className={`organizer-calendar-day ${day.getMonth() !== anchorDate.getMonth() && mode === 'month' ? 'outside-month' : ''}`} key={key}>
          <strong>{mode === 'month' ? day.getDate() : new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' }).format(day)}</strong>
          {dayEvents.map((event) => <button className="organizer-calendar-event" type="button" key={event.id} onClick={() => onNavigate('events')}>
            <span>{event.title}</span><small>{event.status}</small>
          </button>)}
        </article>;
      })}
    </div>
    {!events.length && <EmptyState>No events scheduled yet.</EmptyState>}
  </section>;
}

export default function OrganizerWorkspace({ view, api, user, onNavigate }) {
  const [resource, setResource] = useState(null);
  const [events, setEvents] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [request, setRequest] = useState(null);
  const [requestForm, setRequestForm] = useState({ eventId: '', guestCount: '', budget: '', notes: '' });
  const [categoryForm, setCategoryForm] = useState({ name: '', budgetLimit: '' });
  const [expenseForm, setExpenseForm] = useState({ categoryId: '', bookingId: '', vendorId: '', description: '', plannedAmount: '', actualAmount: '', expenseDate: '' });
  const [taskForm, setTaskForm] = useState({ bookingId: '', title: '', details: '', dueAt: '' });
  const [messageForm, setMessageForm] = useState({ bookingId: '', body: '' });
  const [revisionReasons, setRevisionReasons] = useState({});
  const [profileForm, setProfileForm] = useState({ fullName: user.full_name || user.name || '', phone: user.phone || '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      setNotice('');
      try {
        let nextResource = null;
        if (view === 'overview') {
          const [overviewResponse, eventsResponse, bookingsResponse] = await Promise.all([
            api('/platform/organizer/overview'), api('/platform/events/mine'), api('/platform/bookings'),
          ]);
          if (!active) return;
          setEvents(rowsFrom(eventsResponse));
          setBookings(rowsFrom(bookingsResponse));
          nextResource = overviewResponse.data || {};
        } else if (view === 'calendar') {
          const [eventsResponse, bookingsResponse] = await Promise.all([api('/platform/events/mine'), api('/platform/bookings')]);
          if (!active) return;
          setEvents(rowsFrom(eventsResponse));
          setBookings(rowsFrom(bookingsResponse));
          nextResource = {};
        } else if (view === 'vendors' || view === 'services') {
          const response = await api(`/platform/${view}?page=1&limit=100&sort=recommended`);
          if (!active) return;
          nextResource = rowsFrom(response);
          if (view === 'services') {
            const [eventsResponse] = await Promise.all([api('/platform/events/mine')]);
            if (!active) return;
            setEvents(rowsFrom(eventsResponse));
          }
        } else if (view === 'favorites') {
          nextResource = rowsFrom(await api('/platform/organizer/favorites'));
        } else if (view === 'bookings') {
          nextResource = rowsFrom(await api('/platform/bookings'));
        } else if (view === 'quotations') {
          nextResource = rowsFrom(await api('/platform/organizer/quotations'));
        } else if (view === 'budget' || view === 'coordination') {
          const [eventsResponse, bookingsResponse] = await Promise.all([api('/platform/events/mine'), api('/platform/bookings')]);
          if (!active) return;
          const eventRows = rowsFrom(eventsResponse);
          setEvents(eventRows);
          setBookings(rowsFrom(bookingsResponse));
          const eventId = selectedEventId || eventRows[0]?.id;
          if (!selectedEventId && eventId) setSelectedEventId(String(eventId));
          nextResource = eventId
            ? view === 'budget'
              ? (await api(`/platform/organizer/events/${eventId}/budget`)).data
              : rowsFrom(await api(`/platform/organizer/events/${eventId}/tasks`))
            : view === 'budget' ? { event: null, categories: [], expenses: [], summary: {} } : [];
        } else if (view === 'messages') {
          const [messagesResponse, bookingsResponse] = await Promise.all([api('/platform/organizer/messages'), api('/platform/bookings')]);
          if (!active) return;
          setBookings(rowsFrom(bookingsResponse));
          nextResource = rowsFrom(messagesResponse);
        } else if (view === 'notifications') {
          nextResource = rowsFrom(await api('/platform/organizer/notifications'));
        } else if (view === 'reports') {
          nextResource = rowsFrom(await api('/platform/organizer/reports'));
        } else if (view === 'profile') {
          const response = await api('/platform/organizer/profile');
          if (!active) return;
          nextResource = response.data || {};
          setProfileForm({ fullName: nextResource.full_name || '', phone: nextResource.phone || '' });
        }
        if (active) setResource(nextResource);
      } catch (issue) {
        if (active) setError(messageFor(issue, 'Unable to load this Organizer workspace.'));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [api, refreshKey, selectedEventId, view]);

  async function mutate(action, success) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      setRefreshKey((current) => current + 1);
    } catch (issue) {
      setError(messageFor(issue, 'The request could not be completed.'));
    } finally {
      setBusy(false);
    }
  }

  const eventId = selectedEventId || events[0]?.id || '';
  const categories = resource?.categories || [];
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (Array.isArray(resource) ? resource : []).filter((row) => {
      const searchable = `${row.name || ''} ${row.business_name || ''} ${row.title || ''} ${row.category || ''} ${row.city || ''} ${row.description || ''}`.toLowerCase();
      return (!normalizedQuery || searchable.includes(normalizedQuery))
        && (!categoryFilter || row.category === categoryFilter)
        && (!locationFilter || String(row.city || '').toLowerCase().includes(locationFilter.toLowerCase()))
        && (!maxPrice || Number(row.price ?? row.priceFrom ?? 0) <= Number(maxPrice));
    });
  }, [categoryFilter, locationFilter, maxPrice, query, resource]);

  if (loading) return <div className="loading"><span className="spinner"/>Loading Organizer workspace...</div>;
  if (view === 'calendar') return <CalendarWorkspace events={events} onNavigate={onNavigate}/>;

  const feedback = <>{error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}</>;
  const eventSelect = (value, onChange, label = 'Event') => <label className="field"><span>{label}</span><select value={value} onChange={onChange} required><option value="">Choose an event</option>{events.map((event) => <option value={event.id} key={event.id}>{event.title}</option>)}</select></label>;

  if (view === 'overview') return <section className="organizer-shell organizer-workspace">
    {feedback}
    <PageHeading eyebrow="WORKSPACE" title="Organizer overview" description={`Welcome, ${user.full_name || user.name || 'Organizer'}. Your numbers include only your own records.`} action={<button className="button" type="button" onClick={() => onNavigate('events')}>Create event</button>} />
    <div className="metric-grid">
      <article className="metric-card"><p>Total events</p><strong>{resource?.totalEvents || 0}</strong><span>{resource?.upcomingEvents || 0} upcoming, {resource?.ongoingEvents || 0} ongoing</span></article>
      <article className="metric-card"><p>Bookings</p><strong>{resource?.totalBookings || 0}</strong><span>{resource?.pendingBookings || 0} pending, {resource?.confirmedBookings || 0} confirmed</span></article>
      <article className="metric-card"><p>Completed bookings</p><strong>{resource?.completedBookings || 0}</strong><span>From your events</span></article>
      <article className="metric-card"><p>Budget remaining</p><strong>{money(resource?.budget?.remaining)}</strong><span>{money(resource?.budget?.actualExpenses)} actual expenses</span></article>
    </div>
    <div className="two-column-layout">
      <section className="panel"><div className="panel-header"><h3>Upcoming events</h3><button className="button secondary small" type="button" onClick={() => onNavigate('calendar')}>Open calendar</button></div>
        {events.filter((event) => new Date(String(eventStart(event) || '').replace(' ', 'T')) >= new Date()).slice(0, 5).map((event) => <article className="list-card" key={event.id}><div><strong>{event.title}</strong><small>{displayDate(eventStart(event))} · {event.location || event.city || 'Location to be set'}</small></div><span className={`pill ${event.status}`}>{event.status}</span></article>)}
        {!events.some((event) => new Date(String(eventStart(event) || '').replace(' ', 'T')) >= new Date()) && <EmptyState>No upcoming events.</EmptyState>}
      </section>
      <section className="panel"><div className="panel-header"><h3>Recent bookings</h3><button className="button secondary small" type="button" onClick={() => onNavigate('bookings')}>View bookings</button></div>
        {bookings.slice(0, 5).map((booking) => <article className="list-card" key={booking.id}><div><strong>{booking.serviceTitle || booking.service_description}</strong><small>{booking.eventTitle || booking.event_title} · {displayDate(booking.eventDate || booking.scheduledDate)}</small></div><span className={`pill ${booking.status}`}>{booking.status}</span></article>)}
        {!bookings.length && <EmptyState>No bookings yet.</EmptyState>}
      </section>
    </div>
    {feedback}
  </section>;

  if (view === 'vendors' || view === 'services') {
    const isVendor = view === 'vendors';
    const categoriesList = [...new Set((Array.isArray(resource) ? resource : []).map((row) => row.category).filter(Boolean))].sort();
    return <section className="organizer-shell organizer-workspace">
      {feedback}
      <PageHeading eyebrow="MARKETPLACE" title={isVendor ? 'Find vendors' : 'Browse services'} description={isVendor ? 'Compare verified vendors by name, service category, location, and rating.' : 'Search packages and compare service descriptions, locations, and prices.'} />
      <div className="panel organizer-workspace-filters">
        <label className="organizer-search"><span>Search</span><div><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isVendor ? 'Vendor name or description' : 'Service or vendor name'} /></div></label>
        <label className="field"><span>Category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{categoriesList.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="field"><span>Location</span><input value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} placeholder="Any city" /></label>
        {!isVendor && <label className="field"><span>Maximum price</span><input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="No limit" /></label>}
      </div>
      {isVendor ? <div className="organizer-market-list">{filteredRows.map((vendor) => <article className="panel organizer-market-item" key={vendor.id}>
        <div><span className={`pill ${vendor.verified ? 'verified' : 'pending'}`}>{vendor.verified ? 'Verified' : 'Unverified'}</span><h3>{vendor.name || vendor.business_name}</h3><p>{vendor.category || 'General'} · {vendor.city || 'Location not listed'}</p><p>{vendor.description}</p><small>{vendor.reviewCount || 0} reviews · {vendor.rating ? `${Number(vendor.rating).toFixed(1)} / 5` : 'No rating'} · From {money(vendor.priceFrom)}</small></div>
        <div className="organizer-market-actions"><a className="button secondary small" href={`/vendors/${vendor.id}`}>Profile <ExternalLink size={14}/></a><button className="button small" type="button" disabled={busy} onClick={() => mutate(() => api('/platform/organizer/favorites', { method: 'POST', body: JSON.stringify({ vendorId: Number(vendor.id) }) }), 'Vendor saved.')}>Save vendor</button></div>
      </article>)}{!filteredRows.length && <EmptyState>No vendors match those filters.</EmptyState>}</div>
        : <div className="organizer-market-list">{filteredRows.map((service) => <article className="panel organizer-market-item" key={service.id}>
          <div><span className="pill active">{service.category || 'Service'}</span><h3>{service.title}</h3><p>{service.vendorName || service.vendor_name} · {service.city || 'Location not listed'}</p><p>{service.description}</p><strong>{money(service.price, service.currency)}</strong><small>{service.reviewCount || 0} reviews · {service.rating ? `${Number(service.rating).toFixed(1)} / 5` : 'No rating'}</small></div>
          <div className="organizer-market-actions"><button className="button secondary small" type="button" onClick={() => { setRequest({ kind: 'quote', service }); setRequestForm({ eventId: '', guestCount: '', budget: '', notes: '' }); }}>Request quote</button><button className="button small" type="button" onClick={() => { setRequest({ kind: 'booking', service }); setRequestForm({ eventId: '', guestCount: '', budget: '', notes: '' }); }}>Request booking</button></div>
        </article>)}{!filteredRows.length && <EmptyState>No services match those filters.</EmptyState>}</div>}
      {request && <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && setRequest(null)}><form className="modal" onSubmit={(event) => {
        event.preventDefault();
        const body = request.kind === 'booking'
          ? { eventId: Number(requestForm.eventId), serviceId: Number(request.service.id), notes: requestForm.notes }
          : { eventId: Number(requestForm.eventId), serviceId: Number(request.service.id), guestCount: requestForm.guestCount ? Number(requestForm.guestCount) : undefined, budget: requestForm.budget ? Number(requestForm.budget) : undefined, notes: requestForm.notes };
        mutate(async () => {
          await api(request.kind === 'booking' ? '/platform/bookings' : '/platform/service-quote-requests', { method: 'POST', body: JSON.stringify(body) });
          setRequest(null);
        }, request.kind === 'booking' ? 'Booking request sent.' : 'Quotation request sent.');
      }}>
        <div className="modal-head"><h2>{request.kind === 'booking' ? 'Request a booking' : 'Request a quotation'}</h2><button className="icon-button" type="button" aria-label="Close" onClick={() => setRequest(null)}>×</button></div>
        <div className="modal-body"><p>{request.service.title} · {request.service.vendorName || request.service.vendor_name}</p>{eventSelect(requestForm.eventId, (event) => setRequestForm((current) => ({ ...current, eventId: event.target.value })))}
          {request.kind === 'quote' && <><label className="field"><span>Expected guests</span><input type="number" min="1" max="100000" value={requestForm.guestCount} onChange={(event) => setRequestForm((current) => ({ ...current, guestCount: event.target.value }))} /></label><label className="field"><span>Budget (ETB)</span><input type="number" min="0" step="0.01" value={requestForm.budget} onChange={(event) => setRequestForm((current) => ({ ...current, budget: event.target.value }))} /></label></>}
          <label className="field"><span>Requirements</span><textarea rows="4" maxLength="2000" value={requestForm.notes} onChange={(event) => setRequestForm((current) => ({ ...current, notes: event.target.value }))} /></label></div>
        <div className="modal-foot"><button className="button secondary" type="button" onClick={() => setRequest(null)} disabled={busy}>Cancel</button><button className="button" type="submit" disabled={busy || !requestForm.eventId}>{busy ? 'Sending...' : 'Send request'}</button></div>
      </form></div>}
    </section>;
  }

  if (view === 'favorites') return <section className="organizer-shell organizer-workspace">{feedback}<PageHeading eyebrow="SHORTLIST" title="Saved vendors" description="Keep preferred providers together and open their public profiles." />
    <div className="organizer-market-list">{(Array.isArray(resource) ? resource : []).map((vendor) => <article className="panel organizer-market-item" key={vendor.id}><div><h3>{vendor.name}</h3><p>{vendor.category} · {vendor.city}</p><p>{vendor.description}</p></div><div className="organizer-market-actions"><a className="button secondary small" href={`/vendors/${vendor.id}`}>Open profile <ExternalLink size={14}/></a><button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/platform/organizer/favorites/${vendor.id}`, { method: 'DELETE' }), 'Saved vendor removed.')}>Remove</button></div></article>)}{!resource?.length && <EmptyState>No vendors saved yet.</EmptyState>}</div>
  </section>;

  if (view === 'bookings') return <section className="organizer-shell organizer-workspace">{feedback}<PageHeading eyebrow="RESERVATIONS" title="Booking management" description="Review vendor responses, event dates, quoted prices, and booking status." action={<button className="button" type="button" onClick={() => onNavigate('services')}>Browse services</button>} />
    <div className="table-wrap"><table><thead><tr><th>Event</th><th>Vendor / service</th><th>Date</th><th>Status</th><th>Amount</th><th>Action</th></tr></thead><tbody>{(Array.isArray(resource) ? resource : []).map((booking) => <tr key={booking.id}><td>{booking.eventTitle || booking.event_title || 'Event'}</td><td>{booking.vendorName || booking.vendor_name} · {booking.serviceTitle || booking.service_description}</td><td>{displayDate(booking.eventDate || booking.scheduledDate || booking.scheduled_date)}</td><td><span className={`pill ${booking.status}`}>{booking.status}</span></td><td>{money(booking.quotedAmount || booking.quoted_amount, booking.currency)}</td><td>{['requested', 'under_review', 'quoted', 'accepted'].includes(String(booking.status).toLowerCase()) && <button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/platform/bookings/${booking.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }), 'Booking cancelled.')}>Cancel</button>}</td></tr>)}</tbody></table></div>
    {!resource?.length && <EmptyState>No booking requests yet. Browse services to get started.</EmptyState>}
  </section>;

  if (view === 'quotations') return <section className="organizer-shell organizer-workspace">{feedback}<PageHeading eyebrow="VENDOR PROPOSALS" title="Request quotations" description="Compare vendor responses, accept an offer, decline it, or request a revision." action={<button className="button secondary" type="button" onClick={() => onNavigate('services')}>Browse services</button>} />
    <div className="organizer-market-list">{(Array.isArray(resource) ? resource : []).map((quote) => <article className="panel organizer-market-item" key={quote.id}>
      <div>
        <span className={`pill ${quote.status}`}>{quote.status === 'draft' ? 'pending vendor response' : quote.status.replaceAll('_', ' ')}</span>
        <h3>{quote.vendorName} · {quote.service}</h3>
        <p>{quote.eventTitle || 'No event linked'}{quote.eventType ? ` · ${quote.eventType}` : ''}{quote.eventDate ? ` · ${String(quote.eventDate).slice(0, 16)}` : ''}{quote.eventLocation ? ` · ${quote.eventLocation}` : ''}{quote.validUntil ? ` · Valid through ${quote.validUntil}` : ''}</p>
        {(quote.guestCount || quote.budget !== null) && <p>{quote.guestCount ? `${quote.guestCount} guests` : ''}{quote.budget !== null ? ` · Budget ${money(quote.budget, quote.currency)}` : ''}</p>}
        {quote.requiredServices && <p><strong>Requested scope:</strong> {quote.requiredServices}</p>}
        {quote.additionalRequirements && <p><strong>Requirements:</strong> {quote.additionalRequirements}</p>}
        {quote.requestMessage && <p><strong>Message:</strong> {quote.requestMessage}</p>}
        {quote.contactPhone && <p><strong>Contact phone:</strong> {quote.contactPhone}</p>}
        {quote.notes && <p>{quote.notes}</p>}
        <strong>{money(quote.amount, quote.currency)}</strong>
      </div>
      {quote.status === 'draft' && <button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/platform/organizer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }), 'Quotation request cancelled.')}>Cancel request</button>}
      {['sent', 'revision_requested'].includes(quote.status) && <div className="organizer-quote-actions"><button className="button small" type="button" disabled={busy} onClick={() => mutate(() => api(`/platform/organizer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) }), 'Quotation accepted.')}>Accept</button><button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/platform/organizer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'declined' }) }), 'Quotation declined.')}>Decline</button><label className="field"><span>Revision request</span><input value={revisionReasons[quote.id] || ''} onChange={(event) => setRevisionReasons((current) => ({ ...current, [quote.id]: event.target.value }))} maxLength="500" /></label><button className="button secondary small" type="button" disabled={busy || (revisionReasons[quote.id] || '').trim().length < 5} onClick={() => mutate(() => api(`/platform/organizer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'revision_requested', reason: revisionReasons[quote.id].trim() }) }), 'Revision requested.')}>Request revision</button></div>}
    </article>)}{!resource?.length && <EmptyState>No quotation requests yet. Browse services to request a price.</EmptyState>}</div>
  </section>;

  if (view === 'budget') return <section className="organizer-shell organizer-workspace">{feedback}<PageHeading eyebrow="PLANNING" title="Budget and expenses" description="Track allocated budgets separately from planned and actual expenses." />
    {events.length ? <label className="organizer-compact-field"><span>Event</span><select value={eventId} onChange={(event) => setSelectedEventId(event.target.value)}>{events.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label> : <EmptyState>Create an event before tracking expenses.</EmptyState>}
    {eventId && resource?.event && <><div className="metric-grid"><article className="metric-card"><p>Allocated</p><strong>{money(resource.event.budget)}</strong></article><article className="metric-card"><p>Planned</p><strong>{money(resource.summary?.planned)}</strong></article><article className="metric-card"><p>Actual</p><strong>{money(resource.summary?.actual)}</strong></article><article className="metric-card"><p>Remaining</p><strong className={Number(resource.summary?.remaining) < 0 ? 'organizer-over-budget' : ''}>{money(resource.summary?.remaining)}</strong></article></div>
      <div className="two-column-layout"><form className="panel organizer-form" onSubmit={(event) => { event.preventDefault(); mutate(async () => { await api(`/platform/organizer/events/${eventId}/budget/categories`, { method: 'POST', body: JSON.stringify({ name: categoryForm.name, budgetLimit: Number(categoryForm.budgetLimit) }) }); setCategoryForm({ name: '', budgetLimit: '' }); }, 'Budget category saved.'); }}><h3>Category spending limit</h3><label className="field"><span>Category</span><input required minLength="1" maxLength="100" value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="field"><span>Limit (ETB)</span><input type="number" min="0" max="100000000" step="0.01" required value={categoryForm.budgetLimit} onChange={(event) => setCategoryForm((current) => ({ ...current, budgetLimit: event.target.value }))} /></label><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Add category'}</button></form>
        <form className="panel organizer-form" onSubmit={(event) => { event.preventDefault(); const payload = { categoryId: expenseForm.categoryId ? Number(expenseForm.categoryId) : null, bookingId: expenseForm.bookingId ? Number(expenseForm.bookingId) : null, vendorId: expenseForm.vendorId ? Number(expenseForm.vendorId) : null, description: expenseForm.description, plannedAmount: expenseForm.plannedAmount === '' ? null : Number(expenseForm.plannedAmount), actualAmount: expenseForm.actualAmount === '' ? null : Number(expenseForm.actualAmount), expenseDate: expenseForm.expenseDate || null }; mutate(async () => { await api(`/platform/organizer/events/${eventId}/expenses`, { method: 'POST', body: JSON.stringify(payload) }); setExpenseForm({ categoryId: '', bookingId: '', vendorId: '', description: '', plannedAmount: '', actualAmount: '', expenseDate: '' }); }, 'Expense saved.'); }}><h3>Record expense</h3><label className="field"><span>Description</span><input required minLength="2" maxLength="255" value={expenseForm.description} onChange={(event) => setExpenseForm((current) => ({ ...current, description: event.target.value }))} /></label><label className="field"><span>Category</span><select value={expenseForm.categoryId} onChange={(event) => setExpenseForm((current) => ({ ...current, categoryId: event.target.value }))}><option value="">Uncategorized</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><div className="organizer-inline-fields"><label className="field"><span>Planned</span><input type="number" min="0" step="0.01" value={expenseForm.plannedAmount} onChange={(event) => setExpenseForm((current) => ({ ...current, plannedAmount: event.target.value }))} /></label><label className="field"><span>Actual</span><input type="number" min="0" step="0.01" value={expenseForm.actualAmount} onChange={(event) => setExpenseForm((current) => ({ ...current, actualAmount: event.target.value }))} /></label></div><label className="field"><span>Expense date</span><input type="date" value={expenseForm.expenseDate} onChange={(event) => setExpenseForm((current) => ({ ...current, expenseDate: event.target.value }))} /></label><button className="button" disabled={busy || !expenseForm.plannedAmount && !expenseForm.actualAmount}>{busy ? 'Saving...' : 'Save expense'}</button></form></div>
      <section className="panel"><h3>Category limits</h3>{categories.map((category) => <div className="report-row" key={category.id}><span>{category.name}</span><strong>{money(category.budgetLimit)}</strong><button className="icon-button" type="button" aria-label={`Delete ${category.name}`} disabled={busy} onClick={() => mutate(() => api(`/platform/organizer/events/${eventId}/budget/categories/${category.id}`, { method: 'DELETE' }), 'Category removed.') }><Trash2 size={16}/></button></div>)}{!categories.length && <p className="muted">No category limits configured.</p>}</section>
      <section className="panel"><h3>Expenses</h3><div className="table-wrap"><table><thead><tr><th>Description</th><th>Category</th><th>Vendor</th><th>Date</th><th>Planned</th><th>Actual</th><th></th></tr></thead><tbody>{(resource.expenses || []).map((expense) => <tr key={expense.id}><td>{expense.description}</td><td>{expense.category_name || 'Uncategorized'}</td><td>{expense.vendor_name || '—'}</td><td>{expense.expenseDate || '—'}</td><td>{money(expense.plannedAmount)}</td><td>{money(expense.actualAmount)}</td><td><button className="icon-button" type="button" aria-label="Delete expense" disabled={busy} onClick={() => mutate(() => api(`/platform/organizer/events/${eventId}/expenses/${expense.id}`, { method: 'DELETE' }), 'Expense removed.')}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>{!resource.expenses?.length && <p className="muted">No expenses recorded.</p>}</section>
    </>}
  </section>;

  if (view === 'coordination') return <section className="organizer-shell organizer-workspace">{feedback}<PageHeading eyebrow="VENDOR FOLLOW-UP" title="Vendor coordination" description="Assign preparation tasks to vendors linked to your event bookings." />
    {events.length ? <label className="organizer-compact-field"><span>Event</span><select value={eventId} onChange={(event) => setSelectedEventId(event.target.value)}>{events.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label> : <EmptyState>Create an event and booking before assigning tasks.</EmptyState>}
    {eventId && <form className="panel organizer-form" onSubmit={(event) => { event.preventDefault(); mutate(async () => { await api(`/platform/organizer/events/${eventId}/tasks`, { method: 'POST', body: JSON.stringify({ ...taskForm, bookingId: Number(taskForm.bookingId), dueAt: taskForm.dueAt || null }) }); setTaskForm({ bookingId: '', title: '', details: '', dueAt: '' }); }, 'Vendor task assigned.'); }}><h3>New vendor task</h3><label className="field"><span>Booking and vendor</span><select required value={taskForm.bookingId} onChange={(event) => setTaskForm((current) => ({ ...current, bookingId: event.target.value }))}><option value="">Choose booking</option>{bookings.filter((booking) => String(booking.eventId || booking.event_id) === String(eventId) && !['cancelled', 'rejected'].includes(booking.status)).map((booking) => <option value={booking.id} key={booking.id}>{booking.vendorName || booking.vendor_name} · {booking.serviceTitle || booking.service_description}</option>)}</select></label><label className="field"><span>Task</span><input required minLength="2" maxLength="160" value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} /></label><label className="field"><span>Details</span><textarea maxLength="2000" value={taskForm.details} onChange={(event) => setTaskForm((current) => ({ ...current, details: event.target.value }))} /></label><label className="field"><span>Deadline</span><input type="datetime-local" value={taskForm.dueAt} onChange={(event) => setTaskForm((current) => ({ ...current, dueAt: event.target.value }))} /></label><button className="button" disabled={busy || !taskForm.bookingId}>{busy ? 'Saving...' : 'Assign task'}</button></form>}
    {(Array.isArray(resource) ? resource : []).map((task) => <article className="panel organizer-task" key={task.id}><div><strong>{task.title}</strong><p>{task.vendor_name} · {task.service_description}</p><small>{task.details}</small><small>Due {displayDate(task.due_at)}</small></div><label className="organizer-compact-field"><span>Status</span><select value={task.status} onChange={(event) => mutate(() => api(`/platform/organizer/events/${eventId}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ title: task.title, details: task.details || '', dueAt: task.due_at, status: event.target.value }) }), 'Task status updated.')}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="blocked">Blocked</option></select></label><button className="icon-button" type="button" aria-label="Delete task" disabled={busy} onClick={() => mutate(() => api(`/platform/organizer/events/${eventId}/tasks/${task.id}`, { method: 'DELETE' }), 'Task removed.')}><Trash2 size={16}/></button></article>)}
    {eventId && !resource?.length && <EmptyState>No vendor tasks for this event.</EmptyState>}
  </section>;

  if (view === 'messages') return <section className="organizer-shell organizer-workspace">{feedback}<PageHeading eyebrow="CONVERSATIONS" title="Messages" description="Send and receive messages in the context of your vendor bookings." />
    <form className="panel organizer-form" onSubmit={(event) => { event.preventDefault(); mutate(async () => { await api('/platform/organizer/messages', { method: 'POST', body: JSON.stringify({ bookingId: Number(messageForm.bookingId), body: messageForm.body }) }); setMessageForm({ bookingId: '', body: '' }); }, 'Message sent.'); }}><label className="field"><span>Booking</span><select required value={messageForm.bookingId} onChange={(event) => setMessageForm((current) => ({ ...current, bookingId: event.target.value }))}><option value="">Choose booking</option>{bookings.map((booking) => <option value={booking.id} key={booking.id}>{booking.eventTitle || booking.event_title} · {booking.vendorName || booking.vendor_name}</option>)}</select></label><label className="field"><span>Message</span><textarea required minLength="1" maxLength="4000" value={messageForm.body} onChange={(event) => setMessageForm((current) => ({ ...current, body: event.target.value }))} /></label><button className="button" disabled={busy || !messageForm.bookingId}>{busy ? 'Sending...' : 'Send message'}</button></form>
    {(Array.isArray(resource) ? resource : []).map((message) => <article className={`panel organizer-message ${message.read ? '' : 'unread'}`} key={message.id}><div><strong>{message.sender}</strong><small>{message.eventTitle} · {message.vendorName} · {displayDate(message.createdAt)}</small><p>{message.body}</p></div>{!message.read && Number(message.recipientId) === Number(user.id) && <button className="button secondary small" type="button" disabled={busy} onClick={() => mutate(() => api(`/platform/organizer/messages/${message.id}/read`, { method: 'POST' }), 'Message marked as read.')}>Mark read</button>}</article>)}
    {!resource?.length && <EmptyState>No booking conversations yet.</EmptyState>}
  </section>;

  if (view === 'notifications') return <section className="organizer-shell organizer-workspace">{feedback}<PageHeading eyebrow="UPDATES" title="Notifications" description="Booking, quotation, message, and event updates sent to your account." action={<button className="button secondary" type="button" disabled={busy || !resource?.some((item) => !item.read)} onClick={() => mutate(() => api('/platform/organizer/notifications/read-all', { method: 'POST' }), 'All notifications marked as read.')}><Check size={16}/> Mark all read</button>} />
    {(Array.isArray(resource) ? resource : []).map((item) => <article className={`panel organizer-message ${item.read ? '' : 'unread'}`} key={item.id}><div><strong>{item.title}</strong><small>{item.type} · {displayDate(item.createdAt)}</small><p>{item.message}</p></div>{!item.read && <button className="button secondary small" type="button" disabled={busy} onClick={() => mutate(() => api(`/platform/organizer/notifications/${item.id}/read`, { method: 'POST' }), 'Notification marked as read.')}><Bell size={14}/> Mark read</button>}</article>)}
    {!resource?.length && <EmptyState>No notifications yet.</EmptyState>}
  </section>;

  if (view === 'reports') return <section className="organizer-shell organizer-workspace">{feedback}<PageHeading eyebrow="ANALYTICS" title="Event reports" description="Compare event budgets, actual expenses, booking commitments, and status." />
    <div className="table-wrap"><table><thead><tr><th>Event</th><th>Date</th><th>Status</th><th>Budget</th><th>Bookings</th><th>Committed</th><th>Planned</th><th>Actual</th><th>Variance</th></tr></thead><tbody>{(Array.isArray(resource) ? resource : []).map((row) => <tr key={row.id}><td>{row.title}</td><td>{displayDate(row.startDate)}</td><td>{row.status}</td><td>{money(row.budget)}</td><td>{row.bookingCount}</td><td>{money(row.committedAmount)}</td><td>{money(row.plannedExpenses)}</td><td>{money(row.actualExpenses)}</td><td className={Number(row.budget) - Number(row.actualExpenses) < 0 ? 'organizer-over-budget' : ''}>{money(Number(row.budget) - Number(row.actualExpenses))}</td></tr>)}</tbody></table></div>
    {!resource?.length && <EmptyState>No report data for your events yet.</EmptyState>}
  </section>;

  if (view === 'profile') return <section className="organizer-shell organizer-workspace">{feedback}<PageHeading eyebrow="ACCOUNT" title="Profile management" description="Update your contact details and securely change your password." />
    <div className="two-column-layout"><form className="panel organizer-form" onSubmit={(event) => { event.preventDefault(); mutate(async () => { await api('/platform/organizer/profile', { method: 'PATCH', body: JSON.stringify(profileForm) }); }, 'Profile updated.'); }}><h3>Personal information</h3><label className="field"><span>Full name</span><input required minLength="2" maxLength="160" value={profileForm.fullName} onChange={(event) => setProfileForm((current) => ({ ...current, fullName: event.target.value }))} /></label><label className="field"><span>Email</span><input value={resource?.email || user.email || ''} disabled /></label><label className="field"><span>Phone</span><input maxLength="40" value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} /></label><p className="muted">Profile photo is managed from the account control in the dashboard header.</p><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Save profile'}</button></form>
      <form className="panel organizer-form" onSubmit={(event) => { event.preventDefault(); mutate(async () => { await api('/platform/organizer/profile/password', { method: 'POST', body: JSON.stringify(passwordForm) }); setPasswordForm({ currentPassword: '', newPassword: '' }); }, 'Password updated.'); }}><h3>Change password</h3><label className="field"><span>Current password</span><input type="password" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} /></label><label className="field"><span>New password</span><input type="password" autoComplete="new-password" minLength="12" maxLength="16" required value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} /></label><small>Use 12-16 characters with uppercase, lowercase, and a number.</small><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button></form></div>
  </section>;

  return <section className="organizer-shell organizer-workspace">{feedback}<EmptyState>This Organizer section is unavailable.</EmptyState></section>;
}