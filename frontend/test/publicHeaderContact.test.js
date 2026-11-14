import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import ContactTopBar from '../src/ContactTopBar.js';
import { getMissingTranslationKeys, translate } from '../src/language.js';
import { PUBLIC_SITE_SETTINGS } from '../src/siteSettings.js';

const navigationSource = await readFile(new URL('../src/PublicNavigation.jsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('public header contact links use the central settings and correct display values', () => {
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, {
    contactInfo: { phone: '+251 11 123 4567', email: 'old@example.com' },
  }));

  assert.deepEqual(PUBLIC_SITE_SETTINGS.contact, {
    email: 'abebeke99@gmail.com',
    emailHref: 'mailto:abebeke99@gmail.com',
    phone: '0986481821',
    phoneHref: 'tel:+251986481821',
  });
  assert.match(markup, /href="tel:\+251986481821"/);
  assert.match(markup, /href="mailto:abebeke99@gmail\.com"/);
  assert.match(markup, />0986481821<\/span>/);
  assert.match(markup, />abebeke99@gmail\.com<\/span>/);
  assert.doesNotMatch(markup, /old@example\.com|\+251 11 123 4567/);
});

test('contact details remain separate while social icons align to the right on desktop', () => {
  const markup = renderToStaticMarkup(React.createElement(ContactTopBar, {
    environment: { VITE_FACEBOOK_URL: 'https://facebook.com/eventhub' },
    children: React.createElement('span', { id: 'language-switcher' }, 'English'),
  }));
  const leftContent = markup.match(/<div class="contact-top-bar-left">([\s\S]*?)<\/div>/)?.[1] || '';
  const actionsContent = markup.match(/<div class="contact-top-bar-actions">([\s\S]*?)<\/div><\/div><\/aside>/)?.[1] || '';

  assert.doesNotMatch(leftContent, /contact-top-bar-item/);
  assert.match(leftContent, /contact-top-bar-social/);
  assert.match(styleSource, /@media\(min-width:1100px\)\{[\s\S]*?\.contact-top-bar-inner\{[^}]*flex-direction:row-reverse/);
  assert.ok(actionsContent.indexOf('contact-top-bar-info') < actionsContent.indexOf('contact-top-bar-actions-divider'));
  assert.ok(actionsContent.indexOf('contact-top-bar-actions-divider') < actionsContent.indexOf('id="language-switcher"'));
});

test('mobile drawer shows full central contact details with tappable links', () => {
  assert.match(navigationSource, /import \{ PUBLIC_SITE_SETTINGS \} from '\.\/siteSettings\.js'/);
  assert.match(navigationSource, /href=\{phoneHref\}[\s\S]*?<span>\{phone\}<\/span>/);
  assert.match(navigationSource, /href=\{emailHref\}[\s\S]*?<span>\{email\}<\/span>/);
  assert.match(styleSource, /@media\(max-width:767px\)\{[\s\S]*?\.contact-top-bar-item\{width:44px;min-height:44px;flex:0 0 44px;justify-content:center\}[\s\S]*?\.contact-top-bar-item span\{display:none\}/);
  assert.match(styleSource, /\.contact-top-bar-item span\{[^}]*overflow:hidden;text-overflow:ellipsis/);
  assert.match(styleSource, /\.contact-top-bar a:focus-visible/);
});

test('tablet contact text stays visible and the top bar can wrap into a second row', () => {
  const tabletStyles = styleSource.match(/@media\(min-width:768px\) and \(max-width:1099px\)\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(tabletStyles, /\.contact-top-bar-inner\{flex-wrap:wrap/);
  assert.match(tabletStyles, /\.contact-top-bar-left\{flex:0 0 auto\}/);
  assert.match(tabletStyles, /\.contact-top-bar-actions\{flex:0 1 690px/);
  assert.doesNotMatch(tabletStyles, /\.contact-top-bar-item span\{display:none\}/);
});

test('contact labels have English and Amharic translations', () => {
  for (const key of ['topBarPhone', 'topBarEmail', 'topBarContactInfo']) {
    assert.ok(translate(key, 'en'), `missing English translation for ${key}`);
    assert.ok(translate(key, 'am'), `missing Amharic translation for ${key}`);
    assert.equal(getMissingTranslationKeys('am').includes(key), false, `missing Amharic translation for ${key}`);
  }
});
