const userStatuses = new Set(['active', 'suspended', 'pending']);
const userSortFields = new Set(['id', 'full_name', 'email', 'status', 'created_at', 'roles']);

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function parseUserManagementQuery(search = '') {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const query = (params.get('q') || '').trim();
  const role = (params.get('role') || '').trim();
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const validDateRange = (!dateFrom || isValidDate(dateFrom))
    && (!dateTo || isValidDate(dateTo))
    && (!dateFrom || !dateTo || dateFrom <= dateTo);

  return {
    focusId: /^\d+$/.test(params.get('focus') || '') ? params.get('focus') : '',
    q: query.length <= 120 ? query : '',
    status: userStatuses.has(params.get('status')) ? params.get('status') : '',
    role: role.length > 0 && role.length <= 80 ? role : '',
    dateFrom: validDateRange ? dateFrom : '',
    dateTo: validDateRange ? dateTo : '',
    sortBy: userSortFields.has(params.get('sortBy')) ? params.get('sortBy') : 'created_at',
    sortDirection: ['asc', 'desc'].includes(params.get('sortDirection')) ? params.get('sortDirection') : 'desc',
  };
}

export function updateUserManagementQuery(search, filters) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  for (const key of ['q', 'status', 'role', 'dateFrom', 'dateTo']) {
    const value = String(filters[key] || '').trim();
    if (value) params.set(key, value);
    else params.delete(key);
  }
  params.set('sortBy', filters.sortBy);
  params.set('sortDirection', filters.sortDirection);
  return params.toString();
}

export function validateCreateUserForm(form, translate, vendorRoleId, allowedRoleIds = null) {
  const errors = {};
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneDigits = String(form.phone || '').replace(/\D/g, '');
  const password = String(form.password || '');

  if (!form.full_name.trim()) errors.full_name = translate('adminUserFullNameRequired');
  const username = String(form.username || '').trim();
  if (!username) {
    errors.username = translate('adminUserUsernameRequired');
  } else if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
    errors.username = translate('usernameRequirements');
  }
  if (!form.email.trim()) {
    errors.email = translate('adminUserEmailRequired');
  } else if (!emailPattern.test(form.email.trim())) {
    errors.email = translate('adminUserEmailInvalid');
  }
  if (!form.phone.trim()) {
    errors.phone = translate('adminUserPhoneRequired');
  } else if (!/^\+?[\d().\s-]+$/.test(form.phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
    errors.phone = translate('adminUserPhoneInvalid');
  }
  if (!password) {
    errors.password = translate('adminUserPasswordRequired');
  } else if (password.length < 12 || password.length > 16
    || new TextEncoder().encode(password).length > 72) {
    errors.password = translate('adminUserPasswordRequirements');
  }
  if (!form.confirm_password) {
    errors.confirm_password = translate('adminUserConfirmPasswordRequired');
  } else if (password !== form.confirm_password) {
    errors.confirm_password = translate('adminUserPasswordMismatch');
  }
  if (!form.role_id) {
    errors.role_id = translate('adminUserAccountTypeRequired');
  } else if (allowedRoleIds && !allowedRoleIds.map(String).includes(String(form.role_id))) {
    errors.role_id = translate('adminUserRoleNotAllowed');
  }
  if (String(form.fid_number || '').trim().length > 120) {
    errors.fid_number = translate('adminUserFidNumberTooLong');
  }
  if (vendorRoleId != null && String(form.role_id) === String(vendorRoleId)) {
    if (!String(form.business_name || '').trim()) errors.business_name = translate('adminUserBusinessNameRequired');
    if (!form.category_id) errors.category_id = translate('adminUserCategoryRequired');
  }

  return errors;
}
