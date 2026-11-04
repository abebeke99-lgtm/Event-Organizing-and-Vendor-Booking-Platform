export function formatCustomerMoney(amount, currency) {
  const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim())
    ? currency.trim().toUpperCase()
    : 'ETB';
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(safe);
  } catch {
    return `${safe.toLocaleString()} ${code}`;
  }
}
