import { createElement as h } from 'react';

export default function BrandLogo({
  size = '160px',
  className = '',
  linkTo = '/',
  onClick,
}) {
  const width = typeof size === 'number' ? `${size}px` : size;

  return h('a', {
    className: `brand-logo-link ${className}`.trim(),
    href: linkTo,
    onClick,
  }, h('img', {
    className: 'brand-logo-image',
    src: '/eventhub-logo.png',
    alt: 'EventHub – Plan. Book. Celebrate.',
    style: { width, height: 'auto', objectFit: 'contain' },
  }));
}
