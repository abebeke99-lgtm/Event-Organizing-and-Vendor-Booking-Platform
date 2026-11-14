import React, { createElement as h } from 'react';
import { translate, useLanguage } from './language.js';
import { getFooterSocialLinks } from './socialLinks.js';
import SocialMediaLink from './SocialMediaLink.js';
import Logo from './components/Logo.js';

const SHOW_FOOTER_CONTACT = false;

export default function AppFooter({ socialEnvironment }) {
  const language = useLanguage();
  const branding = typeof document === 'undefined' ? {} : document.documentElement.dataset;
  const platformName = branding.platformName || 'EventHub';
  const platformDescription = branding.platformDescription || '';
  const supportPhone = branding.supportPhone || '';
  const configuredSocialLinks = SHOW_FOOTER_CONTACT
    ? getFooterSocialLinks(socialEnvironment).filter((social) => social.url)
    : [];
  const currentYear = new Date().getFullYear();

  const columns = [
    h('div', { className: 'footer-column', key: 'brand' },
      h('div', { className: 'brand-pill' }, h(Logo, { className: 'footer-brand-logo', size: 'xs', variant: 'mono-white' }), h('strong', { className: 'footer-brand-name' }, platformName)),
      h('p', null, platformDescription || translate('footerDescription', language))),
    h('div', { className: 'footer-column', key: 'explore' },
      h('h4', null, translate('explore', language)),
      h('a', { href: '/events' }, translate('browseEvents', language)),
      h('a', { href: '/vendors' }, translate('findVendorsNav', language)),
      h('a', { href: '/services' }, translate('browseServices', language)),
      h('a', { href: '/service-categories' }, translate('serviceCategories', language))),
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
      h('a', { href: '/cookie-policy' }, translate('cookiePolicy', language)),
      h('a', { href: '/refund-policy' }, translate('refundPolicy', language)),
      h('div', { className: 'footer-attribution' },
        h('span', null, translate('footerCopyright', language).replace('{year}', String(currentYear))),
        h('span', null, translate('footerDeveloper', language)))),
  ];

  if (SHOW_FOOTER_CONTACT) {
    columns.push(h('div', { className: 'footer-column footer-contact-column', key: 'contact' },
      h('h4', null, translate('contactUsNav', language)),
      branding.supportEmail && h('a', {
        className: 'footer-contact-email',
        href: `mailto:${branding.supportEmail}`,
        'aria-label': `${translate('emailAddress', language)}: ${branding.supportEmail}`,
      }, h('span', null, branding.supportEmail)),
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
