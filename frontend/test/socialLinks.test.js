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

test('contact top bar always renders the configured email and only includes an optional phone', () => {
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, {
    environment: {
      VITE_CONTACT_PHONE: '+251986481821',
    },
  }));

  assert.match(markup, /href="mailto:abebeke99@gmail\.com"/);
  assert.match(markup, /aria-label="Email: abebeke99@gmail\.com"/);
  assert.match(markup, /href="tel:\+251986481821"/);
  assert.match(markup, /aria-label="Phone: \+251986481821"/);
  assert.doesNotMatch(markup, /VITE_CONTACT_ADDRESS|Addis Ababa/);
});

test('contact top bar omits an empty optional phone and has no social list when URLs are empty', () => {
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, {
    environment: {
      VITE_CONTACT_PHONE: '',
      VITE_TELEGRAM_URL: '',
      VITE_YOUTUBE_URL: '',
      VITE_FACEBOOK_URL: '',
      VITE_LINKEDIN_URL: '',
    },
  }));

  assert.match(markup, /href="mailto:abebeke99@gmail\.com"/);
  assert.doesNotMatch(markup, /href="tel:|contact-top-bar-social|https:\/\/|unconfigured/);
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
    { id: 'telegram', labelKey: 'telegram', url: 'https://t.me/eventhub' },
    { id: 'facebook', labelKey: 'facebook', url: 'https://facebook.com/eventhub' },
  ]);
  assert.deepEqual(
    Array.from(markup.matchAll(/href="(https:\/\/[^"]+)"/g), ([, href]) => href),
    ['https://t.me/eventhub', 'https://facebook.com/eventhub'],
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
    VITE_CONTACT_PHONE: '+251986481821',
  };
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, { environment }));

  assert.equal(getTopBarSocialLinks(environment).length, 4);
  assert.match(markup, /href="tel:\+251986481821"/);
  assert.equal((markup.match(/target="_blank"/g) || []).length, 4);
});

test('top bar contact and social labels are translated in Amharic', () => {
  assert.equal(translate('topBarContactInfo', 'am'), 'የመገኛ መረጃ');
  assert.equal(translate('topBarEmail', 'am'), 'ኢሜይል');
  assert.equal(translate('eventHubOn', 'am'), 'EventHub በ');
  assert.equal(translate('telegram', 'am'), 'ቴሌግራም');
  assert.equal(translate('youtube', 'am'), 'ዩቲዩብ');
  assert.equal(translate('facebook', 'am'), 'ፌስቡክ');
  assert.equal(translate('linkedin', 'am'), 'ሊንክድኢን');
});

test('top bar social icon order follows Telegram, YouTube, Facebook, LinkedIn', () => {
  const links = getTopBarSocialLinks({
    VITE_TELEGRAM_URL: 'https://t.me/eventhub',
    VITE_YOUTUBE_URL: 'https://youtube.com/@eventhub',
    VITE_FACEBOOK_URL: 'https://facebook.com/eventhub',
    VITE_LINKEDIN_URL: 'https://linkedin.com/company/eventhub',
  });

  assert.deepEqual(links.map(({ id }) => id), ['telegram', 'youtube', 'facebook', 'linkedin']);
});

test('top bar ignores invalid profile URLs without changing footer output', () => {
  assert.deepEqual(getTopBarSocialLinks({
    VITE_TELEGRAM_URL: 'https://user:password@t.me/eventhub',
    VITE_YOUTUBE_URL: 'not a URL',
    VITE_FACEBOOK_URL: 'https://facebook.com/',
    VITE_LINKEDIN_URL: 'javascript:alert(1)',
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

test('example, development, and production env files expose configured public contact details', async () => {
  const expectedValues = {
    VITE_TELEGRAM_URL: 'https://t.me/የአንተ_ቻናል',
    VITE_YOUTUBE_URL: 'https://youtube.com/@የአንተ_ቻናል',
    VITE_FACEBOOK_URL: 'https://facebook.com/የአንተ_ገጽ',
    VITE_LINKEDIN_URL: 'https://linkedin.com/company/የአንተ_ገጽ',
    VITE_CONTACT_PHONE: '+251986481821',
  };

  for (const filename of ['../.env.example', '../.env.development', '../.env.production']) {
    const contents = await readFile(new URL(filename, import.meta.url), 'utf8');
    const lines = contents.split(/\r?\n/);
    for (const [key, value] of Object.entries(expectedValues)) {
      assert.ok(lines.includes(`${key}=${value}`), `${filename} should configure ${key}`);
    }
  }
});
