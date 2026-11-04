import React, { createElement as h } from 'react';
import { Mail, Phone } from 'lucide-react';
import { translate, useLanguage } from './language.js';
import { getTopBarSocialLinks } from './socialLinks.js';
import SocialMediaLink from './SocialMediaLink.js';

const CONTACT_EMAIL = 'abebeke99@gmail.com';
const viteEnvironment = typeof import.meta.env === 'undefined' ? {} : import.meta.env;

export default function ContactTopBar({ environment = viteEnvironment }) {
  const language = useLanguage();
  const phone = environment.VITE_CONTACT_PHONE?.trim();
  const socialLinks = getTopBarSocialLinks(environment);
  const items = [
    h('a', {
      key: 'email',
      className: 'contact-top-bar-item contact-top-bar-email',
      href: `mailto:${CONTACT_EMAIL}`,
      'aria-label': `${translate('topBarEmail', language)}: ${CONTACT_EMAIL}`,
    }, h(Mail, { size: 16, 'aria-hidden': 'true' }), h('span', null, CONTACT_EMAIL)),
  ];

  if (phone) {
    items.push(h('a', {
      key: 'phone',
      className: 'contact-top-bar-item contact-top-bar-phone',
      href: `tel:${phone.replace(/[^\d+]/g, '')}`,
      'aria-label': `${translate('topBarPhone', language)}: ${phone}`,
    }, h(Phone, { size: 16, 'aria-hidden': 'true' }), h('span', null, phone)));
  }

  return h('aside', {
    className: `contact-top-bar${socialLinks.length ? ' contact-top-bar-has-socials' : ''}`,
    'aria-label': translate('topBarContactInfo', language),
  },
    h('div', { className: 'contact-top-bar-inner' },
      h('div', { className: 'contact-top-bar-info' }, items),
      socialLinks.length > 0 && h('ul', {
        className: 'contact-top-bar-social',
        'aria-label': translate('topBarSocialLinks', language),
      }, socialLinks.map((social) => {
        const label = `${translate('eventHubOn', language)} ${translate(social.labelKey, language)}`;
        return h('li', { key: social.id },
          h(SocialMediaLink, {
            platform: social.id,
            label,
            url: social.url,
          }));
      }))));
}
