import { translate } from './language.js';

export const INQUIRY_TYPES = [
  { value: 'general_inquiry', label: 'General Inquiry' },
  { value: 'technical_support', label: 'Technical Support' },
  { value: 'vendor_support', label: 'Vendor Support' },
  { value: 'booking_assistance', label: 'Booking Assistance' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'other', label: 'Other' },
];

export function normalizeContactForm(values = {}) {
  return {
    full_name: String(values.full_name ?? '').trim(),
    email: String(values.email ?? '').trim().toLowerCase(),
    phone: String(values.phone ?? '').trim(),
    subject: String(values.subject ?? '').trim(),
    inquiry_type: String(values.inquiry_type ?? 'general_inquiry').trim() || 'general_inquiry',
    message: String(values.message ?? '').trim(),
  };
}

export function validateContactForm(values = {}, language = 'en') {
  const normalized = normalizeContactForm(values);
  const errors = {};

  if (!normalized.full_name || normalized.full_name.length < 2) {
    errors.full_name = translate('fullNameRequired', language);
  }
  if (!normalized.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
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
  return {
    email: settings.email || '',
    phone: settings.phone || '',
    address: settings.address || '',
    hours: settings.hours || '',
    socials: Array.isArray(settings.socials) ? settings.socials : [],
  };
}
