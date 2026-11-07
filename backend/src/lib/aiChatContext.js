import { buildPublicEventListingQuery, mapDatabaseEvent } from './eventCatalog.js';
import { loadPublicMarketplace } from './marketplace.js';
import { publicEventSelect } from './publicEventSql.js';
import { listPublicServices } from './serviceCatalog.js';
import { listPublicVendors } from './vendorCatalog.js';

const stopWords = new Set([
  'about', 'and', 'can', 'find', 'for', 'from', 'help', 'how', 'looking', 'need',
  'please', 'show', 'some', 'that', 'the', 'what', 'where', 'with', 'you',
]);

function searchTerms(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu)
    ?.filter((term) => !stopWords.has(term))
    .slice(0, 12) || [];
}

function relevanceScore(record, fields, terms) {
  const text = fields.map((field) => String(record[field] ?? '')).join(' ').toLocaleLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function selectRelevant(records, fields, terms, limit) {
  return records
    .map((record) => ({ record, score: relevanceScore(record, fields, terms) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ record }) => record);
}

export async function loadAiChatContext(database, message) {
  const [marketplace, eventRows] = await Promise.all([
    loadPublicMarketplace(database),
    (async () => {
      const listing = buildPublicEventListingQuery({ status: 'upcoming', sort: 'upcoming', limit: 40 });
      const [rows] = await database.query(
        `${publicEventSelect} ${listing.where}
         ORDER BY ${listing.orderBy} LIMIT ?`,
        [...listing.params, listing.limit],
      );
      return rows.map(mapDatabaseEvent);
    })(),
  ]);
  const terms = searchTerms(message);
  const services = listPublicServices(marketplace.services, { limit: 50, sort: 'recommended' }).services;
  const vendors = listPublicVendors(marketplace.vendors, { limit: 50, sort: 'recommended' }).vendors;

  const events = selectRelevant(eventRows, ['title', 'type', 'description', 'location', 'venue'], terms, 6)
    .map((event) => ({
      id: event.id,
      title: event.title,
      category: event.type,
      location: event.location || event.venue || null,
      date: event.startDate,
      startingPrice: event.startingPrice,
      availableTickets: event.availableQuantity,
      href: `/events/${event.id}`,
    }));
  const matchedServices = selectRelevant(services, ['title', 'category', 'description', 'vendorName', 'city'], terms, 8)
    .map((service) => ({
      id: service.id,
      title: service.title,
      vendor: service.vendorName,
      category: service.category,
      location: service.city || null,
      price: service.price,
      currency: service.currency,
      available: service.available === true,
      href: `/services/${service.id}`,
    }));
  const matchedVendors = selectRelevant(vendors, ['business_name', 'category', 'description', 'city'], terms, 6)
    .map((vendor) => ({
      id: vendor.id,
      name: vendor.business_name,
      category: vendor.category,
      location: vendor.city || null,
      startingPrice: vendor.priceFrom,
      currency: vendor.currency || null,
      available: vendor.available === true,
      href: `/vendors/${vendor.id}`,
    }));
  const categories = marketplace.categories
    .filter((category) => !terms.length || relevanceScore(category, ['name', 'description'], terms) > 0)
    .slice(0, 30)
    .map(({ id, name, description, vendorCount, serviceCount }) => ({
      id,
      name,
      description,
      verifiedVendorCount: vendorCount,
      publishedServiceCount: serviceCount,
      href: `/categories/${encodeURIComponent(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}`,
    }));

  return { events, vendors: matchedVendors, services: matchedServices, categories };
}
