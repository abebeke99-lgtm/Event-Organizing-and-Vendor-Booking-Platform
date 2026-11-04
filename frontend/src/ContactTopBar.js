import React, { createElement as h } from 'react';
import { Clock3, Mail, MapPin, Phone } from 'lucide-react';
import { translate, useLanguage } from './language.js';
import { getFooterSocialLinks } from './socialLinks.js';
import SocialMediaLink from './SocialMediaLink.js';

const viteEnvironment = typeof import.meta.env === 'undefined' ? {} : {
  VITE_CONTACT_PHONE: import.meta.env.VITE_CONTACT_PHONE,
  VITE_CONTACT_ADDRESS: import.meta.env.VITE_CONTACT_ADDRESS,
  VITE_TELEGRAM_URL: import.meta.env.VITE_TELEGRAM_URL,
  VITE_YOUTUBE_URL: import.meta.env.VITE_YOUTUBE_URL,
  VITE_FACEBOOK_URL: import.meta.env.VITE_FACEBOOK_URL,
  VITE_LINKEDIN_URL: import.meta.env.VITE_LINKEDIN_URL,
};

const supportEmail = 'abebeke99@gmail.com';

export default function ContactTopBar({ environment = viteEnvironment }) {
  const language = useLanguage();
  const phone = environment.VITE_CONTACT_PHONE?.trim();
  const address = environment.VITE_CONTACT_ADDRESS?.trim();
  const socialLinks = getFooterSocialLinks(environment).filter((social) => social.url);
  const infoItems = [
    h('a', {
      key: 'email',
      className: 'contact-top-bar-item contact-top-bar-email',
      href: `mailto:${supportEmail}`,
      'aria-label': `${translate('topBarEmail', language)}: ${supportEmail}`,
    }, h(Mail, { size: 16, 'aria-hidden': 'true' }), h('span', null, supportEmail)),
    h('span', {
      key: 'hours',
      className: 'contact-top-bar-item contact-top-bar-hours',
      'aria-label': `${translate('topBarWorkingHours', language)}: ${translate('topBarWorkingDays', language)}`,
    }, h(Clock3, { size: 16, 'aria-hidden': 'true' }), h('span', null, translate('topBarWorkingDays', language))),
  ];

  if (phone) {
    infoItems.push(h('a', {
      key: 'phone',
      className: 'contact-top-bar-item contact-top-bar-phone',
      href: `tel:${phone.replace(/[^\d+]/g, '')}`,
      'aria-label': `${translate('topBarPhone', language)}: ${phone}`,
    }, h(Phone, { size: 16, 'aria-hidden': 'true' }), h('span', null, phone)));
  }

  if (address) {
    infoItems.push(h('span', {
      key: 'address',
      className: 'contact-top-bar-item contact-top-bar-address',
      'aria-label': `${translate('topBarAddress', language)}: ${address}`,
    }, h(MapPin, { size: 16, 'aria-hidden': 'true' }), h('span', null, address)));
  }

  return h('div', { className: 'contact-top-bar', role: 'region', 'aria-label': translate('topBarContactInfo', language) },
    h('div', { className: 'contact-top-bar-inner' },
      h('div', { className: 'contact-top-bar-info' }, infoItems),
      socialLinks.length > 0 && h('div', { className: 'contact-top-bar-social', 'aria-label': translate('topBarSocialLinks', language) },
        socialLinks.map((social) => h(SocialMediaLink, {
          key: social.id,
          platform: social.id,
          label: `${translate('eventHubOn', language)} ${translate(social.labelKey, language)}`,
          url: social.url,
        })))));
}
