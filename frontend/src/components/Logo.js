import { createElement as h, useEffect } from 'react';

const LOGO_URL = '/assets/logo.svg';
const SIZES = { xs: 32, sm: 48, md: 80, lg: 120, xl: 160 };
const SYMBOLS = {
  full: 'eh-full',
  icon: 'eh-icon',
  'mono-white': 'eh-mono-white',
};

export default function Logo({ size = 'md', variant = 'full', className = '' }) {
  const width = SIZES[size] || SIZES.md;
  const symbol = SYMBOLS[variant] || SYMBOLS.full;
  const isLarge = size === 'lg' || size === 'xl';

  useEffect(() => {
    if (!isLarge) return;
    if (!document.querySelector('[data-eh-logo-preload]')) {
      const preload = document.createElement('link');
      preload.rel = 'preload';
      preload.as = 'image';
      preload.type = 'image/svg+xml';
      preload.href = LOGO_URL;
      preload.dataset.ehLogoPreload = 'true';
      document.head.appendChild(preload);
    }
    if (!document.querySelector('[data-eh-logo-image-preload]')) {
      const imagePreload = document.createElement('img');
      imagePreload.alt = '';
      imagePreload.dataset.ehLogoImagePreload = 'true';
      imagePreload.setAttribute('aria-hidden', 'true');
      imagePreload.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
      imagePreload.onload = imagePreload.onerror = () => imagePreload.remove();
      imagePreload.src = LOGO_URL;
      document.body.appendChild(imagePreload);
    }
  }, [isLarge]);

  const viewBox = variant === 'icon' ? '0 0 48 48' : '0 0 120 92';
  const height = variant === 'icon' ? width : width * 92 / 120;

  return h('svg', {
      className: `eh-logo eh-logo--${variant} ${className}`.trim(),
      width,
      height,
      viewBox,
      role: 'img',
      'aria-label': 'EH logo',
      focusable: 'false',
    },
    h('use', { href: `${LOGO_URL}#${symbol}` }),
  );
}
