import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Clock3, MapPin, Search } from 'lucide-react';
import { formatCustomerMoney as money } from './customerMoney.js';
import './customerBookings.css';

const STATUS_GROUPS = {
  All: null,
  Pending: ['requested', 'under_review', 'quoted'],
  Confirmed: ['accepted', 'confirmed', 'in_progress'],
  Completed: ['completed'],
  Cancelled: ['cancelled'],
  Rejected: ['rejected'],
};
const PAGE_SIZE = 8;

function formatBookingDate(value, options = { dateStyle: 'medium' }) {
  if (!value) return 'Not provided';
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, options).format(date);
}

function statusLabel(status) {
  return String(status || 'requested').replaceAll('_', ' ');
}

function CustomerBookingCard({ booking, api, onNavigate, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  async function cancelBooking() {
    if (!window.confirm(`Cancel booking ${booking.reference}? This action cannot be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/platform/bookings/${booking.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
      await onRefresh();
    } catch (issue) {
      setError(issue.message || 'The booking could not be cancelled.');
    } finally {
      setBusy(false);
    }
  }

  return <article className="customer-service-booking panel">
    <div className="customer-service-booking-main">
      <div className="customer-service-booking-title">
        <span className={`pill ${String(booking.status).replaceAll('_', '-')}`}>{statusLabel(booking.status)}</span>
        <span className="customer-service-booking-reference">{booking.reference}</span>
      </div>
      <h2>{booking.serviceTitle || booking.serviceDescription || 'Service booking'}</h2>
      <p className="customer-service-booking-subtitle">{booking.vendorName || 'Vendor'} · {booking.eventTitle || 'Event'}</p>
      <div className="customer-service-booking-meta">
        <span><CalendarDays size={16}/> {formatBookingDate(booking.eventDate)}</span>
        <span><Clock3 size={16}/> {formatBookingDate(booking.scheduledDate, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <span><MapPin size={16}/> {booking.location || booking.eventCity || 'Location not provided'}</span>
      </div>
      <div className="customer-service-booking-payment">
        <strong>{booking.quotedAmount > 0 ? money(booking.quotedAmount, booking.currency) : 'Quotation pending'}</strong>
        <span>Payment: {statusLabel(booking.paymentStatus)}</span>
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
      {rescheduleOpen && <RescheduleForm
        booking={booking}
        api={api}
        onCancel={() => setRescheduleOpen(false)}
        onSaved={async () => { setRescheduleOpen(false); await onRefresh(); }}
      />}
    </div>
    <div className="customer-service-booking-actions">
      <button className="button secondary small" type="button" onClick={() => onNavigate(`/customer/bookings/${booking.id}`)}>View details</button>
      {booking.canReschedule && !rescheduleOpen && <button className="button secondary small" type="button" disabled={busy} onClick={() => setRescheduleOpen(true)}>Reschedule</button>}
      {booking.canCancel && <button className="button danger small" type="button" disabled={busy} onClick={cancelBooking}>{busy ? 'Updating…' : 'Cancel booking'}</button>}
    </div>
  </article>;
}

function RescheduleForm({ booking, api, onCancel, onSaved }) {
  const [scheduledDate, setScheduledDate] = useState(String(booking.scheduledDate || '').replace(' ', 'T').slice(0, 16));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!window.confirm('Submit this rescheduling request to the vendor?')) return;
    setBusy(true);
    setError('');
    try {
      const response = await api(`/customer/bookings/${booking.id}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledDate, reason }),
      });
      if (!response?.data?.scheduled_date) throw new Error('The server did not confirm the new booking date.');
      await onSaved(response.data);
    } catch (issue) {
      setError(issue.message || 'The booking could not be rescheduled.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="customer-booking-reschedule" onSubmit={submit}>
    <h3>Request a new date and time</h3>
    {error && <p className="alert error" role="alert">{error}</p>}
    <label className="field"><span>New date and time</span><input type="datetime-local" required value={scheduledDate} min={new Date().toISOString().slice(0, 16)} onChange={(event) => setScheduledDate(event.target.value)} /></label>
    <label className="field"><span>Reason for rescheduling</span><textarea required minLength="5" maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    <div className="customer-service-booking-actions">
      <button className="button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
      <button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Keep current date</button>
    </div>
  </form>;
}

export function CustomerBookingsList({ api, onNavigate }) {
  const [bookings, setBookings] = useState([]);
  const [activeFilter, setActiveFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadBookings = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const response = await api('/customer/bookings', { signal });
      if (!Array.isArray(response?.data)) throw new Error('The server returned an invalid bookings list.');
      setBookings(response.data);
    } catch (issue) {
      if (issue.name !== 'AbortError') setError(issue.message || 'Bookings could not be loaded.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    loadBookings(controller.signal);
    return () => controller.abort();
  }, [loadBookings]);

  const counts = useMemo(() => Object.fromEntries(Object.entries(STATUS_GROUPS).map(([label, statuses]) => [
    label,
    statuses ? bookings.filter((booking) => statuses.includes(booking.status)).length : bookings.length,
  ])), [bookings]);
  const filtered = useMemo(() => bookings
    .filter((booking) => !STATUS_GROUPS[activeFilter] || STATUS_GROUPS[activeFilter].includes(booking.status))
    .filter((booking) => `${booking.reference} ${booking.vendorName} ${booking.serviceTitle} ${booking.eventTitle} ${booking.status}`.toLowerCase().includes(search.trim().toLowerCase())), [activeFilter, bookings, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [activeFilter, search]);

  return <section className="customer-service-bookings">
    <header className="customer-service-bookings-header">
      <div><p className="eyebrow">RESERVATIONS</p><h1>My bookings</h1><p>View your service bookings and manage permitted changes.</p></div>
      <button className="button" type="button" onClick={() => onNavigate('/customer/dashboard?view=services')}>Browse services</button>
    </header>
    <label className="field customer-service-bookings-search"><span>Search your bookings</span><div><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, vendor, service, or event" /></div></label>
    <div className="customer-service-bookings-tabs" role="tablist" aria-label="Filter bookings by status">
      {Object.keys(STATUS_GROUPS).map((filter) => <button key={filter} type="button" role="tab" aria-selected={activeFilter === filter} className={activeFilter === filter ? 'active' : ''} onClick={() => setActiveFilter(filter)}>{filter}<span>{counts[filter]}</span></button>)}
    </div>
    {loading ? <div className="loading" role="status"><span className="spinner"/>Loading your bookings…</div>
      : error ? <div className="alert error" role="alert">{error}<button className="text-action" type="button" onClick={() => loadBookings()}>Retry</button></div>
        : visible.length ? <div className="customer-service-bookings-list">{visible.map((booking) => <CustomerBookingCard key={booking.id} booking={booking} api={api} onNavigate={onNavigate} onRefresh={() => loadBookings()} />)}</div>
          : <div className="customer-service-bookings-empty"><h2>{search ? 'No matching bookings' : activeFilter === 'All' ? 'No bookings yet' : `No ${activeFilter.toLowerCase()} bookings`}</h2><p>{search ? 'Try another search term.' : 'Your service bookings will appear here.'}</p>{!search && <button className="button" type="button" onClick={() => onNavigate('/customer/dashboard?view=services')}>Browse services</button>}</div>}
    {!loading && !error && filtered.length > PAGE_SIZE && <nav className="customer-service-bookings-pagination" aria-label="Bookings pages"><button className="button secondary small" type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {totalPages}</span><button className="button secondary small" type="button" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>Next</button></nav>}
  </section>;
}

export function CustomerBookingDetailsPage({ bookingId, api, onNavigate }) {
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const loadBooking = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const response = await api(`/customer/bookings/${bookingId}`, { signal });
      if (!response?.data?.id) throw new Error('The server returned an invalid booking.');
      setBooking(response.data);
    } catch (issue) {
      if (issue.name !== 'AbortError') setError(issue.message || 'Booking details could not be loaded.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [api, bookingId]);

  useEffect(() => {
    const controller = new AbortController();
    loadBooking(controller.signal);
    return () => controller.abort();
  }, [loadBooking]);

  async function cancelBooking() {
    if (!booking || !window.confirm(`Cancel booking ${booking.reference}? This action cannot be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/platform/bookings/${booking.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
      await loadBooking();
    } catch (issue) {
      setError(issue.message || 'The booking could not be cancelled.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="customer-service-booking-details"><div className="loading" role="status"><span className="spinner"/>Loading booking details…</div></main>;
  if (error && !booking) return <main className="customer-service-booking-details"><button className="button secondary small" type="button" onClick={() => onNavigate('/customer/dashboard?view=bookings')}><ArrowLeft size={16}/> My bookings</button><div className="alert error" role="alert">{error}</div></main>;
  if (!booking) return null;

  return <main className="customer-service-booking-details">
    <button className="button secondary small" type="button" onClick={() => onNavigate('/customer/dashboard?view=bookings')}><ArrowLeft size={16}/> My bookings</button>
    <header className="customer-service-booking-details-header"><div><p className="eyebrow">BOOKING DETAILS</p><h1>{booking.reference}</h1><p>{booking.eventTitle || 'Event'} · {booking.vendorName || 'Vendor'}</p></div><span className={`pill ${String(booking.status).replaceAll('_', '-')}`}>{statusLabel(booking.status)}</span></header>
    {error && <p className="alert error" role="alert">{error}</p>}
    <section className="panel customer-service-booking-details-grid">
      <div><small>Vendor</small><strong>{booking.vendorName || 'Not provided'}</strong></div>
      <div><small>Service</small><strong>{booking.serviceTitle || booking.serviceDescription || 'Not provided'}</strong></div>
      <div><small>Event date</small><strong>{formatBookingDate(booking.eventDate)}</strong></div>
      <div><small>Requested date and time</small><strong>{formatBookingDate(booking.scheduledDate, { dateStyle: 'medium', timeStyle: 'short' })}</strong></div>
      <div><small>Location</small><strong>{booking.location || 'Not provided'}</strong></div>
      {booking.eventType && <div><small>Event type</small><strong>{booking.eventType}</strong></div>}
      {booking.eventGuestCount != null && <div><small>Expected guests</small><strong>{booking.eventGuestCount}</strong></div>}
      {booking.eventBudget != null && <div><small>Event budget</small><strong>{money(booking.eventBudget, booking.currency)}</strong></div>}
      <div><small>Price / quotation</small><strong>{booking.quotedAmount > 0 ? money(booking.quotedAmount, booking.currency) : 'Quotation pending'}</strong></div>
      <div><small>Payment status</small><strong>{statusLabel(booking.paymentStatus)}</strong></div>
      <div><small>Booking status</small><strong>{statusLabel(booking.status)}</strong></div>
      <div><small>Requested on</small><strong>{formatBookingDate(booking.createdAt)}</strong></div>
      {booking.moderationReason && <div className="customer-service-booking-details-wide"><small>Latest update</small><p>{booking.moderationReason}</p></div>}
      {booking.eventDescription && <div className="customer-service-booking-details-wide"><small>Event description</small><p>{booking.eventDescription}</p></div>}
      {booking.eventNotes && <div className="customer-service-booking-details-wide"><small>Event notes</small><p>{booking.eventNotes}</p></div>}
      {booking.serviceDescription && booking.serviceDescription !== booking.serviceTitle && <div className="customer-service-booking-details-wide"><small>Service details</small><p>{booking.serviceDescription}</p></div>}
    </section>
    <div className="customer-service-booking-actions">
      <button className="button secondary" type="button" onClick={() => window.print()}>Print summary</button>
      {booking.canReview && <button className="button" type="button" onClick={() => onNavigate(`/customer/dashboard?view=reviews&bookingId=${booking.id}`)}>Leave a review</button>}
      {booking.canReschedule && <button className="button secondary" type="button" disabled={busy} onClick={() => setRescheduleOpen(true)}>Request reschedule</button>}
      {booking.canCancel && <button className="button danger" type="button" disabled={busy} onClick={cancelBooking}>{busy ? 'Updating…' : 'Cancel booking'}</button>}
    </div>
    {rescheduleOpen && <div className="customer-booking-modal-backdrop" role="presentation"><section className="customer-booking-modal" role="dialog" aria-modal="true" aria-labelledby="customer-booking-reschedule-title"><h2 id="customer-booking-reschedule-title">Request a new date</h2><RescheduleForm booking={booking} api={api} onCancel={() => setRescheduleOpen(false)} onSaved={async () => { setRescheduleOpen(false); await loadBooking(); }} /></section></div>}
  </main>;
}
