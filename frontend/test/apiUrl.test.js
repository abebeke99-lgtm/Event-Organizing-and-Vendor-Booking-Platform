import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveApiBaseUrl } from '../src/api/apiUrl.js';

test('production API URL is required', () => {
  assert.throws(
    () => resolveApiBaseUrl('', true),
    /VITE_API_URL must be configured/,
  );
});

test('development defaults to the local API', () => {
  assert.equal(resolveApiBaseUrl('', false), 'http://127.0.0.1:4000/api');
});

test('API origins and /api paths normalize to one /api suffix', () => {
  assert.equal(resolveApiBaseUrl('https://api.example.test', true), 'https://api.example.test/api');
  assert.equal(resolveApiBaseUrl('https://api.example.test/api/', true), 'https://api.example.test/api');
});

test('production API URL must use HTTPS', () => {
  assert.throws(
    () => resolveApiBaseUrl('http://api.example.test/api', true),
    /Production VITE_API_URL must use HTTPS/,
  );
});

test('production API URL must not target localhost or loopback addresses', () => {
  for (const value of [
    'https://localhost/api',
    'https://api.localhost/api',
    'https://127.0.0.1/api',
    'https://[::1]/api',
  ]) {
    assert.throws(
      () => resolveApiBaseUrl(value, true),
      /must not use a localhost or loopback host/,
    );
  }
});

test('API URL rejects credentials, unexpected paths, queries, and fragments', () => {
  for (const value of [
    'https://user:password@api.example.test/api',
    'https://api.example.test/v1',
    'https://api.example.test/api?token=secret',
    'https://api.example.test/api#fragment',
  ]) {
    assert.throws(
      () => resolveApiBaseUrl(value, true),
      /VITE_API_URL must be an API origin or end in/,
    );
  }
});
