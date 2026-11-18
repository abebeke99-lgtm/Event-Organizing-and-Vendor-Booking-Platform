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
  assert.equal(resolveApiBaseUrl('', false), 'http://127.0.0.1:5000/api');
});

test('development API host follows the browser hostname for loopback addresses', () => {
  assert.equal(
    resolveApiBaseUrl('', false, 'localhost'),
    'http://localhost:5000/api',
  );
  assert.equal(
    resolveApiBaseUrl('http://127.0.0.1:5000/api', false, 'localhost'),
    'http://localhost:5000/api',
  );
  assert.equal(
    resolveApiBaseUrl('http://localhost:5000/api', false, '127.0.0.1'),
    'http://127.0.0.1:5000/api',
  );
});

test('API origins and /api paths normalize to one /api suffix', () => {
  assert.equal(resolveApiBaseUrl('https://192.0.2.10', true), 'https://192.0.2.10/api');
  assert.equal(resolveApiBaseUrl('https://192.0.2.10/api/', true), 'https://192.0.2.10/api');
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

test('production API URL rejects example and reserved placeholder domains', () => {
  for (const value of [
    'https://api.example.com/api',
    'https://api.example.net/api',
    'https://api.example.test/api',
    'https://api.example.invalid/api',
    'https://api.eventhub.test/api',
  ]) {
    assert.throws(
      () => resolveApiBaseUrl(value, true),
      /must not use an example or reserved placeholder domain/,
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
