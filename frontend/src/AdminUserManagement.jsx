import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Eye, EyeOff, KeyRound, Mail, Pencil, Plus, Search, Shield, UserRound, X } from 'lucide-react';
import apiClient from './api/axios.js';
import { translate, translateText } from './language.js';
import {
  parseUserManagementQuery,
  updateUserManagementQuery,
  validateCreateUserForm,
} from './adminUserManagementUtils.js';
import './adminUserManagement.css';

const emptyForm = {
  full_name: '',
  username: '',
  email: '',
  phone: '',
  password: '',
  confirm_password: '',
  role_id: '',
  business_name: '',
  category_id: '',
  fid_number: '',
};
const statusOptions = ['active', 'suspended'];
const userFilterStatusOptions = ['pending', ...statusOptions];
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
  if (status === 'pending') return translate('adminUserStatusInvited');
  return translate(`adminUserStatus${status.charAt(0).toUpperCase()}${status.slice(1)}`);
}

function displayRoles(roles) {
  return String(roles).split(',').map((role) => {
    const key = `adminUserRole${role.trim().toLowerCase()}`;
    const translated = translate(key);
    return translated === key ? role.trim() : translated;
  }).filter(Boolean).join(', ');
}

function AvatarBadge({ user }) {
  const initials = String(user.full_name || user.email || 'U')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
  return React.createElement('span', {
    className: 'um-avatar-badge',
    style: {
      width: 28, height: 28, fontSize: 10,
      display: 'grid', placeItems: 'center',
      color: '#fff', background: '#3b82f6', borderRadius: 5
    }
  }, initials);
}

function UserRowActions({ user, busy, currentAdminId, onView, onEdit, onChangeRole, onSuspend, onActivate, onResetPassword, onDelete }) {
  const isAdmin = user.roles?.toLowerCase().includes('admin');
  return React.createElement('div', { className: 'um-row-actions' },
    React.createElement('button', {
      type: 'button', title: 'View details and booking history',
      'aria-label': `View ${user.full_name}`, disabled: busy,
      onClick: () => onView(user)
    }, React.createElement(Eye, { size: 15 })),
    React.createElement('button', {
      type: 'button', title: 'Edit user information',
      'aria-label': `Edit ${user.full_name}`, disabled: busy,
      onClick: () => onEdit(user)
    }, React.createElement(Pencil, { size: 15 })),
    React.createElement('button', {
      type: 'button', title: isAdmin ? 'Administrator role changes are restricted' : 'Change role',
      'aria-label': `Change role for ${user.full_name}`, disabled: busy || isAdmin,
      onClick: () => onChangeRole(user)
    }, React.createElement(Shield, { size: 15 })),
    user.status === 'pending' && React.createElement('button', {
      type: 'button', title: 'Resend invitation',
      'aria-label': `Resend invitation for ${user.full_name}`, disabled: busy,
      onClick: () => onSuspend(user)
    }, React.createElement(Mail, { size: 15 })),
    React.createElement('button', {
      type: 'button',
      title: user.status === 'suspended' ? 'Reactivate account' : 'Deactivate account',
      'aria-label': `${user.status === 'suspended' ? 'Reactivate' : 'Deactivate'} account ${user.full_name}`,
      disabled: busy || (Number(user.id) === Number(currentAdminId) && user.status === 'active'),
      onClick: () => onSuspend(user)
    }, React.createElement(UserRound, { size: 15 })),
    React.createElement('button', {
      type: 'button', title: 'Initiate secure password reset',
      'aria-label': `Reset password for ${user.full_name}`, disabled: busy,
      onClick: () => onResetPassword(user)
    }, React.createElement(KeyRound, { size: 15 })),
    user.status === 'active' && !isAdmin && React.createElement('button', {
      type: 'button', title: 'Remove user',
      'aria-label': `Delete account for ${user.full_name}`, disabled: busy,
      onClick: () => onDelete(user)
    }, React.createElement(X, { size: 15 }))
  );
}

function SummaryCard({ title, count, subtitle, icon }) {
  return React.createElement('div', { className: 'um-summary-card' },
    React.createElement('div', { className: 'um-summary-card-icon' }, icon),
    React.createElement('div', { className: 'um-summary-card-info' },
      React.createElement('p', { className: 'um-summary-card-title' }, translate(title)),
      React.createElement('p', { className: 'um-summary-card-count', style: { fontSize: '28px', fontWeight: 700, color: '#1b2942' } }, count.toLocaleString()),
      React.createElement('p', { className: 'um-summary-card-sub' }, translate(subtitle))
    )
  );
}

function SkeletonRow() {
  return React.createElement('tr', { className: 'um-skeleton-row' },
    React.createElement('td', { colSpan: 10, className: 'um-skeleton-cell' },
      React.createElement('div', { className: 'um-skeleton-cell-inner', colSpan: 10, style: { width: '50%' } }),
      React.createElement('div', { className: 'um-skeleton-cell-inner', style: { width: '30%' } }),
      React.createElement('div', { className: 'um-skeleton-cell-inner', style: { width: '20%' } })
    )
  );
}

function ErrorCard({ message, onRetry }) {
  return React.createElement('div', { className: 'um-error-card', role: 'alert' },
    React.createElement('p', { className: 'um-error-message' }, message),
    React.createElement('button', { className: 'um-retry-button', onClick: onRetry, 'aria-label': 'Retry' },
      translate('adminUserRetry')
    )
  );
}

function UserModal({
  modal,
  form,
  formErrors,
  roles,
  categories,
  rolesLoading,
  categoriesLoading,
  busy,
  showPassword,
  setShowPassword,
  updateForm,
  onSubmit,
  onClose,
}) {
  const isCreate = modal.type === 'create';
  const selectedRoleName = String(
    roles.find((role) => String(role.id) === String(form.role_id))?.name || '',
  ).toLowerCase();
  const formField = (name, label, options = {}) => React.createElement('label', { className: 'um-form-field' },
    React.createElement('span', null, label),
    React.createElement('input', {
      name,
      value: form[name] || '',
      onChange: (event) => updateForm(name, event.target.value),
      'aria-invalid': Boolean(formErrors[name]),
      'aria-describedby': formErrors[name] ? `um-error-${name}` : undefined,
      ...options,
    }),
    formErrors[name] && React.createElement('small', { id: `um-error-${name}`, className: 'um-field-error' }, formErrors[name]),
  );

  return React.createElement('div', { className: 'um-modal-backdrop', role: 'presentation' },
    React.createElement('section', { className: 'um-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': isCreate ? translate('adminUserCreateAccount') : translate('adminUserEditInformation') },
      React.createElement('div', { className: 'um-modal-header' },
        React.createElement('h3', null, isCreate ? translate('adminUserCreateAccount') : translate('adminUserEditInformation')),
        React.createElement('button', { type: 'button', className: 'um-modal-close', onClick: onClose, 'aria-label': translate('adminUserCancel') },
          React.createElement(X, { size: 18 })),
      ),
      React.createElement('form', { className: 'um-modal-form', onSubmit },
        formField('full_name', translate('adminUserFullName')),
        isCreate && formField('username', translate('adminUserUsername')),
        formField('email', translate('adminUserEmailAddress'), { type: 'email', disabled: !isCreate }),
        formField('phone', translate('adminUserPhoneNumber'), { type: 'tel' }),
        isCreate && React.createElement(React.Fragment, null,
          React.createElement('label', { className: 'um-form-field' },
            React.createElement('span', null, translate('adminUserPassword')),
            React.createElement('span', { className: 'um-password-input' },
              React.createElement('input', {
                name: 'password',
                type: showPassword ? 'text' : 'password',
                value: form.password,
                onChange: (event) => updateForm('password', event.target.value),
                'aria-invalid': Boolean(formErrors.password),
              }),
              React.createElement('button', {
                type: 'button',
                onClick: () => setShowPassword((current) => !current),
                'aria-label': showPassword ? translate('adminUserHidePassword') : translate('adminUserShowPassword'),
              }, showPassword ? React.createElement(EyeOff, { size: 16 }) : React.createElement(Eye, { size: 16 })),
            ),
            formErrors.password && React.createElement('small', { className: 'um-field-error' }, formErrors.password),
          ),
          React.createElement('label', { className: 'um-form-field' },
            React.createElement('span', null, translate('adminUserConfirmPassword')),
            React.createElement('input', {
              name: 'confirm_password',
              type: showPassword ? 'text' : 'password',
              value: form.confirm_password,
              onChange: (event) => updateForm('confirm_password', event.target.value),
              'aria-invalid': Boolean(formErrors.confirm_password),
            }),
            formErrors.confirm_password && React.createElement('small', { className: 'um-field-error' }, formErrors.confirm_password),
          ),
          React.createElement('label', { className: 'um-form-field' },
            React.createElement('span', null, translate('adminUserRole')),
            React.createElement('select', {
              name: 'role_id',
              value: form.role_id,
              disabled: rolesLoading,
              onChange: (event) => updateForm('role_id', event.target.value),
              'aria-invalid': Boolean(formErrors.role_id),
            },
              React.createElement('option', { value: '' }, translate('adminUserChooseRole')),
              roles.map((role) => React.createElement('option', {
                key: role.id,
                value: role.id,
              }, displayRoles(role.name))),
            ),
            formErrors.role_id && React.createElement('small', { className: 'um-field-error' }, formErrors.role_id),
          ),
          React.createElement('div', { className: 'um-form-field' },
            React.createElement('span', null, translate('adminUserDigitalId')),
            React.createElement('output', null, translate('adminUserDigitalIdGenerated')),
            React.createElement('small', null, translate('adminUserDigitalIdHelp')),
          ),
          formField('fid_number', translate('adminUserFidNumber')),
          selectedRoleName === 'vendor' && React.createElement(React.Fragment, null,
            formField('business_name', translate('adminUserBusinessName')),
            React.createElement('label', { className: 'um-form-field' },
              React.createElement('span', null, translate('adminUserServiceCategory')),
              React.createElement('select', {
                name: 'category_id',
                value: form.category_id,
                disabled: categoriesLoading,
                onChange: (event) => updateForm('category_id', event.target.value),
              },
                React.createElement('option', { value: '' }, categoriesLoading ? translate('adminUserLoadingCategories') : translate('adminUserChooseCategory')),
                categories.map((category) => React.createElement('option', { key: category.id, value: category.id }, category.name)),
              ),
              formErrors.category_id && React.createElement('small', { className: 'um-field-error' }, formErrors.category_id),
            ),
          ),
        ),
        React.createElement('div', { className: 'um-modal-actions' },
          React.createElement('button', { type: 'button', className: 'button secondary', onClick: onClose, disabled: busy }, translate('adminUserCancel')),
          React.createElement('button', { type: 'submit', className: 'button', disabled: busy }, isCreate ? translate('adminUserCreateAccount') : translate('adminUserSave')),
        ),
      ),
    ),
  );
}

function ActionModal({ actionModal, actionForm, busy, filterRoles, updateActionForm, onSubmit, onClose }) {
  if (!actionModal) return null;
  const isRole = actionModal.type === 'role';
  return React.createElement('div', { className: 'um-modal-backdrop', role: 'presentation' },
    React.createElement('section', { className: 'um-modal um-action-modal', role: 'dialog', 'aria-modal': 'true' },
      React.createElement('h3', null, isRole ? translate('adminUserChangeRole') : translate('adminUserChangeStatus')),
      React.createElement('form', { onSubmit },
        isRole
          ? React.createElement('label', { className: 'um-form-field' },
            React.createElement('span', null, translate('adminUserRole')),
            React.createElement('select', { value: actionForm.role_id, onChange: (event) => updateActionForm('role_id', event.target.value) },
              React.createElement('option', { value: '' }, translate('adminUserChooseRole')),
              filterRoles.filter((role) => !role.is_admin
                && ['organizer', 'vendor'].includes(String(role.name).toLowerCase())).map((role) => React.createElement('option', { key: role.id, value: role.id }, displayRoles(role.name))),
            ),
          )
          : React.createElement(React.Fragment, null,
            React.createElement('label', { className: 'um-form-field' },
              React.createElement('span', null, translate('adminUserStatus')),
              React.createElement('select', { value: actionForm.status, onChange: (event) => updateActionForm('status', event.target.value) },
                React.createElement('option', { value: 'active' }, translate('adminUserStatusActive')),
                React.createElement('option', { value: 'suspended' }, translate('adminUserStatusSuspended')),
              ),
            ),
            React.createElement('label', { className: 'um-form-field' },
              React.createElement('span', null, translate('adminUserReason')),
              React.createElement('textarea', { value: actionForm.reason, onChange: (event) => updateActionForm('reason', event.target.value), required: true }),
            ),
          ),
        React.createElement('div', { className: 'um-modal-actions' },
          React.createElement('button', { type: 'button', className: 'button secondary', onClick: onClose, disabled: busy }, translate('adminUserCancel')),
          React.createElement('button', { type: 'submit', className: 'button', disabled: busy }, translate('adminUserSave')),
        ),
      ),
    ),
  );
}

function AdminUserManagement(props) {
  const { initialUsers = null, currentAdminId = null } = props;
  const [initialQuery] = useState(() => parseUserManagementQuery(
    typeof window === 'undefined' ? '' : window.location.search,
  ));
  const [focusId, setFocusId] = useState(initialQuery.focusId);
  const initialQueryText = initialQuery.q || initialQuery.focusId;
  const initialFilters = {
    q: initialQueryText,
    status: initialQuery.status,
    role: initialQuery.role,
    dateFrom: initialQuery.dateFrom,
    dateTo: initialQuery.dateTo,
    sortBy: initialQuery.sortBy,
    sortDirection: initialQuery.sortDirection,
  };
  const openedFocus = useRef('');
  const [users, setUsers] = useState(initialUsers ?? []);
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [filterRoles, setFilterRoles] = useState([]);
  const [pagination, setPagination] = useState({ ...initialPagination, total: initialUsers?.length ?? 0 });
  const [loading, setLoading] = useState(initialUsers === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createdDigitalId, setCreatedDigitalId] = useState('');
  const [searchInput, setSearchInput] = useState(initialQueryText);
  const [filters, setFilters] = useState(initialFilters);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [actionModal, setActionModal] = useState(null);
  const [actionForm, setActionForm] = useState({});
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetails, setUserDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [skeletonUsers, setSkeletonUsers] = useState(true);
  const [hasError, setHasError] = useState(false);
  const requestId = useRef(0);

  const loadUsers = useCallback(async (page, nextFilters, pageSize) => {
    const request = ++requestId.current;
    setLoading(true);
    setError('');
    setHasError(false);
    setSkeletonUsers(true);
    try {
      const params = { page, pageSize, ...Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => value !== '')) };
      const response = await apiClient.get('/admin/users', { params });
      if (request !== requestId.current) return;
      setUsers(response.data.data);
      setPagination(response.data.pagination);
      setSkeletonUsers(false);
    } catch (issue) {
      if (request === requestId.current) {
        setError(issue.message || 'Unable to load users.');
        setHasError(true);
        setSkeletonUsers(false);
      }
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, []);

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
        setRoles(allRoles.filter((role) => role.is_active
          && ['organizer', 'vendor'].includes(String(role.name).toLowerCase())));
      })
      .catch((issue) => setError((current) => current || issue.message || translate('adminUserRolesLoadFailed')))
      .finally(() => setRolesLoading(false));
    apiClient.get('/admin/categories', { params: { pageSize: 100, status: 'active' } })
      .then((response) => setCategories(response.data.data))
      .catch((issue) => setError((current) => current || issue.message || translate('adminUserCategoriesLoadFailed')))
      .finally(() => setCategoriesLoading(false));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePopState = () => {
      const query = parseUserManagementQuery(window.location.search);
      const queryText = query.q || query.focusId;
      setFocusId(query.focusId);
      setSearchInput(queryText);
      setFilters({ ...query, q: queryText });
      setPagination((current) => ({ ...current, page: 1 }));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (initialUsers !== null) return;
    loadUsers(pagination.page, filters, pagination.pageSize);
  }, [filters, initialUsers, loadUsers, pagination.page, pagination.pageSize]);

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
    const query = updateUserManagementQuery(window.location.search, next);
    if (window.history) {
      window.history.pushState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
  }

  function changeFilter(field, value) {
    const next = { ...filters, [field]: value };
    setFilters(next);
    setPagination((current) => ({ ...current, page: 1 }));
    const query = updateUserManagementQuery(window.location.search, next);
    if (window.history) {
      window.history.pushState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
  }

  function startCreate() {
    setForm(emptyForm);
    setFormErrors({});
    setCreatedDigitalId('');
    setModal({ type: 'create' });
  }

  function startEdit(user) {
    setForm({ ...emptyForm, full_name: user.full_name, email: user.email, phone: user.phone || '' });
    setFormErrors({});
    setModal({ type: 'edit', user });
  }

  function startStatusChange(user) {
    const status = user.status === 'suspended' ? 'active' : 'suspended';
    setActionForm({ status, reason: '' });
    setActionModal({ type: 'status', user });
  }

  function startRoleChange(user) {
    if (user.roles?.toLowerCase().includes('admin')) return;
    setActionForm({ role_id: user.role_id ? String(user.role_id) : '' });
    setActionModal({ type: 'role', user });
  }

  async function saveUser(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    setCreatedDigitalId('');
    if (modal.type === 'create') {
      const vendorRoleId = roles.find((role) => String(role.name).toLowerCase() === 'vendor')?.id;
      const allowedRoleIds = roles.map((role) => role.id);
      const validationErrors = validateCreateUserForm(form, translate, vendorRoleId, allowedRoleIds);
      setFormErrors(validationErrors);
      if (Object.keys(validationErrors).length) return;
    }
    setBusy(true);
    try {
      if (modal.type === 'edit' && !window.confirm(translateText(`Save profile changes for ${modal.user.full_name}?`))) return;
      const payload = { ...form, phone: form.phone.trim() || null };
      if (modal.type === 'create') {
        payload.role_id = Number(payload.role_id);
        const selectedRoleName = String(roles.find((role) => String(role.id) === String(payload.role_id))?.name || '').toLowerCase();
        if (selectedRoleName === 'vendor') {
          if (!payload.business_name) delete payload.business_name;
          if (payload.category_id) payload.category_id = Number(payload.category_id);
          else delete payload.category_id;
        } else {
          delete payload.business_name;
          delete payload.category_id;
        }
        const response = await apiClient.post('/admin/users', payload);
        setCreatedDigitalId(response.data.data.digital_id);
        setNotice(translate('adminUserCreated'));
      } else {
        delete payload.username;
        delete payload.email;
        delete payload.role_id;
        delete payload.business_name;
        delete payload.category_id;
        delete payload.password;
        delete payload.confirm_password;
        delete payload.fid_number;
        await apiClient.patch(`/admin/users/${modal.user.id}`, payload);
        setNotice(translate('adminUserUpdated'));
      }
      setModal(null);
      await loadUsers(pagination.page, filters, pagination.pageSize);
    } catch (issue) {
      if (modal?.type === 'create' && issue.status === 409 && /email|ኢሜይል/i.test(issue.message || '')) {
        setFormErrors((current) => ({ ...current, email: translate('adminUserEmailExists') }));
      } else if (modal?.type === 'create' && issue.status === 409 && /phone|ስልክ/i.test(issue.message || '')) {
        setFormErrors((current) => ({ ...current, phone: translate('adminUserPhoneExists') }));
      } else {
        setError(issue.message || 'The user could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  }

  function startStatusChange(user) {
    const status = user.status === 'suspended' ? 'active' : 'suspended';
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
        setNotice(actionForm.status === 'active' ? translate('adminUserReactivated') : translate('adminUserDeactivated'));
      } else {
        await apiClient.patch(`/admin/users/${actionModal.user.id}/role`, { role_id: Number(actionForm.role_id) });
        setNotice(translate('adminUserRoleUpdated'));
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

  async function resendInvitation(user) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiClient.post(`/admin/users/${user.id}/resend-invite`, {});
      setNotice(translate('adminUserInvitationResent'));
    } catch (issue) {
      setError(issue.status === 503 ? translate('adminUserInviteEmailFailed') : issue.message || translate('adminUserInviteResendFailed'));
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

  function deleteUser(user, onConfirmed) {
    if (!window.confirm(translateText(`Are you sure you want to delete ${user.full_name}? This will soft-delete the account and preserve all booking, audit, and financial records.`))) return;
    onConfirmed();
  }

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const firstItem = pagination.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const lastItem = Math.min(pagination.page * pagination.pageSize, pagination.total);

  function renderTableRow(user, busy, currentAdminId, onView, onEdit, onChangeRole, onSuspend, onActivate, onResetPassword, onDelete) {
    return React.createElement('tr', { key: user.id },
      React.createElement('td', { style: { display: 'block' } }, React.createElement('strong', { className: 'um-user-name' }, user.full_name)),
      React.createElement('td', null, React.createElement('span', { className: 'um-user-email' }, user.email)),
      React.createElement('td', null, React.createElement('code', null, user.digital_id || '—')),
      React.createElement('td', null, React.createElement('code', null, user.fid_number || '—')),
      React.createElement('td', null, user.phone || '—'),
      React.createElement('td', null, React.createElement('code', null, user.last_login_at ? displayDateTime(user.last_login_at) : '—')),
      React.createElement('td', null, displayRoles(user.roles) || 'Unassigned'),
      React.createElement('td', null, React.createElement('span', { className: `pill ${user.status}` }, statusLabel(user.status))),
      React.createElement('td', null, displayDate(user.created_at)),
      React.createElement('td', null, Number(user.bookings_count || 0)),
      React.createElement('td', null,
        UserRowActions({ user, busy, currentAdminId, onView, onEdit, onChangeRole, onSuspend, onActivate, onResetPassword, onDelete })
      )
    );
  }

  function getTableRows(users, busy, currentAdminId, onView, onEdit, onChangeRole, onSuspend, onActivate, onResetPassword, onDelete) {
    const rows = users.map(user => renderTableRow(user, busy, currentAdminId, onView, onEdit, onChangeRole, onSuspend, onActivate, onResetPassword, onDelete));
    return rows;
  }

  const tableRows = getTableRows(users, busy, currentAdminId, openUserDetails, startEdit, startRoleChange, startStatusChange, initiatePasswordReset, deleteUser);

  function renderNoContent() {
    if (loading) {
      return React.createElement('div', { className: 'um-table-scroll' },
        React.createElement('table', { className: 'um-table' },
          React.createElement('thead', null,
            React.createElement('tr', null,
              React.createElement('th', null, translate('adminUserFullName')),
              React.createElement('th', null, translate('adminUserEmailAddress')),
              React.createElement('th', null, translate('adminUserPhoneNumber')),
              React.createElement('th', null, translate('adminUserLastLogin')),
              React.createElement('th', null, translate('adminUserRole')),
              React.createElement('th', null, 'Status'),
              React.createElement('th', null, 'Registered'),
              React.createElement('th', null, 'Bookings'),
              React.createElement('th', null, 'Actions')
            )
          ),
          React.createElement('tbody', null,
            skeletonUsers ? Array.from({length: 8}, (_, i) => React.createElement(SkeletonRow, { key: i })) : []
          )
        )
      );
    }
    if (users.length === 0) {
      return React.createElement('div', { className: 'um-empty-state' },
        React.createElement(UserRound, { size: 28 }),
        React.createElement('strong', null, translate('no users found')),
        React.createElement('span', null, 'Try changing your search or filters.')
      );
    }
    return null;
  }

  const noContent = renderNoContent();

  return React.createElement('div', { className: 'um-page' },
    React.createElement('div', { className: 'page-heading' },
      React.createElement('div', null,
        React.createElement('p', { className: 'eyebrow' }, translate('adminUserAdministration')),
        React.createElement('h2', null, translate('userManagement')),
        React.createElement('p', { className: 'muted' }, translate('adminUserDescription'))
      ),
      React.createElement('button', {
        type: 'button', className: 'button um-create-button',
        onClick: startCreate
      }, React.createElement(Plus, { size: 16 }), ' ', translate('adminUserCreate'))
    ),
    hasError && React.createElement(ErrorCard, { message: error, onRetry: () => setHasError(false) }),
    error && React.createElement('div', { className: 'alert error', role: 'alert' },
      error,
      React.createElement('button', { className: 'dismiss', onClick: () => setError(''), 'aria-label': 'Dismiss error' },
        React.createElement(X, { size: 15 })
      )
    ),
    notice && React.createElement('div', { className: 'alert success', role: 'status' },
      notice,
      createdDigitalId && React.createElement(React.Fragment, null,
        translate('adminUserDigitalId'),
        React.createElement('code', null, createdDigitalId)
      ),
      React.createElement('button', { className: 'dismiss', onClick: () => { setNotice(''); setCreatedDigitalId(''); }, 'aria-label': 'Dismiss notice' },
        React.createElement(X, { size: 15 })
      )
    ),

    React.createElement('div', { className: 'um-summary-cards', style: {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24
    } },
      React.createElement(SummaryCard, {
        title: 'adminUserTotalUsers', count: pagination.total,
        subtitle: 'adminUserTotalUsersDescription', icon: React.createElement(UserRound, { size: 24 })
      }),
      React.createElement(SummaryCard, {
        title: 'adminUserActiveUsers',
        count: pagination.total > 0 ? Math.max(0, pagination.total - (users.filter(u => u.status === 'suspended').length || 0) || 0) : 0,
        subtitle: 'adminUserActiveUsersDescription', icon: React.createElement(UserRound, { size: 24 })
      }),
      React.createElement(SummaryCard, {
        title: 'adminUserSuspendedUsers',
        count: users.filter(u => u.status === 'suspended').length,
        subtitle: 'adminUserSuspendedUsersDescription', icon: React.createElement(EyeOff, { size: 24 })
      }),
      React.createElement(SummaryCard, {
        title: 'adminUserNewThisMonth', count: 0,
        subtitle: 'adminUserNewThisMonthDescription', icon: React.createElement(CalendarDays, { size: 24 })
      })
    ),

    React.createElement('form', { className: 'um-filters panel', onSubmit: applyFilters },
      React.createElement('label', { className: 'um-search' },
        React.createElement(Search, { size: 16 }),
        React.createElement('input', {
          'aria-label': 'Search users',
          placeholder: 'Search name, email, phone, or ID',
          maxLength: 120,
          value: searchInput,
          onChange: (e) => setSearchInput(e.target.value)
        }),
        React.createElement('button', { type: 'submit' }, 'Search')
      ),
      React.createElement('label', { className: 'um-filter' },
        React.createElement('span', null, 'Role'),
        React.createElement('select', {
          value: filters.role,
          onChange: (e) => changeFilter('role', e.target.value)
        },
          React.createElement('option', { value: '' }, 'All roles'),
          filterRoles.map((role) => React.createElement('option', { key: role.name, value: role.name }, displayRoles(role.name)))
        )
      ),
      React.createElement('label', { className: 'um-filter' },
        React.createElement('span', null, translate('adminUserStatusFilter')),
        React.createElement('select', {
          value: filters.status,
          onChange: (e) => changeFilter('status', e.target.value)
        },
          React.createElement('option', { value: '' }, 'All statuses'),
          userFilterStatusOptions.map((status) => React.createElement('option', { key: status, value: status }, statusLabel(status)))
        )
      ),
      React.createElement('label', { className: 'um-filter' },
        React.createElement('span', null, 'Registered from'),
        React.createElement('input', {
          type: 'date', value: filters.dateFrom,
          max: filters.dateTo || undefined,
          onChange: (e) => changeFilter('dateFrom', e.target.value)
        }
        )
      ),
      React.createElement('label', { className: 'um-filter' },
        React.createElement('span', null, 'Registered to'),
        React.createElement('input', {
          type: 'date', value: filters.dateTo, min: filters.dateFrom || undefined,
          onChange: (e) => changeFilter('dateTo', e.target.value)
        }
        )
      ),
      React.createElement('label', { className: 'um-filter' },
        React.createElement('span', null, 'Sort by'),
        React.createElement('select', {
          value: `${filters.sortBy}:${filters.sortDirection}`,
          onChange: (e) => {
            const parts = (e.target.value || '').split(':');
            const sortBy = parts[0] || 'created_at';
            const sortDirection = parts[1] || 'desc';
            const next = { ...filters, sortBy, sortDirection };
            setFilters(next);
            setPagination((current) => ({ ...current, page: 1 }));
            const query = updateUserManagementQuery(window.location.search, next);
            if (window.history) {
              window.history.pushState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
            }
          }
        },
          React.createElement('option', { value: 'created_at:desc' }, 'Newest first'),
          React.createElement('option', { value: 'created_at:asc' }, 'Oldest first'),
          React.createElement('option', { value: 'full_name:asc' }, 'Name A–Z'),
          React.createElement('option', { value: 'full_name:desc' }, 'Name Z–A'),
          React.createElement('option', { value: 'email:asc' }, 'Email A–Z'),
          React.createElement('option', { value: 'id:desc' }, 'ID newest')
        )
      )
    ),

    noContent,
    React.createElement('section', { className: 'um-table-panel panel', 'aria-busy': loading },
      React.createElement('div', { className: 'um-table-heading' },
        React.createElement('div', null,
          React.createElement('h3', null, 'Registered users'),
          React.createElement('p', null,
            loading ? 'Updating user list…' : `${pagination.total.toLocaleString()} account${pagination.total === 1 ? '' : 's'} found`
          )
        ),
        React.createElement('label', { className: 'um-page-size' },
          'Rows ',
          React.createElement('select', {
            value: pagination.pageSize,
            onChange: (e) => {
              const pageSize = Number(e.target.value);
              setPagination((current) => ({ ...current, page: 1, pageSize }));
            }
          },
            React.createElement('option', { value: 10 }, '10'),
            React.createElement('option', { value: 20 }, '20'),
            React.createElement('option', { value: 50 }, '50'),
            React.createElement('option', { value: 100 }, '100')
          )
        )
      ),
      !loading && users.length > 0 && React.createElement('div', { className: 'um-table-scroll' },
        React.createElement('table', { className: 'um-table' },
          React.createElement('thead', null,
            React.createElement('tr', null,
              React.createElement('th', null, translate('adminUserFullName')),
              React.createElement('th', null, translate('adminUserEmailAddress')),
              React.createElement('th', null, 'Digital ID'),
              React.createElement('th', null, 'FID Number (D/F)'),
              React.createElement('th', null, translate('adminUserPhoneNumber')),
              React.createElement('th', null, translate('adminUserLastLogin')),
              React.createElement('th', null, translate('adminUserRole')),
              React.createElement('th', null, 'Status'),
              React.createElement('th', null, 'Registered'),
              React.createElement('th', null, 'Bookings'),
              React.createElement('th', null, 'Actions')
            )
          ),
          React.createElement('tbody', null, tableRows)
        )
      ),
      !loading && users.length > 0 && React.createElement('nav', { className: 'um-pagination', 'aria-label': 'User pagination' },
        React.createElement('button', {
          type: 'button',
          disabled: pagination.page <= 1,
          onClick: () => setPagination((current) => ({ ...current, page: current.page - 1 })),
        }, translate('adminUserPreviousPage')),
        React.createElement('span', null, `${firstItem}-${lastItem} / ${pagination.total}`),
        React.createElement('button', {
          type: 'button',
          disabled: pagination.page >= totalPages,
          onClick: () => setPagination((current) => ({ ...current, page: current.page + 1 })),
        }, translate('adminUserNextPage')),
      )
    ),
    modal && React.createElement(UserModal, {
      modal,
      form,
      formErrors,
      roles,
      categories,
      rolesLoading,
      categoriesLoading,
      busy,
      showPassword,
      setShowPassword,
      updateForm,
      onSubmit: saveUser,
      onClose: () => setModal(null),
    }),
    React.createElement(ActionModal, {
      actionModal,
      actionForm,
      busy,
      filterRoles,
      updateActionForm,
      onSubmit: saveSensitiveChange,
      onClose: () => setActionModal(null),
    }),
  );
}

export default AdminUserManagement;