import React from 'react';

const iconPaths = {
  telegram: React.createElement('path', { d: 'M21.8 3.2 18.7 20c-.2 1.2-.9 1.5-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6.1 13.6 1.2 12c-1.1-.3-1.1-1 .2-1.5L20.5 3c.9-.3 1.7.2 1.3 1.2Z' }),
  youtube: [
    React.createElement('path', { key: 'body', d: 'M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8Z' }),
    React.createElement('path', { key: 'play', className: 'social-icon-cutout', d: 'm9.6 15.5 6.2-3.5-6.2-3.5v7Z' }),
  ],
  facebook: React.createElement('path', { d: 'M13.5 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.5 1.6-1.5h1.7V3.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.3V13h2.8v8h3.4Z' }),
  linkedin: [
    React.createElement('path', { key: 'mark', d: 'M5.2 7.3a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM3.5 9h3.4v12H3.5zM9 9h3.2v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.3 4.3 5.2V21h-3.4v-6.3c0-1.5 0-3.4-2.1-3.4s-2.4 1.6-2.4 3.3V21H9V9Z' }),
  ],
};

function SocialMediaIcon({ platform }) {
  return React.createElement('svg', {
    className: 'social-media-icon',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false',
  }, iconPaths[platform]);
}

export default function SocialMediaLink({ platform, label, url, unconfiguredLabel = 'official profile not configured' }) {
  const icon = React.createElement(SocialMediaIcon, { platform });
  if (!url) {
    const accessibleLabel = `${label}, ${unconfiguredLabel}`;
    return React.createElement('span', {
      className: `footer-social-link footer-social-${platform} footer-social-link-unconfigured`,
      role: 'img',
      'aria-label': accessibleLabel,
      'aria-disabled': 'true',
      title: accessibleLabel,
    }, icon);
  }

  return React.createElement('a', {
    className: `footer-social-link footer-social-${platform}`,
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': label,
    title: label,
  }, icon);
}
