import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { getFooterSocialLinks } from '../src/socialLinks.js';
import SocialMediaLink from '../src/SocialMediaLink.js';
import AppFooter from '../src/AppFooter.js';
import ContactTopBar from '../src/ContactTopBar.js';

test('footer only enables configured profile URLs', () => {
  const links = getFooterSocialLinks({
    VITE_TELEGRAM_URL: 'https://t.me/eventhub_official',
    VITE_YOUTUBE_URL: '',
    VITE_FACEBOOK_URL: 'https://facebook.com/eventhub',
    VITE_LINKEDIN_URL: 'https://linkedin.com/company/eventhub',
  });

  assert.deepEqual(links, [
    { id: 'telegram', labelKey: 'telegram', url: 'https://t.me/eventhub_official' },
    { id: 'youtube', labelKey: 'youtube', url: null },
    { id: 'facebook', labelKey: 'facebook', url: 'https://facebook.com/eventhub' },
    { id: 'linkedin', labelKey: 'linkedin', url: 'https://linkedin.com/company/eventhub' },
  ]);
});

test('footer renders unconfigured social profiles as accessible non-links', () => {
  const links = getFooterSocialLinks({});
  assert.deepEqual(links.map(({ id }) => id), ['telegram', 'youtube', 'facebook', 'linkedin']);
  for (const { id, url } of links) {
    assert.equal(url, null);
    const markup = renderToStaticMarkup(React.createElement(SocialMediaLink, {
      platform: id,
      label: id,
      url,
      unconfiguredLabel: 'official profile not configured',
    }));
    assert.match(markup, /<span[^>]*role="img"/);
    assert.match(markup, /aria-disabled="true"/);
    assert.match(markup, /aria-label="[^"]+, official profile not configured"/);
    assert.doesNotMatch(markup, /href=/);
  }
});

test('platform root URLs are treated as unconfigured rather than official profiles', () => {
  const links = getFooterSocialLinks({
    VITE_TELEGRAM_URL: 'https://t.me/',
    VITE_YOUTUBE_URL: 'https://youtube.com/',
    VITE_FACEBOOK_URL: 'https://facebook.com/',
    VITE_LINKEDIN_URL: 'https://linkedin.com/',
  });
  assert.ok(links.every(({ url }) => url === null));
});

test('footer social links reject malformed or non-HTTPS URLs', () => {
  assert.throws(
    () => getFooterSocialLinks({ VITE_TELEGRAM_URL: 'javascript:alert(1)' }),
    /VITE_TELEGRAM_URL must be a valid HTTPS URL/,
  );
  assert.throws(
    () => getFooterSocialLinks({ VITE_YOUTUBE_URL: 'http://youtube.com/' }),
    /VITE_YOUTUBE_URL must be a valid HTTPS URL/,
  );
  assert.throws(
    () => getFooterSocialLinks({ VITE_FACEBOOK_URL: 'https://example.com/eventhub' }),
    /VITE_FACEBOOK_URL must be a valid HTTPS URL/,
  );
});

test('footer omits the contact column and social links when profiles are configured', () => {
  const markup = renderToStaticMarkup(React.createElement(AppFooter, {
    socialEnvironment: {
      VITE_TELEGRAM_URL: 'https://t.me/YOUR_CHANNEL',
      VITE_YOUTUBE_URL: 'https://youtube.com/@YOUR_CHANNEL',
      VITE_FACEBOOK_URL: 'https://facebook.com/YOUR_PAGE',
      VITE_LINKEDIN_URL: 'https://linkedin.com/company/YOUR_PAGE',
    },
  }));
  assert.doesNotMatch(markup, /Contact Us|mailto:|EventHub on (?:Telegram|YouTube|Facebook|LinkedIn)/);
  assert.doesNotMatch(markup, /t\.me\/YOUR_CHANNEL|youtube\.com\/@YOUR_CHANNEL|facebook\.com\/YOUR_PAGE|linkedin\.com\/company\/YOUR_PAGE/);
});

test('footer does not render a contact column or setup notice when profiles are empty', () => {
  const markup = renderToStaticMarkup(React.createElement(AppFooter, {
    socialEnvironment: {
      VITE_TELEGRAM_URL: '',
      VITE_YOUTUBE_URL: '',
      VITE_FACEBOOK_URL: '',
      VITE_LINKEDIN_URL: '',
    },
  }));

  assert.doesNotMatch(markup, /Contact Us|mailto:|Official social profile links are not configured yet\./);
  assert.doesNotMatch(markup, /EventHub on (?:Telegram|YouTube|Facebook|LinkedIn)/);
});

test('footer contact column is not rendered while SHOW_FOOTER_CONTACT is false', () => {
  const markup = renderToStaticMarkup(React.createElement(AppFooter));

  assert.doesNotMatch(markup, /footer-contact-column|footer-contact-email|footer-social-links|footer-social-notice/);
  assert.doesNotMatch(markup, /Contact Us|abebeke99@gmail\.com|Official social profile links are not configured yet\./);
});

test('footer places copyright and developer credit at the right of the Legal column', () => {
  const year = new Date().getFullYear();
  const markup = renderToStaticMarkup(React.createElement(AppFooter));
  const legalColumn = markup.match(/class="footer-column footer-legal-column"[\s\S]*?<\/div>/)?.[0];
  assert.ok(legalColumn?.includes(`class="footer-attribution"><span>${year} EventHub. All Rights Reserved.</span><span>Developed by Bekele Abebe</span></div>`));
  assert.doesNotMatch(markup.match(/class="site-footer-bottom"[\s\S]*?<\/div>/)?.[0] || '', /footer-attribution/);
});

test('footer credit aligns to the right of Legal without adding a divider', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const attribution = styles.match(/\.footer-legal-column \.footer-attribution\{([^}]*)\}/)?.[1];

  assert.ok(attribution);
  assert.match(attribution, /justify-self:\s*end/);
  assert.match(attribution, /text-align:\s*right/);
  assert.doesNotMatch(styles.match(/\.site-footer-bottom\{([^}]*)\}/)?.[1] || '', /border-top/);
});

test('social media links open safely in a new tab and expose an accessible label', () => {
  const markup = renderToStaticMarkup(React.createElement(SocialMediaLink, {
    platform: 'telegram',
    label: 'Telegram',
    url: 'https://t.me/eventhub_official',
  }));

  assert.match(markup, /href="https:\/\/t\.me\/eventhub_official"/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.match(markup, /aria-label="Telegram"/);
  assert.match(markup, /title="Telegram"/);
  assert.match(markup, /<svg[^>]*aria-hidden="true"/);
});

test('contact top bar renders email, optional phone and address, and configured social icons', () => {
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, {
    environment: {
      VITE_CONTACT_PHONE: '0986481821',
      VITE_CONTACT_ADDRESS: 'Addis Ababa',
      VITE_TELEGRAM_URL: 'https://t.me/eventhub',
      VITE_YOUTUBE_URL: '',
      VITE_FACEBOOK_URL: 'https://facebook.com/eventhub',
      VITE_LINKEDIN_URL: '',
    },
  }));

  assert.match(markup, /href="mailto:abebeke99@gmail\.com"/);
  assert.match(markup, /href="tel:0986481821"/);
  assert.match(markup, /Addis Ababa/);
  assert.match(markup, /href="https:\/\/t\.me\/eventhub"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(markup, /href="https:\/\/facebook\.com\/eventhub"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.doesNotMatch(markup, /youtube|linkedin/i);
});

test('contact top bar hides empty phone and address values and renders no social area without configured URLs', () => {
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, {
    environment: {
      VITE_CONTACT_PHONE: '',
      VITE_CONTACT_ADDRESS: '',
      VITE_TELEGRAM_URL: '',
      VITE_YOUTUBE_URL: '',
      VITE_FACEBOOK_URL: '',
      VITE_LINKEDIN_URL: '',
    },
  }));

  assert.match(markup, /href="mailto:abebeke99@gmail\.com"/);
  assert.doesNotMatch(markup, /href="tel:/);
  assert.doesNotMatch(markup, /contact-top-bar-address/);
  assert.doesNotMatch(markup, /contact-top-bar-social/);
});
