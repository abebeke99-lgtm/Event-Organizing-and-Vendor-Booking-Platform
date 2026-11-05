export const homepageVenueImagePaths = [
  '/im1/images.jfif',
  '/images.jfif',
  '/images%20(1).jfif',
  '/images%20(2).jfif',
  '/images%20(3).jfif',
  '/images%20(4).jfif',
  '/images%20(5).jfif',
  '/images%20(6).jfif',
  '/images%20(7).jfif',
];

export const homepageInspirationImages = [
  { src: '/images.jfif', categoryKey: 'publicHomeCategoryWeddingVenues' },
  { src: '/images%20(1).jfif', categoryKey: 'publicHomeCategoryBirthdayCelebrations' },
  { src: '/images%20(2).jfif', categoryKey: 'publicHomeCategoryCorporateEvents' },
  { src: '/images%20(3).jfif', categoryKey: 'publicHomeCategoryGraduationParties' },
  { src: '/images%20(4).jfif', categoryKey: 'publicHomeCategoryEngagementCelebrations' },
];

function normalizeVenuePart(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function eventImage(event) {
  if (typeof event?.coverImage === 'string' && event.coverImage.trim()) return event.coverImage;
  if (Array.isArray(event?.galleryImages)) {
    return event.galleryImages.find((image) => typeof image === 'string' && image.trim()) || null;
  }
  return null;
}

export function getHomepageVenueCards(venues, events, limit = 12) {
  if (!Array.isArray(venues) || !Array.isArray(events) || !Number.isInteger(limit) || limit < 1) return [];

  const eventsByVenue = new Map();
  for (const event of events) {
    const venueName = normalizeVenuePart(event?.venue);
    if (!venueName) continue;
    const venueEvents = eventsByVenue.get(venueName) || [];
    venueEvents.push(event);
    eventsByVenue.set(venueName, venueEvents);
  }

  return venues.flatMap((venue) => {
    const name = typeof venue?.name === 'string' ? venue.name.trim() : '';
    if (!name) return [];
    const venueEvents = eventsByVenue.get(normalizeVenuePart(name)) || [];
    const city = typeof venue.city === 'string' ? venue.city.trim() : '';
    const matchingEvent = venueEvents.find((event) => (
      (!city || normalizeVenuePart(event.location) === normalizeVenuePart(city))
      && eventImage(event)
    )) || venueEvents.find(eventImage);

    return [{
      name,
      city,
      eventCount: Number.isFinite(Number(venue.eventCount)) ? Number(venue.eventCount) : 0,
      image: matchingEvent ? eventImage(matchingEvent) : null,
    }];
  }).slice(0, limit);
}
