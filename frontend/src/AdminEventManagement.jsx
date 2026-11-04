import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Eye, MapPin, Pencil, Plus, Search, Star, X } from 'lucide-react';
import apiClient from './api/axios.js';
import './adminEventManagement.css';

const initialPagination = { page: 1, pageSize: 20, total: 0 };
const eventStatuses = [
  ['draft', 'Draft'],
  ['pending_approval', 'Pending approval'],
  ['published', 'Published'],
  ['booked', 'Booked'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['rejected', 'Rejected'],
  ['cancelled', 'Cancelled'],
  ['upcoming', 'Upcoming'],
  ['open', 'Open'],
];

const blankForm = () => ({
  organizer_id: '',
  title: '',
  event_type: '',
  description: '',
  city: '',
  venue: '',
  cover_image_url: '',
  gallery_images: '',
  start_date: '',
  end_date: '',
  budget: '',
  guest_count: '',
  capacity: '',
  notes: '',
});

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function statusName(value) {
  if (value === 'published' || value === 'active') return 'Published';
  if (value === 'upcoming' || value === 'open') return value[0].toUpperCase() + value.slice(1);
  return eventStatuses.find(([status]) => status === value)?.[1] || value?.replaceAll('_', ' ') || 'Unknown';
}

function errorText(error) {
  return error.response?.data?.error || error.message || 'The request could not be completed.';
}

function eventFormValues(event) {
  return Object.fromEntries(Object.keys(blankForm()).map((key) => [
    key,
    key === 'gallery_images'
      ? galleryImages(event[key]).join('\n')
      : event[key] === null || event[key] === undefined ? '' : String(event[key]),
  ]));
}

function galleryImages(value) {
  if (Array.isArray(value)) return value.filter((image) => typeof image === 'string');
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((image) => typeof image === 'string') : [];
  } catch {
    return [];
  }
}

function Field({ label, name, value, onChange, required = false, type = 'text', options, rows, min, maxLength }) {
  return (
    <label className="field">
      <span>{label}</span>
      {options ? (
        <select required={required} value={value ?? ''} onChange={(event) => onChange(name, event.target.value)}>
          <option value="">Choose {label.toLowerCase()}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : rows ? (
        <textarea rows={rows} maxLength={maxLength} value={value ?? ''} onChange={(event) => onChange(name, event.target.value)} />
      ) : (
        <input
          required={required}
          type={type}
          min={min}
          maxLength={maxLength}
          value={value ?? ''}
          onChange={(event) => onChange(name, event.target.value)}
        />
      )}
    </label>
  );
}

function Modal({ title, children, onClose, footer }) {
  return (
    <div className="overlay admin-event-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal admin-event-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </section>
    </div>
  );
}

export default function AdminEventManagement() {
  const focusId = new URLSearchParams(window.location.search).get('focus');
  const focusQuery = /^\d+$/.test(focusId || '') ? focusId : '';
  const openedFocus = useRef('');
  const [events, setEvents] = useState([]);
  const [pagination, setPagination] = useState(initialPagination);
  const [organizers, setOrganizers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [queryInput, setQueryInput] = useState(focusQuery);
  const [query, setQuery] = useState(focusQuery);
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(blankForm);

  const loadEvents = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/admin/events', {
        params: {
          page,
          pageSize: pagination.pageSize,
          ...(query ? { q: query } : {}),
          ...(status ? { status } : {}),
        },
      });
      setEvents(response.data.data);
      setPagination(response.data.pagination);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, query, status]);

  useEffect(() => {
    loadEvents(1);
  }, [loadEvents]);

  useEffect(() => {
    let active = true;
    apiClient.get('/admin/events/options').then((response) => {
      if (!active) return;
      setOrganizers(response.data.data.organizers);
      setCategories(response.data.data.categories);
    }).catch((issue) => {
      if (active) setError(errorText(issue));
    });
    return () => { active = false; };
  }, []);

  const eventCategoryOptions = categories.map((category) => ({ value: category.name, label: category.name }));
  if (form.event_type && !eventCategoryOptions.some((category) => category.value === form.event_type)) {
    eventCategoryOptions.push({ value: form.event_type, label: `${form.event_type} (existing)` });
  }
  const editFields = [
    ...(modal?.kind === 'create' ? [{
      name: 'organizer_id',
      label: 'Organizer / customer',
      options: organizers.map((person) => ({
        value: String(person.id),
        label: `${person.full_name} · ${person.email}`,
      })),
      required: true,
    }] : []),
    {
      name: 'event_type',
      label: 'Category',
      options: eventCategoryOptions,
      required: true,
    },
    { name: 'title', label: 'Event name', required: true, maxLength: 180 },
    { name: 'description', label: 'Description', rows: 4, maxLength: 10000 },
    { name: 'city', label: 'City', maxLength: 120 },
    { name: 'venue', label: 'Venue / location', maxLength: 180 },
    { name: 'cover_image_url', label: 'Cover image URL', type: 'url', maxLength: 1000 },
    { name: 'gallery_images', label: 'Gallery image URLs (one per line)', rows: 3 },
    { name: 'start_date', label: 'Start date and time', type: 'datetime-local', required: true },
    { name: 'end_date', label: 'End date and time', type: 'datetime-local', min: form.start_date },
    { name: 'budget', label: 'Budget', type: 'number', min: 0 },
    { name: 'guest_count', label: 'Guest count', type: 'number', min: 1 },
    { name: 'capacity', label: 'Ticket capacity', type: 'number', min: 1 },
    { name: 'notes', label: 'Administrative notes', rows: 3, maxLength: 2000 },
  ];

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function openCreate() {
    setForm(blankForm());
    setModal({ kind: 'create' });
    setError('');
    setNotice('');
  }

  function openEdit(event) {
    setForm(eventFormValues(event));
    setModal({ kind: 'edit', event });
    setError('');
    setNotice('');
  }

  async function submitEvent(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        ...form,
        gallery_images: form.gallery_images.split(/\r?\n/).map((image) => image.trim()).filter(Boolean),
        ...(form.budget === '' ? { budget: null } : { budget: Number(form.budget) }),
        ...(form.capacity === '' ? { capacity: null } : { capacity: Number(form.capacity) }),
        ...(form.guest_count === '' ? { guest_count: null } : { guest_count: Number(form.guest_count) }),
      };
      if (modal.kind === 'edit') delete body.organizer_id;
      if (modal.kind === 'create') {
        await apiClient.post('/admin/events', body);
        setNotice('Event created as a draft.');
      } else {
        await apiClient.patch(`/admin/events/${modal.event.id}`, body);
        setNotice('Event information updated.');
      }
      setModal(null);
      await loadEvents(pagination.page);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setSaving(false);
    }
  }

  async function runAction() {
    if (saving || !modal?.event) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.patch(`/admin/events/${modal.event.id}/status`, {
        action: modal.action,
        ...(modal.reason ? { reason: modal.reason.trim() } : {}),
      });
      const completedActions = {
        approve: 'approved and published',
        reject: 'rejected',
        publish: 'published',
        unpublish: 'unpublished',
        cancel: 'cancelled',
        complete: 'marked completed',
      };
      setNotice(`Event ${completedActions[modal.action]}.`);
      setModal(null);
      await loadEvents(pagination.page);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setSaving(false);
    }
  }

  async function toggleFeatured(event) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.patch(`/admin/events/${event.id}`, { is_featured: !event.is_featured });
      setNotice(event.is_featured ? 'Event removed from featured listings.' : 'Event added to featured listings.');
      await loadEvents(pagination.page);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setSaving(false);
    }
  }

  async function openDetails(event) {
    setSaving(true);
    setError('');
    try {
      const response = await apiClient.get(`/admin/events/${event.id}`);
      setModal({ kind: 'details', detail: response.data.data });
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setSaving(false);
    }

    useEffect(() => {
      if (!focusId || loading || openedFocus.current === focusId) return;
      const event = events.find((row) => Number(row.id) === Number(focusId));
      if (event) {
        openedFocus.current = focusId;
        openDetails(event);
      }
    }, [events, focusId, loading]);
  }

  function openAction(action, event) {
    setModal({ kind: 'action', action, event, reason: '' });
    setError('');
    setNotice('');
  }

  function availableActions(event) {
    const statusValue = event.status === 'published' ? 'active' : event.status;
    const actions = [];
    if (statusValue === 'pending_approval') actions.push(['approve', 'Approve'], ['reject', 'Reject']);
    if (['draft', 'rejected'].includes(statusValue)) actions.push(['publish', 'Publish']);
    if (['active', 'booked', 'upcoming', 'open'].includes(statusValue)) actions.push(['unpublish', 'Unpublish']);
    if (!['cancelled', 'completed'].includes(statusValue)) actions.push(['cancel', 'Cancel']);
    const eventEnd = new Date(String(event.end_date || event.start_date).replace(' ', 'T')).getTime();
    if (!['cancelled', 'completed'].includes(statusValue) && eventEnd <= Date.now()) actions.push(['complete', 'Complete']);
    return actions;
  }

  const actionDescription = {
    approve: 'Approve this event and make it publicly available?',
    reject: 'Reject this event? A reason is required and will be sent to its organizer.',
    publish: 'Publish this event so it can receive new bookings?',
    unpublish: 'Unpublish this event? Existing bookings and payment records will be preserved.',
    cancel: 'Cancel this event? Existing bookings and payment records will be preserved.',
    complete: 'Mark this event as completed?',
  };

  return (
    <section className="admin-event-management">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Platform management</p>
          <h2>Event Management</h2>
          <p className="muted">Search, review, and manage events, bookings, vendors, and status history.</p>
        </div>
        <button className="button" type="button" onClick={openCreate}><Plus size={16} /> Create event</button>
      </div>
      {notice && <div className="alert success" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}<button className="dismiss" type="button" onClick={() => setError('')}>Dismiss</button></div>}

      <div className="admin-event-toolbar">
        <form className="search-box" onSubmit={(event) => {
          event.preventDefault();
          setQuery(queryInput.trim());
        }}>
          <Search size={17} />
          <input
            aria-label="Search events"
            placeholder="Search name, ID, organizer, customer, location, category…"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <select className="filter-select" aria-label="Filter by event status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {eventStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span className="result-count">{pagination.total} events</span>
      </div>

      <div className="admin-event-list">
        {loading ? (
          <div className="panel admin-event-empty"><div className="loading"><span className="spinner" />Loading events…</div></div>
        ) : events.length === 0 ? (
          <div className="panel admin-event-empty"><CalendarDays size={28} /><strong>No events found</strong><span>Try another search or status filter.</span></div>
        ) : events.map((event) => (
          <article className="panel admin-event-card" key={event.id}>
            {event.cover_image_url
              ? <img className="admin-event-cover" src={event.cover_image_url} alt="" loading="lazy" />
              : <div className="admin-event-cover admin-event-cover-placeholder"><CalendarDays size={24} /></div>}
            <div className="admin-event-card-main">
              <div className="admin-event-card-heading">
                <div>
                  <span className="admin-event-category">{event.event_type || 'Uncategorized'}</span>
                  <h3>{event.title}</h3>
                  <p className="muted">Event #{event.id} · Organized by {event.organizer_name}</p>
                </div>
                <span className={`pill ${event.status}`}>{statusName(event.status)}</span>
              </div>
              <p className="admin-event-description">{event.description || 'No description provided.'}</p>
              <div className="admin-event-meta">
                <span><Clock3 size={14} />{formatDate(event.start_date)}</span>
                <span><MapPin size={14} />{[event.venue, event.city].filter(Boolean).join(', ') || 'Location not set'}</span>
                <span>{event.booking_count} booking{Number(event.booking_count) === 1 ? '' : 's'}</span>
                <span>{event.vendor_names || 'No vendors booked'}</span>
              </div>
              {event.rejection_reason && <p className="admin-event-rejection"><strong>Rejection reason:</strong> {event.rejection_reason}</p>}
              <div className="admin-event-actions">
                <button className="text-action" type="button" disabled={saving} onClick={() => openDetails(event)}><Eye size={14} /> Details & history</button>
                <button className="text-action" type="button" disabled={saving} onClick={() => openEdit(event)}><Pencil size={14} /> Edit</button>
                <button className="text-action" type="button" disabled={saving} aria-pressed={Boolean(event.is_featured)} onClick={() => toggleFeatured(event)}>
                  <Star size={14} fill={event.is_featured ? 'currentColor' : 'none'} />{event.is_featured ? 'Unfeature' : 'Feature'}
                </button>
                {availableActions(event).map(([action, label]) => (
                  <button
                    key={action}
                    className={`text-action ${['reject', 'cancel'].includes(action) ? 'subtle-danger' : ''}`}
                    type="button"
                    disabled={saving}
                    onClick={() => openAction(action, event)}
                  >
                    {action === 'approve' && <Check size={14} />}{label}
                  </button>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="pagination">
        <span>Showing {events.length ? (pagination.page - 1) * pagination.pageSize + 1 : 0}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}</span>
        <div>
          <button className="icon-button" type="button" disabled={pagination.page <= 1 || loading} onClick={() => loadEvents(pagination.page - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button>
          <span>Page {pagination.page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span>
          <button className="icon-button" type="button" disabled={pagination.page * pagination.pageSize >= pagination.total || loading} onClick={() => loadEvents(pagination.page + 1)} aria-label="Next page"><ChevronRight size={18} /></button>
        </div>
      </div>

      {modal?.kind === 'create' || modal?.kind === 'edit' ? (
        <Modal
          title={modal.kind === 'create' ? 'Create event' : `Edit event #${modal.event.id}`}
          onClose={() => !saving && setModal(null)}
          footer={(
            <>
              <button className="button secondary" type="button" disabled={saving} onClick={() => setModal(null)}>Cancel</button>
              <button className="button" type="submit" form="admin-event-form" disabled={saving}>{saving ? 'Saving…' : 'Save event'}</button>
            </>
          )}
        >
          <form id="admin-event-form" className="admin-event-form" onSubmit={submitEvent}>
            {editFields.map((field) => (
              <Field
                key={field.name}
                {...field}
                value={form[field.name]}
                onChange={setField}
              />
            ))}
            {form.cover_image_url && <img className="admin-event-form-preview" src={form.cover_image_url} alt="Event cover preview" />}
            {modal.kind === 'create' && <p className="muted admin-event-form-note">New events are saved as drafts and must be explicitly published or approved.</p>}
          </form>
        </Modal>
      ) : null}

      {modal?.kind === 'action' && (
        <Modal
          title={`${modal.action[0].toUpperCase()}${modal.action.slice(1)} event #${modal.event.id}`}
          onClose={() => !saving && setModal(null)}
          footer={(
            <>
              <button className="button secondary" type="button" disabled={saving} onClick={() => setModal(null)}>Keep event</button>
              <button
                className={`button ${['reject', 'cancel'].includes(modal.action) ? 'danger' : ''}`}
                type="button"
                disabled={saving || ['reject', 'cancel'].includes(modal.action) && modal.reason.trim().length < 5}
                onClick={runAction}
              >
                {saving ? 'Saving…' : `Confirm ${modal.action}`}
              </button>
            </>
          )}
        >
          <p>{actionDescription[modal.action]}</p>
          {['reject', 'cancel', 'unpublish'].includes(modal.action) && (
            <label className="field">
              <span>{modal.action === 'unpublish' ? 'Reason (optional)' : 'Reason (required)'}</span>
              <textarea
                required={modal.action !== 'unpublish'}
                minLength={modal.action === 'unpublish' ? undefined : 5}
                maxLength={1000}
                rows={4}
                value={modal.reason}
                onChange={(event) => setModal((current) => ({ ...current, reason: event.target.value }))}
              />
            </label>
          )}
        </Modal>
      )}

      {modal?.kind === 'details' && (
        <Modal
          title={`${modal.detail.event.title} · Event #${modal.detail.event.id}`}
          onClose={() => setModal(null)}
          footer={<button className="button secondary" type="button" onClick={() => setModal(null)}>Close</button>}
        >
          <EventDetails detail={modal.detail} />
        </Modal>
      )}
    </section>
  );
}

function EventDetails({ detail }) {
  const { event, vendorBookings, ticketBookings, history } = detail;
  return (
    <div className="admin-event-details">
      {event.cover_image_url && <img className="admin-event-detail-cover" src={event.cover_image_url} alt={`Cover for ${event.title}`} />}
      {galleryImages(event.gallery_images).length > 0 && (
        <div className="admin-event-gallery" aria-label="Event gallery">
          {galleryImages(event.gallery_images).map((image, index) => <img key={`${image}-${index}`} src={image} alt={`${event.title} gallery ${index + 1}`} loading="lazy" />)}
        </div>
      )}
      <div className="admin-event-detail-grid">
        <div><span>Status</span><strong>{statusName(event.status)}</strong></div>
        <div><span>Category</span><strong>{event.event_type}</strong></div>
        <div><span>Organizer</span><strong>{event.organizer_name} · {event.organizer_email}</strong></div>
        <div><span>Location</span><strong>{[event.venue, event.city].filter(Boolean).join(', ') || 'Not set'}</strong></div>
        <div><span>Starts</span><strong>{formatDate(event.start_date)}</strong></div>
        <div><span>Ends</span><strong>{formatDate(event.end_date)}</strong></div>
        <div><span>Capacity / guests</span><strong>{event.capacity ?? '—'} / {event.guest_count ?? '—'}</strong></div>
      </div>
      <section><h3>Description</h3><p className="admin-event-detail-copy">{event.description || 'No description provided.'}</p></section>
      {event.rejection_reason && <section><h3>Rejection reason</h3><p>{event.rejection_reason}</p></section>}
      <section>
        <h3>Vendor bookings ({vendorBookings.length})</h3>
        {vendorBookings.length ? <div className="admin-event-related-list">{vendorBookings.map((booking) => (
          <article key={booking.id}>
            <div><strong>{booking.vendor_name}</strong><span>{booking.service_description} · {booking.category || 'Uncategorized'}</span></div>
            <span className={`pill ${booking.status}`}>{booking.status}</span>
            <strong>{booking.currency} {booking.quoted_amount}</strong>
          </article>
        ))}</div> : <p className="muted">No vendor bookings are associated with this event.</p>}
      </section>
      <section>
        <h3>Ticket bookings ({ticketBookings.length})</h3>
        {ticketBookings.length ? <div className="admin-event-related-list">{ticketBookings.map((booking) => (
          <article key={booking.id}>
            <div><strong>{booking.customer_name}</strong><span>{booking.ticket_name} · {booking.quantity} ticket{Number(booking.quantity) === 1 ? '' : 's'}</span></div>
            <span className={`pill ${booking.booking_status}`}>{booking.booking_status.replaceAll('_', ' ')}</span>
            <strong>{booking.total_amount} ({booking.payment_status})</strong>
          </article>
        ))}</div> : <p className="muted">No ticket bookings are associated with this event.</p>}
      </section>
      <section>
        <h3>Event history and administrative actions</h3>
        {history.length ? <ol className="admin-event-history">{history.map((item, index) => {
          let details = item.details;
          if (typeof details === 'string') {
            try { details = JSON.parse(details); } catch { details = {}; }
          }
          const description = item.reason
            || details?.reason
            || (details?.fields?.length ? `Updated: ${details.fields.join(', ')}` : '');
          return (
            <li key={`${item.source}-${item.id}-${index}`}>
              <span className="admin-event-history-dot" />
              <div>
                <strong>{item.action.replaceAll('.', ' ').replaceAll('_', ' ')}</strong>
                <span>{item.actor_name || 'System'} · {formatDate(item.created_at)}</span>
                {(item.from_status || item.to_status) && <span>{statusName(item.from_status)} → {statusName(item.to_status)}</span>}
                {description && <p>{description}</p>}
              </div>
            </li>
          );
        })}</ol> : <p className="muted">No history has been recorded for this event.</p>}
      </section>
    </div>
  );
}
