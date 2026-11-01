import assert from 'node:assert/strict';
import test from 'node:test';
import { withStableKeys } from '../src/listKeys.js';

test('stable item keys follow record identities when collection order changes', () => {
  const records = [{ id: 11 }, { id: 22 }];
  const firstKeys = new Map(withStableKeys(records, (record) => record.id).map(({ item, key }) => [item.id, key]));
  const reorderedKeys = new Map(withStableKeys([...records].reverse(), (record) => record.id).map(({ item, key }) => [item.id, key]));

  assert.deepEqual(reorderedKeys, firstKeys);
});

test('duplicate content identities receive deterministic unique keys', () => {
  const records = [{ url: '/social' }, { url: '/social' }];

  assert.deepEqual(
    withStableKeys(records, (record) => record.url).map(({ key }) => key),
    ['/social:0', '/social:1'],
  );
});