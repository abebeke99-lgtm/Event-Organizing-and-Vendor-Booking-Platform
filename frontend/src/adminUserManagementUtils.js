export function validateCreateUserForm(form, translate, vendorRoleId, allowedRoleIds = null) {
  const errors = {};
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneDigits = String(form.phone || '').replace(/\D/g, '');
  const password = String(form.password || '');

  if (!form.full_name.trim()) errors.full_name = translate('adminUserFullNameRequired');
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
  } else if (password.length < 8 || password.length > 128
    || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)
    || !/[^A-Za-z0-9]/.test(password)
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
