import { translate } from './language.js';

export const INQUIRY_TYPES = [
  { value: 'general_inquiry', label: 'General Inquiry' },
  { value: 'event_booking_support', label: 'Event Booking Support' },
  { value: 'vendor_support', label: 'Vendor Support' },
  { value: 'service_request', label: 'Service Request' },
  { value: 'payment_billing', label: 'Payment and Billing' },
  { value: 'technical_support', label: 'Technical Support' },
  { value: 'account_assistance', label: 'Account Assistance' },
  { value: 'partnership_inquiry', label: 'Partnership Inquiry' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'other', label: 'Other' },
];

export function normalizeContactForm(values = {}) {
  return {
    full_name: String(values.full_name ?? '').trim(),
    email: String(values.email ?? '').trim().toLowerCase(),
    phone: String(values.phone ?? '').trim(),
    subject: String(values.subject ?? '').trim(),
    inquiry_type: 'general_inquiry',
    message: String(values.message ?? '').trim(),
  };
}

export function validateContactForm(values = {}, language = 'en') {
  const normalized = normalizeContactForm(values);
  const errors = {};

  if (normalized.full_name.length < 2) {
    errors.full_name = translate('fullNameRequired', language);
  } else if (normalized.full_name.length > 160) {
    errors.full_name = translate('contactNameTooLong', language);
  }
  if (normalized.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    errors.email = translate('validEmailRequired', language);
  }
  if (!normalized.subject || normalized.subject.length < 4 || normalized.subject.length > 200) {
    errors.subject = translate('subjectLengthError', language);
  }
  if (!normalized.message || normalized.message.length < 20 || normalized.message.length > 2500) {
    errors.message = translate('messageLengthError', language);
  }
  if (normalized.phone && normalized.phone.length > 40) {
    errors.phone = translate('phoneLengthError', language);
  }

  return { normalized, errors };
}

export function buildContactInfo(settings = {}) {
  const socials = Array.isArray(settings.socials)
    ? settings.socials.filter((entry) => {
      if (!entry || typeof entry !== 'object' || !entry.label || !entry.url) return false;
      try {
        return ['http:', 'https:'].includes(new URL(entry.url).protocol);
      } catch {
        return false;
      }
    })
    : [];

  return {
    email: String(settings.email ?? '').trim(),
    phone: String(settings.phone ?? '').trim(),
    address: String(settings.address ?? '').trim(),
    hours: String(settings.hours ?? '').trim(),
    socials,
  };
}
