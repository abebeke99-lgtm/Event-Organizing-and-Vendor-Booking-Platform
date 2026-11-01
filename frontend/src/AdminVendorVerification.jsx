import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Building2, Clock3, Download, FileText, Search, ShieldAlert, UserRound } from 'lucide-react';
import apiClient from './api/axios.js';
import './adminVendorVerification.css';

const pageSize = 12;
const statusTabs = [
  { key: '', label: 'All applications' },
  { key: 'pending', label: 'Pending' },
  { key: 'under_review', label: 'Under Review' },
  { key: 'information_requested', label: 'Information Requested' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'suspended', label: 'Suspended' },
];

function statusLabel(status = '') {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatSize(size) {
  if (!Number.isFinite(Number(size))) return '—';
  return `${Math.max(1, Math.round(Number(size) / 1024))} KB`;
}

function availableActions(status) {
  if (status === 'pending') return [['under_review', 'Start review']];
  if (status === 'under_review') return [
    ['verified', 'Approve application'],
    ['information_requested', 'Request information'],
    ['rejected', 'Reject application'],
  ];
  if (status === 'verified') return [['suspended', 'Suspend vendor']];
  if (status === 'suspended') return [['verified', 'Reinstate vendor']];
  if (status === 'information_requested') return [['under_review', 'Resume review']];
  return [];
}

export default function AdminVendorVerification() {
  const focusId = new URLSearchParams(window.location.search).get('focus');
  const [applications, setApplications] = useState([]);
  const [counts, setCounts] = useState({});
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState(/^\d+$/.test(focusId || '') ? focusId : '');
  const [search, setSearch] = useState(/^\d+$/.test(focusId || '') ? focusId : '');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');

  const loadApplications = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/admin/vendor-verification', {
        params: { page, pageSize, ...(status ? { status } : {}), ...(search ? { q: search } : {}) },
      });
      setApplications(response.data.data);
      setCounts(response.data.counts || {});
      setPagination(response.data.pagination);
      setSelectedId((current) => (
        response.data.data.some((item) => String(item.id) === String(current))
          ? current
          : response.data.data[0]?.id ?? null
      ));
    } catch (issue) {
      setError(issue.message || 'Vendor applications could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/admin/vendor-verification/${id}`);
      setDetail(response.data.data);
    } catch (issue) {
      setError(issue.message || 'Vendor application details could not be loaded.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApplications(1);
  }, [loadApplications]);

  useEffect(() => {
    loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const selectedApplication = useMemo(
    () => applications.find((item) => String(item.id) === String(selectedId)),
    [applications, selectedId],
  );

  function submitSearch(event) {
    event.preventDefault();
    setSearch(query.trim());
  }

  function beginAction(nextStatus, label) {
    setAction({ status: nextStatus, label });
    setReason('');
  }

  async function submitAction(event) {
    event.preventDefault();
    if (!action || reason.trim().length < 5) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.patch(`/admin/vendor-verification/${selectedId}/status`, {
        status: action.status,
        reason: reason.trim(),
      });
      setAction(null);
      await loadApplications(pagination.page);
      await loadDetail(selectedId);
    } catch (issue) {
      setError(issue.message || 'The verification action could not be completed.');
    } finally {
      setSaving(false);
    }
  }

  async function downloadDocument(document) {
    setError('');
    try {
      const response = await apiClient.get(
        `/admin/vendor-verification/${selectedId}/documents/${document.id}`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(response.data);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = document.original_name;
      anchor.rel = 'noopener';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (issue) {
      setError(issue.message || 'The private verification document could not be accessed.');
    }
  }

  return (
    <div className="av-page">
      <header className="av-heading">
        <div>
          <p className="eyebrow">VENDOR ONBOARDING</p>
          <h2>Vendor Verification</h2>
          <p className="muted">Review vendor information and documents before approving access.</p>
        </div>
        <span className="av-total"><Building2 size={16}/>{pagination.total} applications</span>
      </header>

      {error && <div className="alert error" role="alert">{error}<button className="dismiss" type="button" onClick={() => setError('')}>Dismiss</button></div>}

      <div className="av-tabs" role="tablist" aria-label="Filter vendor applications">
        {statusTabs.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={status === tab.key}
            className={status === tab.key ? 'active' : ''}
            key={tab.key || 'all'}
            onClick={() => setStatus(tab.key)}
          >
            {tab.label}<span>{tab.key ? Number(counts[tab.key] || 0) : Object.values(counts).reduce((sum, item) => sum + Number(item || 0), 0)}</span>
          </button>
        ))}
      </div>

      <form className="av-search panel" onSubmit={submitSearch}>
        <label className="av-search-field"><Search size={16}/><input aria-label="Search vendor applications" placeholder="Search business, owner, email, phone, or application ID" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
        <button className="button" type="submit">Search</button>
      </form>

      <div className="av-layout">
        <section className="panel av-list-panel" aria-label="Vendor applications">
          <div className="av-list-heading"><strong>{status ? statusLabel(status) : 'All'} applications</strong><span>{pagination.total} results</span></div>
          {loading ? <div className="av-loading"><span className="spinner"/>Loading vendor applications…</div>
            : applications.length ? <div className="av-list">
              {applications.map((application) => (
                <button
                  type="button"
                  className={`av-list-item ${String(selectedId) === String(application.id) ? 'selected' : ''}`}
                  key={application.id}
                  onClick={() => setSelectedId(application.id)}
                >
                  <span className="av-avatar"><Building2 size={16}/></span>
                  <span className="av-item-copy">
                    <strong>{application.business_name}</strong>
                    <small>{application.owner_name} · #{application.id}</small>
                    <small>{application.category_name || 'No category'} · {formatDate(application.created_at)}</small>
                  </span>
                  <span className={`av-status ${application.verification_status}`}>{statusLabel(application.verification_status)}</span>
                </button>
              ))}
            </div> : <div className="av-empty">No vendor applications match this filter.</div>}
          {!loading && pagination.totalPages > 1 && <div className="av-pagination">
            <button type="button" className="button secondary" disabled={pagination.page <= 1} onClick={() => loadApplications(pagination.page - 1)}>Previous</button>
            <span>Page {pagination.page} of {pagination.totalPages}</span>
            <button type="button" className="button secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => loadApplications(pagination.page + 1)}>Next</button>
          </div>}
        </section>

        <section className="panel av-detail-panel" aria-label="Selected vendor details">
          {detailLoading ? <div className="av-loading"><span className="spinner"/>Loading application details…</div>
            : detail ? <>
              <div className="av-detail-heading">
                <div><p className="eyebrow">APPLICATION #{detail.id}</p><h3>{detail.business_name}</h3><span className={`av-status ${detail.verification_status}`}>{statusLabel(detail.verification_status)}</span></div>
                {detail.verification_status === 'suspended' && <ShieldAlert className="av-warning" size={20}/>}
              </div>
              {detail.verification_reason && <p className="av-reason"><strong>Latest review note:</strong> {detail.verification_reason}</p>}

              <div className="av-info-grid">
                <div><UserRound size={15}/><span><strong>Owner</strong><small>{detail.owner_name}</small></span></div>
                <div><span className="av-info-icon">@</span><span><strong>Email</strong><small>{detail.email}</small></span></div>
                <div><span className="av-info-icon">#</span><span><strong>Phone</strong><small>{detail.phone || 'Not provided'}</small></span></div>
                <div><Building2 size={15}/><span><strong>Category</strong><small>{detail.category_name || 'Not selected'}</small></span></div>
                <div><span className="av-info-icon">⌖</span><span><strong>Service area</strong><small>{detail.city || 'Not provided'}</small></span></div>
                <div><Clock3 size={15}/><span><strong>Submitted</strong><small>{formatDate(detail.created_at)}</small></span></div>
              </div>

              <section className="av-subsection"><h4>Business information</h4><p>{detail.description || 'No business description provided.'}</p></section>

              <section className="av-subsection">
                <h4><FileText size={16}/> Verification documents <span>{detail.documents.length}</span></h4>
                {detail.documents.length ? <div className="av-documents">{detail.documents.map((document) => (
                  <article key={document.id}><FileText size={17}/><span><strong>{document.original_name}</strong><small>{document.content_type} · {formatSize(document.file_size)} · {formatDate(document.created_at)}</small></span><button type="button" className="av-icon-button" aria-label={`Download ${document.original_name}`} onClick={() => downloadDocument(document)}><Download size={16}/></button></article>
                ))}</div> : <p>No verification documents have been submitted.</p>}
              </section>

              <section className="av-subsection">
                <h4><Clock3 size={16}/> Verification history</h4>
                {detail.history.length ? <ol className="av-history">{detail.history.map((entry) => (
                  <li key={entry.id}><span className="av-history-mark"/><div><strong>{entry.from_status ? `${statusLabel(entry.from_status)} → ` : ''}{statusLabel(entry.to_status)}</strong><small>{entry.reason}</small><small>{entry.actor_name || 'Vendor'} · {formatDate(entry.created_at)}</small></div></li>
                ))}</ol> : <p>No verification history is available.</p>}
              </section>

              {availableActions(detail.verification_status).length > 0 && <div className="av-actions">
                {availableActions(detail.verification_status).map(([nextStatus, label]) => (
                  <button
                    type="button"
                    className={`button ${['rejected', 'suspended'].includes(nextStatus) ? 'danger' : nextStatus === 'under_review' ? 'secondary' : ''}`}
                    key={nextStatus}
                    onClick={() => beginAction(nextStatus, label)}
                  >{nextStatus === 'verified' ? <BadgeCheck size={15}/> : null}{label}</button>
                ))}
              </div>}
            </> : <div className="av-empty">Select an application to review.</div>}
        </section>
      </div>

      {action && <div className="av-modal-backdrop" role="presentation">
        <form className="av-action-dialog panel" role="dialog" aria-modal="true" aria-labelledby="av-action-title" onSubmit={submitAction}>
          <p className="eyebrow">CONFIRM VERIFICATION ACTION</p>
          <h3 id="av-action-title">{action.label}</h3>
          <p>This action will update the vendor’s account, create an audit record, and notify the vendor.</p>
          <label className="field"><span>Required reason</span><textarea rows="4" minLength="5" maxLength="1000" required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record the checks performed and the basis for this decision."/></label>
          <div className="av-dialog-actions"><button type="button" className="button secondary" disabled={saving} onClick={() => setAction(null)}>Cancel</button><button type="submit" className="button" disabled={saving || reason.trim().length < 5}>{saving ? 'Saving…' : 'Confirm action'}</button></div>
        </form>
      </div>}
    </div>
  );
}
