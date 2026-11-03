export function generateSecurePassword() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return `Aa9!${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function validateCreateUserForm(form, translate) {
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
  if (!form.password) {
    errors.password = translate('adminUserPasswordRequired');
  } else if (form.password.length < 16 || form.password.length > 128 || !/[A-Z]/.test(form.password) || !/[a-z]/.test(form.password) || !/\d/.test(form.password)) {
    errors.password = translate('adminUserPasswordWeak');
  }
  if (!form.confirm_password) {
    errors.confirm_password = translate('adminUserConfirmPasswordRequired');
  } else if (form.password !== form.confirm_password) {
    errors.confirm_password = translate('adminUserPasswordMismatch');
  }
  if (!form.role_id) errors.role_id = translate('adminUserAccountTypeRequired');

  return errors;
}
