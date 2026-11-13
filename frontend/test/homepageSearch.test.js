import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildHomepageSearchPath } from '../src/homepageUtils.js';

const componentSource = await readFile(new URL('../src/HomepageSearch.jsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('homepage hero search contains only its query field and submit control', () => {
  assert.match(componentSource, /<form className="hero-search homepage-search" role="search"/);
  assert.match(componentSource, /type="search"/);
  assert.match(componentSource, /className="button homepage-search-submit" type="submit"/);
  assert.doesNotMatch(componentSource, /<select\b|homepage-search-filter|useState\('(?:category|location)'\)/);
  assert.match(appSource, /<HomepageSearch api=\{api\} onNavigate=\{onNavigate\} \/>/);
  assert.doesNotMatch(appSource, /<HomepageSearch[^>]*(?:categories|locations)=/);
  assert.match(appSource, /onNavigate\(`\/search\?category=\$\{encodeURIComponent\(category\.name\)\}`\)/);
  assert.match(componentSource, /`\/service-categories\/\$\{encodeURIComponent\(item\.slug \|\| item\.name\)\}`/);
  assert.match(appSource, /`\/service-categories\/\$\{encodeURIComponent\(category\.slug \|\| category\.name\)\}`/);
});

test('homepage hero search submits only a non-empty text query', () => {
  assert.equal(buildHomepageSearchPath('  wedding gala  '), '/search?q=wedding+gala');
  assert.equal(buildHomepageSearchPath('music & lights'), '/search?q=music+%26+lights');
  assert.equal(buildHomepageSearchPath('  '), null);
  assert.match(componentSource, /onNavigate\(searchPath\)/);
});

test('homepage hero search fills the row and stacks on small screens', () => {
  assert.match(styleSource, /\.homepage-search\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(styleSource, /@media\(max-width:640px\)\{[\s\S]*?\.homepage-search\{grid-template-columns:1fr/);
  assert.match(styleSource, /@media\(max-width:640px\)\{[\s\S]*?\.homepage-search-submit\{[^}]*width:100%/);
});
