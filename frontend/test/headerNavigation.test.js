import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const navigationSource = await readFile(new URL('../src/PublicNavigation.jsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('public navigation exposes the owning dropdown and clears pointer focus', () => {
  assert.match(navigationSource, /aria-expanded={isOpen}/);
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
