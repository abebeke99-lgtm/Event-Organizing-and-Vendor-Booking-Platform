import { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, ExternalLink, Search, Trash2 } from 'lucide-react';
import { translateText } from './language.js';
import { formatCustomerMoney as money } from './customerMoney.js';
import './customerWorkspace.css';

const formatDate = (value) => {
  if (!value) return 'Date not set';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};
const statusClass = (value) => String(value || '').toLowerCase().replaceAll('_', '-');
const EMPTY_OBJECT = Object.freeze({});

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading customer-workspace-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="muted">{description}</p></div>{action}</div>;
}

function EmptyState({ children }) {
  return <div className="empty panel"><strong>{children}</strong></div>;
}

function CustomerRequestModal({ item, events, api, mutate, onClose }) {
  const [form, setForm] = useState({ eventId: '', guestCount: '', budget: '', notes: '' });
  if (item.kind === 'save-service') return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-label="Save service"><div className="modal-head"><h2>Save service</h2><button className="icon-button" type="button" aria-label="Close" onClick={onClose}>×</button></div><div className="modal-body"><p>Save {item.service.title} by {item.service.vendorName} to your wishlist?</p></div><div className="modal-foot"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button" type="button" onClick={() => mutate(async () => { await api('/customer/saved-services', { method: 'POST', body: JSON.stringify({ serviceId: Number(item.service.id) }) }); onClose(); }, 'Service saved to wishlist.')}>Save service</button></div></section></div>;

  const isBooking = item.kind === 'booking';
  const availableEvents = isBooking ? events.filter((event) => ['active', 'published', 'upcoming', 'open'].includes(String(event.status).toLowerCase())) : events;
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={(event) => {
    event.preventDefault();
    const body = isBooking
      ? { eventId: Number(form.eventId), serviceId: Number(item.service.id), notes: form.notes }
      : { eventId: Number(form.eventId), serviceId: Number(item.service.id), guestCount: form.guestCount ? Number(form.guestCount) : undefined, budget: form.budget ? Number(form.budget) : undefined, notes: form.notes };
    mutate(async () => {
      await api(isBooking ? '/platform/bookings' : '/platform/service-quote-requests', { method: 'POST', body: JSON.stringify(body) });
      onClose();
    }, isBooking ? 'Booking request sent.' : 'Quotation request sent.');
  }}>
    <div className="modal-head"><h2>{isBooking ? 'Request a booking' : 'Request a quotation'}</h2><button className="icon-button" type="button" aria-label="Close" onClick={onClose}>×</button></div>
    <div className="modal-body"><p>{item.service.title} · {item.service.vendorName}</p>
      <label className="field"><span>Event</span><select required value={form.eventId} onChange={(event) => setForm((current) => ({ ...current, eventId: event.target.value }))}><option value="">Choose an event</option>{availableEvents.map((event) => <option value={event.id} key={event.id}>{event.title} · {new Date(String(event.startDate || event.date).replace(' ', 'T')).toLocaleDateString()}</option>)}</select></label>
      {!isBooking && <><label className="field"><span>Expected guests</span><input type="number" min="1" max="100000" value={form.guestCount} onChange={(event) => setForm((current) => ({ ...current, guestCount: event.target.value }))} /></label><label className="field"><span>Budget</span><input type="number" min="0" max="100000000" step="0.01" value={form.budget} onChange={(event) => setForm((current) => ({ ...current, budget: event.target.value }))} /></label></>}
      <label className="field"><span>Requirements</span><textarea maxLength={isBooking ? 500 : 2000} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
    </div>
    <div className="modal-foot"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button" type="submit" disabled={!form.eventId}>{isBooking ? 'Send booking request' : 'Send quotation request'}</button></div>
  </form></div>;
}

export default function CustomerWorkspace({ view, data = {}, api, user = {}, onNavigate, onRefresh, onUserChange }) {
  const categories = Array.isArray(data?.categories) ? data.categories.filter(Boolean) : [];
  const services = Array.isArray(data?.services) ? data.services.filter(Boolean) : [];
  const bookings = Array.isArray(data?.bookings) ? data.bookings.filter(Boolean) : [];
  const history = Array.isArray(data?.history) ? data.history.filter(Boolean) : [];
  const events = Array.isArray(data?.events) ? data.events.filter(Boolean) : [];
  const favorites = Array.isArray(data?.favorites) ? data.favorites.filter(Boolean) : [];
  const savedServices = Array.isArray(data?.['saved-services']) ? data['saved-services'].filter(Boolean) : [];
  const quotations = Array.isArray(data?.quotations) ? data.quotations.filter(Boolean) : [];
  const payments = Array.isArray(data?.payments) ? data.payments.filter(Boolean) : [];
  const refunds = Array.isArray(data?.refunds) ? data.refunds.filter(Boolean) : [];
  const messages = Array.isArray(data?.messages) ? data.messages.filter(Boolean) : [];
  const reviews = Array.isArray(data?.reviews) ? data.reviews.filter(Boolean) : [];
  const notifications = Array.isArray(data?.notifications) ? data.notifications.filter(Boolean) : [];
  const profile = data?.profile ?? EMPTY_OBJECT;
  const overview = data?.overview ?? EMPTY_OBJECT;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState({ search: '', category: '', location: '', minPrice: '', maxPrice: '', minRating: '', sort: 'recommended' });
  const [catalogRows, setCatalogRows] = useState([]);
  const [catalogPage, setCatalogPage] = useState({ page: 1, total: 0, totalPages: 1, limit: 12 });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [eventForm, setEventForm] = useState({ title: '', type: '', description: '', city: '', venue: '', startDate: '', endDate: '', guestCount: '', budget: '', capacity: '', notes: '', coverImageUrl: '' });
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [requestService, setRequestService] = useState(null);
  const [requestForm, setRequestForm] = useState({ eventId: '', guestCount: '', budget: '', notes: '' });
  const [quoteReasons, setQuoteReasons] = useState({});
  const [messageForm, setMessageForm] = useState({ bookingId: '', body: '' });
  const [reviewForm, setReviewForm] = useState({ bookingId: '', rating: '5', comment: '' });
  const [refundForm, setRefundForm] = useState(null);
  const [profileForm, setProfileForm] = useState({ fullName: profile.fullName || user.full_name || user.name || '', phone: profile.phone || user.phone || '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    setProfileForm({ fullName: profile.fullName || user.full_name || user.name || '', phone: profile.phone || user.phone || '' });
  }, [profile, user.full_name, user.name, user.phone]);

  useEffect(() => {
    if (!['vendors', 'services'].includes(view)) return undefined;
    let active = true;
    async function loadCatalog() {
      setCatalogLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(catalogPage.page || 1), limit: '12', sort: filters.sort });
        if (filters.search.trim()) params.set('search', filters.search.trim());
        if (filters.category) params.set('category', filters.category);
        if (filters.location.trim()) params.set('location', filters.location.trim());
        if (filters.minPrice !== '') params.set('minPrice', filters.minPrice);
        if (filters.maxPrice !== '') params.set('maxPrice', filters.maxPrice);
        if (filters.minRating !== '') params.set('minRating', filters.minRating);
        const response = await api(`/customer/${view}?${params}`);
        if (!active) return;
        setCatalogRows(Array.isArray(response?.data) ? response.data.filter(Boolean) : []);
        const pageInfo = response?.pagination && typeof response.pagination === 'object' ? response.pagination : {};
        setCatalogPage({
          page: Number(pageInfo.page ?? 1) || 1,
          total: Number(pageInfo.total ?? 0) || 0,
          totalPages: Number(pageInfo.totalPages ?? 1) || 1,
          limit: Number(pageInfo.limit ?? 12) || 12,
        });
      } catch (issue) {
        if (active) setError(issue.response?.data?.error || issue.message || 'The catalog could not be loaded.');
      } finally {
        if (active) setCatalogLoading(false);
      }
    }
    loadCatalog();
    return () => { active = false; };
  }, [api, catalogPage.page, filters, view]);

  async function mutate(action, message) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      setNotice(message);
      onRefresh();
      return result;
    } catch (issue) {
      setError(issue.response?.data?.error || issue.message || 'The request could not be completed.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const feedback = <>{error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}</>;
  const changeFilter = (key, value) => {
    setCatalogPage((current) => ({ ...current, page: 1 }));
    setFilters((current) => ({ ...current, [key]: value }));
  };

  async function saveEvent(event) {
    event.preventDefault();
    const body = {
      ...eventForm,
      title: eventForm.title.trim(),
      type: eventForm.type.trim(),
      guestCount: eventForm.guestCount === '' ? null : Number(eventForm.guestCount),
      budget: eventForm.budget === '' ? null : Number(eventForm.budget),
      capacity: eventForm.capacity === '' ? null : Number(eventForm.capacity),
      endDate: eventForm.endDate || null,
    };
    await mutate(async () => {
      await api(editingEventId ? `/platform/events/${editingEventId}` : '/platform/events', {
        method: editingEventId ? 'PATCH' : 'POST', body: JSON.stringify(body),
      });
      setEventFormOpen(false);
      setEditingEventId(null);
      setEventForm({ title: '', type: '', description: '', city: '', venue: '', startDate: '', endDate: '', guestCount: '', budget: '', capacity: '', notes: '', coverImageUrl: '' });
    }, editingEventId ? 'Event updated.' : 'Event saved as a draft.');
  }

  function startEditEvent(event) {
    setEditingEventId(event.id);
    setEventForm({
      title: event.title || '', type: event.type || '', description: event.description || '', city: event.location || event.city || '',
      venue: event.venue || '', startDate: String(event.startDate || event.date || '').replace(' ', 'T').slice(0, 16),
      endDate: String(event.endDate || '').replace(' ', 'T').slice(0, 16), guestCount: event.guestCount ?? '',
      budget: event.budget ?? '', capacity: event.capacity ?? '', notes: event.notes || '', coverImageUrl: event.coverImage || '',
    });
    setEventFormOpen(true);
  }

  function requestVendorMutation(vendorId) {
    return mutate(() => api('/customer/favorites', { method: 'POST', body: JSON.stringify({ vendorId: Number(vendorId) }) }), 'Vendor added to wishlist.');
  }

  if (view === 'overview') return <section className="customer-workspace">{feedback}
    <PageHeading eyebrow="CUSTOMER HOME" title={`Welcome, ${user.full_name || user.name || 'Customer'}`} description="Your events, bookings, payments, and updates in one place." action={<button className="button" type="button" onClick={() => onNavigate('services')}>Browse services</button>} />
    <div className="metric-grid"><article className="metric-card"><p>Total bookings</p><strong>{overview.totalBookings ?? 0}</strong><span>{overview.pendingBookings ?? 0} pending</span></article><article className="metric-card"><p>Confirmed</p><strong>{overview.confirmedBookings ?? 0}</strong><span>{overview.upcomingEvents ?? 0} upcoming events</span></article><article className="metric-card"><p>Payment balance</p><strong>{money(overview.outstandingPayments ?? 0)}</strong><span>{overview.pendingQuotations ?? 0} open quotations</span></article><article className="metric-card"><p>Unread updates</p><strong>{(overview.unreadMessages ?? 0) + (overview.unreadNotifications ?? 0)}</strong><span>{overview.unreadMessages ?? 0} messages · {overview.unreadNotifications ?? 0} notifications</span></article></div>
    <div className="two-column-layout"><section className="panel"><div className="panel-header"><h3>Recent bookings</h3><button className="button secondary small" type="button" onClick={() => onNavigate('bookings')}>View bookings</button></div>{bookings.slice(0, 5).map((booking) => <article className="list-card" key={booking.id}><div><strong>{booking.serviceTitle}</strong><small>{booking.reference} · {booking.eventTitle || 'Event'} · {formatDate(booking.eventDate)}</small></div><span className={`pill ${statusClass(booking.status)}`}>{booking.status}</span></article>)}{!bookings.length && <EmptyState>No bookings yet. Browse services to get started.</EmptyState>}</section><section className="panel"><div className="panel-header"><h3>Recent updates</h3><button className="button secondary small" type="button" onClick={() => onNavigate('notifications')}>View all</button></div>{notifications.slice(0, 5).map((item) => <article className="list-card" key={item.id}><div><strong>{item.title}</strong><small>{item.message}</small></div><span className={`pill ${item.read ? 'inactive' : 'active'}`}>{item.read ? 'Read' : 'New'}</span></article>)}{!notifications.length && <EmptyState>No notifications.</EmptyState>}</section></div>
    <section className="panel"><div className="panel-header"><h3>Quick discovery</h3><button className="button secondary small" type="button" onClick={() => onNavigate('categories')}>Service categories</button></div><div className="customer-quick-services">{services.slice(0, 4).map((service) => <article className="customer-service-card" key={service.id}><strong>{service.title}</strong><small>{service.vendorName} · {service.category}</small><span>{money(service.price, service.currency)}</span><button className="button secondary small" type="button" onClick={() => onNavigate('services')}>View services</button></article>)}</div>{!services.length && <EmptyState>No published services are available.</EmptyState>}</section>
  </section>;

  if (view === 'vendors' || view === 'services') {
    const isVendors = view === 'vendors';
    const categoryOptions = categories;
    return <section className="customer-workspace">{feedback}<PageHeading eyebrow="DISCOVERY" title={isVendors ? 'Browse vendors' : 'Search services'} description="Search, compare, save, and request a service for one of your events." />
      <div className="panel customer-catalog-filters"><label className="field"><span>Search</span><div className="customer-search"><Search size={16}/><input value={filters.search} onChange={(event) => changeFilter('search', event.target.value)} placeholder={isVendors ? 'Vendor name' : 'Service or description'} /></div></label><label className="field"><span>Category</span><select value={filters.category} onChange={(event) => changeFilter('category', event.target.value)}><option value="">All categories</option>{categoryOptions.map((item) => <option value={item.name} key={item.id}>{item.name}</option>)}</select></label><label className="field"><span>Location</span><input value={filters.location} onChange={(event) => changeFilter('location', event.target.value)} placeholder="Any city" /></label><label className="field"><span>Minimum price</span><input type="number" min="0" value={filters.minPrice} onChange={(event) => changeFilter('minPrice', event.target.value)} /></label><label className="field"><span>Maximum price</span><input type="number" min="0" value={filters.maxPrice} onChange={(event) => changeFilter('maxPrice', event.target.value)} /></label><label className="field"><span>Minimum rating</span><select value={filters.minRating} onChange={(event) => changeFilter('minRating', event.target.value)}><option value="">Any rating</option><option value="4">4+</option><option value="4.5">4.5+</option></select></label><label className="field"><span>Sort</span><select value={filters.sort} onChange={(event) => changeFilter('sort', event.target.value)}><option value="recommended">Recommended</option><option value="highest-rated">Highest rated</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option>{!isVendors && <option value="alphabetical">Alphabetical</option>}</select></label></div>
      {catalogLoading ? <div className="loading"><span className="spinner"/>Loading catalog...</div> : <div className="customer-catalog-grid">{catalogRows.map((item) => <article className="panel customer-catalog-card" key={item.id}>
        {(item.coverImageUrl || item.logoUrl || item.images?.[0]?.url) && <img src={item.coverImageUrl || item.logoUrl || item.images?.[0]?.url} alt={item.name || item.title} loading="lazy"/>}
        <div><span className={`pill ${item.verified ? 'verified' : 'active'}`}>{isVendors ? item.verified ? 'Verified' : 'Listing' : item.category}</span><h3>{isVendors ? item.name : item.title}</h3><p>{isVendors ? `${item.category} · ${item.city}` : `${item.vendorName} · ${item.city}`}</p><p>{item.description}</p><strong>{money(isVendors ? item.priceFrom : item.price, item.currency)}</strong>{item.rating > 0 && <small>{Number(item.rating).toFixed(1)} / 5 · {item.reviewCount || 0} reviews</small>}
          {Array.isArray(item.packages) && item.packages.length > 0 && <div className="customer-package-preview">{item.packages.filter(Boolean).slice(0, 2).map((pkg) => <span key={pkg.id}>{pkg.name}: {money(pkg.price, pkg.currency)}</span>)}</div>}
        </div><div className="customer-catalog-actions"><button className="button secondary small" type="button" onClick={() => isVendors ? onNavigate('favorites') : setRequestService({ kind: 'quote', service: item })}>{isVendors ? 'View profile' : 'Request quote'}</button>{isVendors ? <button className="button small" type="button" disabled={busy} onClick={() => requestVendorMutation(item.id)}>Save vendor</button> : <><button className="button secondary small" type="button" onClick={() => setRequestService({ kind: 'save-service', service: item })}>Save service</button><button className="button small" type="button" onClick={() => setRequestService({ kind: 'booking', service: item })}>Request booking</button></>}</div>
      </article>)}{!catalogRows.length && <EmptyState>No matching records. Try changing the filters.</EmptyState>}</div>}
      {!catalogLoading && catalogRows.length > 0 && <div className="pagination-row"><span>{catalogPage.total} results</span><button className="button secondary small" type="button" disabled={catalogPage.page <= 1} onClick={() => setCatalogPage((current) => ({ ...current, page: current.page - 1 }))}><ChevronLeft size={16}/> Previous</button><span>Page {catalogPage.page} of {catalogPage.totalPages}</span><button className="button secondary small" type="button" disabled={catalogPage.page >= catalogPage.totalPages} onClick={() => setCatalogPage((current) => ({ ...current, page: current.page + 1 }))}>Next <ChevronRight size={16}/></button></div>}
      {requestService && <CustomerRequestModal item={requestService} events={events} api={api} mutate={mutate} onClose={() => setRequestService(null)} />}
    </section>;
  }

  if (view === 'categories') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="SERVICE DIRECTORY" title="Service categories" description="Browse active categories and open matching services." />{categories.map((category) => <article className="panel customer-category-row" key={category.id}><div><strong>{category.name}</strong><p>{category.description}</p><small>{category.vendorCount ?? 0} vendors · {category.serviceCount ?? 0} services</small></div><button className="button secondary small" type="button" onClick={() => { changeFilter('category', category.name); onNavigate('services'); }}>Browse services</button></article>)}{!categories.length && <EmptyState>No active categories available.</EmptyState>}</section>;

  if (view === 'bookings' || view === 'history') {
    const rows = view === 'bookings' ? bookings : history;
    const filteredRows = rows.filter((booking) => `${booking.reference} ${booking.serviceTitle} ${booking.eventTitle} ${booking.status}`.toLowerCase().includes(query.trim().toLowerCase()))
      .filter((booking) => !statusFilter || statusClass(booking.status) === statusFilter);
    return <section className="customer-workspace">{feedback}<PageHeading eyebrow="RESERVATIONS" title={view === 'bookings' ? 'My bookings' : 'Booking history'} description="Track service dates, status, payment state, and actions available for each booking." action={view === 'bookings' ? <button className="button" type="button" onClick={() => onNavigate('services')}>Browse services</button> : null} />
      <div className="customer-list-filters"><label className="field"><span>Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Reference, event, vendor, service" /></label><label className="field"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{[...new Set(rows.map((item) => statusClass(item.status)))].map((status) => <option value={status} key={status}>{status.replaceAll('-', ' ')}</option>)}</select></label></div>
      <div className="customer-booking-list">{filteredRows.map((booking) => <article className="panel customer-booking-card" key={booking.id}><div><span className={`pill ${statusClass(booking.status)}`}>{booking.status}</span><h3>{booking.serviceTitle}</h3><p>{booking.eventTitle || 'Event'} · {formatDate(booking.eventDate)}</p><p>{booking.vendorName || 'Vendor'} · {money(booking.quotedAmount, booking.currency)}</p><small>Payment: {booking.paymentStatus || 'unpaid'}</small></div><div className="customer-actions">{view === 'bookings' && ['requested', 'under_review', 'quoted', 'accepted'].includes(statusClass(booking.status)) && <button className="button danger small" type="button" disabled={busy} onClick={() => window.confirm(translateText('Cancel this booking request?')) && mutate(() => api(`/platform/bookings/${booking.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }), 'Booking cancelled.')}>Cancel booking</button>}{view === 'history' && <button className="button secondary small" type="button" onClick={() => { changeFilter('search', booking.serviceTitle); onNavigate('services'); }}>Book similar service</button>}</div></article>)}{!filteredRows.length && <EmptyState>No bookings match the selected filters.</EmptyState>}</div>
    </section>;
  }

  if (view === 'events') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="EVENT PLANNING" title="My events" description="Create events, track linked bookings, and update your own event details." action={<button className="button" type="button" onClick={() => { setEditingEventId(null); setEventForm({ title: '', type: '', description: '', city: '', venue: '', startDate: '', endDate: '', guestCount: '', budget: '', capacity: '', notes: '', coverImageUrl: '' }); setEventFormOpen((current) => !current); }}>New event</button>} />
    {eventFormOpen && <form className="panel customer-workspace-form" onSubmit={saveEvent}><h3>{editingEventId ? 'Edit event' : 'Create event'}</h3><div className="customer-form-grid"><label className="field"><span>Event name</span><input required minLength="2" maxLength="180" value={eventForm.title} onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))} /></label><label className="field"><span>Event type</span><input required minLength="2" maxLength="80" value={eventForm.type} onChange={(event) => setEventForm((current) => ({ ...current, type: event.target.value }))} /></label><label className="field"><span>Start date and time</span><input type="datetime-local" required value={eventForm.startDate} onChange={(event) => setEventForm((current) => ({ ...current, startDate: event.target.value }))} /></label><label className="field"><span>End date and time</span><input type="datetime-local" value={eventForm.endDate} onChange={(event) => setEventForm((current) => ({ ...current, endDate: event.target.value }))} /></label><label className="field"><span>Location / city</span><input maxLength="120" value={eventForm.city} onChange={(event) => setEventForm((current) => ({ ...current, city: event.target.value }))} /></label><label className="field"><span>Venue</span><input maxLength="180" value={eventForm.venue} onChange={(event) => setEventForm((current) => ({ ...current, venue: event.target.value }))} /></label><label className="field"><span>Expected guests</span><input type="number" min="1" max="100000" value={eventForm.guestCount} onChange={(event) => setEventForm((current) => ({ ...current, guestCount: event.target.value }))} /></label><label className="field"><span>Budget</span><input type="number" min="0" max="100000000" step="0.01" value={eventForm.budget} onChange={(event) => setEventForm((current) => ({ ...current, budget: event.target.value }))} /></label><label className="field customer-form-wide"><span>Description</span><textarea maxLength="10000" value={eventForm.description} onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))} /></label><label className="field customer-form-wide"><span>Planning notes</span><textarea maxLength="2000" value={eventForm.notes} onChange={(event) => setEventForm((current) => ({ ...current, notes: event.target.value }))} /></label></div><div className="customer-actions"><button className="button" disabled={busy}>{busy ? 'Saving...' : editingEventId ? 'Save changes' : 'Save draft'}</button><button className="button secondary" type="button" onClick={() => setEventFormOpen(false)}>Cancel</button></div></form>}
    {events.map((event) => <article className="panel customer-event-card" key={event.id}><div><span className={`pill ${statusClass(event.status)}`}>{event.status}</span><h3>{event.title}</h3><p>{event.type} · {formatDate(event.startDate || event.date)} · {event.location || event.city}</p><p>{event.guestCount ?? 0} guests · Budget {money(event.budget, event.currency)}</p><small>{event.description || event.notes}</small></div><div className="customer-actions"><button className="button secondary small" type="button" onClick={() => startEditEvent(event)}>Edit</button>{statusClass(event.status) === 'draft' && <button className="button small" type="button" disabled={busy} onClick={() => mutate(() => api(`/platform/events/${event.id}/publish`, { method: 'PATCH' }), 'Event published.')}>Publish</button>}{!['completed', 'cancelled'].includes(statusClass(event.status)) && <button className="button danger small" type="button" disabled={busy} onClick={() => window.confirm(translateText('Cancel this event? Active bookings must be resolved first.')) && mutate(() => api(`/platform/events/${event.id}/cancel`, { method: 'PATCH' }), 'Event cancelled.')}>Cancel</button>}<button className="button secondary small" type="button" onClick={() => onNavigate('bookings')}>View bookings</button></div></article>)}{!events.length && !eventFormOpen && <EmptyState>No events yet. Create your first event to start planning.</EmptyState>}
  </section>;

  if (view === 'favorites') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="WISHLIST" title="Saved vendors and services" description="Keep preferred providers and packages for later comparison." />
    <h3>Vendors</h3>{favorites.map((vendor) => <article className="panel customer-saved-card" key={`vendor-${vendor.id}`}><div><h3>{vendor.name}</h3><p>{vendor.category} · {vendor.city}</p><small>{vendor.description}</small></div><div className="customer-actions"><button className="button secondary small" type="button" onClick={() => onNavigate('vendors')}>Browse vendors</button><button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/favorites/${vendor.id}`, { method: 'DELETE' }), 'Vendor removed from wishlist.')}>Remove</button></div></article>)}{!favorites.length && <p className="muted">No saved vendors.</p>}
    <h3>Services</h3>{savedServices.map((service) => <article className="panel customer-saved-card" key={`service-${service.id}`}><div><h3>{service.title}</h3><p>{service.vendorName} · {service.category} · {service.city}</p><strong>{money(service.price, service.currency)}</strong></div><div className="customer-actions"><button className="button secondary small" type="button" onClick={() => { changeFilter('search', service.title); onNavigate('services'); }}>Open service</button><button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/saved-services/${service.id}`, { method: 'DELETE' }), 'Service removed from wishlist.')}>Remove</button></div></article>)}{!savedServices.length && <p className="muted">No saved services.</p>}
  </section>;

  if (view === 'quotations') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="PRICE PROPOSALS" title="Quotations" description="Compare vendor offers and accept, decline, or request a revision." />
    {quotations.map((quote) => <article className="panel customer-quote-card" key={quote.id}>
      <div>
        <span className={`pill ${statusClass(quote.status)}`}>{quote.status === 'draft' ? 'pending vendor response' : String(quote.status ?? '').replaceAll('_', ' ')}</span>
        <h3>{quote.vendorName} · {quote.service}</h3>
        <p>{quote.event || 'No event linked'}{quote.eventType ? ` · ${quote.eventType}` : ''}{quote.eventDate ? ` · ${String(quote.eventDate).slice(0, 16)}` : ''}{quote.eventLocation ? ` · ${quote.eventLocation}` : ''}{quote.validUntil ? ` · Valid through ${quote.validUntil}` : ''}</p>
        {(quote.guestCount ?? 0) > 0 || quote.budget != null ? <p>{quote.guestCount ? `${quote.guestCount} guests` : ''}{quote.budget != null ? ` · Budget ${money(quote.budget, quote.currency)}` : ''}</p> : null}
        {quote.requiredServices && <p><strong>Requested scope:</strong> {quote.requiredServices}</p>}
        {quote.additionalRequirements && <p><strong>Requirements:</strong> {quote.additionalRequirements}</p>}
        {quote.requestMessage && <p><strong>Message:</strong> {quote.requestMessage}</p>}
        {quote.contactPhone && <p><strong>Contact phone:</strong> {quote.contactPhone}</p>}
        {quote.notes && <p>{quote.notes}</p>}
        <strong>{money(quote.amount, quote.currency)}</strong>
      </div>
      {quote.status === 'draft' && <button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }), 'Quotation request cancelled.')}>Cancel request</button>}
      {['sent', 'revision_requested'].includes(statusClass(quote.status)) && <div className="customer-actions"><button className="button" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) }), 'Quotation accepted.')}>Accept</button><button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'declined' }) }), 'Quotation declined.')}>Decline</button><label className="field"><span>Revision request</span><input maxLength="500" value={quoteReasons[quote.id] || ''} onChange={(event) => setQuoteReasons((current) => ({ ...current, [quote.id]: event.target.value }))} /></label><button className="button secondary small" type="button" disabled={busy || (quoteReasons[quote.id] || '').trim().length < 5} onClick={() => mutate(() => api(`/customer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'revision_requested', reason: quoteReasons[quote.id].trim() }) }), 'Revision requested.')}>Request revision</button></div>}
    </article>)}{!quotations.length && <EmptyState>No quotations yet. Request a quote from a service listing.</EmptyState>}
  </section>;

  if (view === 'payments') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="FINANCIAL RECORDS" title="Payments and refunds" description="Statuses are read-only and reflect verified payment/refund records." />
    <div className="table-wrap"><table><thead><tr><th>Payment</th><th>Event</th><th>Service</th><th>Status</th><th>Amount</th><th>Date</th><th></th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{payment.reference}</td><td>{payment.event}</td><td>{payment.service}</td><td><span className={`pill ${statusClass(payment.status)}`}>{payment.status}</span></td><td>{money(payment.amount, payment.currency)}</td><td>{formatDate(payment.date)}</td><td>{['paid', 'partially_refunded'].includes(statusClass(payment.status)) && <button className="button secondary small" type="button" onClick={() => setRefundForm({ payment, amount: String(payment.amount ?? 0), reason: '' })}>Request refund</button>}</td></tr>)}</tbody></table></div>{!payments.length && <EmptyState>No payment records yet.</EmptyState>}
    <section className="panel"><h3>Refund history</h3>{refunds.map((refund) => <article className="list-card" key={refund.id}><div><strong>Payment #{refund.paymentId} · {money(refund.amount, refund.currency)}</strong><small>{refund.reason} · {formatDate(refund.createdAt)}</small></div><span className={`pill ${statusClass(refund.status)}`}>{refund.status}</span></article>)}{!refunds.length && <p className="muted">No refund requests.</p>}</section>
    {refundForm && <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && setRefundForm(null)}><form className="modal" onSubmit={(event) => { event.preventDefault(); mutate(async () => { await api(`/customer/payments/${refundForm.payment.id}/refunds`, { method: 'POST', body: JSON.stringify({ amount: Number(refundForm.amount), reason: refundForm.reason, idempotencyKey: globalThis.crypto.randomUUID() }) }); setRefundForm(null); }, 'Refund request submitted.'); }}><div className="modal-head"><h2>Request refund</h2><button className="icon-button" type="button" aria-label="Close" onClick={() => setRefundForm(null)}>×</button></div><div className="modal-body"><p>{refundForm.payment.reference} · {money(refundForm.payment.amount, refundForm.payment.currency)}</p><label className="field"><span>Amount</span><input type="number" min="0.01" max={refundForm.payment.amount} step="0.01" required value={refundForm.amount} onChange={(event) => setRefundForm((current) => ({ ...current, amount: event.target.value }))} /></label><label className="field"><span>Reason</span><textarea required minLength="5" maxLength="500" value={refundForm.reason} onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value }))} /></label></div><div className="modal-foot"><button className="button secondary" type="button" onClick={() => setRefundForm(null)}>Cancel</button><button className="button" disabled={busy}>{busy ? 'Submitting...' : 'Submit refund request'}</button></div></form></div>}
  </section>;

  if (view === 'messages') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="CONVERSATIONS" title="Messages" description="Message vendors in the context of your bookings." />
    <form className="panel customer-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(() => api('/customer/messages', { method: 'POST', body: JSON.stringify({ bookingId: Number(messageForm.bookingId), body: messageForm.body }) }), 'Message sent.'); setMessageForm({ bookingId: '', body: '' }); }}><label className="field"><span>Booking</span><select required value={messageForm.bookingId} onChange={(event) => setMessageForm((current) => ({ ...current, bookingId: event.target.value }))}><option value="">Choose booking</option>{bookings.filter((booking) => !['cancelled', 'rejected'].includes(statusClass(booking.status))).map((booking) => <option value={booking.id} key={booking.id}>{booking.eventTitle} · {booking.vendorName} · {booking.serviceTitle}</option>)}</select></label><label className="field"><span>Message</span><textarea required maxLength="4000" value={messageForm.body} onChange={(event) => setMessageForm((current) => ({ ...current, body: event.target.value }))} /></label><button className="button" disabled={busy || !messageForm.bookingId}>{busy ? 'Sending...' : 'Send message'}</button></form>
    {messages.map((message) => <article className={`panel customer-message ${message.read ? '' : 'unread'}`} key={message.id}><div><strong>{message.senderId === Number(user.id ?? 0) ? 'You' : message.sender} · {message.vendor}</strong><small>{message.event} · Booking #{message.bookingId} · {formatDate(message.createdAt)}</small><p>{message.body}</p></div>{!message.read && Number(message.recipientId ?? 0) === Number(user.id ?? 0) && <button className="button secondary small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/messages/${message.id}/read`, { method: 'POST' }), 'Message marked as read.')}>Mark read</button>}</article>)}{!messages.length && <EmptyState>No conversations yet.</EmptyState>}
  </section>;

  if (view === 'reviews') {
    const reviewedBookingIds = new Set(reviews.map((review) => Number(review.bookingId ?? 0)));
    const eligibleBookings = bookings.filter((booking) => statusClass(booking.status) === 'completed' && !reviewedBookingIds.has(Number(booking.id)));
    return <section className="customer-workspace">{feedback}<PageHeading eyebrow="FEEDBACK" title="Reviews and ratings" description="Reviews are allowed once per completed booking and cannot be changed after submission." />
      <form className="panel customer-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(() => api('/customer/reviews', { method: 'POST', body: JSON.stringify({ bookingId: Number(reviewForm.bookingId), rating: Number(reviewForm.rating), comment: reviewForm.comment }) }), 'Review submitted.'); setReviewForm({ bookingId: '', rating: '5', comment: '' }); }}><h3>Review a completed service</h3><label className="field"><span>Completed booking</span><select required value={reviewForm.bookingId} onChange={(event) => setReviewForm((current) => ({ ...current, bookingId: event.target.value }))}><option value="">Choose booking</option>{eligibleBookings.map((booking) => <option value={booking.id} key={booking.id}>{booking.vendorName} · {booking.serviceTitle} · {booking.eventTitle}</option>)}</select></label><label className="field"><span>Rating</span><select value={reviewForm.rating} onChange={(event) => setReviewForm((current) => ({ ...current, rating: event.target.value }))}>{[5, 4, 3, 2, 1].map((rating) => <option value={rating} key={rating}>{rating} stars</option>)}</select></label><label className="field"><span>Comment</span><textarea maxLength="2000" value={reviewForm.comment} onChange={(event) => setReviewForm((current) => ({ ...current, comment: event.target.value }))} /></label><button className="button" disabled={busy || !reviewForm.bookingId}>{busy ? 'Submitting...' : 'Submit review'}</button></form>
      {reviews.map((review) => <article className="panel customer-message" key={review.id}><div><strong>{review.vendorName} · {'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}</strong><p>{review.comment || 'Rating submitted'}</p><small>{formatDate(review.createdAt)} · {review.status}</small></div></article>)}{!reviews.length && !eligibleBookings.length && <EmptyState>No completed bookings are eligible for a review.</EmptyState>}
    </section>;
  }

  if (view === 'notifications') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="UPDATES" title="Notifications" description="Booking, quotation, payment, message, and event updates sent to your account." action={<button className="button secondary" type="button" disabled={busy || !notifications.some((item) => !item.read)} onClick={() => mutate(() => api('/customer/notifications/read-all', { method: 'POST' }), 'All notifications marked as read.')}><Check size={16}/> Mark all read</button>} />
    {notifications.map((item) => <article className={`panel customer-message ${item.read ? '' : 'unread'}`} key={item.id}><div><strong>{item.title}</strong><small>{item.type} · {formatDate(item.createdAt)}</small><p>{item.message}</p></div><div className="customer-actions">{item.relatedType === 'booking' && <button className="button secondary small" type="button" onClick={() => onNavigate('bookings')}>Open booking</button>}{item.relatedType === 'event' && <button className="button secondary small" type="button" onClick={() => onNavigate('events')}>Open event</button>}{!item.read && <button className="button secondary small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/notifications/${item.id}/read`, { method: 'POST' }), 'Notification marked as read.')}><Bell size={14}/> Mark read</button>}</div></article>)}{!notifications.length && <EmptyState>No notifications yet.</EmptyState>}
  </section>;

  if (view === 'profile') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="ACCOUNT" title="Profile management" description="Update your contact details and secure your account." />
    <div className="two-column-layout"><form className="panel customer-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(async () => { const response = await api('/customer/profile', { method: 'PATCH', body: JSON.stringify(profileForm) }); onUserChange?.((current) => current ? { ...current, full_name: profileForm.fullName, name: profileForm.fullName, phone: profileForm.phone } : current); return response; }, 'Profile updated.'); }}><h3>Personal information</h3><label className="field"><span>Full name</span><input required minLength="2" maxLength="160" value={profileForm.fullName} onChange={(event) => setProfileForm((current) => ({ ...current, fullName: event.target.value }))} /></label><label className="field"><span>Email</span><input value={profile.email || user.email || ''} disabled /></label><label className="field"><span>Phone</span><input maxLength="40" value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} /></label><p className="muted">Email changes require a separate verification flow and are not available here. Update your profile photo from the header.</p><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Save profile'}</button></form>
      <form className="panel customer-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(async () => { await api('/customer/profile/password', { method: 'POST', body: JSON.stringify(passwordForm) }); setPasswordForm({ currentPassword: '', newPassword: '' }); }, 'Password updated.'); }}><h3>Change password</h3><label className="field"><span>Current password</span><input type="password" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} /></label><label className="field"><span>New password</span><input type="password" autoComplete="new-password" required minLength="12" maxLength="16" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} /></label><small>Use 12-16 characters with uppercase, lowercase, and a number.</small><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button></form></div>
  </section>;

  return <section className="customer-workspace">{feedback}<EmptyState>This customer section is unavailable.</EmptyState></section>;
}