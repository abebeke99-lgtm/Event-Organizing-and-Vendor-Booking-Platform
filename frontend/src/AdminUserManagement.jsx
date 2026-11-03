import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Eye, EyeOff, KeyRound, Pencil, Plus, Search, Shield, UserRound, X } from 'lucide-react';
import apiClient from './api/axios.js';
import { translate, translateText } from './language.js';
import { generateSecurePassword, validateCreateUserForm } from './adminUserManagementUtils.js';
import './adminUserManagement.css';

const emptyForm = { full_name: '', email: '', phone: '', role_id: '', password: '', confirm_password: '', status: 'active' };
const statusOptions = ['active', 'suspended', 'pending'];
const initialPagination = { page: 1, pageSize: 20, total: 0 };

function displayDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function displayDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function statusLabel(status) {
  return translate(`adminUserStatus${status.charAt(0).toUpperCase()}${status.slice(1)}`);
}

function UserModal({ modal, roles, onClose, onSave, onChange, form, busy, errors }) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  if (!modal) return null;
  const isCreate = modal.type === 'create';
  const assignableRoles = isCreate
    ? roles.filter((role) => ['organizer', 'vendor'].includes(String(role.name).toLowerCase()))
    : roles;
  const t = (key) => translate(key);
  function showFieldError(field) {
    return errors[field] ? <small className="um-field-error" id={`um-error-${field}`} role="alert">{errors[field]}</small> : null;
  }
  function generateTemporaryPassword() {
    const password = generateSecurePassword();
    onChange('password', password);
    onChange('confirm_password', password);
    setPasswordVisible(true);
    setConfirmPasswordVisible(true);
  }
  return (
    <div className="um-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className={`um-modal${isCreate ? ' um-create-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="um-modal-title">
        <div className="um-modal-heading">
          <div>
            <p className="eyebrow">{t(isCreate ? 'adminUserCreateEyebrow' : 'adminUserEditEyebrow')}</p>
            <h3 id="um-modal-title">{t(isCreate ? 'adminUserCreateTitle' : 'adminUserEditTitle')}</h3>
          </div>
          <button type="button" className="um-icon-button" onClick={onClose} disabled={busy} aria-label={t('adminUserCloseDialog')}><X size={18}/></button>
        </div>
        <form className={`um-form${isCreate ? ' um-create-form' : ''}`} onSubmit={onSave} noValidate={isCreate}>
          <label className="field um-field">
            <span>{t('adminUserFullName')}</span>
            <input required maxLength={160} autoComplete="name" placeholder={t('adminUserFullNamePlaceholder')} value={form.full_name} onChange={(event) => onChange('full_name', event.target.value)} aria-invalid={Boolean(errors.full_name)} aria-describedby={errors.full_name ? 'um-error-full_name' : undefined}/>
            {showFieldError('full_name')}
          </label>
          <label className="field um-field">
            <span>{t('adminUserEmailAddress')}</span>
            <input required type="email" maxLength={254} autoComplete="email" placeholder={t('adminUserEmailPlaceholder')} value={form.email} onChange={(event) => onChange('email', event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'um-error-email' : undefined}/>
            {showFieldError('email')}
          </label>
          <label className="field um-field">
            <span>{t('adminUserPhoneNumber')}</span>
            <input type="tel" maxLength={40} autoComplete="tel" placeholder={t('adminUserPhonePlaceholder')} value={form.phone} onChange={(event) => onChange('phone', event.target.value)} aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'um-error-phone' : undefined}/>
            {showFieldError('phone')}
          </label>
          {isCreate && <>
            <div className="field um-field">
              <label htmlFor="um-initial-password">{t('adminUserInitialPassword')}</label>
              <span className="um-password-input">
                <input id="um-initial-password" required type={passwordVisible ? 'text' : 'password'} minLength={16} maxLength={128} autoComplete="new-password" placeholder={t('adminUserPasswordPlaceholder')} value={form.password} onChange={(event) => onChange('password', event.target.value)} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'um-error-password' : 'um-password-requirements'}/>
                <button type="button" className="um-password-toggle" onClick={() => setPasswordVisible((visible) => !visible)} aria-label={t(passwordVisible ? 'adminUserHidePassword' : 'adminUserShowPassword')} aria-pressed={passwordVisible} title={t(passwordVisible ? 'adminUserHidePassword' : 'adminUserShowPassword')}><span>{t(passwordVisible ? 'adminUserHidePassword' : 'adminUserShowPassword')}</span>{passwordVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
              </span>
              <span className="um-password-tools">
                <small id="um-password-requirements">{t('adminUserPasswordNotice')}</small>
                <button type="button" className="um-generate-password" onClick={generateTemporaryPassword} disabled={busy}><KeyRound size={14}/>{t('adminUserGeneratePassword')}</button>
              </span>
              {showFieldError('password')}
            </div>
            <div className="field um-field">
              <label htmlFor="um-confirm-password">{t('adminUserConfirmPassword')}</label>
              <span className="um-password-input">
                <input id="um-confirm-password" required type={confirmPasswordVisible ? 'text' : 'password'} minLength={16} maxLength={128} autoComplete="new-password" placeholder={t('adminUserConfirmPasswordPlaceholder')} value={form.confirm_password} onChange={(event) => onChange('confirm_password', event.target.value)} aria-invalid={Boolean(errors.confirm_password)} aria-describedby={errors.confirm_password ? 'um-error-confirm_password' : undefined}/>
                <button type="button" className="um-password-toggle" onClick={() => setConfirmPasswordVisible((visible) => !visible)} aria-label={t(confirmPasswordVisible ? 'adminUserHidePassword' : 'adminUserShowPassword')} aria-pressed={confirmPasswordVisible} title={t(confirmPasswordVisible ? 'adminUserHidePassword' : 'adminUserShowPassword')}><span>{t(confirmPasswordVisible ? 'adminUserHidePassword' : 'adminUserShowPassword')}</span>{confirmPasswordVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
              </span>
              {showFieldError('confirm_password')}
            </div>
            <label className="field um-field">
              <span>{t('adminUserAccountType')}</span>
              <select required value={form.role_id} onChange={(event) => onChange('role_id', event.target.value)} aria-invalid={Boolean(errors.role_id)} aria-describedby={errors.role_id ? 'um-error-role_id' : undefined}>
                <option value="">{t('adminUserChooseAccountType')}</option>
                {assignableRoles.map((role) => <option key={role.id} value={role.id}>{t(`adminUserRole${String(role.name).toLowerCase()}`)}</option>)}
              </select>
              {showFieldError('role_id')}
            </label>
            <label className="field um-field">
              <span>{t('adminUserAccountStatus')}</span>
              <select value={form.status} onChange={(event) => onChange('status', event.target.value)}><option value="active">{t('adminUserStatusActive')}</option><option value="suspended">{t('adminUserCreateStatusSuspended')}</option></select>
            </label>
          </>}
          <div className="um-modal-actions">
            <button type="button" className="button secondary" onClick={onClose} disabled={busy}>{t('adminUserCancel')}</button>
            <button type="submit" className="button" disabled={busy} aria-busy={busy}>{busy ? <><span className="um-spinner" aria-hidden="true"/>{t('adminUserSaving')}</> : isCreate ? t('adminUserCreateAccount') : t('adminUserSaveChanges')}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ActionModal({ modal, roles, form, busy, onClose, onChange, onSubmit }) {
  if (!modal) return null;
  const isStatus = modal.type === 'status';
  const title = isStatus ? (form.status === 'active' ? 'Activate account' : 'Change account status') : 'Change user role';
  return (
    <div className="um-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="um-modal" role="dialog" aria-modal="true" aria-labelledby="um-action-title">
        <div className="um-modal-heading">
          <div><p className="eyebrow">CONFIRM ACCOUNT CHANGE</p><h3 id="um-action-title">{title}</h3></div>
          <button type="button" className="um-icon-button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={18}/></button>
        </div>
        <form className="um-form" onSubmit={onSubmit}>
          {isStatus ? <>
            <label className="field"><span>{translate('adminUserAccountStatus')}</span><select value={form.status} onChange={(event) => onChange('status', event.target.value)}>{statusOptions.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}</select></label>
            <label className="field"><span>Reason for this change</span><textarea required minLength={3} maxLength={500} rows={3} value={form.reason} onChange={(event) => onChange('reason', event.target.value)}/></label>
          </> : <label className="field"><span>New role</span><select required value={form.role_id} onChange={(event) => onChange('role_id', event.target.value)}><option value="">Choose a role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>}
          <div className="um-modal-actions">
            <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="button" disabled={busy}>{busy ? 'Saving…' : 'Confirm change'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function UserDetails({ user, details, loading, error, onClose }) {
  if (!user) return null;
  const bookings = details?.bookings || [];
  const activity = details?.activity || [];
  return (
    <div className="um-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="um-modal um-details-modal" role="dialog" aria-modal="true" aria-labelledby="um-details-title">
        <div className="um-modal-heading">
          <div><p className="eyebrow">ACCOUNT OVERVIEW</p><h3 id="um-details-title">{user.full_name}</h3><span className="um-muted">User ID #{user.id}</span></div>
          <button type="button" className="um-icon-button" onClick={onClose} aria-label="Close details"><X size={18}/></button>
        </div>
        {loading ? <div className="um-loading">Loading account activity…</div> : error ? <div className="alert error">{error}</div> : <>
          <div className="um-detail-grid">
            <div><span>Email</span><strong>{user.email}</strong></div>
            <div><span>Phone</span><strong>{user.phone || '—'}</strong></div>
            <div><span>Role</span><strong>{user.roles || 'Unassigned'}</strong></div>
            <div><span>{translate('adminUserAccountStatus')}</span><strong><span className={`pill ${user.status}`}>{statusLabel(user.status)}</span></strong></div>
            <div><span>Registered</span><strong>{displayDateTime(user.created_at)}</strong></div>
          </div>
          <section className="um-detail-section">
            <h4>Booking history <span>{bookings.length}</span></h4>
            {bookings.length ? <div className="um-history-list">{bookings.map((booking) => <article key={booking.id}>
              <div><strong>{booking.event_title || booking.service_description || `Booking #${booking.id}`}</strong><span>{booking.vendor_name || booking.service_description || 'Vendor booking'}</span><small>{displayDateTime(booking.created_at)} · {booking.payment_count} payment record(s)</small></div>
              <div className="um-booking-value"><strong>{booking.currency} {Number(booking.quoted_amount || 0).toLocaleString()}</strong><span className={`pill ${booking.status}`}>{booking.status}</span></div>
            </article>)}</div> : <p className="um-empty">No booking records are associated with this account.</p>}
          </section>
          <section className="um-detail-section">
            <h4>Administrative activity <span>{activity.length}</span></h4>
            {activity.length ? <div className="um-activity-list">{activity.map((item) => <article key={item.id}><span className="um-activity-dot"/><div><strong>{item.action.replaceAll('.', ' ')}</strong><span>{item.entity_type}{item.entity_id ? ` #${item.entity_id}` : ''} · by user #{item.actor_id}</span><small>{displayDateTime(item.created_at)}</small></div></article>)}</div> : <p className="um-empty">No administrative activity is available.</p>}
          </section>
        </>}
      </section>
    </div>
  );
}

export default function AdminUserManagement() {
  const focusId = new URLSearchParams(window.location.search).get('focus');
  const openedFocus = useRef('');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [filterRoles, setFilterRoles] = useState([]);
  const [pagination, setPagination] = useState(initialPagination);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchInput, setSearchInput] = useState(/^\d+$/.test(focusId || '') ? focusId : '');
  const [filters, setFilters] = useState({ q: /^\d+$/.test(focusId || '') ? focusId : '', status: '', role: '', dateFrom: '', dateTo: '', sortBy: 'created_at', sortDirection: 'desc' });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [actionModal, setActionModal] = useState(null);
  const [actionForm, setActionForm] = useState({});
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetails, setUserDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const requestId = useRef(0);

  const loadUsers = useCallback(async (page, nextFilters, pageSize) => {
    const request = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const params = { page, pageSize, ...Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => value !== '')) };
      const response = await apiClient.get('/admin/users', { params });
      if (request !== requestId.current) return;
      setUsers(response.data.data);
      setPagination(response.data.pagination);
    } catch (issue) {
      if (request === requestId.current) setError(issue.message || 'Unable to load users.');
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers(pagination.page, filters, pagination.pageSize);
  }, [filters, loadUsers, pagination.page, pagination.pageSize]);

  useEffect(() => {
    if (!focusId || loading || openedFocus.current === focusId) return;
    const user = users.find((row) => Number(row.id) === Number(focusId));
    if (user) {
      openedFocus.current = focusId;
      openUserDetails(user);
    }
  }, [focusId, loading, users]);

  useEffect(() => {
    apiClient.get('/admin/roles', { params: { pageSize: 100 } })
      .then((response) => {
        const allRoles = response.data.data;
        setFilterRoles(allRoles);
        setRoles(allRoles.filter((role) => role.is_active && !role.is_admin));
      })
      .catch((issue) => setError((current) => current || issue.message || 'Unable to load available roles.'));
  }, []);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function updateActionForm(field, value) {
    setActionForm((current) => ({ ...current, [field]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();
    const next = { ...filters, q: searchInput.trim() };
    setFilters(next);
    setPagination((current) => ({ ...current, page: 1 }));
  }

  function changeFilter(field, value) {
    const next = { ...filters, [field]: value };
    setFilters(next);
    setPagination((current) => ({ ...current, page: 1 }));
  }

  function startCreate() {
    setForm(emptyForm);
    setFormErrors({});
    setModal({ type: 'create' });
  }

  function startEdit(user) {
    setForm({ ...emptyForm, full_name: user.full_name, email: user.email, phone: user.phone || '' });
    setFormErrors({});
    setModal({ type: 'edit', user });
  }

  async function saveUser(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    if (modal.type === 'create') {
      const validationErrors = validateCreateUserForm(form, translate);
      setFormErrors(validationErrors);
      if (Object.keys(validationErrors).length) return;
    }
    setBusy(true);
    try {
      if (modal.type === 'edit' && !window.confirm(translateText(`Save profile changes for ${modal.user.full_name}?`))) return;
      const payload = { ...form, phone: form.phone.trim() || null };
      if (modal.type === 'create') {
        if (payload.password !== payload.confirm_password) {
          setFormErrors({ confirm_password: translate('adminUserPasswordMismatch') });
          return;
        }
        delete payload.confirm_password;
        payload.role_id = Number(payload.role_id);
        await apiClient.post('/admin/users', payload);
        setNotice(translate('adminUserCreated'));
      } else {
        delete payload.password;
        delete payload.role_id;
        await apiClient.patch(`/admin/users/${modal.user.id}`, payload);
        setNotice('User details updated.');
      }
      setModal(null);
      await loadUsers(pagination.page, filters, pagination.pageSize);
    } catch (issue) {
      if (modal?.type === 'create' && issue.status === 409 && /email|ኢሜይል/i.test(issue.message || '')) {
        setFormErrors((current) => ({ ...current, email: issue.message }));
      } else if (modal?.type === 'create' && issue.status === 409 && /phone|ስልክ/i.test(issue.message || '')) {
        setFormErrors((current) => ({ ...current, phone: issue.message }));
      } else {
        setError(issue.message || 'The user could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  }

  function startStatusChange(user) {
    const status = user.status === 'active' ? 'suspended' : 'active';
    setActionForm({ status, reason: '' });
    setActionModal({ type: 'status', user });
  }

  function startRoleChange(user) {
    if (user.roles?.toLowerCase().includes('admin')) return;
    setActionForm({ role_id: user.role_id ? String(user.role_id) : '' });
    setActionModal({ type: 'role', user });
  }

  async function saveSensitiveChange(event) {
    event.preventDefault();
    if (!window.confirm(translateText(actionModal.type === 'status'
      ? `Confirm changing this account to ${actionForm.status}?`
      : 'Confirm changing this user’s role?'))) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (actionModal.type === 'status') {
        await apiClient.patch(`/admin/users/${actionModal.user.id}/status`, { status: actionForm.status, reason: actionForm.reason.trim() });
        setNotice(`Account status changed to ${actionForm.status}.`);
      } else {
        await apiClient.patch(`/admin/users/${actionModal.user.id}/role`, { role_id: Number(actionForm.role_id) });
        setNotice('User role updated; their active sessions were revoked.');
      }
      setActionModal(null);
      await loadUsers(pagination.page, filters, pagination.pageSize);
    } catch (issue) {
      setError(issue.message || 'The account change could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function initiatePasswordReset(user) {
    if (!window.confirm(translateText(`Send a password reset verification code to ${user.email}? The current password will not be disclosed.`))) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.post(`/admin/users/${user.id}/password-reset`, {});
      setNotice(response.data.message || 'Password reset was initiated.');
    } catch (issue) {
      setError(issue.message || 'Password reset could not be initiated.');
    } finally {
      setBusy(false);
    }
  }

  async function openUserDetails(user) {
    setSelectedUser(user);
    setUserDetails(null);
    setDetailsError('');
    setDetailsLoading(true);
    try {
      const [profile, activity] = await Promise.all([
        apiClient.get(`/admin/users/${user.id}`),
        apiClient.get(`/admin/users/${user.id}/activity`),
      ]);
      setSelectedUser(profile.data.data);
      setUserDetails(activity.data.data);
    } catch (issue) {
      setDetailsError(issue.message || 'Unable to load this user’s details.');
    } finally {
      setDetailsLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const firstItem = pagination.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const lastItem = Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <div className="um-page">
      <div className="page-heading">
        <div><p className="eyebrow">ADMINISTRATION</p><h2>User Management</h2><p className="muted">Search, review, and manage registered platform accounts.</p></div>
        <button type="button" className="button um-create-button" onClick={startCreate}><Plus size={16}/> Create user</button>
      </div>
      {error && <div className="alert error" role="alert">{error}<button className="dismiss" onClick={() => setError('')} aria-label="Dismiss error"><X size={15}/></button></div>}
      {notice && <div className="alert success" role="status">{notice}<button className="dismiss" onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={15}/></button></div>}
      <form className="um-filters panel" onSubmit={applyFilters}>
        <label className="um-search"><Search size={16}/><input aria-label="Search users" placeholder="Search name, email, phone, or ID" value={searchInput} onChange={(event) => setSearchInput(event.target.value)}/><button type="submit">Search</button></label>
        <label className="um-filter"><span>Role</span><select value={filters.role} onChange={(event) => changeFilter('role', event.target.value)}><option value="">All roles</option>{filterRoles.map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</select></label>
        <label className="um-filter"><span>{translate('adminUserStatusFilter')}</span><select value={filters.status} onChange={(event) => changeFilter('status', event.target.value)}><option value="">All statuses</option>{statusOptions.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}</select></label>
        <label className="um-filter"><span>Registered from</span><input type="date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(event) => changeFilter('dateFrom', event.target.value)}/></label>
        <label className="um-filter"><span>Registered to</span><input type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => changeFilter('dateTo', event.target.value)}/></label>
        <label className="um-filter"><span>Sort by</span><select value={`${filters.sortBy}:${filters.sortDirection}`} onChange={(event) => {
          const [sortBy, sortDirection] = event.target.value.split(':');
          const next = { ...filters, sortBy, sortDirection };
          setFilters(next);
          setPagination((current) => ({ ...current, page: 1 }));
        }}><option value="created_at:desc">Newest first</option><option value="created_at:asc">Oldest first</option><option value="full_name:asc">Name A–Z</option><option value="full_name:desc">Name Z–A</option><option value="email:asc">Email A–Z</option><option value="id:desc">ID newest</option></select></label>
      </form>
      <section className="um-table-panel panel" aria-busy={loading}>
        <div className="um-table-heading"><div><h3>Registered users</h3><p>{loading ? 'Updating user list…' : `${pagination.total.toLocaleString()} account${pagination.total === 1 ? '' : 's'} found`}</p></div><label className="um-page-size">Rows <select value={pagination.pageSize} onChange={(event) => {
          const pageSize = Number(event.target.value);
          setPagination((current) => ({ ...current, page: 1, pageSize }));
        }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
        {loading && users.length === 0 ? <div className="um-loading"><span className="um-spinner"/>Loading registered users…</div> : users.length === 0 && !loading ? <div className="um-empty-state"><UserRound size={28}/><strong>No users found</strong><span>Try changing your search or filters.</span></div> : <>
          <div className="um-table-scroll"><table className="um-table"><thead><tr><th>User</th><th>ID</th><th>Role</th><th>Status</th><th>Registered</th><th>Bookings</th><th>Actions</th></tr></thead>
            <tbody>{users.map((user) => {
              const isAdmin = user.roles?.toLowerCase().includes('admin');
              return <tr key={user.id}>
                <td><strong className="um-user-name">{user.full_name}</strong><span className="um-user-email">{user.email}</span>{user.phone && <span className="um-user-phone">{user.phone}</span>}</td>
                <td>#{user.id}</td>
                <td>{user.roles || 'Unassigned'}</td>
                <td><span className={`pill ${user.status}`}>{statusLabel(user.status)}</span></td>
                <td>{displayDate(user.created_at)}</td>
                <td>{Number(user.bookings_count || 0)}</td>
                <td><div className="um-row-actions">
                  <button type="button" title="View details and booking history" aria-label={`View ${user.full_name}`} disabled={busy} onClick={() => openUserDetails(user)}><Eye size={15}/></button>
                  <button type="button" title="Edit user information" aria-label={`Edit ${user.full_name}`} disabled={busy} onClick={() => startEdit(user)}><Pencil size={15}/></button>
                  <button type="button" title={isAdmin ? 'Administrator role changes are restricted' : 'Change role'} aria-label={`Change role for ${user.full_name}`} disabled={busy || isAdmin} onClick={() => startRoleChange(user)}><Shield size={15}/></button>
                  <button type="button" title={user.status === 'active' ? 'Deactivate account' : 'Activate account'} aria-label={`${user.status === 'active' ? 'Deactivate' : 'Activate'} ${user.full_name}`} disabled={busy} onClick={() => startStatusChange(user)}><UserRound size={15}/></button>
                  <button type="button" title="Initiate secure password reset" aria-label={`Reset password for ${user.full_name}`} disabled={busy} onClick={() => initiatePasswordReset(user)}><KeyRound size={15}/></button>
                </div></td>
              </tr>;
            })}</tbody>
          </table></div>
          <div className="um-pagination"><span>Showing {firstItem}–{lastItem} of {pagination.total.toLocaleString()}</span><div><button type="button" aria-label="Previous page" disabled={loading || pagination.page <= 1} onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))}><ChevronLeft size={16}/></button><span>Page {pagination.page} of {totalPages}</span><button type="button" aria-label="Next page" disabled={loading || pagination.page >= totalPages} onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))}><ChevronRight size={16}/></button></div></div>
        </>}
      </section>
      <p className="um-retention-note"><CalendarDays size={14}/> Accounts are deactivated rather than deleted so booking, audit, and financial records remain intact.</p>
      <UserModal modal={modal} roles={modal?.type === 'create' ? roles.filter((role) => ['organizer', 'vendor'].includes(role.name.toLowerCase())) : roles} form={form} busy={busy} errors={formErrors} onClose={() => { setFormErrors({}); setModal(null); }} onSave={saveUser} onChange={updateForm}/>
      <ActionModal modal={actionModal} roles={roles} form={actionForm} busy={busy} onClose={() => setActionModal(null)} onChange={updateActionForm} onSubmit={saveSensitiveChange}/>
      <UserDetails user={selectedUser} details={userDetails} loading={detailsLoading} error={detailsError} onClose={() => setSelectedUser(null)}/>
    </div>
  );
}
