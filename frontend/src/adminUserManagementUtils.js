export function validateCreateUserForm(form, translate, vendorRoleId) {
  const errors = {};
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneDigits = String(form.phone || '').replace(/\D/g, '');

  if (!form.full_name.trim()) errors.full_name = translate('adminUserFullNameRequired');
  if (!form.email.trim()) {
    errors.email = translate('adminUserEmailRequired');
  } else if (!emailPattern.test(form.email.trim())) {
    errors.email = translate('adminUserEmailInvalid');
  }
  if (form.phone.trim() && (!/^\+?[\d().\s-]+$/.test(form.phone) || phoneDigits.length < 7 || phoneDigits.length > 15)) {
    errors.phone = translate('adminUserPhoneInvalid');
  }
  if (!form.role_id) errors.role_id = translate('adminUserAccountTypeRequired');
  if (vendorRoleId != null && String(form.role_id) === String(vendorRoleId)) {
    if (!String(form.business_name || '').trim()) errors.business_name = translate('adminUserBusinessNameRequired');
    if (!form.category_id) errors.category_id = translate('adminUserCategoryRequired');
  }

  return errors;
}
