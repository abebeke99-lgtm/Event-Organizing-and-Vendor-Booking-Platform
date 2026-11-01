const ADAPTER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function loadPaymentProvider(adapterName = process.env.PAYMENT_PROVIDER_ADAPTER) {
  const name = String(adapterName || '').trim();
  if (!name) return null;
  if (!ADAPTER_NAME_PATTERN.test(name)) {
    throw new Error('PAYMENT_PROVIDER_ADAPTER must be a provider module name using letters, numbers, underscores, or hyphens.');
  }

  const providerModule = await import(new URL(`../providers/${name}.js`, import.meta.url));
  if (typeof providerModule.createPaymentProvider !== 'function') {
    throw new Error('The configured payment provider module must export createPaymentProvider().');
  }
  const provider = await providerModule.createPaymentProvider();
  if (!provider || typeof provider.name !== 'string' || !provider.name.trim()
    || typeof provider.verifyWebhook !== 'function' || typeof provider.refundPayment !== 'function') {
    throw new Error('The configured payment provider must implement name, verifyWebhook(), and refundPayment().');
  }
  return provider;
}
