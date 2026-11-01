import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, ChevronLeft, ChevronRight, Clock3, ExternalLink, Mail, Megaphone, RotateCw } from 'lucide-react';
import apiClient from './api/axios.js';
import './adminNotifications.css';

const initialPagination = { page: 1, pageSize: 20, total: 0 };
const initialAnnouncement = { title: '', message: '', channel: 'in_app' };

function errorText(error) {
  return error.response?.data?.error || error.message || 'The request could not be completed.';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function Modal({ title, children, onClose, footer }) {
  return (
    <div className="overlay admin-notifications-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal admin-notifications-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </section>
    </div>
  );
}

export default function AdminNotifications() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(initialPagination);
  const [unreadCount, setUnreadCount] = useState(0);
  const [channels, setChannels] = useState(['in_app']);
  const [filters, setFilters] = useState({ q: '', type: '', read: '', dateFrom: '', dateTo: '' });
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState(initialAnnouncement);
  const [announcementKey, setAnnouncementKey] = useState('');
  const [history, setHistory] = useState(null);
  const [modal, setModal] = useState('');

  const loadNotifications = useCallback(async (page = pagination.page) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/admin/notifications', {
        params: {
          page,
          pageSize: pagination.pageSize,
          sortBy,
          sortDirection,
          ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')),
        },
      });
      setRows(response.data.data || []);
      setPagination(response.data.pagination || initialPagination);
      setUnreadCount(Number(response.data.unreadCount || 0));
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setLoading(false);
    }
  }, [filters, pagination.page, pagination.pageSize, sortBy, sortDirection]);

  useEffect(() => { loadNotifications(1); }, [filters, sortBy, sortDirection]);

  useEffect(() => {
    let active = true;
    apiClient.get('/admin/notifications/options')
      .then((response) => { if (active) setChannels(response.data.data.channels || ['in_app']); })
      .catch((issue) => { if (active) setError(errorText(issue)); });
    return () => { active = false; };
  }, []);

  async function markRead(row) {
    if (row.read) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/admin/notifications/${row.id}/read`);
      await loadNotifications(pagination.page);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    setBusy(true);
    setError('');
    try {
      await apiClient.post('/admin/notifications/read-all');
      setNotice('All notifications have been marked as read.');
      await loadNotifications(pagination.page);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(row) {
    setHistory(null);
    setModal('history');
    setError('');
    try {
      const response = await apiClient.get(`/admin/notifications/${row.id}/history`);
      setHistory(response.data.data || []);
    } catch (issue) {
      setError(errorText(issue));
    }
  }

  async function retryDelivery(row) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiClient.post(`/admin/notifications/${row.id}/retry`);
      setNotice('The email provider confirmed delivery.');
      await loadNotifications(pagination.page);
    } catch (issue) {
      const message = errorText(issue);
      await loadNotifications(pagination.page);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function updateAnnouncement(field, value) {
    setAnnouncement((current) => ({ ...current, [field]: value }));
    setAnnouncementKey('');
  }

  async function submitAnnouncement(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const key = announcementKey || globalThis.crypto.randomUUID();
      setAnnouncementKey(key);
      const response = await apiClient.post('/admin/notifications/announcements', {
        ...announcement,
        idempotencyKey: key,
      });
      const outcomes = response.data.data.deliveries || [];
      const failed = outcomes.filter((entry) => entry.deliveryStatus === 'failed').length;
      setNotice(failed
        ? `Announcement created. ${failed} email delivery${failed === 1 ? '' : 'ies'} failed and can be retried.`
        : 'Announcement created and delivered to administrator inboxes.');
      setAnnouncement(initialAnnouncement);
      setAnnouncementKey('');
      setModal('');
      await loadNotifications(1);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
    setPagination((current) => ({ ...current, page: 1 }));
  }

  const pageCount = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));

  return (
    <section className="page admin-notifications">
      <div className="page-heading admin-notifications-heading">
        <div>
          <h1>Notifications</h1>
          <p>Administrator inbox, delivery history, and system announcements.</p>
        </div>
        <div className="admin-notifications-heading-actions">
          <span className="admin-notifications-unread"><Bell size={16}/> {unreadCount} unread</span>
          <button className="button secondary" type="button" disabled={busy || unreadCount === 0} onClick={markAllRead}>
            <Check size={16}/> Mark all read
          </button>
          <button className="button" type="button" onClick={() => { setError(''); setModal('announcement'); }}>
            <Megaphone size={16}/> New announcement
          </button>
        </div>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert success" role="status">{notice}</div>}

      <form className="admin-notifications-filters" onSubmit={(event) => event.preventDefault()}>
        <label className="admin-notifications-search">
          <span>Search</span>
          <input value={filters.q} maxLength="120" onChange={(event) => updateFilter('q', event.target.value)} placeholder="Title or message" />
        </label>
        <label>
          <span>Type</span>
          <select value={filters.type} onChange={(event) => updateFilter('type', event.target.value)}>
            <option value="">All types</option>
            {['system', 'announcement', 'user_registration', 'vendor_verification', 'booking', 'event', 'vendor', 'complaint', 'payment', 'review'].map((type) => (
              <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Read status</span>
          <select value={filters.read} onChange={(event) => updateFilter('read', event.target.value)}>
            <option value="">All</option>
            <option value="false">Unread</option>
            <option value="true">Read</option>
          </select>
        </label>
        <label>
          <span>From</span>
          <input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} />
        </label>
        <label>
          <span>Sort by</span>
          <select value={`${sortBy}:${sortDirection}`} onChange={(event) => {
            const [nextSort, nextDirection] = event.target.value.split(':');
            setSortBy(nextSort);
            setSortDirection(nextDirection);
          }}>
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="title:asc">Title A–Z</option>
            <option value="delivery_status:asc">Delivery status</option>
          </select>
        </label>
      </form>

      <div className="admin-notifications-list" aria-live="polite">
        {loading ? <div className="admin-notifications-empty">Loading notifications…</div>
          : rows.length === 0 ? <div className="admin-notifications-empty">No notifications match these filters.</div>
            : rows.map((row) => (
              <article className={`admin-notification-card ${row.read ? '' : 'unread'}`} key={row.id}>
                <div className="admin-notification-icon">{row.delivery_channel === 'email' ? <Mail size={18}/> : <Bell size={18}/>}</div>
                <div className="admin-notification-content">
                  <div className="admin-notification-title-row">
                    <h2>{row.title}</h2>
                    {!row.read && <span className="admin-notification-unread-dot" aria-label="Unread"/>}
                  </div>
                  <p>{row.message}</p>
                  <div className="admin-notification-meta">
                    <span>{row.notification_type?.replaceAll('_', ' ') || 'system'}</span>
                    <span><Clock3 size={13}/> {formatDate(row.created_at)}</span>
                    <span className={`delivery-${row.delivery_status}`}>{row.delivery_channel === 'email' ? 'Email' : 'In-app'}: {row.delivery_status?.replaceAll('_', ' ')}</span>
                    {row.delivery_attempts > 0 && <span>{row.delivery_attempts} attempt{row.delivery_attempts === 1 ? '' : 's'}</span>}
                  </div>
                  {row.last_delivery_error && <small className="admin-notification-delivery-error">Last delivery error: {row.last_delivery_error}</small>}
                </div>
                <div className="admin-notification-actions">
                  {row.relatedUrl && <a className="button secondary small" href={row.relatedUrl}>Open record <ExternalLink size={14}/></a>}
                  {!row.read && <button className="button secondary small" type="button" disabled={busy} onClick={() => markRead(row)}>Mark read</button>}
                  <button className="button secondary small" type="button" disabled={busy} onClick={() => openHistory(row)}>History</button>
                  {row.delivery_channel === 'email' && row.delivery_status === 'failed'
                    && <button className="button secondary small" type="button" disabled={busy} onClick={() => retryDelivery(row)}><RotateCw size={14}/> Retry</button>}
                </div>
              </article>
            ))}
      </div>

      <div className="admin-notifications-pagination">
        <span>{pagination.total} notification{pagination.total === 1 ? '' : 's'} · Page {pagination.page} of {pageCount}</span>
        <div>
          <button className="button secondary small" type="button" disabled={loading || pagination.page <= 1} onClick={() => loadNotifications(pagination.page - 1)}><ChevronLeft size={16}/> Previous</button>
          <button className="button secondary small" type="button" disabled={loading || pagination.page >= pageCount} onClick={() => loadNotifications(pagination.page + 1)}>Next <ChevronRight size={16}/></button>
        </div>
      </div>

      {modal === 'announcement' && (
        <Modal title="Create system announcement" onClose={() => !busy && setModal('')} footer={(
          <>
            <button className="button secondary" type="button" disabled={busy} onClick={() => setModal('')}>Cancel</button>
            <button className="button" type="submit" form="admin-announcement-form" disabled={busy}>{busy ? 'Sending…' : 'Send announcement'}</button>
          </>
        )}>
          <form id="admin-announcement-form" className="admin-notification-form" onSubmit={submitAnnouncement}>
            {error && <div className="alert error" role="alert">{error}</div>}
            <label><span>Title</span><input required minLength="3" maxLength="180" value={announcement.title} onChange={(event) => updateAnnouncement('title', event.target.value)} /></label>
            <label><span>Message</span><textarea required minLength="3" maxLength="5000" rows="6" value={announcement.message} onChange={(event) => updateAnnouncement('message', event.target.value)} /></label>
            <label><span>Channel</span>
              <select value={announcement.channel} onChange={(event) => updateAnnouncement('channel', event.target.value)}>
                {channels.map((channel) => <option key={channel} value={channel}>{channel === 'in_app' ? 'Administrator inbox' : 'Email'}</option>)}
              </select>
            </label>
            {announcement.channel === 'email' && <p className="admin-notification-email-note">Email delivery will be marked successful only after the configured provider accepts it.</p>}
          </form>
        </Modal>
      )}

      {modal === 'history' && (
        <Modal title="Notification history" onClose={() => setModal('')}>
          {!history ? <p>Loading history…</p> : history.length === 0
            ? <p>No recorded actions for this notification.</p>
            : <ol className="admin-notification-history">
              {history.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.action.replaceAll('_', ' ')}</strong>
                  <span>{entry.actor_name || 'System'} · {formatDate(entry.created_at)}</span>
                  {entry.details && <small>{typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)}</small>}
                </li>
              ))}
            </ol>}
        </Modal>
      )}
    </section>
  );
}
