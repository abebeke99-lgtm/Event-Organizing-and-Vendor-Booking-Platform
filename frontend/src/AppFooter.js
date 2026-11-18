import React, { createElement as h } from 'react';
import { translate, useLanguage } from './language.js';
import { getFooterSocialLinks } from './socialLinks.js';
import SocialMediaLink from './SocialMediaLink.js';
import BrandLogo from './components/common/BrandLogo.js';

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
    h('div', { className: 'footer-column min-w-0', key: 'brand' },
      h(BrandLogo, { className: 'footer-brand-logo-link', size: '160px', linkTo: '/' }),
      h('p', { className: 'text-sm leading-7 text-slate-300 max-w-xs' }, platformDescription || translate('footerDescription', language))),
    h('div', { className: 'footer-column min-w-0', key: 'explore' },
      h('h4', { className: 'text-white font-semibold mb-2' }, translate('explore', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/events' }, translate('browseEvents', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/vendors' }, translate('findVendorsNav', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/services' }, translate('browseServices', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/service-categories' }, translate('serviceCategories', language))),
    h('div', { className: 'footer-column min-w-0', key: 'support' },
      h('h4', { className: 'text-white font-semibold mb-2' }, translate('support', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/help' }, translate('helpCenter', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/help' }, translate('frequentlyAskedQuestions', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/help' }, translate('bookingGuide', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/contact' }, translate('contactSupport', language))),
    h('div', { className: 'footer-column footer-legal-column min-w-0', key: 'legal' },
      h('h4', { className: 'text-white font-semibold mb-2' }, translate('legal', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/terms' }, translate('termsConditions', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/privacy' }, translate('privacyPolicy', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/cookie-policy' }, translate('cookiePolicy', language)),
      h('a', { className: 'hover:text-white/90 transition', href: '/refund-policy' }, translate('refundPolicy', language)),
      h('div', { className: 'footer-attribution text-xs text-slate-300/90' },
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

  return h('footer', { className: 'site-footer w-full bg-slate-900 text-slate-200' },
    h('div', { className: 'site-footer-inner mx-auto grid w-full max-w-[1520px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8' }, columns),
    supportPhone && h('div', { className: 'site-footer-bottom mx-auto w-full max-w-[1520px] px-4 pb-8 sm:px-6 lg:px-8' },
      h('a', { className: 'text-slate-300 hover:text-white', href: `tel:${supportPhone.replace(/[^\d+]/g, '')}` }, supportPhone)));
}
