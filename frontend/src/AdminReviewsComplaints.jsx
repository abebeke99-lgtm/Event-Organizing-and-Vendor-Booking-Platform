import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Eye, X } from 'lucide-react';
import apiClient from './api/axios.js';
import './adminReviewsComplaints.css';

const pageDefaults = { page: 1, pageSize: 20, total: 0 };
const reviewStatuses = ['published', 'hidden', 'flagged'];
const complaintStatuses = ['open', 'under_review', 'resolved', 'closed'];

function errorText(error) {
  return error.response?.data?.error || error.message || 'The request could not be completed.';
}

function displayDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function historyDetails(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function Modal({ title, children, onClose, footer }) {
  return (
    <div className="overlay admin-review-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal admin-review-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}><X size={18}/></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </section>
    </div>
  );
}

export default function AdminReviewsComplaints({ kind }) {
  const isReview = kind === 'reviews';
  const focusId = new URLSearchParams(window.location.search).get('focus');
  const focusQuery = /^\d+$/.test(focusId || '')
    ? `${isReview ? 'RV' : 'CMP'}-${String(focusId).padStart(6, '0')}`
    : '';
  const openedFocus = useRef('');
  const title = isReview ? 'Reviews Management' : 'Complaints Management';
  const endpoint = isReview ? '/admin/reviews' : '/admin/complaints';
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(pageDefaults);
  const [vendors, setVendors] = useState([]);
  const [services, setServices] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [searchInput, setSearchInput] = useState(focusQuery);
  const [filters, setFilters] = useState({ q: focusQuery, status: '', rating: '', vendorId: '', serviceId: '', dateFrom: '', dateTo: '' });
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reason, setReason] = useState('');
  const [complaintForm, setComplaintForm] = useState({ status: '', resolution: '', assignedTo: '' });

  const loadRows = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(endpoint, {
        params: {
          page,
          pageSize: pagination.pageSize,
          sortBy,
          sortDirection,
          ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')),
        },
      });
      setRows(response.data.data);
      setPagination(response.data.pagination);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setLoading(false);
    }
  }, [endpoint, filters, pagination.pageSize, sortBy, sortDirection]);

  useEffect(() => { loadRows(1); }, [loadRows]);

  useEffect(() => {
    let active = true;
    if (isReview) {
      Promise.all([
        apiClient.get('/admin/reviews/vendors'),
        apiClient.get('/admin/reviews/services'),
      ]).then(([vendorResponse, serviceResponse]) => {
        if (!active) return;
        setVendors(vendorResponse.data.data);
        setServices(serviceResponse.data.data);
      }).catch((issue) => { if (active) setError(errorText(issue)); });
    } else {
      apiClient.get('/admin/complaints/assignees')
        .then((response) => { if (active) setAssignees(response.data.data); })
        .catch((issue) => { if (active) setError(errorText(issue)); });
    }
    return () => { active = false; };
  }, [isReview]);

  useEffect(() => {
    if (!isReview) return;
    let active = true;
    apiClient.get('/admin/reviews/services', { params: filters.vendorId ? { vendorId: filters.vendorId } : {} })
      .then((response) => { if (active) setServices(response.data.data); })
      .catch((issue) => { if (active) setError(errorText(issue)); });
    return () => { active = false; };
  }, [filters.vendorId, isReview]);

  async function openDetails(row) {
    setError('');
    setReason('');
    setDetail(null);
    setModal({ kind: 'details', row });
    try {
      const response = await apiClient.get(`${endpoint}/${row.id}`);
      setDetail(response.data.data);
      if (!isReview) {
        setComplaintForm({
          status: response.data.data.status,
          resolution: response.data.data.resolution || '',
          assignedTo: response.data.data.assigned_to ? String(response.data.data.assigned_to) : '',
        });
      }

      useEffect(() => {
        if (!focusId || loading || openedFocus.current === focusId) return;
        const row = rows.find((entry) => Number(entry.id) === Number(focusId));
        if (row) {
          openedFocus.current = focusId;
          openDetails(row);
        }
      }, [focusId, loading, rows]);
    } catch (issue) {
      setError(errorText(issue));
    }
  }

  function applyFilters(event) {
    event.preventDefault();
    setFilters((current) => ({ ...current, q: searchInput.trim() }));
  }

  async function submitReviewModeration(event) {
    event.preventDefault();
    if (!modal) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.patch(`/admin/reviews/${modal.row.id}/moderation`, { status: modal.status, reason });
      setNotice(`Review ${modal.status === 'hidden' ? 'hidden' : 'restored'}; the original rating and text were preserved.`);
      setModal(null);
      setDetail(null);
      await loadRows(pagination.page);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }

  async function submitComplaintUpdate(event) {
    event.preventDefault();
    if (!modal) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.patch(`/admin/complaints/${modal.row.id}`, {
        status: complaintForm.status,
        resolution: complaintForm.resolution,
        assignedTo: complaintForm.assignedTo ? Number(complaintForm.assignedTo) : null,
        reason,
      });
      setNotice(`Complaint CMP-${String(modal.row.id).padStart(6, '0')} updated; timeline and audit history were recorded.`);
      setModal(null);
      setDetail(null);
      await loadRows(pagination.page);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }

  async function downloadAttachment(attachment) {
    setError('');
    try {
      const response = await apiClient.get(
        `/admin/complaints/${detail.id}/attachments/${attachment.id}`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.original_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (issue) {
      setError(errorText(issue));
    }
  }

  function sort(field) {
    if (sortBy === field) setSortDirection((value) => value === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(field);
      setSortDirection('asc');
    }
  }

  function openModeration(row, status) {
    setReason('');
    setModal({ kind: 'moderate', row, status });
  }

  const statusOptions = isReview ? reviewStatuses : complaintStatuses;

  return (
    <section className="admin-reviews-complaints">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Platform operations</p>
          <h2>{title}</h2>
          <p className="muted">{isReview
            ? 'Moderate visibility without changing customer ratings or original review text.'
            : 'Review sensitive customer reports, assign authorized staff, and preserve a complete timeline.'}</p>
        </div>
      </div>
      {notice && <div className="alert success" role="status">{notice}<button className="dismiss" onClick={() => setNotice('')}>Dismiss</button></div>}
      {error && <div className="alert error" role="alert">{error}<button className="dismiss" onClick={() => setError('')}>Dismiss</button></div>}
      <form className="admin-rc-filters" onSubmit={applyFilters}>
        <label className="admin-rc-search">Search
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={isReview ? 'Review, customer, vendor, service, booking' : 'Reference, customer, vendor, booking, subject'}/>
        </label>
        <button className="button secondary" type="submit">Search</button>
        <label>Status
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">All statuses</option>
            {statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        {isReview && <>
          <label>Rating
            <select value={filters.rating} onChange={(event) => setFilters((current) => ({ ...current, rating: event.target.value }))}>
              <option value="">All ratings</option>
              {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} stars</option>)}
            </select>
          </label>
          <label>Vendor
            <select value={filters.vendorId} onChange={(event) => setFilters((current) => ({ ...current, vendorId: event.target.value, serviceId: '' }))}>
              <option value="">All vendors</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.business_name}</option>)}
            </select>
          </label>
          <label>Service
            <select value={filters.serviceId} onChange={(event) => setFilters((current) => ({ ...current, serviceId: event.target.value }))}>
              <option value="">All services</option>
              {services.map((service) => <option key={service.id} value={service.id}>{service.title}</option>)}
            </select>
          </label>
        </>}
        <label>From <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}/></label>
        <label>To <input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}/></label>
        <label>Sort
          <select value={`${sortBy}:${sortDirection}`} onChange={(event) => {
            const [field, direction] = event.target.value.split(':');
            setSortBy(field); setSortDirection(direction);
          }}>
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            {isReview && <><option value="rating:desc">Highest rating</option><option value="rating:asc">Lowest rating</option><option value="vendor_name:asc">Vendor A–Z</option></>}
            {!isReview && <><option value="status:asc">Status A–Z</option><option value="subject:asc">Subject A–Z</option></>}
          </select>
        </label>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            {isReview ? <tr>
              <th><button onClick={() => sort('created_at')}>Review</button></th>
              <th><button onClick={() => sort('rating')}>Rating</button></th>
              <th>Customer</th><th><button onClick={() => sort('vendor_name')}>Vendor / Service</button></th>
              <th>Booking / Event</th><th>Status</th><th>Actions</th>
            </tr> : <tr>
              <th><button onClick={() => sort('created_at')}>Reference / Date</button></th>
              <th>Customer</th><th>Vendor / Booking</th><th>Complaint</th>
              <th><button onClick={() => sort('status')}>Status</button></th>
              <th>Assigned staff</th><th>Attachments</th><th>Actions</th>
            </tr>}
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={isReview ? 7 : 8}><div className="loading"><span className="spinner"/>Loading {isReview ? 'reviews' : 'complaints'}…</div></td></tr>
              : !rows.length ? <tr><td colSpan={isReview ? 7 : 8}><div className="empty"><strong>No {isReview ? 'reviews' : 'complaints'} found</strong><span>Adjust your search or filters.</span></div></td></tr>
                : rows.map((row) => isReview ? (
                  <tr key={row.id}>
                    <td>RV-{String(row.id).padStart(6, '0')}<small>{displayDate(row.created_at)}</small><p className="admin-rc-comment">{row.comment || 'No written comment'}</p></td>
                    <td><span className="admin-rc-rating" aria-label={`${row.rating} out of 5 stars`}>{'★'.repeat(Number(row.rating))}{'☆'.repeat(5 - Number(row.rating))}</span><small>{row.rating}/5</small></td>
                    <td>{row.customer_name}<small>{row.customer_email}</small></td>
                    <td>{row.vendor_name}<small>{row.service_title || 'Service not available'}</small></td>
                    <td>BK-{String(row.booking_id).padStart(6, '0')}<small>{row.event_title}</small></td>
                    <td><span className={`pill ${row.status}`}>{row.status}</span></td>
                    <td><div className="admin-rc-actions">
                      <button className="icon-button" type="button" aria-label="View review history" onClick={() => openDetails(row)}><Eye size={16}/></button>
                      {row.status === 'hidden'
                        ? <button className="button secondary small" onClick={() => openModeration(row, 'published')}>Restore</button>
                        : <button className="button danger small" onClick={() => openModeration(row, 'hidden')}>Hide</button>}
                    </div></td>
                  </tr>
                ) : (
                  <tr key={row.id}>
                    <td>CMP-{String(row.id).padStart(6, '0')}<small>{displayDate(row.created_at)}</small></td>
                    <td>{row.customer_name}<small>{row.customer_email}</small></td>
                    <td>{row.vendor_name || 'Not linked'}<small>{row.booking_id ? `BK-${String(row.booking_id).padStart(6, '0')}` : 'No booking linked'}</small></td>
                    <td><strong>{row.subject}</strong><p className="admin-rc-comment">{row.details}</p></td>
                    <td><span className={`pill ${row.status}`}>{row.status.replaceAll('_', ' ')}</span></td>
                    <td>{row.assignee_name || 'Unassigned'}</td>
                    <td>{Number(row.attachment_count || 0)}</td>
                    <td><button className="button secondary small" onClick={() => openDetails(row)}>Review</button></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>Showing {rows.length ? ((pagination.page - 1) * pagination.pageSize) + 1 : 0}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}</span>
        <div>
          <button className="icon-button" aria-label="Previous page" disabled={pagination.page <= 1 || loading} onClick={() => loadRows(pagination.page - 1)}><ChevronLeft size={18}/></button>
          <span>Page {pagination.page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span>
          <button className="icon-button" aria-label="Next page" disabled={pagination.page * pagination.pageSize >= pagination.total || loading} onClick={() => loadRows(pagination.page + 1)}><ChevronRight size={18}/></button>
        </div>
      </div>

      {modal?.kind === 'details' && (
        <Modal title={isReview ? `Review RV-${String(modal.row.id).padStart(6, '0')}` : `Complaint CMP-${String(modal.row.id).padStart(6, '0')}`} onClose={() => setModal(null)} footer={
          isReview ? <button className="button secondary" type="button" onClick={() => setModal(null)}>Close</button> : <>
            <button className="button secondary" type="button" disabled={busy} onClick={() => setModal(null)}>Close</button>
            <button className="button" type="submit" form="admin-complaint-update" disabled={busy}>{busy ? 'Saving…' : 'Save update'}</button>
          </>
        }>
          {!detail ? <div className="loading"><span className="spinner"/>Loading secure record…</div> : isReview ? (
            <div className="admin-rc-detail">
              <p><strong>Customer:</strong> {detail.customer_name} · {detail.customer_email}</p>
              <p><strong>Vendor / service:</strong> {detail.vendor_name} · {detail.service_title || 'Unavailable'}</p>
              <p><strong>Booking:</strong> BK-{String(detail.booking_id).padStart(6, '0')} · {detail.event_title}</p>
              <p><strong>Rating:</strong> {detail.rating}/5 · <strong>Status:</strong> {detail.status}</p>
              <blockquote>{detail.comment || 'No written comment.'}</blockquote>
              <h3>Moderation history</h3>
              {detail.history?.length ? detail.history.map((entry) => (
                <p key={entry.id}>{displayDate(entry.created_at)} · {entry.actor_name || 'Customer/system'} · {entry.from_status || 'Created'} → {entry.to_status || entry.action}{entry.reason ? ` · ${entry.reason}` : ''}</p>
              )) : <p>No moderation history.</p>}
            </div>
          ) : (
            <div className="admin-rc-detail">
              <p><strong>From:</strong> {detail.customer_name} · {detail.customer_email}</p>
              <p><strong>Vendor:</strong> {detail.vendor_name || 'Not linked'}{detail.booking_id ? ` · BK-${String(detail.booking_id).padStart(6, '0')}` : ''}</p>
              <p><strong>Submitted:</strong> {displayDate(detail.created_at)}</p>
              <p><strong>Subject:</strong> {detail.subject}</p>
              <blockquote>{detail.details}</blockquote>
              <h3>Supporting attachments</h3>
              {detail.attachments?.length ? detail.attachments.map((file) => (
                <button className="admin-rc-attachment" type="button" key={file.id} onClick={() => downloadAttachment(file)}>
                  <Download size={15}/>{file.original_name} · {(Number(file.file_size) / 1024).toFixed(0)} KB
                </button>
              )) : <p>No supporting attachments.</p>}
              <h3>Complaint timeline</h3>
              {detail.history?.length ? detail.history.map((entry) => {
                const changes = historyDetails(entry.details);
                return (
                  <p key={entry.id}>
                    {displayDate(entry.created_at)} · {entry.actor_name || 'Customer/system'} · {entry.action.replaceAll('_', ' ')}: {entry.from_status || 'Created'} → {entry.to_status || entry.action}
                    {entry.reason ? ` · ${entry.reason}` : ''}
                    {changes.resolutionChanged && changes.resolution ? ` · Resolution: ${changes.resolution}` : ''}
                    {changes.assignedTo && Number(changes.assignedTo) !== Number(changes.previousAssignee)
                      ? ` · Assigned staff ID: ${changes.assignedTo}` : ''}
                  </p>
                );
              }) : <p>No timeline entries.</p>}
              <form id="admin-complaint-update" className="admin-rc-update" onSubmit={submitComplaintUpdate}>
                <label>Status
                  <select value={complaintForm.status} onChange={(event) => setComplaintForm((current) => ({ ...current, status: event.target.value }))}>
                    {complaintStatuses.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
                  </select>
                </label>
                <label>Assign to administrator
                  <select value={complaintForm.assignedTo} onChange={(event) => setComplaintForm((current) => ({ ...current, assignedTo: event.target.value }))}>
                    <option value="">Unassigned</option>
                    {assignees.map((person) => <option key={person.id} value={person.id}>{person.full_name} · {person.email}</option>)}
                  </select>
                </label>
                <label>Resolution notes
                  <textarea maxLength={1000} value={complaintForm.resolution} onChange={(event) => setComplaintForm((current) => ({ ...current, resolution: event.target.value }))}/>
                </label>
                <label>Update reason (required)
                  <textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/>
                </label>
              </form>
            </div>
          )}
        </Modal>
      )}
      {modal?.kind === 'moderate' && (
        <Modal title={`${modal.status === 'hidden' ? 'Hide' : 'Restore'} review`} onClose={() => !busy && setModal(null)} footer={
          <>
            <button className="button secondary" type="button" disabled={busy} onClick={() => setModal(null)}>Cancel</button>
            <button className="button" type="submit" form="admin-review-moderation" disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button>
          </>
        }>
          <p>Only review visibility changes. The customer’s original rating and text are preserved.</p>
          <form id="admin-review-moderation" onSubmit={submitReviewModeration}>
            <label className="field"><span>Moderation reason (required)</span><textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
          </form>
        </Modal>
      )}
    </section>
  );
}
