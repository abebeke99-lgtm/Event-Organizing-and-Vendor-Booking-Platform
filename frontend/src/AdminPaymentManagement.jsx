import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, Eye, X } from 'lucide-react';
import apiClient from './api/axios.js';
import './adminPaymentManagement.css';

const initialPagination = { page: 1, pageSize: 20, total: 0 };
const paymentStatuses = [
  'pending', 'authorized', 'successful', 'failed', 'cancelled',
  'refunded', 'partially_refunded', 'refund_pending',
];
const refundStatuses = ['pending', 'processing', 'succeeded', 'failed', 'rejected'];

function errorText(error) {
  return error.response?.data?.error || error.message || 'The request could not be completed.';
}

function formatAmount(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency || ''}`.trim();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || ''}`.trim();
  }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function statusLabel(status) {
  return ({
    successful: 'Successful',
    paid: 'Successful',
    partially_refunded: 'Partially refunded',
    refund_pending: 'Refund pending',
    succeeded: 'Succeeded',
  })[status] || String(status || 'Unknown')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Modal({ title, children, onClose, footer }) {
  return (
    <div className="overlay admin-payment-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal admin-payment-modal" role="dialog" aria-modal="true" aria-label={title}>
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

export default function AdminPaymentManagement() {
  const focusId = new URLSearchParams(window.location.search).get('focus');
  const focusQuery = /^\d+$/.test(focusId || '') ? focusId : '';
  const openedFocus = useRef('');
  const [tab, setTab] = useState('payments');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(initialPagination);
  const [queryInput, setQueryInput] = useState(focusQuery);
  const [query, setQuery] = useState(focusQuery);
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [integrationConfigured, setIntegrationConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = {
        page,
        pageSize: pagination.pageSize,
        ...(query ? { q: query } : {}),
        ...(status ? { status } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
      };
      const response = await apiClient.get(tab === 'payments' ? '/admin/payments' : '/admin/refunds', { params });
      setRows(response.data.data || []);
      setPagination(response.data.pagination || initialPagination);
      setIntegrationConfigured(Boolean(response.data.integration?.configured));
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, pagination.pageSize, query, status, tab]);

  useEffect(() => { void load(1); }, [load]);

  async function exportReport(reportTab = tab) {
    setBusy(true);
    setError('');
    try {
      const response = await apiClient.get(
        reportTab === 'payments' ? '/admin/payments/export' : '/admin/refunds/export',
        {
          params: {
            ...(query ? { q: query } : {}),
            ...(status ? { status } : {}),
            ...(dateFrom ? { dateFrom } : {}),
            ...(dateTo ? { dateTo } : {}),
          },
          responseType: 'blob',
        },
      );
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = reportTab === 'payments' ? 'payment-report.csv' : 'refund-report.csv';
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

  async function openDetails(paymentId) {
    setDetail(null);
    setError('');
    setModal({ kind: 'details', id: paymentId });
    try {
      const response = await apiClient.get(`/admin/payments/${paymentId}`);
      setDetail(response.data.data);
    } catch (issue) {
      setError(errorText(issue));
    }

    useEffect(() => {
      if (!focusId || tab !== 'payments' || loading || openedFocus.current === focusId) return;
      const payment = rows.find((row) => Number(row.id) === Number(focusId));
      if (payment) {
        openedFocus.current = focusId;
        openDetails(payment.id);
      }
    }, [focusId, loading, rows, tab]);
  }

  async function decideRefund(decision, refundRow = modal?.row) {
    if (!refundRow || (decision === 'rejected' && reason.trim().length < 5)) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiClient.patch(`/admin/refunds/${refundRow.id}/decision`, {
        decision,
        ...(decision === 'rejected' ? { reason: reason.trim() } : {}),
      });
      setNotice(response.data.data.status === 'processing'
        ? 'Refund approved and submitted; it is not marked successful until the provider confirms.'
        : `Refund request ${response.data.data.status}.`);
      setModal(null);
      setReason('');
      await load(pagination.page);
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setBusy(false);
    }
  }

  const statuses = tab === 'payments' ? paymentStatuses : refundStatuses;

  return (
    <section className="admin-payment-management">
      <div className="page-heading">
        <div>
          <p className="eyebrow">System control</p>
          <h2>Payment and Refund Management</h2>
          <p className="muted">Review real transaction records, refund decisions, and immutable financial history.</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void exportReport()} disabled={busy}>
          <Download size={16}/> Export {tab === 'payments' ? 'payment' : 'refund'} report
        </button>
      </div>

      {!integrationConfigured && (
        <div className="alert warning" role="status">
          Payment integration pending. Transactions are read-only and remain unverified until a payment provider with verified webhooks is configured. Refund approvals are unavailable; rejection decisions remain available.
        </div>
      )}
      {notice && <div className="alert success" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}

      <div className="admin-payment-tabs" role="tablist" aria-label="Financial records">
        <button type="button" role="tab" aria-selected={tab === 'payments'} className={tab === 'payments' ? 'active' : ''} onClick={() => { setTab('payments'); setStatus(''); }}>
          Payments
        </button>
        <button type="button" role="tab" aria-selected={tab === 'refunds'} className={tab === 'refunds' ? 'active' : ''} onClick={() => { setTab('refunds'); setStatus(''); }}>
          Refund requests
        </button>
      </div>

      <form className="admin-payment-filters" onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()); }}>
        <label className="admin-payment-search">
          <span className="sr-only">Search transactions or customers</span>
          <input value={queryInput} maxLength={120} onChange={(event) => setQueryInput(event.target.value)} placeholder="Search ID, booking, customer, provider, reference"/>
          <button className="button" type="submit">Search</button>
        </label>
        <label><span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </label>
        <label><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/></label>
        <label><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)}/></label>
        <span className="admin-payment-count">{pagination.total} records</span>
      </form>

      <div className="table-wrap">
        <table>
          {tab === 'payments' ? (
            <>
              <thead><tr><th>Transaction</th><th>Booking / event</th><th>Customer</th><th>Amount</th><th>Method / provider</th><th>Reference</th><th>Status</th><th>Created</th><th>History</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan="9">Loading payment transactions…</td></tr> : rows.length === 0 ? <tr><td colSpan="9">No payment transactions found.</td></tr> : rows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>#{row.id}</strong></td>
                    <td><strong>{row.booking_reference}</strong><small>{row.event_title || '—'}</small></td>
                    <td>{row.customer_name}<small>{row.customer_email}</small></td>
                    <td>{formatAmount(row.amount, row.currency)}{Number(row.refunded_amount) > 0 && <small>Refunded {formatAmount(row.refunded_amount, row.currency)}</small>}</td>
                    <td>{row.payment_method || 'Not recorded'}<small>{row.provider || 'Provider pending'}</small></td>
                    <td>{row.provider_reference || 'Not verified'}</td>
                    <td><span className={`admin-payment-status status-${row.status}`}>{statusLabel(row.status)}</span></td>
                    <td>{formatDate(row.created_at)}</td>
                    <td><button className="icon-button" type="button" onClick={() => void openDetails(row.id)} aria-label={`View transaction ${row.id} history`}><Eye size={17}/></button></td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <thead><tr><th>Refund</th><th>Transaction / booking</th><th>Customer</th><th>Amount</th><th>Reason</th><th>Status</th><th>Requested</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan="8">Loading refund requests…</td></tr> : rows.length === 0 ? <tr><td colSpan="8">No refund requests found.</td></tr> : rows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>#{row.id}</strong></td>
                    <td><strong>Payment #{row.payment_id}</strong><small>{row.booking_reference} · {row.provider_reference || 'No provider reference'}</small></td>
                    <td>{row.customer_name}<small>{row.customer_email}</small></td>
                    <td>{formatAmount(row.amount, row.currency)}</td>
                    <td className="admin-payment-reason">{row.reason}</td>
                    <td><span className={`admin-payment-status status-${row.status}`}>{statusLabel(row.status)}</span>{row.decision_reason && <small>{row.decision_reason}</small>}</td>
                    <td>{formatDate(row.created_at)}</td>
                    <td>
                      <div className="admin-payment-actions">
                        {row.status === 'pending' && (
                          <>
                            <button className="button small" type="button" disabled={busy || !integrationConfigured} onClick={() => { setReason(''); setModal({ kind: 'approve', row }); }} title={!integrationConfigured ? 'Configure a verified provider first' : 'Approve refund'}>
                              <Check size={14}/> Approve
                            </button>
                            <button className="button secondary small" type="button" disabled={busy} onClick={() => { setReason(''); setModal({ kind: 'reject', row }); }}>Reject</button>
                          </>
                        )}
                        {row.status === 'processing' && integrationConfigured && (
                          <button className="button secondary small" type="button" disabled={busy} onClick={() => void decideRefund('approved', row)}>Reconcile</button>
                        )}
                        <button className="icon-button" type="button" onClick={() => void openDetails(row.payment_id)} aria-label={`View refund ${row.id} history`}><Eye size={16}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>

      <div className="pagination">
        <span>Showing {rows.length ? ((pagination.page - 1) * pagination.pageSize) + 1 : 0}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}</span>
        <div>
          <button className="icon-button" type="button" disabled={pagination.page <= 1 || loading} onClick={() => void load(pagination.page - 1)} aria-label="Previous financial records page"><ChevronLeft size={18}/></button>
          <span>Page {pagination.page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span>
          <button className="icon-button" type="button" disabled={pagination.page * pagination.pageSize >= pagination.total || loading} onClick={() => void load(pagination.page + 1)} aria-label="Next financial records page"><ChevronRight size={18}/></button>
        </div>
      </div>

      {modal?.kind === 'details' && (
        <Modal title={`Financial history — payment #${modal.id}`} onClose={() => setModal(null)} footer={<button className="button secondary" type="button" onClick={() => setModal(null)}>Close</button>}>
          {!detail ? <p>Loading transaction history…</p> : (
            <div className="admin-payment-history">
              <h3>Transaction</h3>
              <p>{detail.payment.booking_reference} · {detail.payment.event_title}</p>
              <p>{formatAmount(detail.payment.amount, detail.payment.currency)} · {statusLabel(detail.payment.status)}</p>
              <p>Method: {detail.payment.payment_method || 'Not recorded'} · Provider: {detail.payment.provider || 'Not configured'}</p>
              <h3>Refunds</h3>
              {detail.refunds.length ? detail.refunds.map((refund) => <article key={refund.id}><strong>Refund #{refund.id} · {statusLabel(refund.status)}</strong><span>{formatAmount(refund.amount, refund.currency)} · {refund.reason}</span>{refund.decision_reason && <span>Decision: {refund.decision_reason}</span>}</article>) : <p>No refund requests.</p>}
              <h3>Immutable history</h3>
              {detail.history.length ? detail.history.map((entry) => <article key={entry.id}><strong>{statusLabel(entry.action)}</strong><span>{formatDate(entry.created_at)} · {entry.actor_name || (entry.actor_id ? `Actor #${entry.actor_id}` : 'Provider')}</span><span>{entry.from_status || '—'} → {entry.to_status || '—'}</span></article>) : <p>No history events recorded.</p>}
            </div>
          )}
        </Modal>
      )}

      {(modal?.kind === 'approve' || modal?.kind === 'reject') && (
        <Modal
          title={modal.kind === 'approve' ? `Approve refund #${modal.row.id}?` : `Reject refund #${modal.row.id}`}
          onClose={() => setModal(null)}
          footer={(
            <>
              <button className="button secondary" type="button" onClick={() => setModal(null)}>Cancel</button>
              <button className={`button ${modal.kind === 'reject' ? 'danger' : ''}`} type="button" disabled={busy || (modal.kind === 'reject' && reason.trim().length < 5)} onClick={() => void decideRefund(modal.kind === 'approve' ? 'approved' : 'rejected')}>
                {busy ? 'Saving…' : modal.kind === 'approve' ? 'Approve and submit' : 'Reject request'}
              </button>
            </>
          )}
        >
          <p><strong>{formatAmount(modal.row.amount, modal.row.currency)}</strong> requested against payment #{modal.row.payment_id}.</p>
          <p className="muted">The refund is not successful until the provider confirms it. Approval is unavailable without an enabled provider adapter.</p>
          {modal.kind === 'reject' && <label className="field"><span>Rejection reason (required)</span><textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>}
        </Modal>
      )}
    </section>
  );
}
