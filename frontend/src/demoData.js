export const DEMO_DATA_STORAGE_KEY = 'eventhub-demo-data';

const initialData = () => ({
  categories: [
    { id: 1, name: 'Photography', description: 'Photography and video services', is_active: true, active: true, vendorCount: 2, serviceCount: 2 },
    { id: 2, name: 'Catering', description: 'Food, drinks, and service staff', is_active: true, active: true, vendorCount: 1, serviceCount: 1 },
    { id: 3, name: 'Decoration', description: 'Event styling, flowers, and decor', is_active: true, active: true, vendorCount: 1, serviceCount: 1 },
    { id: 4, name: 'Venues', description: 'Event halls and unique spaces', is_active: true, active: true, vendorCount: 1, serviceCount: 1 },
    { id: 5, name: 'Entertainment', description: 'Music, DJs, and live performances', is_active: true, active: true, vendorCount: 1, serviceCount: 1 },
    { id: 6, name: 'Transportation', description: 'Guest and event transportation', is_active: true, active: true, vendorCount: 1, serviceCount: 1 },
  ],
  vendors: [
    { id: 1, name: 'Lumen Photography', business_name: 'Lumen Photography', category: 'Photography', categoryId: 1, category_id: 1, city: 'Addis Ababa', description: 'Candid wedding and celebration photography.', verified: true, verification_status: 'approved', rating: 4.9, reviewCount: 38, priceFrom: 18000, status: 'active', logoUrl: '' },
    { id: 2, name: 'Blue Nile Catering', business_name: 'Blue Nile Catering', category: 'Catering', categoryId: 2, category_id: 2, city: 'Addis Ababa', description: 'Seasonal menus and thoughtful guest service.', verified: true, verification_status: 'approved', rating: 4.8, reviewCount: 24, priceFrom: 42000, status: 'active', logoUrl: '' },
    { id: 3, name: 'Petal & Pine Events', business_name: 'Petal & Pine Events', category: 'Decoration', categoryId: 3, category_id: 3, city: 'Bahir Dar', description: 'Floral installations and custom event styling.', verified: true, verification_status: 'approved', rating: 4.7, reviewCount: 19, priceFrom: 22000, status: 'active', logoUrl: '' },
    { id: 4, name: 'Horizon Event Hall', business_name: 'Horizon Event Hall', category: 'Venues', categoryId: 4, category_id: 4, city: 'Addis Ababa', description: 'Flexible indoor venue with full event support.', verified: true, verification_status: 'approved', rating: 4.6, reviewCount: 31, priceFrom: 65000, status: 'active', logoUrl: '' },
    { id: 5, name: 'Abay Sound & Stage', business_name: 'Abay Sound & Stage', category: 'Entertainment', categoryId: 5, category_id: 5, city: 'Hawassa', description: 'Professional DJ, sound, and lighting packages.', verified: true, verification_status: 'approved', rating: 4.8, reviewCount: 16, priceFrom: 15000, status: 'active', logoUrl: '' },
    { id: 6, name: 'Unity Event Transport', business_name: 'Unity Event Transport', category: 'Transportation', categoryId: 6, category_id: 6, city: 'Addis Ababa', description: 'Reliable guest shuttles and event-day transport.', verified: false, verification_status: 'pending', rating: 4.5, reviewCount: 9, priceFrom: 12000, status: 'active', logoUrl: '' },
  ],
  services: [
    { id: 101, title: 'Wedding Photography', name: 'Wedding Photography', description: 'Full-day coverage, edited gallery, and a private download link.', category: 'Photography', categoryId: 1, category_id: 1, city: 'Addis Ababa', price: 24000, currency: 'ETB', rating: 4.9, reviewCount: 28, vendorId: 1, vendor_id: 1, vendorName: 'Lumen Photography', vendor_name: 'Lumen Photography', status: 'active', packages: [{ id: 1, name: 'Full day', price: 24000, currency: 'ETB' }] },
    { id: 102, title: 'Event Video Story', name: 'Event Video Story', description: 'Highlight film and professionally edited ceremony footage.', category: 'Photography', categoryId: 1, category_id: 1, city: 'Addis Ababa', price: 32000, currency: 'ETB', rating: 4.8, reviewCount: 13, vendorId: 1, vendor_id: 1, vendorName: 'Lumen Photography', vendor_name: 'Lumen Photography', status: 'active', packages: [] },
    { id: 103, title: 'Celebration Catering', name: 'Celebration Catering', description: 'A locally inspired menu with setup and service staff.', category: 'Catering', categoryId: 2, category_id: 2, city: 'Addis Ababa', price: 52000, currency: 'ETB', rating: 4.8, reviewCount: 24, vendorId: 2, vendor_id: 2, vendorName: 'Blue Nile Catering', vendor_name: 'Blue Nile Catering', status: 'active', packages: [] },
    { id: 104, title: 'Floral Event Styling', name: 'Floral Event Styling', description: 'Custom table styling, ceremony flowers, and a setup team.', category: 'Decoration', categoryId: 3, category_id: 3, city: 'Bahir Dar', price: 28000, currency: 'ETB', rating: 4.7, reviewCount: 19, vendorId: 3, vendor_id: 3, vendorName: 'Petal & Pine Events', vendor_name: 'Petal & Pine Events', status: 'active', packages: [] },
    { id: 105, title: 'Conference Hall Package', name: 'Conference Hall Package', description: 'A flexible hall with seating, presentation equipment, and support.', category: 'Venues', categoryId: 4, category_id: 4, city: 'Addis Ababa', price: 68000, currency: 'ETB', rating: 4.6, reviewCount: 31, vendorId: 4, vendor_id: 4, vendorName: 'Horizon Event Hall', vendor_name: 'Horizon Event Hall', status: 'active', packages: [] },
    { id: 106, title: 'DJ and Sound Package', name: 'DJ and Sound Package', description: 'DJ, sound system, and lighting for a lively reception.', category: 'Entertainment', categoryId: 5, category_id: 5, city: 'Hawassa', price: 18000, currency: 'ETB', rating: 4.8, reviewCount: 16, vendorId: 5, vendor_id: 5, vendorName: 'Abay Sound & Stage', vendor_name: 'Abay Sound & Stage', status: 'active', packages: [] },
  ],
  events: [
    { id: 201, title: 'Wedding Ceremony', type: 'Wedding', event_type: 'Wedding', description: 'A family celebration in the heart of Addis Ababa.', city: 'Addis Ababa', location: 'Addis Ababa', venue: 'Lalibela Garden', startDate: '2027-02-20T14:00:00', start_date: '2027-02-20T14:00:00', date: '2027-02-20T14:00:00', status: 'published', capacity: 250, organizer_id: 4, coverImageUrl: '' },
    { id: 202, title: 'Graduation Celebration', type: 'Graduation', event_type: 'Graduation', description: 'Celebrate a milestone with friends and family.', city: 'Bahir Dar', location: 'Bahir Dar', venue: 'Lake View Center', startDate: '2027-01-16T10:00:00', start_date: '2027-01-16T10:00:00', date: '2027-01-16T10:00:00', status: 'published', capacity: 140, organizer_id: 4, coverImageUrl: '' },
    { id: 203, title: 'Birthday Garden Party', type: 'Birthday', event_type: 'Birthday', description: 'An outdoor birthday gathering with live music.', city: 'Hawassa', location: 'Hawassa', venue: 'Wabe Garden', startDate: '2027-03-08T16:00:00', start_date: '2027-03-08T16:00:00', date: '2027-03-08T16:00:00', status: 'published', capacity: 90, organizer_id: 4, coverImageUrl: '' },
    { id: 204, title: 'Annual Business Conference', type: 'Conference', event_type: 'Conference', description: 'A day of talks, networking, and workshops.', city: 'Addis Ababa', location: 'Addis Ababa', venue: 'Horizon Event Hall', startDate: '2027-04-12T08:30:00', start_date: '2027-04-12T08:30:00', date: '2027-04-12T08:30:00', status: 'published', capacity: 400, organizer_id: 4, coverImageUrl: '' },
    { id: 205, title: 'Cultural Festival', type: 'Festival', event_type: 'Festival', description: 'Music, food, and local artists across the region.', city: 'Bahir Dar', location: 'Bahir Dar', venue: 'Millennium Park', startDate: '2027-05-01T11:00:00', start_date: '2027-05-01T11:00:00', date: '2027-05-01T11:00:00', status: 'published', capacity: 800, organizer_id: 4, coverImageUrl: '' },
    { id: 206, title: 'Live Music Night', type: 'Concert', event_type: 'Concert', description: 'An evening concert featuring local musicians.', city: 'Hawassa', location: 'Hawassa', venue: 'City Amphitheater', startDate: '2027-06-18T18:00:00', start_date: '2027-06-18T18:00:00', date: '2027-06-18T18:00:00', status: 'published', capacity: 1200, organizer_id: 4, coverImageUrl: '' },
    { id: 301, title: 'Demo Customer Wedding', type: 'Wedding', event_type: 'Wedding', description: 'Private planning event for the demo customer.', city: 'Addis Ababa', location: 'Addis Ababa', venue: 'Garden Venue', startDate: '2027-07-14T15:00:00', start_date: '2027-07-14T15:00:00', date: '2027-07-14T15:00:00', status: 'active', capacity: 180, organizer_id: 3, coverImageUrl: '' },
    { id: 302, title: 'Community Fundraiser', type: 'Fundraiser', event_type: 'Fundraiser', description: 'A draft fundraiser event.', city: 'Bahir Dar', location: 'Bahir Dar', venue: '', startDate: '2027-08-03T09:00:00', start_date: '2027-08-03T09:00:00', date: '2027-08-03T09:00:00', status: 'draft', capacity: 120, organizer_id: 3, coverImageUrl: '' },
  ],
  bookings: [
    { id: 401, reference: 'DEMO-BOOK-401', serviceId: 101, service_id: 101, serviceTitle: 'Wedding Photography', service: 'Wedding Photography', vendorId: 1, vendor_id: 1, vendorName: 'Lumen Photography', customer: 'Demo Customer', customer_name: 'Demo Customer', eventId: 301, event_id: 301, eventTitle: 'Demo Customer Wedding', eventDate: '2027-07-14T15:00:00', date: '2027-07-14T15:00:00', quotedAmount: 24000, currency: 'ETB', status: 'confirmed', paymentStatus: 'unpaid', created_at: '2026-10-12T09:00:00Z' },
    { id: 402, reference: 'DEMO-BOOK-402', serviceId: 103, service_id: 103, serviceTitle: 'Celebration Catering', service: 'Celebration Catering', vendorId: 2, vendor_id: 2, vendorName: 'Blue Nile Catering', customer: 'Demo Customer', customer_name: 'Demo Customer', eventId: 202, event_id: 202, eventTitle: 'Graduation Celebration', eventDate: '2027-01-16T10:00:00', date: '2027-01-16T10:00:00', quotedAmount: 52000, currency: 'ETB', status: 'requested', paymentStatus: 'unpaid', created_at: '2026-10-18T11:30:00Z' },
    { id: 403, reference: 'DEMO-BOOK-403', serviceId: 106, service_id: 106, serviceTitle: 'DJ and Sound Package', service: 'DJ and Sound Package', vendorId: 5, vendor_id: 5, vendorName: 'Abay Sound & Stage', customer: 'Sara Bekele', customer_name: 'Sara Bekele', eventId: 203, event_id: 203, eventTitle: 'Birthday Garden Party', eventDate: '2026-09-10T16:00:00', date: '2026-09-10T16:00:00', quotedAmount: 18000, currency: 'ETB', status: 'completed', paymentStatus: 'paid', created_at: '2026-08-02T08:00:00Z' },
    { id: 404, reference: 'DEMO-BOOK-404', serviceId: 102, service_id: 102, serviceTitle: 'Event Video Story', service: 'Event Video Story', vendorId: 1, vendor_id: 1, vendorName: 'Lumen Photography', customer: 'Demo Customer', customer_name: 'Demo Customer', eventId: 301, event_id: 301, eventTitle: 'Demo Customer Wedding', eventDate: '2027-07-14T15:00:00', date: '2027-07-14T15:00:00', quotedAmount: 32000, currency: 'ETB', status: 'requested', paymentStatus: 'unpaid', created_at: '2026-10-21T09:00:00Z' },
  ],
  quotations: [
    { id: 501, reference: 'DEMO-QUOTE-501', serviceId: 104, service_id: 104, service: 'Floral Event Styling', serviceTitle: 'Floral Event Styling', vendorId: 3, vendor_id: 3, vendorName: 'Petal & Pine Events', eventId: 301, event_id: 301, eventTitle: 'Demo Customer Wedding', amount: 28000, currency: 'ETB', status: 'submitted', notes: 'Includes ceremony arch and reception table styling.', validUntil: '2027-01-31' },
    { id: 502, reference: 'DEMO-QUOTE-502', serviceId: 105, service_id: 105, service: 'Conference Hall Package', serviceTitle: 'Conference Hall Package', vendorId: 4, vendor_id: 4, vendorName: 'Horizon Event Hall', eventId: 302, event_id: 302, eventTitle: 'Community Fundraiser', amount: 68000, currency: 'ETB', status: 'pending', notes: 'Includes room setup and presentation equipment.', validUntil: '2027-02-15' },
    { id: 503, reference: 'DEMO-QUOTE-503', serviceId: 101, service_id: 101, service: 'Wedding Photography', serviceTitle: 'Wedding Photography', vendorId: 1, vendor_id: 1, vendorName: 'Lumen Photography', eventId: 301, event_id: 301, eventTitle: 'Demo Customer Wedding', amount: 24000, currency: 'ETB', status: 'submitted', notes: 'Includes full-day coverage and an edited gallery.', validUntil: '2027-02-28' },
  ],
  payments: [
    { id: 601, reference: 'DEMO-PAY-601', bookingId: 401, booking_id: 401, service: 'Wedding Photography', provider: 'Lumen Photography', amount: 24000, currency: 'ETB', status: 'pending', created_at: '2026-10-20T10:00:00Z' },
    { id: 602, reference: 'DEMO-PAY-602', bookingId: 403, booking_id: 403, service: 'DJ and Sound Package', provider: 'Abay Sound & Stage', amount: 18000, currency: 'ETB', status: 'successful', created_at: '2026-09-11T08:30:00Z' },
  ],
  reviews: [
    { id: 701, bookingId: 403, booking_id: 403, rating: 5, comment: 'Great sound and a smooth setup.', vendorId: 5, vendor_id: 5, vendorName: 'Abay Sound & Stage', service: 'DJ and Sound Package', status: 'published', created_at: '2026-09-12T08:00:00Z' },
    { id: 702, bookingId: 401, booking_id: 401, rating: 5, comment: 'Demo review awaiting the event.', vendorId: 1, vendor_id: 1, vendorName: 'Lumen Photography', service: 'Wedding Photography', status: 'pending', created_at: '2026-10-22T08:00:00Z' },
  ],
  notifications: [
    { id: 801, title: 'Booking confirmed', message: 'Your photography booking has been confirmed.', read: false, status: 'unread', created_at: '2026-10-20T09:00:00Z' },
    { id: 802, title: 'Quotation received', message: 'Petal & Pine Events submitted a quotation.', read: false, status: 'unread', created_at: '2026-10-19T13:00:00Z' },
    { id: 803, title: 'Welcome to EventHub', message: 'Explore vendors and services for your next event.', read: true, status: 'read', created_at: '2026-10-01T08:00:00Z' },
  ],
  messages: [
    { id: 901, bookingId: 401, booking_id: 401, sender: 'Lumen Photography', body: 'We can schedule a quick planning call this week.', read: false, created_at: '2026-10-20T14:00:00Z' },
  ],
  favorites: [1, 3],
  savedServices: [102],
  availability: [{ id: 1001, date: '2027-02-20', status: 'available', note: 'Open for bookings' }],
  media: [],
  tasks: [{ id: 1101, title: 'Confirm photo timeline', details: 'Share the ceremony schedule with Lumen Photography.', status: 'open', dueAt: '2027-06-20', bookingId: 401 }],
  vendorProfile: { businessName: 'Lumen Photography', categoryId: 1, city: 'Addis Ababa', description: 'Wedding and event photography.', phone: '+251 911 000 111', verificationStatus: 'approved' },
  customerProfile: { fullName: 'Demo Customer', full_name: 'Demo Customer', email: 'customer@demo.eventhub', phone: '+251 911 000 222' },
  organizerProfile: { full_name: 'Demo Organizer', phone: '+251 911 000 333' },
  verification: { status: 'approved', submittedAt: '2026-09-15T10:00:00Z', documents: [] },
});

const clone = (value) => JSON.parse(JSON.stringify(value));

function readData(storage) {
  const saved = storage?.getItem(DEMO_DATA_STORAGE_KEY);
  if (saved === null || saved === undefined) return initialData();
  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch {
    throw new Error('Saved demo application data is invalid. Clear the EventHub demo data and try again.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Saved demo application data is invalid. Clear the EventHub demo data and try again.');
  }
  return { ...initialData(), ...parsed };
}

function writeData(storage, data) {
  storage?.setItem(DEMO_DATA_STORAGE_KEY, JSON.stringify(data));
}

function eventList(data, session) {
  return data.events.filter((event) => event.status === 'published'
    || ['customer', 'organizer'].includes(session?.role) && event.organizer_id === 3);
}

function rowsForRoute(route, data, session) {
  const customerRoutes = {
    overview: () => ({
      totalBookings: data.bookings.filter((booking) => booking.customer_name === (session?.name || 'Demo Customer')).length,
      pendingBookings: data.bookings.filter((booking) => booking.customer_name === (session?.name || 'Demo Customer') && ['requested', 'pending'].includes(booking.status)).length,
      confirmedBookings: data.bookings.filter((booking) => booking.customer_name === (session?.name || 'Demo Customer') && booking.status === 'confirmed').length,
      upcomingEvents: data.events.filter((event) => event.organizer_id === 3 && new Date(event.startDate) >= new Date()).length,
      outstandingPayments: data.payments.filter((payment) => ['pending', 'authorized'].includes(payment.status)).reduce((sum, payment) => sum + payment.amount, 0),
      pendingQuotations: data.quotations.filter((quote) => ['pending', 'submitted'].includes(quote.status)).length,
      unreadMessages: data.messages.filter((message) => !message.read).length,
      unreadNotifications: data.notifications.filter((notification) => !notification.read).length,
    }),
    vendors: () => data.vendors,
    services: () => data.services,
    categories: () => data.categories,
    bookings: () => data.bookings.filter((booking) => booking.customer_name === (session?.name || 'Demo Customer') && booking.status !== 'completed'),
    history: () => data.bookings.filter((booking) => booking.customer_name === (session?.name || 'Demo Customer') && ['completed', 'cancelled', 'rejected'].includes(booking.status)),
    events: () => data.events.filter((event) => event.organizer_id === 3),
    favorites: () => data.vendors.filter((vendor) => data.favorites.includes(vendor.id)),
    quotations: () => data.quotations,
    payments: () => data.payments,
    messages: () => data.messages,
    reviews: () => data.reviews,
    notifications: () => data.notifications,
    profile: () => data.customerProfile,
    'saved-services': () => data.services.filter((service) => data.savedServices.includes(service.id)),
  };
  if (route.startsWith('/customer/')) {
    const key = route.slice('/customer/'.length).split('/')[0];
    return customerRoutes[key]?.();
  }

  const vendorRoutes = {
    overview: () => ({
      totalServices: data.services.filter((service) => Number(service.vendorId) === 1).length,
      activeServices: data.services.filter((service) => Number(service.vendorId) === 1 && service.status === 'active').length,
      totalBookings: data.bookings.filter((booking) => Number(booking.vendorId) === 1).length,
      pendingBookings: data.bookings.filter((booking) => Number(booking.vendorId) === 1 && ['requested', 'pending'].includes(booking.status)).length,
      confirmedBookings: data.bookings.filter((booking) => Number(booking.vendorId) === 1 && booking.status === 'confirmed').length,
      completedBookings: data.bookings.filter((booking) => Number(booking.vendorId) === 1 && booking.status === 'completed').length,
      upcomingBookings: data.bookings.filter((booking) => Number(booking.vendorId) === 1 && new Date(booking.eventDate) >= new Date()).length,
      totalCustomers: new Set(data.bookings.filter((booking) => Number(booking.vendorId) === 1).map((booking) => booking.customer)).size,
      totalEarnings: data.payments.filter((payment) => payment.status === 'successful' && data.bookings.some((booking) => booking.id === payment.bookingId && Number(booking.vendorId) === 1)).reduce((sum, payment) => sum + payment.amount, 0),
      pendingPayouts: data.payments.filter((payment) => payment.status === 'pending' && data.bookings.some((booking) => booking.id === payment.bookingId && Number(booking.vendorId) === 1)).reduce((sum, payment) => sum + payment.amount, 0),
      pendingQuotations: data.quotations.filter((quote) => Number(quote.vendorId) === 1 && ['pending', 'submitted'].includes(quote.status)).length,
      unreadMessages: data.messages.filter((message) => !message.read).length,
      notifications: data.notifications.filter((notification) => !notification.read).length,
    }),
    profile: () => data.vendorProfile,
    verification: () => data.verification,
    services: () => data.services.filter((service) => Number(service.vendorId) === 1),
    categories: () => data.categories,
    pricing: () => data.services.map((service) => ({ serviceId: service.id, serviceTitle: service.title, price: service.price, currency: service.currency })),
    availability: () => ({ schedule: data.availability }),
    'booking-requests': () => data.bookings.filter((booking) => Number(booking.vendorId) === 1 && ['requested', 'pending'].includes(booking.status)),
    bookings: () => data.bookings.filter((booking) => Number(booking.vendorId) === 1 && ['confirmed', 'accepted', 'in_progress'].includes(booking.status)),
    history: () => data.bookings.filter((booking) => Number(booking.vendorId) === 1 && ['completed', 'cancelled', 'rejected'].includes(booking.status)),
    tasks: () => data.tasks,
    quotations: () => data.quotations.filter((quote) => Number(quote.vendorId) === 1),
    payments: () => data.payments.filter((payment) => data.bookings.some((booking) => booking.id === payment.bookingId && Number(booking.vendorId) === 1)),
    messages: () => data.messages.filter((message) => data.bookings.some((booking) => booking.id === message.bookingId && Number(booking.vendorId) === 1)),
    reviews: () => data.reviews,
    notifications: () => data.notifications,
    reports: () => ({ bookings: data.bookings, payments: data.payments }),
    account: () => data.vendorProfile,
    packages: () => data.services.flatMap((service) => service.packages || []),
    media: () => data.media,
  };
  if (route.startsWith('/vendor/')) {
    const key = route.slice('/vendor/'.length).split('/')[0];
    return vendorRoutes[key]?.();
  }

  if (route === '/platform/organizer/overview') {
    return {
      totalEvents: data.events.filter((event) => event.organizer_id === 3).length,
      upcomingEvents: data.events.filter((event) => event.organizer_id === 3 && new Date(event.startDate) >= new Date()).length,
      ongoingEvents: 0,
      budget: { allocated: 150000 },
    };
  }
  if (route === '/platform/organizer/profile') return data.organizerProfile;
  if (route.startsWith('/platform/organizer/events/')) {
    return route.endsWith('/budget')
      ? { event: data.events.find((event) => String(event.id) === route.split('/')[4]) || null, categories: [], expenses: [], summary: { planned: 0, actual: 0, remaining: 0 } }
      : data.tasks;
  }
  if (route.startsWith('/platform/organizer/')) {
    const key = route.slice('/platform/organizer/'.length).split('/')[0];
    const routes = {
      favorites: () => data.vendors.filter((vendor) => data.favorites.includes(vendor.id)),
      quotations: () => data.quotations,
      messages: () => data.messages,
      notifications: () => data.notifications,
      reports: () => data.bookings,
    };
    return routes[key]?.();
  }
  if (route === '/platform/events/mine') return data.events.filter((event) => event.organizer_id === 3);
  if (route === '/platform/events/categories') return data.categories;
  if (route === '/platform/events/featured') return eventList(data, session)[0] || null;
  if (route === '/platform/bookings') return data.bookings;
  if (route === '/platform/vendors') return data.vendors;
  if (route === '/platform/services') return data.services;
  if (route === '/platform/categories') return data.categories;
  if (route === '/platform/overview') return { users: { total_users: 14 }, vendors: { total_vendors: data.vendors.length }, events: { total_events: data.events.length }, bookings: { total_bookings: data.bookings.length } };
  if (route === '/platform/events') return eventList(data, session);
  if (route === '/platform/vendor-application') return { status: 'not_submitted', documents: [] };
  if (route === '/platform/vendor-application/documents') return [];
  if (route === '/platform/ticket-bookings/mine') return [];
  const serviceMatch = route.match(/^\/platform\/services\/(\d+)$/);
  if (serviceMatch) {
    const service = data.services.find((item) => String(item.id) === serviceMatch[1]);
    return service ? {
      ...service,
      reviews: data.reviews.filter((review) => Number(review.vendorId) === Number(service.vendorId)),
      availability: data.availability,
    } : null;
  }
  const vendorMatch = route.match(/^\/platform\/vendors\/(\d+)$/);
  if (vendorMatch) {
    const vendor = data.vendors.find((item) => String(item.id) === vendorMatch[1]);
    return vendor ? {
      ...vendor,
      services: data.services.filter((service) => Number(service.vendorId) === Number(vendor.id)),
      reviews: data.reviews.filter((review) => Number(review.vendorId) === Number(vendor.id)),
    } : null;
  }
  const categoryMatch = route.match(/^\/platform\/categories\/([^/]+)$/);
  if (categoryMatch) {
    const key = decodeURIComponent(categoryMatch[1]).toLowerCase();
    const category = data.categories.find((item) => String(item.id) === key || item.name.toLowerCase().replaceAll(' ', '-') === key || item.name.toLowerCase() === key);
    return category ? {
      ...category,
      services: data.services.filter((service) => Number(service.categoryId) === Number(category.id)),
      vendors: data.vendors.filter((vendor) => Number(vendor.categoryId) === Number(category.id)),
      events: eventList(data, session).filter((event) => event.type.toLowerCase().includes(category.name.toLowerCase())),
    } : null;
  }

  const eventMatch = route.match(/^\/platform\/events\/(\d+)(?:\/(tickets|related))?$/);
  if (eventMatch) {
    const [, id, subresource] = eventMatch;
    if (subresource === 'tickets') return [];
    if (subresource === 'related') return data.events.filter((event) => String(event.id) !== id).slice(0, 3);
    return data.events.find((event) => String(event.id) === id) || null;
  }
  if (route === '/admin/dashboard/overview') {
    return {
      users: { total_users: 14 }, vendors: { total_vendors: data.vendors.length, verified_vendors: data.vendors.filter((vendor) => vendor.verified).length, pending_vendors: data.vendors.filter((vendor) => !vendor.verified).length },
      events: { total_events: data.events.length, published_events: eventList(data, session).length, upcoming_events: eventList(data, session).length },
      bookings: { total_bookings: data.bookings.length, pending_bookings: data.bookings.filter((booking) => booking.status === 'requested').length, confirmed_bookings: data.bookings.filter((booking) => booking.status === 'confirmed').length, completed_bookings: data.bookings.filter((booking) => booking.status === 'completed').length, cancelled_bookings: 0 },
      payments: { total_payments: data.payments.length, successful_payments: data.payments.filter((payment) => payment.status === 'successful').length, pending_payments: data.payments.filter((payment) => payment.status === 'pending').length, refund_requests: 0 },
      complaints: { open_complaints: 0, total_complaints: 0 }, reviews: { total_reviews: data.reviews.length },
      bookingTrend: [], eventCategories: [], revenueByCurrency: [], bookingStatuses: [], recentBookings: data.bookings.slice(0, 3), recentVendorRequests: [], recentComplaints: [], recentReviews: data.reviews.slice(0, 3),
    };
  }
  if (route === '/about' || route === '/contact') return {};
  if (route === '/vendor/media') return data.media;
  if (route === '/admin/users') return [{ id: 1, full_name: 'Demo Administrator', email: 'admin@demo.eventhub', roles: ['admin'], status: 'active' }, { id: 3, full_name: 'Demo Organizer', email: 'organizer@demo.eventhub', roles: ['organizer'], status: 'active' }, { id: 4, full_name: 'Demo Vendor', email: 'vendor@demo.eventhub', roles: ['vendor'], status: 'active' }, { id: 2, full_name: 'Demo Customer', email: 'customer@demo.eventhub', roles: ['customer'], status: 'active' }];
  if (route === '/admin/vendors') return data.vendors;
  if (route === '/admin/events') return data.events;
  if (route === '/admin/bookings') return data.bookings;
  if (route === '/admin/categories') return data.categories;
  if (route === '/admin/reviews') return data.reviews;
  if (route === '/admin/payments') return data.payments;
  return undefined;
}

function filterRows(rows, params) {
  const search = (params.get('search') || params.get('q') || '').trim().toLowerCase();
  const category = (params.get('category') || '').trim().toLowerCase();
  const location = (params.get('location') || '').trim().toLowerCase();
  const minPrice = Number(params.get('minPrice') || 0);
  const maxPrice = params.has('maxPrice') ? Number(params.get('maxPrice')) : Infinity;
  const minRating = Number(params.get('minRating') || 0);
  let filtered = rows.filter((row) => {
    const text = Object.values(row).filter((value) => typeof value === 'string').join(' ').toLowerCase();
    const price = Number(row.price ?? row.priceFrom ?? 0);
    return (!search || text.includes(search))
      && (!category || String(row.category || '').toLowerCase() === category)
      && (!location || String(row.city || row.location || '').toLowerCase().includes(location))
      && price >= minPrice && price <= maxPrice
      && Number(row.rating || 0) >= minRating;
  });
  const sort = params.get('sort') || '';
  if (sort === 'highest-rated' || sort === 'rating') filtered = filtered.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
  else if (sort === 'price-low' || sort === 'price_asc') filtered = filtered.sort((a, b) => Number(a.price ?? a.priceFrom ?? 0) - Number(b.price ?? b.priceFrom ?? 0));
  else if (sort === 'price-high' || sort === 'price_desc') filtered = filtered.sort((a, b) => Number(b.price ?? b.priceFrom ?? 0) - Number(a.price ?? a.priceFrom ?? 0));
  return filtered;
}

function paginatedResponse(rows, params) {
  const filtered = filterRows(rows, params);
  const page = Math.max(1, Number(params.get('page') || 1));
  const limit = Math.max(1, Math.min(100, Number(params.get('limit') || 12)));
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const currentPage = Math.min(page, totalPages);
  return {
    data: clone(filtered.slice((currentPage - 1) * limit, currentPage * limit)),
    pagination: { page: currentPage, total: filtered.length, totalPages, limit },
  };
}

export function createDemoDataService({ storage = globalThis.localStorage, getSession = () => null, now = Date.now } = {}) {
  let data;
  let sequence = Math.max(10000, Number(String(now()).slice(-8))) * 100;
  const createId = () => ++sequence;
  const getData = () => {
    if (!data) data = readData(storage);
    return data;
  };
  const save = () => writeData(storage, getData());

  return {
    request(path, options = {}) {
      const [route, query = ''] = String(path).split('?');
      const params = new URLSearchParams(query);
      const method = String(options.method || 'GET').toUpperCase();
      const state = getData();
      const session = getSession();

      if (method === 'GET') {
        if (/^\/vendor\/media\/\d+$/.test(route)) {
          const placeholder = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#eff6ff"/><path d="M0 280 180 120l130 120 90-80 240 200H0z" fill="#bfdbfe"/><circle cx="470" cy="95" r="34" fill="#fbbf24"/></svg>';
          return { data: new Blob([placeholder], { type: 'image/svg+xml' }) };
        }
        const result = rowsForRoute(route, state, session);
        if (result === undefined) return { data: [], pagination: { page: 1, total: 0, totalPages: 1, limit: 12 } };
        if (route.endsWith('/vendors') || route.endsWith('/services') || route === '/platform/events') {
          return paginatedResponse(Array.isArray(result) ? result : [], params);
        }
        return { data: clone(result) };
      }

      let body = {};
      if (typeof options.body === 'string' && options.body) {
        try {
          body = JSON.parse(options.body);
        } catch {
          throw new Error('Invalid demo request data.');
        }
      }
      let result = { ...body, id: createId() };
      const add = (collection, record) => {
        state[collection].unshift(record);
        result = record;
      };
      if (method === 'POST' && route === '/platform/events') {
        add('events', { ...body, id: createId(), type: body.type || body.event_type, event_type: body.event_type || body.type, city: body.city || '', location: body.city || '', startDate: body.startDate || body.start_date, start_date: body.startDate || body.start_date, date: body.startDate || body.start_date, status: body.status || 'draft', organizer_id: 3 });
      } else if (method === 'PATCH' && /^\/platform\/events\/\d+$/.test(route)) {
        const event = state.events.find((row) => String(row.id) === route.split('/').pop());
        if (!event) throw new Error('The demo event could not be found.');
        Object.assign(event, body);
        result = event;
      } else if (method === 'POST' && ['/platform/bookings', '/customer/bookings'].includes(route)) {
        const service = state.services.find((row) => row.id === Number(body.serviceId));
        if (!service) throw new Error('Choose a service from the demo catalog.');
        const record = { ...body, id: createId(), reference: `DEMO-BOOK-${now()}`, serviceId: service.id, service_id: service.id, serviceTitle: service.title, service: service.title, vendorId: service.vendorId, vendor_id: service.vendorId, vendorName: service.vendorName, customer: session?.name || 'Demo Customer', customer_name: session?.name || 'Demo Customer', eventId: Number(body.eventId), event_id: Number(body.eventId), eventTitle: state.events.find((event) => event.id === Number(body.eventId))?.title || 'Event', eventDate: state.events.find((event) => event.id === Number(body.eventId))?.startDate || '', date: state.events.find((event) => event.id === Number(body.eventId))?.startDate || '', quotedAmount: service.price, currency: service.currency, status: 'requested', paymentStatus: 'unpaid', created_at: new Date(now()).toISOString() };
        add('bookings', record);
      } else if (method === 'POST' && ['/platform/service-quote-requests', '/customer/quotations'].includes(route)) {
        const service = state.services.find((row) => row.id === Number(body.serviceId));
        if (!service) throw new Error('Choose a service from the demo catalog.');
        add('quotations', { ...body, id: createId(), reference: `DEMO-QUOTE-${now()}`, serviceId: service.id, service_id: service.id, service: service.title, serviceTitle: service.title, vendorId: service.vendorId, vendor_id: service.vendorId, vendorName: service.vendorName, eventId: Number(body.eventId), event_id: Number(body.eventId), eventTitle: state.events.find((event) => event.id === Number(body.eventId))?.title || 'Event', amount: Number(body.budget || service.price), currency: service.currency, status: 'pending' });
      } else if (method === 'POST' && ['/customer/favorites', '/platform/organizer/favorites'].includes(route)) {
        const vendorId = Number(body.vendorId);
        if (!state.vendors.some((vendor) => vendor.id === vendorId)) throw new Error('Choose a vendor from the demo marketplace.');
        if (!state.favorites.includes(vendorId)) state.favorites.push(vendorId);
        result = state.vendors.find((vendor) => vendor.id === vendorId);
      } else if (method === 'POST' && route === '/customer/saved-services') {
        const serviceId = Number(body.serviceId);
        const service = state.services.find((row) => row.id === serviceId);
        if (!service) throw new Error('Choose a service from the demo catalog.');
        if (!state.savedServices.includes(serviceId)) state.savedServices.push(serviceId);
        result = service;
      } else if (method === 'POST' && route === '/vendor/services') {
        const service = { ...body, id: createId(), name: body.title, category: state.categories.find((category) => category.id === Number(body.categoryId))?.name || 'Other', category_id: Number(body.categoryId), vendorId: 1, vendor_id: 1, vendorName: state.vendorProfile.businessName, vendor_name: state.vendorProfile.businessName, city: state.vendorProfile.city, rating: 0, reviewCount: 0, currency: body.currency || 'ETB', status: body.status || 'draft', packages: [] };
        add('services', service);
      } else if (method === 'PATCH' && /^\/vendor\/services\/\d+$/.test(route)) {
        const service = state.services.find((row) => String(row.id) === route.split('/').pop());
        if (!service) throw new Error('The demo service could not be found.');
        Object.assign(service, body, { name: body.title || service.title });
        result = service;
      } else if (method === 'DELETE' && /^\/vendor\/services\/\d+$/.test(route)) {
        const serviceId = route.split('/').pop();
        const index = state.services.findIndex((service) => String(service.id) === serviceId);
        if (index < 0) throw new Error('The demo service could not be found.');
        result = state.services.splice(index, 1)[0];
      } else if (method === 'POST' && route === '/vendor/media') {
        const record = {
          id: createId(),
          type: params.get('type') || 'business',
          serviceId: params.get('serviceId') ? Number(params.get('serviceId')) : null,
          filename: params.get('filename') || 'demo-image',
        };
        add('media', record);
      } else if (method === 'DELETE' && /^\/vendor\/media\/\d+$/.test(route)) {
        const mediaId = route.split('/').pop();
        state.media = state.media.filter((item) => String(item.id) !== mediaId);
      } else if (method === 'PATCH' && route === '/vendor/profile') {
        Object.assign(state.vendorProfile, body);
        result = state.vendorProfile;
      } else if (method === 'POST' && route === '/vendor/availability') {
        const scheduleItem = { ...body, id: createId() };
        state.availability = [...state.availability.filter((item) => item.date !== body.date), scheduleItem];
        result = scheduleItem;
      } else if (method === 'DELETE' && /^\/vendor\/availability\/\d{4}-\d{2}-\d{2}$/.test(route)) {
        const date = route.split('/').pop();
        state.availability = state.availability.filter((item) => item.date !== date);
      } else if (method === 'POST' && /^\/vendor\/services\/\d+\/packages$/.test(route)) {
        const service = state.services.find((row) => String(row.id) === route.split('/')[3]);
        if (!service) throw new Error('The demo service could not be found.');
        const pkg = { ...body, id: createId() };
        service.packages = [...(service.packages || []), pkg];
        result = pkg;
      } else if (method === 'PATCH' && /^\/platform\/bookings\/\d+\/status$/.test(route)) {
        const booking = state.bookings.find((row) => String(row.id) === route.split('/')[3]);
        if (!booking) throw new Error('The demo booking could not be found.');
        booking.status = body.status || booking.status;
        result = booking;
      } else if (method === 'PATCH' && /^\/vendor\/bookings\/\d+/.test(route)) {
        const booking = state.bookings.find((row) => String(row.id) === route.split('/')[3]);
        if (!booking) throw new Error('The demo booking could not be found.');
        Object.assign(booking, body);
        result = booking;
      } else if (method === 'PATCH' && route.includes('/notifications/')) {
        state.notifications = state.notifications.map((item) => String(item.id) === route.split('/').pop() ? { ...item, read: true, status: 'read' } : item);
      } else if (method === 'POST' && route.endsWith('/messages')) {
        add('messages', { ...body, id: createId(), sender: session?.name || 'Demo User', read: true, created_at: new Date(now()).toISOString() });
      }
      save();
      return { data: clone(result), message: 'Demo mode: changes are stored only in this browser.' };
    },
  };
}
