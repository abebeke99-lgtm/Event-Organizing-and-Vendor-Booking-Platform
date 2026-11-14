import React, { createElement as h } from 'react';
import { Mail, Phone } from 'lucide-react';
import { translate, useLanguage } from './language.js';
import { getTopBarSocialLinks } from './socialLinks.js';
import SocialMediaLink from './SocialMediaLink.js';
import { PUBLIC_SITE_SETTINGS } from './siteSettings.js';

const viteEnvironment = typeof import.meta.env === 'undefined' ? {} : import.meta.env;

export default function ContactTopBar({
  environment = viteEnvironment,
  contactInfo = {},
  contactError = false,
  children,
}) {
  const language = useLanguage();
  const { email, emailHref, phone, phoneHref } = PUBLIC_SITE_SETTINGS.contact;
  const socialLinks = getTopBarSocialLinks(environment, contactInfo.socials);
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
        })),
      ),
      h('div', { className: 'contact-top-bar-actions' },
        h('div', { className: 'contact-top-bar-info' }, contactItems),
        children && h('span', {
          className: 'utility-divider contact-top-bar-actions-divider',
          'aria-hidden': 'true',
        }),
        children)),
    contactError && h('span', { className: 'visually-hidden', role: 'status' }, translate('contactInfoUnavailable', language)));
}
