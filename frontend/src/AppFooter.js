import React, { createElement as h } from 'react';
import { Mail } from 'lucide-react';
import { translate, useLanguage } from './language.js';
import { getFooterSocialLinks } from './socialLinks.js';
import SocialMediaLink from './SocialMediaLink.js';

const SHOW_FOOTER_CONTACT = false;

export default function AppFooter({ socialEnvironment }) {
  const language = useLanguage();
  const branding = typeof document === 'undefined' ? {} : document.documentElement.dataset;
  const platformName = branding.platformName || 'EventHub';
  const platformDescription = branding.platformDescription || '';
  const platformLogo = branding.brandingLogoUrl || '';
  const supportPhone = branding.supportPhone || '';
  const supportEmail = 'abebeke99@gmail.com';
  const configuredSocialLinks = SHOW_FOOTER_CONTACT
    ? getFooterSocialLinks(socialEnvironment).filter((social) => social.url)
    : [];
  const currentYear = new Date().getFullYear();

  const columns = [
    h('div', { className: 'footer-column', key: 'brand' },
      h('div', { className: 'brand-pill' }, h('img', { className: 'footer-brand-logo', src: platformLogo || '/eventhub-logo.png', alt: platformName })),
      h('p', null, platformDescription || translate('footerDescription', language))),
    h('div', { className: 'footer-column', key: 'explore' },
      h('h4', null, translate('explore', language)),
      h('a', { href: '/events' }, translate('browseEvents', language)),
      h('a', { href: '/vendors' }, translate('findVendorsNav', language)),
      h('a', { href: '/services' }, translate('browseServices', language)),
      h('a', { href: '/categories' }, translate('serviceCategories', language))),
    h('div', { className: 'footer-column', key: 'support' },
      h('h4', null, translate('support', language)),
      h('a', { href: '/help' }, translate('helpCenter', language)),
      h('a', { href: '/help' }, translate('frequentlyAskedQuestions', language)),
      h('a', { href: '/help' }, translate('bookingGuide', language)),
      h('a', { href: '/contact' }, translate('contactSupport', language))),
    h('div', { className: 'footer-column footer-legal-column', key: 'legal' },
      h('h4', null, translate('legal', language)),
      h('a', { href: '/terms' }, translate('termsConditions', language)),
      h('a', { href: '/privacy' }, translate('privacyPolicy', language)),
      h('a', { href: '/help' }, translate('cookiePolicy', language)),
      h('a', { href: '/terms' }, translate('refundPolicy', language)),
      h('div', { className: 'footer-attribution' },
        h('span', null, translate('footerCopyright', language).replace('{year}', String(currentYear))),
        h('span', null, translate('footerDeveloper', language)))),
  ];

  if (SHOW_FOOTER_CONTACT) {
    columns.push(h('div', { className: 'footer-column footer-contact-column', key: 'contact' },
      h('h4', null, translate('contactUsNav', language)),
      h('a', {
        className: 'footer-contact-email',
        href: `mailto:${supportEmail}`,
        'aria-label': `${translate('emailAddress', language)}: ${supportEmail}`,
      }, h(Mail, { size: 16, 'aria-hidden': 'true' }), h('span', null, supportEmail)),
      configuredSocialLinks.length > 0
        ? h('div', { className: 'footer-social-links footer-contact-social-links' },
          configuredSocialLinks.map((social) => h(SocialMediaLink, {
            key: social.id,
            platform: social.id,
            label: `${platformName} on ${translate(social.labelKey, language)}`,
            url: social.url,
          })))
        : h('p', { className: 'footer-social-notice' }, translate('socialLinksUnconfigured', language))));
  }

  return h('footer', { className: 'site-footer' },
    h('div', { className: 'site-footer-inner' }, columns),
    supportPhone && h('div', { className: 'site-footer-bottom' },
      h('a', { href: `tel:${supportPhone.replace(/[^\d+]/g, '')}` }, supportPhone)));
}
