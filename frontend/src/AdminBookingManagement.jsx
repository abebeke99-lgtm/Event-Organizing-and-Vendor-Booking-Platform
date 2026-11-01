import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Eye, X } from 'lucide-react';
import apiClient from './api/axios.js';
import './adminBookingManagement.css';

const initialPagination = { page: 1, pageSize: 20, total: 0 };
const bookingStatuses = ['requested', 'under_review', 'quoted', 'accepted', 'rejected', 'cancelled', 'completed'];
const paymentStatuses = ['unpaid', 'pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded', 'refund_pending'];

function errorText(error) {
  return error.response?.data?.error || error.message || 'The request could not be completed.';
}

function formatDate(value) {
  if (!value) return 'Not scheduled';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function inputDate(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function Modal({ title, children, onClose, footer }) {
  return (
    <div className="overlay admin-booking-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal admin-booking-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18}/></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </section>
    </div>
  );
}

export default function AdminBookingManagement() {
  const focusId = new URLSearchParams(window.location.search).get('focus');
  const focusQuery = /^\d+$/.test(focusId || '') ? `BK-${focusId}` : '';
  const openedFocus = useRef('');
  const [bookings, setBookings] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState(initialPagination);
  const [queryInput, setQueryInput] = useState(focusQuery);
  const [query, setQuery] = useState(focusQuery);
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reason, setReason] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');

  const loadBookings = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/admin/bookings', {
        params: {
          page,
          pageSize: pagination.pageSize,
          sortBy,
          sortDirection,
          ...(query ? { q: query } : {}),
          ...(status ? { status } : {}),
          ...(paymentStatus ? { paymentStatus } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        },
      });
      setBookings(response.data.data);
      setPagination(response.data.pagination);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setLoading(false);
    }
  }, [categoryId, dateFrom, dateTo, paymentStatus, pagination.pageSize, query, sortBy, sortDirection, status]);

  useEffect(() => { loadBookings(1); }, [loadBookings]);

  useEffect(() => {
    let active = true;
    apiClient.get('/admin/categories', { params: { page: 1, pageSize: 100 } })
      .then((response) => { if (active) setCategories(response.data.data || []); })
      .catch((issue) => { if (active) setError(errorText(issue)); });
    return () => { active = false; };
  }, []);

  async function openDetails(booking) {
    setError('');
    setDetail(null);
    setModal({ kind: 'details', booking });
    try {
      const response = await apiClient.get(`/admin/bookings/${booking.id}`);
      setDetail(response.data.data);
    } catch (issue) {
      setError(errorText(issue));
    }
  }

  useEffect(() => {
    if (!focusId || loading || openedFocus.current === focusId) return;
    const booking = bookings.find((row) => Number(row.id) === Number(focusId));
    if (booking) {
      openedFocus.current = focusId;
      openDetails(booking);
    }
  }, [bookings, focusId, loading]);

  function openAction(booking, action) {
    setReason('');
    setScheduledDate(inputDate(booking.scheduled_date || booking.event_start_date));
    setError('');
    setModal({ kind: action, booking });
  }

  async function submitAction(event) {
    event.preventDefault();
    if (!modal) return;
    setBusy(true);
    setError('');
    try {
      if (modal.kind === 'reschedule') {
        await apiClient.post(`/admin/bookings/${modal.booking.id}/reschedule`, {
          scheduled_date: scheduledDate,
          reason,
        });
        setNotice('Booking rescheduled and both parties notified.');
      } else {
        await apiClient.patch(`/admin/bookings/${modal.booking.id}/status`, {
          status: modal.kind,
          reason,
        });
        setNotice(`Booking ${modal.kind.replaceAll('_', ' ')} successfully.`);
      }
      setModal(null);
      await loadBookings(pagination.page);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }

  async function exportBookings() {
    setBusy(true);
    setError('');
    try {
      const response = await apiClient.get('/admin/bookings/export', {
        params: {
          sortBy,
          sortDirection,
          ...(query ? { q: query } : {}),
          ...(status ? { status } : {}),
          ...(paymentStatus ? { paymentStatus } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'booking-report.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }

  function sort(column) {
    if (sortBy === column) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(column);
      setSortDirection('asc');
    }
  }

  const actionOptions = (booking) => {
    const actions = [];
    if (['requested', 'under_review', 'quoted'].includes(booking.status)) {
      actions.push(['accepted', 'Confirm'], ['rejected', 'Reject'], ['cancelled', 'Cancel']);
    } else if (booking.status === 'accepted') {
      actions.push(['completed', 'Complete', Number(booking.can_complete) !== 1], ['cancelled', 'Cancel'], ['reschedule', 'Reschedule']);
    }
    if (['requested', 'under_review', 'quoted'].includes(booking.status)) actions.push(['reschedule', 'Reschedule']);
    return actions;
  };

  const actionTitle = modal?.kind === 'reschedule' ? 'Reschedule booking' : `${modal?.kind || ''} booking`;
  const reasonRequired = ['cancelled', 'rejected', 'reschedule'].includes(modal?.kind);

  return (
    <section className="admin-booking-management">
      <div className="page-heading">
        <div>
          <p className="eyebrow">System control</p>
          <h2>Booking Management</h2>
          <p className="muted">Review booking requests, availability, history, and payment records.</p>
        </div>
        <button className="button secondary" type="button" onClick={exportBookings} disabled={busy}>
          <Download size={16}/> Export report
        </button>
      </div>
      {notice && <div className="alert success" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}<button className="dismiss" onClick={() => setError('')}>Dismiss</button></div>}
      <div className="admin-booking-filters">
        <form className="search-box" onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()); }}>
          <input aria-label="Search bookings" placeholder="Reference, customer, vendor, event, service" value={queryInput} onChange={(event) => setQueryInput(event.target.value)}/>
          <button type="submit">Search</button>
        </form>
        <select aria-label="Booking status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All booking statuses</option>
          {bookingStatuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </select>
        <select aria-label="Payment status" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}>
          <option value="">All payment statuses</option>
          {paymentStatuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </select>
        <select aria-label="Service category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">All categories</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <label>Date from <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/></label>
        <label>Date to <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)}/></label>
        <select aria-label="Sort bookings" value={`${sortBy}:${sortDirection}`} onChange={(event) => {
          const [field, direction] = event.target.value.split(':');
          setSortBy(field); setSortDirection(direction);
        }}>
          <option value="created_at:desc">Newest first</option>
          <option value="created_at:asc">Oldest first</option>
          <option value="scheduled_date:asc">Scheduled date</option>
          <option value="quoted_amount:desc">Price: high to low</option>
          <option value="quoted_amount:asc">Price: low to high</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th><button type="button" onClick={() => sort('id')}>Reference</button></th>
            <th><button type="button" onClick={() => sort('customer_name')}>Customer</button></th>
            <th><button type="button" onClick={() => sort('vendor_name')}>Vendor / service</button></th>
            <th><button type="button" onClick={() => sort('event_title')}>Event</button></th>
            <th><button type="button" onClick={() => sort('scheduled_date')}>Scheduled</button></th>
            <th>Price</th><th>Status</th><th>Payment</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan="9"><div className="loading"><span className="spinner"/>Loading bookings…</div></td></tr>
              : bookings.length === 0 ? <tr><td colSpan="9"><div className="empty"><strong>No bookings found</strong><span>Adjust your search or filters.</span></div></td></tr>
                : bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.reference}</td>
                    <td>{booking.customer_name}<small>{booking.customer_email}</small></td>
                    <td>{booking.vendor_name}<small>{booking.service_title || booking.service_description}</small></td>
                    <td>{booking.event_title}<small>{booking.category_name || 'Uncategorized'}</small></td>
                    <td>{formatDate(booking.scheduled_date || booking.event_start_date)}</td>
                    <td>{booking.currency} {Number(booking.quoted_amount).toLocaleString()}</td>
                    <td><span className={`pill ${booking.status}`}>{booking.status.replaceAll('_', ' ')}</span></td>
                    <td><span className={`pill ${booking.payment_status}`}>{booking.payment_status}</span></td>
                    <td><div className="admin-booking-actions">
                      <button className="icon-button" type="button" aria-label={`View ${booking.reference}`} onClick={() => openDetails(booking)}><Eye size={16}/></button>
                      {actionOptions(booking).map(([action, label, disabled = false]) => (
                        <button
                          key={action}
                          className={`button small ${['cancelled', 'rejected'].includes(action) ? 'danger' : 'secondary'}`}
                          type="button"
                          disabled={busy || disabled}
                          title={disabled ? 'A booking cannot be completed before its scheduled date.' : undefined}
                          onClick={() => openAction(booking, action)}
                        >{label}</button>
                      ))}
                    </div></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>Showing {bookings.length ? ((pagination.page - 1) * pagination.pageSize) + 1 : 0}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}</span>
        <div>
          <button className="icon-button" disabled={pagination.page <= 1 || loading} onClick={() => loadBookings(pagination.page - 1)} aria-label="Previous page"><ChevronLeft size={18}/></button>
          <span>Page {pagination.page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span>
          <button className="icon-button" disabled={pagination.page * pagination.pageSize >= pagination.total || loading} onClick={() => loadBookings(pagination.page + 1)} aria-label="Next page"><ChevronRight size={18}/></button>
        </div>
      </div>

      {modal?.kind === 'details' && (
        <Modal title={`Booking ${modal.booking.reference}`} onClose={() => setModal(null)}>
          {!detail ? <div className="loading"><span className="spinner"/>Loading details…</div> : (
            <div className="admin-booking-detail">
              <h3>Booking details</h3>
              <p><strong>Customer:</strong> {detail.customer_name} · {detail.customer_email}</p>
              <p><strong>Vendor:</strong> {detail.vendor_name} · {detail.vendor_email}</p>
              <p><strong>Event:</strong> {detail.event_title} · {detail.event_type || '—'}</p>
              <p><strong>Service:</strong> {detail.service_title || detail.service_description} · {detail.category_name || '—'}</p>
              <p><strong>Scheduled:</strong> {formatDate(detail.scheduled_date || detail.event_start_date)}</p>
              <p><strong>Price:</strong> {detail.currency} {Number(detail.quoted_amount).toLocaleString()}</p>
              <p><strong>Status:</strong> {detail.status} · <strong>Payment:</strong> {detail.payment_status}</p>
              <h3>Payments and refunds</h3>
              {detail.payments?.length ? detail.payments.map((payment) => (
                <p key={payment.id}>#{payment.id} · {payment.currency} {payment.amount} · {payment.status} · {payment.provider || 'No provider'} · {payment.provider_reference || 'No provider reference'}{payment.verified_at ? ` · Verified ${formatDate(payment.verified_at)}` : ''}</p>
              )) : <p>No payment records.</p>}
              <h3>Refunds</h3>
              {detail.refunds?.length ? detail.refunds.map((refund) => (
                <p key={refund.id}>#{refund.id} · Payment #{refund.payment_id} · {refund.currency} {refund.amount} · {refund.status} · {refund.reason}{refund.provider_refund_reference ? ` · ${refund.provider_refund_reference}` : ''}</p>
              )) : <p>No refund records.</p>}
              <h3>Booking history</h3>
              {detail.history?.length ? detail.history.map((entry) => (
                <p key={entry.id}>{formatDate(entry.created_at)} · {entry.from_status || 'Created'} → {entry.to_status || entry.action}{entry.reason ? ` · ${entry.reason}` : ''}</p>
              )) : <p>No history recorded.</p>}
            </div>
          )}
          <div className="modal-foot"><button className="button secondary" type="button" onClick={() => setModal(null)}>Close</button></div>
        </Modal>
      )}
      {modal && modal.kind !== 'details' && (
        <Modal title={actionTitle} onClose={() => !busy && setModal(null)} footer={
          <>
            <button className="button secondary" type="button" disabled={busy} onClick={() => setModal(null)}>Keep booking</button>
            <button className="button" type="submit" form="admin-booking-action" disabled={busy}>
              {busy ? 'Saving…' : modal.kind === 'reschedule' ? 'Reschedule booking' : `Confirm ${modal.kind}`}
            </button>
          </>
        }>
          <form id="admin-booking-action" onSubmit={submitAction}>
            <p>{modal.booking.reference} · {modal.booking.event_title}</p>
            {modal.kind === 'reschedule' && <label className="field"><span>New scheduled date and time</span><input type="datetime-local" required value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)}/></label>}
            {modal.kind === 'reschedule' && <p className="muted">Rescheduling is permitted only for bookings allowed by the booking policy and vendor availability.</p>}
            {['cancelled', 'rejected'].includes(modal.kind) && <p>This action preserves the booking and payment history.</p>}
            <label className="field"><span>{reasonRequired ? 'Reason (required)' : 'Reason (optional)'}</span><textarea required={reasonRequired} minLength={reasonRequired ? 5 : undefined} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
          </form>
        </Modal>
      )}
    </section>
  );
}
