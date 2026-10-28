import test from 'node:test';
import assert from 'node:assert/strict';
import { getListQuery } from '../src/routes/admin.js';

test('getListQuery builds a searchable status-filtered query', () => {
  const resource = {
    table: 'users',
    search: ['full_name', 'email'],
    statusField: 'status',
  };

  const result = getListQuery(resource, 'smith', 'active');

  assert.equal(result.where, ' WHERE (full_name LIKE ? OR email LIKE ?) AND status = ?');
  assert.deepEqual(result.values, ['%smith%', '%smith%', 'active']);
});

test('getListQuery omits the search clause when there is no text filter', () => {
  const resource = {
    table: 'roles',
    search: ['name', 'description'],
    statusField: 'is_active',
  };

  const result = getListQuery(resource, '', '1');

  assert.equal(result.where, ' WHERE is_active = ?');
  assert.deepEqual(result.values, ['1']);
});
