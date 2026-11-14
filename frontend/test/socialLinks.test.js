import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '../src/language.js';
import { getFooterSocialLinks, getTopBarSocialLinks } from '../src/socialLinks.js';
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
    { id: 'facebook', labelKey: 'facebook', url: 'https://facebook.com/eventhub' },
    { id: 'x', labelKey: 'xSocial', url: null },
    { id: 'youtube', labelKey: 'youtube', url: null },
    { id: 'linkedin', labelKey: 'linkedin', url: 'https://linkedin.com/company/eventhub' },
    { id: 'instagram', labelKey: 'instagram', url: null },
    { id: 'telegram', labelKey: 'telegram', url: 'https://t.me/eventhub_official' },
  ]);
});

test('footer renders unconfigured social profiles as accessible non-links', () => {
  const links = getFooterSocialLinks({});
  assert.deepEqual(links.map(({ id }) => id), ['facebook', 'x', 'youtube', 'linkedin', 'instagram', 'telegram']);
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
    VITE_X_URL: 'https://x.com/',
    VITE_INSTAGRAM_URL: 'https://instagram.com/',
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

test('footer service categories link opens the service category listing', () => {
  const markup = renderToStaticMarkup(React.createElement(AppFooter));
  assert.match(markup, /href="\/service-categories">Service Categories<\/a>/);
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

test('contact top bar uses the central site contact settings', () => {
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, {
    contactInfo: {
      email: 'support@eventhub.test',
      phone: '+251 11 111 1111',
    },
  }));

  assert.match(markup, /href="mailto:abebeke99@gmail\.com"/);
  assert.match(markup, /aria-label="Email: abebeke99@gmail\.com"/);
  assert.match(markup, />abebeke99@gmail\.com<\/span>/);
  assert.match(markup, /href="tel:\+251986481821"/);
  assert.match(markup, /aria-label="Phone: 0986481821"/);
  assert.match(markup, />0986481821<\/span>/);
  assert.doesNotMatch(markup, /VITE_CONTACT_ADDRESS|Addis Ababa/);
});

test('contact top bar keeps central contacts and omits unconfigured social links', () => {
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, {
    environment: {
      VITE_TELEGRAM_URL: '',
      VITE_YOUTUBE_URL: '',
      VITE_FACEBOOK_URL: '',
      VITE_LINKEDIN_URL: '',
      VITE_X_URL: '',
      VITE_INSTAGRAM_URL: '',
    },
    contactInfo: { email: '', phone: '', socials: [] },
  }));

  assert.match(markup, /mailto:abebeke99@gmail\.com/);
  assert.match(markup, /href="tel:\+251986481821"/);
  assert.doesNotMatch(markup, /contact-top-bar-social|https:\/\/|unconfigured/);
});

test('top bar prefers configured site social profiles, including X and Instagram', () => {
  const settings = [
    { label: 'Instagram', url: 'https://www.instagram.com/eventhub' },
    { label: 'X', url: 'https://x.com/eventhub' },
    { label: 'Facebook', url: 'https://facebook.com/eventhub' },
    { label: 'Unrecognized', url: 'https://example.com/eventhub' },
    { label: 'YouTube', url: 'http://youtube.com/@eventhub' },
  ];
  assert.deepEqual(getTopBarSocialLinks({}, settings), [
    { id: 'facebook', labelKey: 'facebook', url: 'https://facebook.com/eventhub' },
    { id: 'x', labelKey: 'xSocial', url: 'https://x.com/eventhub' },
    { id: 'instagram', labelKey: 'instagram', url: 'https://www.instagram.com/eventhub' },
  ]);
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, {
    environment: {},
    contactInfo: { socials: settings },
  }));
  assert.match(markup, /href="https:\/\/x\.com\/eventhub"/);
  assert.match(markup, /href="https:\/\/www\.instagram\.com\/eventhub"/);
  assert.doesNotMatch(markup, /example\.com|youtube\.com/);
  assert.equal((markup.match(/target="_blank"/g) || []).length, 3);
  assert.equal((markup.match(/rel="noopener noreferrer"/g) || []).length, 3);
});

test('top bar renders only valid configured HTTPS profile URLs with safe, translated links', () => {
  const environment = {
    VITE_TELEGRAM_URL: 'https://t.me/eventhub',
    VITE_YOUTUBE_URL: 'http://youtube.com/@eventhub',
    VITE_FACEBOOK_URL: 'https://facebook.com/eventhub',
    VITE_LINKEDIN_URL: 'https://example.com/company/eventhub',
  };
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, { environment }));

  assert.deepEqual(getTopBarSocialLinks(environment), [
    { id: 'facebook', labelKey: 'facebook', url: 'https://facebook.com/eventhub' },
    { id: 'telegram', labelKey: 'telegram', url: 'https://t.me/eventhub' },
  ]);
  assert.deepEqual(
    Array.from(markup.matchAll(/href="(https:\/\/[^"]+)"/g), ([, href]) => href),
    ['https://facebook.com/eventhub', 'https://t.me/eventhub'],
  );
  assert.equal((markup.match(/target="_blank"/g) || []).length, 2);
  assert.equal((markup.match(/rel="noopener noreferrer"/g) || []).length, 2);
  assert.match(markup, /aria-label="EventHub on Telegram"/);
  assert.match(markup, /title="EventHub on Telegram"/);
  assert.match(markup, /aria-label="EventHub on Facebook"/);
  assert.match(markup, /title="EventHub on Facebook"/);
  assert.doesNotMatch(markup, /youtube|example\.com/);
});

test('top bar supports the supplied internationalized profile URLs', () => {
  const environment = {
    VITE_TELEGRAM_URL: 'https://t.me/የአንተ_ቻናል',
    VITE_YOUTUBE_URL: 'https://youtube.com/@የአንተ_ቻናል',
    VITE_FACEBOOK_URL: 'https://facebook.com/የአንተ_ገጽ',
    VITE_LINKEDIN_URL: 'https://linkedin.com/company/የአንተ_ገጽ',
    VITE_X_URL: 'https://x.com/የአንተ_ገጽ',
    VITE_INSTAGRAM_URL: 'https://instagram.com/የአንተ_ገጽ',
  };
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, { environment }));

  assert.equal(getTopBarSocialLinks(environment).length, 6);
  assert.match(markup, /href="tel:\+251986481821"/);
  assert.match(markup, /mailto:abebeke99@gmail\.com/);
  assert.equal((markup.match(/target="_blank"/g) || []).length, 6);
});

test('top bar contact and social labels are translated in Amharic', () => {
  assert.equal(translate('topBarContactInfo', 'am'), 'የመገኛ መረጃ');
  assert.equal(translate('topBarEmail', 'am'), 'ኢሜይል');
  assert.equal(translate('eventHubOn', 'am'), 'EventHub በ');
  assert.equal(translate('telegram', 'am'), 'ቴሌግራም');
  assert.equal(translate('youtube', 'am'), 'ዩቲዩብ');
  assert.equal(translate('facebook', 'am'), 'ፌስቡክ');
  assert.equal(translate('linkedin', 'am'), 'ሊንክድኢን');
  assert.equal(translate('xSocial', 'am'), 'X');
  assert.equal(translate('instagram', 'am'), 'ኢንስታግራም');
});

test('top bar social icon order follows the utility-bar configuration', () => {
  const links = getTopBarSocialLinks({
    VITE_TELEGRAM_URL: 'https://t.me/eventhub',
    VITE_YOUTUBE_URL: 'https://youtube.com/@eventhub',
    VITE_FACEBOOK_URL: 'https://facebook.com/eventhub',
    VITE_LINKEDIN_URL: 'https://linkedin.com/company/eventhub',
    VITE_X_URL: 'https://x.com/eventhub',
    VITE_INSTAGRAM_URL: 'https://instagram.com/eventhub',
  });

  assert.deepEqual(links.map(({ id }) => id), ['facebook', 'x', 'youtube', 'linkedin', 'instagram', 'telegram']);
});

test('top bar ignores invalid profile URLs without changing footer output', () => {
  assert.deepEqual(getTopBarSocialLinks({
    VITE_TELEGRAM_URL: 'https://user:password@t.me/eventhub',
    VITE_YOUTUBE_URL: 'not a URL',
    VITE_FACEBOOK_URL: 'https://facebook.com/',
    VITE_LINKEDIN_URL: 'javascript:alert(1)',
    VITE_X_URL: 'https://x.com/',
    VITE_INSTAGRAM_URL: 'https://instagram.com/',
  }), []);

  const footerWithProfiles = renderToStaticMarkup(React.createElement(AppFooter, {
    socialEnvironment: {
      VITE_TELEGRAM_URL: 'https://t.me/eventhub',
      VITE_YOUTUBE_URL: 'https://youtube.com/@eventhub',
      VITE_FACEBOOK_URL: 'https://facebook.com/eventhub',
      VITE_LINKEDIN_URL: 'https://linkedin.com/company/eventhub',
    },
  }));
  const footerWithoutProfiles = renderToStaticMarkup(React.createElement(AppFooter, {
    socialEnvironment: {},
  }));

  assert.equal(footerWithProfiles, footerWithoutProfiles);
});

test('example, development, and production env files expose configured social profile URLs', async () => {
  const expectedValues = {
    VITE_TELEGRAM_URL: 'https://t.me/የአንተ_ቻናል',
    VITE_YOUTUBE_URL: 'https://youtube.com/@የአንተ_ቻናል',
    VITE_FACEBOOK_URL: 'https://facebook.com/የአንተ_ገጽ',
    VITE_LINKEDIN_URL: 'https://linkedin.com/company/የአንተ_ገጽ',
  };

  for (const filename of ['../.env.example', '../.env.development', '../.env.production']) {
    const contents = await readFile(new URL(filename, import.meta.url), 'utf8');
    const lines = contents.split(/\r?\n/);
    for (const [key, value] of Object.entries(expectedValues)) {
      assert.ok(lines.includes(`${key}=${value}`), `${filename} should configure ${key}`);
    }
    assert.ok(!lines.some((line) => line.startsWith('VITE_CONTACT_PHONE=')), `${filename} should use central contact settings`);
  }
});
