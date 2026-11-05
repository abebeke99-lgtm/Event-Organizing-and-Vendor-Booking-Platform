import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import {
  getNextHeroSlideIndex,
  normalizeHeroSlides,
  reorderHeroSlides,
  validateHeroSlideFile,
  validateHeroSlideLink,
} from '../src/heroSlidesUtils.js';
import { translate } from '../src/language.js';

const validSlides = [
  { id: 2, imageUrl: '/api/hero-slides/2/image', altText: 'Second', sortOrder: 2 },
  { id: 1, imageUrl: '/api/hero-slides/1/image', altText: 'First', sortOrder: 1 },
];

test('hero slide normalization keeps valid slides in sort order and safely handles empty responses', () => {
  assert.deepEqual(normalizeHeroSlides(validSlides).map((slide) => slide.id), [1, 2]);
  assert.deepEqual(normalizeHeroSlides([{ ...validSlides[0], imageUrl: '/uploads/image.png' }]), []);
  assert.deepEqual(normalizeHeroSlides(null), []);
});

test('hero slider arrows wrap around and slide reordering is bounded', () => {
  assert.equal(getNextHeroSlideIndex(1, 2), 0);
  assert.equal(getNextHeroSlideIndex(0, 2, -1), 1);
  assert.equal(getNextHeroSlideIndex(4, 0), 0);
  assert.deepEqual(reorderHeroSlides(validSlides, 0, 1).map((slide) => slide.id), [1, 2]);
  assert.equal(reorderHeroSlides(validSlides, 0, -1), validSlides);
});

test('hero upload helpers validate file type, size, and internal or HTTPS links', () => {
  assert.equal(validateHeroSlideFile({ name: 'hero.webp', type: 'image/webp', size: 12 }), '');
  assert.match(validateHeroSlideFile({ name: 'hero.png', type: 'image/jpeg', size: 12 }), /matching JPG/);
  assert.match(validateHeroSlideFile({ name: 'hero.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 }), /5 MB/);
  assert.equal(validateHeroSlideLink('/events/12?tab=details'), '');
  assert.equal(validateHeroSlideLink('https://example.test/events'), '');
  assert.match(validateHeroSlideLink('//example.test'), /internal path or a valid HTTPS/);
  assert.match(validateHeroSlideLink('javascript:alert(1)'), /internal path or a valid HTTPS/);
});

test('hero image labels are translated in English and Amharic', () => {
  assert.equal(translate('adminHeroImagesTitle', 'en'), 'Hero Images');
  assert.equal(translate('adminHeroImagesTitle', 'am'), 'የጀግና ምስሎች');
  assert.equal(translate('heroPreviousSlide', 'en'), 'Previous slide');
  assert.equal(translate('heroPreviousSlide', 'am'), 'ያለፈው ስላይድ');
});

test('Home slider and Admin page expose the expected accessible controls and management actions', async () => {
  const sliderSource = await readFile(new URL('../src/HomeHeroSlider.jsx', import.meta.url), 'utf8');
  const venueUtilsSource = await readFile(new URL('../src/homepageVenueUtils.js', import.meta.url), 'utf8');
  const adminSource = await readFile(new URL('../src/AdminHeroImages.jsx', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.match(sliderSource, /aria-roledescription="carousel"/);
  assert.match(sliderSource, /aria-live=\{autoplaying \? 'off' : 'polite'\}/);
  assert.match(sliderSource, /fetchpriority=\{index === 0 \? 'high' : 'auto'\}/);
  assert.match(sliderSource, /loading=\{index === 0 \|\| slide\.isLocalVenueImage \? 'eager' : 'lazy'\}/);
  assert.match(sliderSource, /onClick=\{\(\) => scrollToSlide/);
  assert.match(sliderSource, /setSlides\(activeSlides\.length \? activeSlides : getLocalVenueSlides\(\)\)/);
  assert.match(sliderSource, /if \(!slides\.length\) return null/);
  assert.match(venueUtilsSource, /\/images%20\(7\)\.jfif/);
  assert.match(sliderSource, /window\.setInterval\(/);
  assert.match(sliderSource, /onMouseEnter=/);
  assert.match(sliderSource, /onFocus=/);
  assert.match(sliderSource, /ArrowLeft/);
  assert.match(sliderSource, /home-hero-carousel-dot/);
  assert.match(adminSource, /\/admin\/hero-slides\/reorder/);
  assert.match(adminSource, /apiClient\.delete\(`/);
  assert.match(adminSource, /role="dialog"/);
  assert.match(adminSource, /heroImagesRetry/);
  assert.match(adminSource, /onUploadProgress:/);
  assert.match(adminSource, /onChange=\{\(event\) => updateSlide/);
  assert.equal((appSource.match(/slug==='hero-images'\?<AdminHeroImages\/>/g) || []).length, 2);
  assert.match(styles, /scroll-snap-type:x mandatory/);
  assert.match(styles, /@media\(max-width:640px\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.hero-images-heading/);
});

test('Home hero has a gradient fallback and Admin hero page renders loading and upload states', async () => {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    root: fileURLToPath(new URL('../', import.meta.url)),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
  });
  try {
    const { default: HomeHeroSlider } = await server.ssrLoadModule('/src/HomeHeroSlider.jsx');
    assert.equal(renderToString(createElement(HomeHeroSlider)), '');
    const { default: AdminHeroImages } = await server.ssrLoadModule('/src/AdminHeroImages.jsx');
    const adminMarkup = renderToString(createElement(AdminHeroImages));
    assert.match(adminMarkup, /Upload image/);
    assert.match(adminMarkup, /Loading hero images/);
    assert.match(adminMarkup, /0 of 5 slides/);
  } finally {
    await server.close();
  }
});
