import React, { createElement as h } from 'react';
import { Mail, Phone } from 'lucide-react';
import { translate, useLanguage } from './language.js';
import { getTopBarSocialLinks } from './socialLinks.js';
import { PUBLIC_SITE_SETTINGS } from './siteSettings.js';

const viteEnvironment = typeof import.meta.env === 'undefined' ? {} : import.meta.env;

const TOP_BAR_SOCIAL_LINKS = [
  {
    id: 'telegram',
    label: 'Telegram',
    url: 'https://t.me/yourusername',
    paths: [{ d: 'M21.8 3.2 18.7 20c-.2 1.2-.9 1.5-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6.1 13.6 1.2 12c-1.1-.3-1.1-1 .2-1.5L20.5 3c.9-.3 1.7.2 1.3 1.2Z' }],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    url: 'https://facebook.com/yourpage',
    paths: [{ d: 'M13.5 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.5 1.6-1.5h1.7V3.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.3V13h2.8v8h3.4Z' }],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    url: 'https://youtube.com/@yourchannel',
    paths: [
      { d: 'M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8Z' },
      { d: 'm9.6 15.5 6.2-3.5-6.2-3.5v7Z', fill: 'var(--public-utility)' },
    ],
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    url: 'https://linkedin.com/company/yourpage',
    paths: [{ d: 'M5.2 7.3a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM3.5 9h3.4v12H3.5zM9 9h3.2v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.3 4.3 5.2V21h-3.4v-6.3c0-1.5 0-3.4-2.1-3.4s-2.4 1.6-2.4 3.3V21H9V9Z' }],
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    url: 'https://wa.me/251986481821',
    paths: [{ d: 'M20.5 3.5A11.8 11.8 0 0 0 2 17.7L.5 23.5l6-1.6a11.8 11.8 0 0 0 14-18.4ZM12 21a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.5.9.9-3.4-.2-.4A9.8 9.8 0 1 1 12 21Zm5.4-7.3c-.3-.2-1.7-.8-2-.9-.3-.1-.5-.2-.7.2s-.8.9-.9 1.1-.3.2-.6.1a8 8 0 0 1-2.4-1.5 9 9 0 0 1-1.7-2.1c-.2-.3 0-.5.1-.6l.5-.6.3-.5c.1-.2 0-.4 0-.5s-.7-1.6-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4s-1 1-1 2.4 1 2.8 1.2 3c.1.2 2 3.1 4.8 4.3.7.3 1.2.5 1.7.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.2-.3-.3-.6-.4Z' }],
  },
];

function renderSocialLink(social, language) {
  const platformLabel = translate(social.id === 'youtube' ? 'youtube'
    : social.id === 'linkedin' ? 'linkedin'
    : social.id === 'facebook' ? 'facebook'
    : social.id === 'telegram' ? 'telegram'
    : social.id === 'whatsapp' ? 'whatsapp'
    : social.id, language);
  const label = `${translate('eventHubOn', language)} ${platformLabel}`;
  return h('li', { key: social.id },
    h('a', {
      className: `footer-social-link footer-social-${social.id}`,
      href: social.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      'aria-label': label,
      title: label,
    }, h('svg', {
      className: 'social-media-icon',
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
      focusable: 'false',
    }, social.paths.map((path, index) => h('path', { key: index, ...path })))));
}

export default function ContactTopBar({
  environment = viteEnvironment,
  contactInfo = {},
  contactError = false,
  children,
}) {
  const language = useLanguage();
  const { email, emailHref, phone, phoneHref } = PUBLIC_SITE_SETTINGS.contact;
  const configuredSocialLinks = new Map(
    getTopBarSocialLinks(environment, contactInfo.socials).map(({ id, url }) => [id, url]),
  );
  const socialLinks = TOP_BAR_SOCIAL_LINKS.map((social) => ({
    ...social,
    url: configuredSocialLinks.get(social.id) || social.url,
  }));
  const contactItems = [];

  contactItems.push(h('a', {
    key: 'phone',
    className: 'contact-top-bar-item contact-top-bar-phone',
    href: phoneHref,
    'aria-label': `${translate('topBarPhone', language)}: ${phone}`,
  }, h(Phone, { size: 15, 'aria-hidden': 'true' }), h('span', null, phone)));
  contactItems.push(h('span', {
    key: 'divider',
    className: 'contact-top-bar-divider',
    'aria-hidden': 'true',
  }));
  contactItems.push(h('a', {
    key: 'email',
    className: 'contact-top-bar-item contact-top-bar-email',
    href: emailHref,
    'aria-label': `${translate('topBarEmail', language)}: ${email}`,
  }, h(Mail, { size: 15, 'aria-hidden': 'true' }), h('span', null, email)));

  return h('aside', {
    className: 'contact-top-bar',
    'aria-label': translate('topBarContactInfo', language),
  },
    h('div', { className: 'contact-top-bar-inner' },
      h('div', { className: 'contact-top-bar-left' },
        h('div', { className: 'contact-top-bar-info' },
          ...contactItems,
          h('span', {
            className: 'contact-top-bar-divider contact-top-bar-social-divider',
            'aria-hidden': 'true',
          }),
          h('ul', {
            className: 'contact-top-bar-social contact-top-bar-social-icons',
            'aria-label': translate('topBarSocialLinks', language),
          }, socialLinks.map((social) => renderSocialLink(social, language))),
        ),
      ),
      h('div', { className: 'contact-top-bar-actions' },
        children && h('span', {
          className: 'utility-divider contact-top-bar-actions-divider',
          'aria-hidden': 'true',
        }),
        children)),
    contactError && h('span', { className: 'visually-hidden', role: 'status' }, translate('contactInfoUnavailable', language)));
}
