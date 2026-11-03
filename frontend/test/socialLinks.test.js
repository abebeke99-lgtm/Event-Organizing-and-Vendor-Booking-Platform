import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getFooterSocialLinks } from '../src/socialLinks.js';
import SocialMediaLink from '../src/SocialMediaLink.js';

test('footer only enables configured profile URLs', () => {
  const links = getFooterSocialLinks({
    VITE_EVENTHUB_TELEGRAM_URL: 'https://t.me/eventhub_official',
    VITE_EVENTHUB_YOUTUBE_URL: '',
    VITE_EVENTHUB_FACEBOOK_URL: 'https://www.facebook.com/eventhub',
    VITE_EVENTHUB_LINKEDIN_URL: 'https://www.linkedin.com/company/eventhub',
  });

  assert.deepEqual(links, [
    { id: 'telegram', labelKey: 'telegram', url: 'https://t.me/eventhub_official' },
    { id: 'youtube', labelKey: 'youtube', url: null },
    { id: 'facebook', labelKey: 'facebook', url: 'https://www.facebook.com/eventhub' },
    { id: 'linkedin', labelKey: 'linkedin', url: 'https://www.linkedin.com/company/eventhub' },
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
    VITE_EVENTHUB_TELEGRAM_URL: 'https://t.me/',
    VITE_EVENTHUB_YOUTUBE_URL: 'https://www.youtube.com/',
    VITE_EVENTHUB_FACEBOOK_URL: 'https://www.facebook.com/',
    VITE_EVENTHUB_LINKEDIN_URL: 'https://www.linkedin.com/',
  });
  assert.ok(links.every(({ url }) => url === null));
});

test('footer social links reject malformed or non-HTTPS URLs', () => {
  assert.throws(
    () => getFooterSocialLinks({ VITE_EVENTHUB_TELEGRAM_URL: 'javascript:alert(1)' }),
    /VITE_EVENTHUB_TELEGRAM_URL must be a valid HTTPS URL/,
  );
  assert.throws(
    () => getFooterSocialLinks({ VITE_EVENTHUB_YOUTUBE_URL: 'http://youtube.com/' }),
    /VITE_EVENTHUB_YOUTUBE_URL must be a valid HTTPS URL/,
  );
  assert.throws(
    () => getFooterSocialLinks({ VITE_EVENTHUB_FACEBOOK_URL: 'https://example.com/eventhub' }),
    /VITE_EVENTHUB_FACEBOOK_URL must be a valid HTTPS URL/,
  );
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
