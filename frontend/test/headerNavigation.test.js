import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const navigationSource = await readFile(new URL('../src/PublicNavigation.jsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const aboutPageSource = appSource.slice(appSource.indexOf('function AboutPage'), appSource.indexOf('function ContactPage'));
const eventsPageSource = appSource.slice(appSource.indexOf('function EventsPage'), appSource.indexOf('function QuoteRequestModal'));

test('public navigation exposes the owning dropdown and clears pointer focus', () => {
  assert.match(navigationSource, /aria-expanded={isOpen}/);
  assert.match(navigationSource, /aria-label={translate\('mainNavigation', language\)}/);
  assert.match(navigationSource, /aria-controls={`public-menu-\$\{itemKey/);
  assert.match(navigationSource, /if \(event\.detail > 0\) clearPointerNavigationFocus\(\)/);
  assert.match(navigationSource, /navigateAndCloseMenu\(child\.path, close, onNavigate\)/);
  assert.doesNotMatch(navigationSource, /focusAfterNavigation/);
});

test('navigation focus outline is focus-visible only, and open menus have a hover bridge', () => {
  assert.match(styleSource, /\.public-nav-top-item:focus-visible\{outline:2px solid var\(--accent\);/);
  assert.doesNotMatch(styleSource, /\.public-nav-top-item:focus(?!-visible)/);
  assert.match(styleSource, /\.public-nav-item\.has-children::after\{[^}]*height:7px/);
  assert.match(styleSource, /\.public-nav-dropdown\{[^}]*z-index:95[^}]*pointer-events:auto/);
  assert.match(styleSource, /\.public-nav-dropdown\{[^}]*isolation:isolate[^}]*background-color:var\(--card\)/);
  assert.match(styleSource, /max-height:calc\(100vh - var\(--public-header-height/);
  assert.match(styleSource, /\.public-nav-dropdown \.public-nav-label\{[^}]*overflow:visible[^}]*white-space:normal/);
  assert.match(styleSource, /\.public-nav-top-item \.public-nav-label\{overflow:visible;text-overflow:clip;white-space:normal\}/);
  assert.match(styleSource, /font-family:'Noto Sans Ethiopic','DM Sans'/);
  assert.doesNotMatch(styleSource, /\.site-header\{[^}]*backdrop-filter/);
});

test('About group headings, category visuals, and category empty states are accessible', () => {
  assert.match(navigationSource, /translate\(group\.heading, language\)/);
  assert.match(navigationSource, /public-nav-group-heading/);
  assert.match(navigationSource, /public-nav-category-icon/);
  assert.match(navigationSource, /public-nav-category-count/);
  assert.match(navigationSource, /typeof child\.icon === 'function' \|\| typeof child\.icon === 'object'/);
  assert.match(navigationSource, /eventCategoryIcons/);
  assert.match(navigationSource, /typeof child\.icon === 'string' && <img/);
  assert.match(navigationSource, /item\.emptyMessage && !item\.children\.some\(\(child\) => child\.database\)/);
  assert.match(navigationSource, /navigationRecentlyViewedSaveFailed/);
});

test('About routes render one dedicated view and retain a translated closing action', () => {
  for (const page of ['mission-vision', 'how-it-works', 'why-choose', 'team', 'partners', 'success-stories', 'faqs']) {
    assert.ok(aboutPageSource.includes(`pageKey === '${page}'`), `missing dedicated About view: ${page}`);
    assert.ok(appSource.includes(`/about/${page}`), `missing About route: ${page}`);
  }
  assert.match(aboutPageSource, /className="about-cta"/);
  assert.match(aboutPageSource, /t\('aboutCtaTitle'\)/);
  assert.match(aboutPageSource, /window\.scrollTo\(0, 0\)/);
  assert.doesNotMatch(aboutPageSource, /about-hero|about-stats|about-section-nav|sections\.map/);
  assert.match(appSource, /history\.replaceState\(\{\}, '', destination\)/);
});

test('event listing exposes search, filters, sorting, and pagination through the public API', () => {
  assert.match(eventsPageSource, /className="panel event-filter-panel event-listing-filters"/);
  assert.match(eventsPageSource, /value={search} onChange=/);
  assert.match(eventsPageSource, /eventCategoryLabel/);
  assert.match(eventsPageSource, /eventLocationLabel/);
  assert.match(eventsPageSource, /datePreset/);
  assert.match(eventsPageSource, /minimumPrice/);
  assert.match(eventsPageSource, /sortEvents/);
  assert.match(eventsPageSource, /const resetFilters = \(\) =>/);
  assert.match(eventsPageSource, /setSort\('upcoming'\)/);
  assert.match(eventsPageSource, /setPageSize\(6\)/);
  assert.match(eventsPageSource, /getListingFiltersFromPath\(currentPath\)/);
  assert.match(eventsPageSource, /api\(`\/platform\/events\?\$\{eventListingQuery\}`\)/);
  assert.match(eventsPageSource, /pagination\.total > 0/);
});
