import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Search, Star } from 'lucide-react';
import { formatCustomerMoney as money } from './customerMoney.js';
import './customerBookingHistory.css';

const HISTORY_STATUSES = ['completed', 'cancelled', 'rejected', 'accepted', 'quoted', 'under_review', 'requested'];
const PAGE_SIZE = 10;

function formatHistoryDate(value) {
  if (!value) return 'Date not provided';
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export default function CustomerBookingHistory({ api, onNavigate }) {
  const [bookings, setBookings] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    async function loadHistory() {
      setLoading(true);
      setError('');
      try {
        const response = await api(`/customer/history?${params}`, { signal: controller.signal });
        if (!Array.isArray(response?.data) || !response?.pagination) {
          throw new Error('The server returned an invalid booking history response.');
        }
        setBookings(response.data);
        setPagination(response.pagination);
      } catch (issue) {
        if (issue.name !== 'AbortError') setError(issue.message || 'Booking history could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadHistory();
    return () => controller.abort();
  }, [api, dateFrom, dateTo, page, retryKey, search, status]);

  useEffect(() => setPage(1), [dateFrom, dateTo, search, status]);

  return <section className="customer-booking-history">
    <header className="customer-booking-history-header">
      <div><p className="eyebrow">RESERVATIONS</p><h1>Booking history</h1><p>Review completed and other past service bookings.</p></div>
      <span className="customer-booking-history-total">{pagination.total} records</span>
    </header>
    <div className="panel customer-booking-history-filters">
      <label className="field customer-booking-history-search"><span>Search</span><div><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, vendor, service, or event" /></div></label>
      <label className="field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All historical statuses</option>{HISTORY_STATUSES.map((value) => <option value={value} key={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="field"><span>Event date from</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label className="field"><span>Event date to</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
      {(search || status || dateFrom || dateTo) && <button className="button secondary small customer-booking-history-clear" type="button" onClick={() => { setSearch(''); setStatus(''); setDateFrom(''); setDateTo(''); }}>Clear filters</button>}
    </div>
    {loading ? <div className="loading" role="status"><span className="spinner"/>Loading your booking history…</div>
      : error ? <div className="alert error" role="alert">{error}<button className="text-action" type="button" onClick={() => setRetryKey((current) => current + 1)}>Retry</button></div>
        : bookings.length ? <div className="customer-booking-history-list">{bookings.map((booking) => <article className="panel customer-booking-history-card" key={booking.id}>
          <div className="customer-booking-history-summary">
            <div className="customer-booking-history-title"><span className={`pill ${String(booking.status).replaceAll('_', '-')}`}>{String(booking.status).replaceAll('_', ' ')}</span><strong>{booking.reference}</strong></div>
            <h2>{booking.serviceTitle || booking.serviceDescription || 'Service booking'}</h2>
            <p>{booking.vendorName || 'Vendor'} · {booking.eventTitle || 'Event'}</p>
            <span className="customer-booking-history-date"><CalendarDays size={15}/>{formatHistoryDate(booking.eventDate)}</span>
            <div className="customer-booking-history-financials"><strong>{booking.quotedAmount > 0 ? money(booking.quotedAmount, booking.currency) : 'Final price unavailable'}</strong><span>Payment: {String(booking.paymentStatus || 'unpaid').replaceAll('_', ' ')}</span></div>
          </div>
          <div className="customer-booking-history-actions">
            <button className="button secondary small" type="button" onClick={() => onNavigate(`/customer/bookings/${booking.id}`)}><FileText size={15}/> Details</button>
            {booking.canReview && <button className="button small" type="button" onClick={() => onNavigate(`/customer/dashboard?view=reviews&bookingId=${booking.id}`)}><Star size={15}/> Leave a review</button>}
          </div>
        </article>)}</div>
          : <div className="customer-booking-history-empty"><h2>No past bookings found</h2><p>Try adjusting your search or filters. Booking records remain in your history after cancellation.</p></div>}
    {!loading && !error && pagination.totalPages > 1 && <nav className="customer-booking-history-pagination" aria-label="Booking history pages">
      <button className="button secondary small" type="button" disabled={pagination.page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16}/> Previous</button>
      <span>Page {pagination.page} of {pagination.totalPages}</span>
      <button className="button secondary small" type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight size={16}/></button>
    </nav>}
  </section>;
}
