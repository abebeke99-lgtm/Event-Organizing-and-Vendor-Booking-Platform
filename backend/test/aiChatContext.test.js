import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadAiChatContext } from '../src/lib/aiChatContext.js';

const serviceRow = {
  id: 8,
  vendor_id: 3,
  category_id: 2,
  title: 'Catering package',
  description: 'Wedding catering service',
  price: '2500.00',
  currency: 'ETB',
  status: 'active',
  business_name: 'Verified Catering',
  city: 'Addis Ababa',
  verification_status: 'verified',
  category: 'Catering',
  booking_count: 0,
  rating: 4.8,
  review_count: 5,
};
const vendorRow = {
  id: 3,
  user_id: 12,
  business_name: 'Verified Catering',
  city: 'Addis Ababa',
  description: 'Catering services',
  verification_status: 'verified',
  category: 'Catering',
  min_price: '2500.00',
  booking_count: 0,
  rating: 4.8,
  review_count: 5,
  is_featured: 0,
};
const eventRow = {
  id: 14,
  title: 'Wedding Showcase',
  event_type: 'Wedding',
  description: 'A public wedding planning event',
  city: 'Addis Ababa',
  venue: 'Public Hall',
  start_date: '2030-10-10 10:00:00',
  status: 'active',
  starting_price: '900.00',
  available_quantity: 12,
};

const database = {
  async query(sql) {
    if (sql.includes('FROM vendor_profiles vp')) return [[vendorRow], []];
    if (sql.includes('FROM services s')) return [[serviceRow], []];
    if (sql.includes('FROM service_categories')) {
      return [[{
        id: 2,
        name: 'Catering',
        description: 'Food and beverage services',
        is_active: 1,
        vendorCount: 1,
        serviceCount: 1,
      }], []];
    }
    if (sql.includes('FROM events e')) return [[eventRow], []];
    return [[], []];
  },
  async execute() {
    return [[], []];
  },
};

test('AI context uses only public events and verified, published marketplace records', async () => {
  const context = await loadAiChatContext(database, 'Find wedding catering in Addis Ababa');
  assert.equal(context.events[0].id, 14);
  assert.equal(context.events[0].href, '/events/14');
  assert.equal(context.events[0].startingPrice, 900);
  assert.equal(context.events[0].availableTickets, 12);
  assert.equal(context.services[0].id, 8);
  assert.equal(context.services[0].price, 2500);
  assert.equal(context.services[0].currency, 'ETB');
  assert.equal(context.vendors[0].id, 3);
  assert.equal(context.categories[0].name, 'Catering');
});
