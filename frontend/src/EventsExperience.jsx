import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, Clock3, MapPin, Share2, Ticket, Users } from 'lucide-react';
import { formatEventDate, formatEventBudget } from './eventUtils.js';
import './eventsExperience.css';

function messageFor(error, fallback) {
  return error?.message || fallback;
}

function EventStatus({ event, available }) {
  const startsAt = event?.startDate ? new Date(event.startDate) : null;
  const status = event?.status === 'cancelled'
    ? 'Cancelled'
    : event?.status === 'completed' || startsAt && startsAt < new Date()
      ? 'Completed'
      : available === 0
        ? 'Sold out'
        : 'Upcoming';
  return <span className={`event-status event-status-${status.toLowerCase().replace(' ', '-')}`}>{status}</span>;
}

export function EventDetailsPage({ eventId, user, api, onNavigate }) {
  const [event, setEvent] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [related, setRelated] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [shareMessage, setShareMessage] = useState('');
  const [contactOpen, setContactOpen] = useState(false);
  const [contactMessage, setContactMessage] = useState('');
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState('');
  const [contactSuccess, setContactSuccess] = useState('');

  async function loadEvent() {
    setLoading(true);
    setError('');
    setBookingError('');
    try {
      const [eventResponse, ticketResponse, relatedResponse] = await Promise.all([
        api(`/platform/events/${encodeURIComponent(eventId)}`),
        api(`/platform/events/${encodeURIComponent(eventId)}/tickets`),
        api(`/platform/events/${encodeURIComponent(eventId)}/related`),
      ]);
      const nextEvent = eventResponse?.data && !Array.isArray(eventResponse.data) ? eventResponse.data : null;
      const nextTickets = Array.isArray(ticketResponse?.data) ? ticketResponse.data : [];
      setEvent(nextEvent);
      setTickets(nextTickets);
      setRelated(Array.isArray(relatedResponse?.data) ? relatedResponse.data : []);
      setSelectedTicket((current) => nextTickets.some((ticket) => String(ticket.id) === current)
        ? current
        : String(nextTickets[0]?.id || ''));
      if (!nextEvent) setError('This event is no longer available.');
    } catch (issue) {
      setError(messageFor(issue, 'Unable to load event details.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function initialLoad() {
      setLoading(true);
      setError('');
      setBookingError('');
      setConfirmation(null);
      try {
        const [eventResponse, ticketResponse, relatedResponse] = await Promise.all([
          api(`/platform/events/${encodeURIComponent(eventId)}`),
          api(`/platform/events/${encodeURIComponent(eventId)}/tickets`),
          api(`/platform/events/${encodeURIComponent(eventId)}/related`),
        ]);
        if (!active) return;
        const nextTickets = Array.isArray(ticketResponse?.data) ? ticketResponse.data : [];
        const nextEvent = eventResponse?.data && !Array.isArray(eventResponse.data) ? eventResponse.data : null;
        setEvent(nextEvent);
        setTickets(nextTickets);
        setRelated(Array.isArray(relatedResponse?.data) ? relatedResponse.data : []);
        setSelectedTicket(String(nextTickets[0]?.id || ''));
        if (!nextEvent) setError('This event is no longer available.');
      } catch (issue) {
        if (active) setError(messageFor(issue, 'Unable to load event details.'));
      } finally {
        if (active) setLoading(false);
      }
    }
    initialLoad();
    return () => { active = false; };
  }, [api, eventId]);

  const selected = tickets.find((ticket) => String(ticket.id) === selectedTicket);
  const available = selected ? Number(selected.availableQuantity) : null;

  async function bookTicket(event) {
    event.preventDefault();
    if (!selected || booking) return;
    if (user?.role !== 'customer') {
      sessionStorage.setItem('eventhub_after_login', window.location.pathname);
      onNavigate('/login');
      return;
    }
    setBooking(true);
    setBookingError('');
    setConfirmation(null);
    try {
      const result = await api('/platform/ticket-bookings', {
        method: 'POST',
        body: JSON.stringify({
          eventId: Number(eventId),
          ticketTypeId: Number(selected.id),
          quantity: Number(quantity),
          idempotencyKey: window.crypto?.randomUUID?.(),
        }),
      });
      setConfirmation(result?.data || null);
      await loadEvent();
    } catch (issue) {
      setBookingError(messageFor(issue, 'Unable to reserve tickets.'));
    } finally {
      setBooking(false);
    }
  }

  async function shareEvent() {
    setShareMessage('');
    try {
      if (navigator.share) {
        await navigator.share({ title: event.title, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setShareMessage('Event link copied.');
      }
    } catch (issue) {
      if (issue?.name !== 'AbortError') setShareMessage('Could not share this event.');
    }
  }

  async function sendOrganizerMessage(submitEvent) {
    submitEvent.preventDefault();
    if (user?.role !== 'customer') {
      sessionStorage.setItem('eventhub_after_login', window.location.pathname);
      onNavigate('/login');
      return;
    }
    setContactBusy(true);
    setContactError('');
    setContactSuccess('');
    try {
      await api(`/platform/events/${encodeURIComponent(eventId)}/contact`, {
        method: 'POST',
        body: JSON.stringify({ message: contactMessage }),
      });
      setContactSuccess('Your message was sent to the organizer.');
      setContactMessage('');
    } catch (issue) {
      setContactError(messageFor(issue, 'Unable to send your message.'));
    } finally {
      setContactBusy(false);
    }
  }

  if (loading) return <main className="page-shell"><div className="loading" role="status"><span className="spinner" />Loading event…</div></main>;
  if (error || !event) return <main className="page-shell"><div className="event-error panel" role="alert"><p>{error || 'This event is no longer available.'}</p><button className="button secondary" onClick={() => onNavigate('/events')}>Back to Events</button><button className="button" onClick={loadEvent}>Retry</button></div></main>;

  const mapQuery = [event.venue, event.location].filter(Boolean).join(', ');
  const minimumPrice = tickets.length ? Math.min(...tickets.map((ticket) => Number(ticket.price))) : null;
  const defaultCover = 'linear-gradient(120deg, #10243d, #276b92 58%, #79b6c4)';

  return <main className="page-shell event-details-page">
    <button className="event-back-link" type="button" onClick={() => onNavigate('/events')}><ArrowLeft size={16} /> Back to Events</button>
    <section className="event-hero" style={event.coverImage ? { backgroundImage: `linear-gradient(90deg, rgba(10,23,41,.82), rgba(10,23,41,.15)), url("${event.coverImage}")` } : { background: defaultCover }}>
      <div className="event-hero-content">
        <span className="event-category">{event.type || 'Event'}</span>
        <EventStatus event={event} available={event.availableQuantity} />
        <h1>{event.title}</h1>
        <p><CalendarDays size={17} />{formatEventDate(event.startDate) || 'Date to be announced'}</p>
        <p><MapPin size={17} />{[event.venue, event.location].filter(Boolean).join(' · ') || 'Location to be announced'}</p>
      </div>
    </section>

    <div className="event-details-layout">
      <section className="event-detail-main">
        <article className="panel event-description-panel">
          <div className="event-content-heading"><h2>About this event</h2><button className="button secondary small" type="button" onClick={shareEvent}><Share2 size={15} /> Share</button></div>
          <p>{event.description || 'More event information will be added soon.'}</p>
          <div className="event-facts">
            <div><CalendarDays size={18} /><span>Date and time</span><strong>{formatEventDate(event.startDate) || 'To be announced'}</strong></div>
            <div><MapPin size={18} /><span>Venue</span><strong>{[event.venue, event.location].filter(Boolean).join(', ') || 'To be announced'}</strong></div>
            <div><Users size={18} /><span>Capacity</span><strong>{event.capacity ? `${Number(event.capacity).toLocaleString()} guests` : 'Not specified'}</strong></div>
            <div><Ticket size={18} /><span>Starting price</span><strong>{minimumPrice === null ? 'Tickets unavailable' : minimumPrice === 0 ? 'Free' : formatEventBudget(minimumPrice)}</strong></div>
          </div>
          {event.organizerName && <p className="event-organizer">Organized by <strong>{event.organizerName}</strong></p>}
          {mapQuery && <a className="event-map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noreferrer">View location on map</a>}
          <button className="button secondary small" type="button" onClick={() => setContactOpen((open) => !open)}>Contact Organizer</button>
          {contactOpen && <form className="organizer-contact-form" onSubmit={sendOrganizerMessage}>
            {user?.role !== 'customer' && <p className="muted">Sign in with a customer account to contact this organizer.</p>}
            <label className="field"><span>Message</span><textarea rows="4" minLength="10" maxLength="2000" value={contactMessage} onChange={(inputEvent) => setContactMessage(inputEvent.target.value)} placeholder="Write your question for the event organizer" required /></label>
            {contactError && <p className="event-inline-error" role="alert">{contactError}</p>}
            {contactSuccess && <p className="event-inline-message" role="status">{contactSuccess}</p>}
            <button className="button secondary small" type="submit" disabled={contactBusy}>{contactBusy ? 'Sending…' : user?.role === 'customer' ? 'Send message' : 'Log in to contact'}</button>
          </form>}
          {shareMessage && <span className="event-inline-message" role="status">{shareMessage}</span>}
        </article>
        {Array.isArray(event.galleryImages) && event.galleryImages.length > 0 && <section className="event-gallery" aria-label="Event gallery">
          {event.galleryImages.map((image, index) => <img key={`${image}-${index}`} src={image} alt={`${event.title} gallery ${index + 1}`} loading="lazy" />)}
        </section>}
        {related.length > 0 && <section className="related-events">
          <h2>Related events</h2>
          <div className="related-event-grid">
            {related.map((item) => <button key={item.id} className="related-event-card" type="button" onClick={() => onNavigate(`/events/${item.id}`)}>
              <span>{item.type || 'Event'}</span><strong>{item.title}</strong><small>{formatEventDate(item.startDate) || 'Date to be announced'}</small><small>{item.location || 'Location to be announced'}</small>
            </button>)}
          </div>
        </section>}
      </section>

      <aside className="panel ticket-panel" aria-label="Ticket booking">
        <h2>Tickets</h2>
        {tickets.length === 0 ? <p className="muted">Ticket sales are not currently available for this event.</p> : confirmation ? <div className="booking-confirmation" role="status">
          <Check size={24} /><h3>Reservation received</h3><p>Reference: <strong>{confirmation.reference || 'Pending'}</strong></p><p>{confirmation.quantity || quantity} × {confirmation.ticketName || selected?.name}</p><p>Total: <strong>{formatEventBudget(confirmation.totalAmount ?? Number(selected.price) * quantity)}</strong></p><p>Payment: <strong>Pending</strong></p><small>Payment verification is not configured yet. This reservation remains pending and is held for 15 minutes.</small><button className="button secondary" type="button" onClick={() => onNavigate('/my-bookings')}>View My Bookings</button>
        </div> : <form onSubmit={bookTicket} className="ticket-booking-form">
          <label className="field"><span>Ticket type</span><select value={selectedTicket} onChange={(event) => setSelectedTicket(event.target.value)} required>{tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.name} — {Number(ticket.price) === 0 ? 'Free' : formatEventBudget(ticket.price)}</option>)}</select></label>
          {selected && <p className="ticket-availability">{available > 0 ? `${available} available` : 'Sold out'}</p>}
          <label className="field"><span>Quantity</span><input type="number" min="1" max={Math.min(10, available || 1)} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} disabled={!available} required /></label>
          {selected && <div className="ticket-total"><span>Total</span><strong>{formatEventBudget(Number(selected.price) * quantity) || 'Free'}</strong></div>}
          <div className="ticket-payment-note"><Clock3 size={15} /> Reservations are pending payment and expire after 15 minutes.</div>
          {bookingError && <p className="event-inline-error" role="alert">{bookingError}</p>}
          <button className="button ticket-submit" type="submit" disabled={booking || !available}>{booking ? 'Reserving…' : user?.role === 'customer' ? 'Reserve tickets' : 'Log in to book'}</button>
          {user && user.role !== 'customer' && <p className="muted">Ticket booking is available to customer accounts.</p>}
        </form>}
      </aside>
    </div>
  </main>;
}

export function MyEventBookingsPage({ api, onNavigate }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function loadBookings() {
    setLoading(true);
    setError('');
    try {
      const response = await api('/platform/ticket-bookings/mine');
      setBookings(Array.isArray(response?.data) ? response.data : []);
    } catch (issue) {
      setError(messageFor(issue, 'Unable to load your bookings.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBookings(); }, []);

  async function cancelBooking(id) {
    setBusyId(id);
    setError('');
    try {
      await api(`/platform/ticket-bookings/${encodeURIComponent(id)}/cancel`, { method: 'PATCH' });
      await loadBookings();
    } catch (issue) {
      setError(messageFor(issue, 'Unable to cancel this booking.'));
    } finally {
      setBusyId(null);
    }
  }

  return <main className="page-shell my-event-bookings">
    <div className="section-header"><div><p className="eyebrow">CUSTOMER</p><h1>My Event Bookings</h1><p className="muted">Review ticket reservations and their payment status.</p></div><button className="button secondary" onClick={() => onNavigate('/events')}>Browse Events</button></div>
    {error && <div className="alert error" role="alert">{error}<button className="button secondary small" onClick={loadBookings}>Retry</button></div>}
    {loading ? <div className="loading" role="status"><span className="spinner" />Loading bookings…</div> : bookings.length === 0 ? <div className="empty panel"><strong>No event bookings yet</strong><span>When you reserve event tickets, they will appear here.</span><button className="button" onClick={() => onNavigate('/events')}>Discover events</button></div> : <div className="ticket-booking-list">
      {bookings.map((item) => <article className="panel ticket-booking-item" key={item.id}>
        <div><span className="event-category">{item.ticketName}</span><h2>{item.eventTitle}</h2><p>{formatEventDate(item.startDate) || 'Date to be announced'} · {item.location || 'Location to be announced'}</p></div>
        <dl><div><dt>Reference</dt><dd>{item.reference}</dd></div><div><dt>Tickets</dt><dd>{item.quantity}</dd></div><div><dt>Total</dt><dd>{formatEventBudget(item.totalAmount)}</dd></div><div><dt>Payment</dt><dd>{item.paymentStatus}</dd></div><div><dt>Booking</dt><dd>{item.bookingStatus.replaceAll('_', ' ')}</dd></div></dl>
        <div className="ticket-booking-actions"><button className="button secondary small" onClick={() => onNavigate(`/events/${item.eventId}`)}>Event details</button>{item.bookingStatus === 'pending_payment' && <button className="button danger small" disabled={busyId === item.id} onClick={() => cancelBooking(item.id)}>{busyId === item.id ? 'Cancelling…' : 'Cancel reservation'}</button>}</div>
      </article>)}
    </div>}
  </main>;
}

const emptyOrganizerEvent = {
  title: '',
  type: '',
  description: '',
  city: '',
  venue: '',
  coverImageUrl: '',
  startDate: '',
  endDate: '',
  budget: '',
  capacity: '',
  notes: '',
};

function localDateTimeInput(value) {
  if (!value) return '';
  return String(value).replace(' ', 'T').slice(0, 16);
}

export function OrganizerEventsManager({ api }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [eventForm, setEventForm] = useState(emptyOrganizerEvent);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventBusy, setEventBusy] = useState(false);
  const [ticketEventId, setTicketEventId] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [ticketForm, setTicketForm] = useState({ name: '', description: '', price: '', capacity: '' });
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketError, setTicketError] = useState('');

  async function loadEvents() {
    setLoading(true);
    setError('');
    try {
      const response = await api('/platform/events/mine');
      setEvents(Array.isArray(response?.data) ? response.data : []);
    } catch (issue) {
      setError(messageFor(issue, 'Unable to load your events.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadEvents(); }, []);

  async function loadTickets(eventId) {
    setTicketError('');
    try {
      const response = await api(`/platform/events/${encodeURIComponent(eventId)}/tickets/manage`);
      setTickets(Array.isArray(response?.data) ? response.data : []);
      setTicketEventId(eventId);
    } catch (issue) {
      setTicketError(messageFor(issue, 'Unable to load ticket types.'));
    }
  }

  function startEdit(event) {
    setEditingEventId(event.id);
    setEventForm({
      title: event.title || '',
      type: event.type || '',
      description: event.description || '',
      city: event.location || '',
      venue: event.venue || '',
      coverImageUrl: event.coverImage || '',
      startDate: localDateTimeInput(event.startDate),
      endDate: localDateTimeInput(event.endDate),
      budget: event.budget ?? '',
      capacity: event.capacity ?? '',
      notes: event.notes || '',
    });
    setError('');
    setNotice('');
  }

  function resetEventForm() {
    setEditingEventId(null);
    setEventForm(emptyOrganizerEvent);
  }

  function setEventField(key, value) {
    setEventForm((current) => ({ ...current, [key]: value }));
  }

  async function saveEvent(submitEvent) {
    submitEvent.preventDefault();
    setEventBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        ...eventForm,
        budget: eventForm.budget === '' ? null : Number(eventForm.budget),
        capacity: eventForm.capacity === '' ? null : Number(eventForm.capacity),
      };
      await api(editingEventId ? `/platform/events/${editingEventId}` : '/platform/events', {
        method: editingEventId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      setNotice(editingEventId ? 'Event changes saved.' : 'Event created as a draft.');
      resetEventForm();
      await loadEvents();
    } catch (issue) {
      setError(messageFor(issue, 'Unable to save this event.'));
    } finally {
      setEventBusy(false);
    }
  }

  async function updateEventStatus(eventId, action) {
    setError('');
    setNotice('');
    try {
      await api(`/platform/events/${eventId}/${action}`, { method: 'PATCH' });
      setNotice(action === 'publish' ? 'Event published.' : 'Event cancelled.');
      await loadEvents();
    } catch (issue) {
      setError(messageFor(issue, 'Unable to update this event.'));
    }
  }

  async function createTicket(submitEvent) {
    submitEvent.preventDefault();
    if (!ticketEventId) return;
    setTicketBusy(true);
    setTicketError('');
    try {
      await api(`/platform/events/${ticketEventId}/tickets`, {
        method: 'POST',
        body: JSON.stringify({
          ...ticketForm,
          price: Number(ticketForm.price),
          capacity: Number(ticketForm.capacity),
        }),
      });
      setTicketForm({ name: '', description: '', price: '', capacity: '' });
      await loadTickets(ticketEventId);
    } catch (issue) {
      setTicketError(messageFor(issue, 'Unable to create ticket type.'));
    } finally {
      setTicketBusy(false);
    }
  }

  async function saveTicket(ticket) {
    setTicketError('');
    setTicketBusy(true);
    try {
      await api(`/platform/events/${ticketEventId}/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: ticket.name,
          price: Number(ticket.price),
          capacity: Number(ticket.capacity),
          status: ticket.status,
        }),
      });
      await loadTickets(ticketEventId);
    } catch (issue) {
      setTicketError(messageFor(issue, 'Unable to update ticket type.'));
    } finally {
      setTicketBusy(false);
    }
  }

  function changeTicket(ticketId, key, value) {
    setTickets((current) => current.map((ticket) => ticket.id === ticketId ? { ...ticket, [key]: value } : ticket));
  }

  return <section className="organizer-events-manager">
    <div className="page-heading"><div><p className="eyebrow">EVENT MANAGEMENT</p><h2>My Events</h2><p className="muted">Create, publish, and manage ticket inventory for your events.</p></div><button className="button" type="button" onClick={() => { resetEventForm(); setError(''); }}>+ New event</button></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {eventForm && <form className="panel organizer-event-form" onSubmit={saveEvent}>
      <h3>{editingEventId ? 'Edit event' : 'Create event'}</h3>
      <div className="form-grid">
        <label className="field"><span>Event name</span><input value={eventForm.title} minLength="2" maxLength="180" required onChange={(event) => setEventField('title', event.target.value)} /></label>
        <label className="field"><span>Category</span><input value={eventForm.type} maxLength="80" required onChange={(event) => setEventField('type', event.target.value)} /></label>
        <label className="field"><span>Start date and time</span><input type="datetime-local" value={eventForm.startDate} required onChange={(event) => setEventField('startDate', event.target.value)} /></label>
        <label className="field"><span>End date and time (optional)</span><input type="datetime-local" value={eventForm.endDate} onChange={(event) => setEventField('endDate', event.target.value)} /></label>
        <label className="field"><span>City (optional)</span><input maxLength="120" value={eventForm.city} onChange={(event) => setEventField('city', event.target.value)} /></label>
        <label className="field"><span>Venue (optional)</span><input maxLength="180" value={eventForm.venue} onChange={(event) => setEventField('venue', event.target.value)} /></label>
        <label className="field"><span>Cover image URL (optional)</span><input type="url" maxLength="1000" value={eventForm.coverImageUrl} onChange={(event) => setEventField('coverImageUrl', event.target.value)} /></label>
        <label className="field"><span>Capacity (optional)</span><input type="number" min="1" max="1000000" value={eventForm.capacity} onChange={(event) => setEventField('capacity', event.target.value)} /></label>
        <label className="field"><span>Budget (optional)</span><input type="number" min="0" step="0.01" value={eventForm.budget} onChange={(event) => setEventField('budget', event.target.value)} /></label>
        <label className="field organizer-event-description"><span>Description (optional)</span><textarea rows="4" maxLength="10000" value={eventForm.description} onChange={(event) => setEventField('description', event.target.value)} /></label>
        <label className="field organizer-event-description"><span>Planning notes (optional)</span><textarea rows="3" maxLength="2000" value={eventForm.notes} onChange={(event) => setEventField('notes', event.target.value)} /></label>
      </div>
      <div className="organizer-form-actions"><button className="button" type="submit" disabled={eventBusy}>{eventBusy ? 'Saving…' : editingEventId ? 'Save changes' : 'Create draft'}</button>{editingEventId && <button className="button secondary" type="button" onClick={resetEventForm} disabled={eventBusy}>Cancel editing</button>}</div>
    </form>}
    {loading ? <div className="loading" role="status"><span className="spinner" />Loading events…</div> : events.length === 0 ? <div className="empty panel"><strong>No events yet</strong><span>Create your first event to begin event planning and ticket management.</span></div> : <div className="organizer-event-list">
      {events.map((event) => <article className="panel organizer-event-card" key={event.id}>
        <div className="organizer-event-heading"><div><span className={`pill ${event.status}`}>{event.status}</span><h3>{event.title}</h3><p>{event.type} · {formatEventDate(event.startDate) || 'Date to be announced'} · {event.location || 'Location to be announced'}</p></div><div className="organizer-form-actions"><button className="button secondary small" onClick={() => startEdit(event)}>Edit</button><button className="button secondary small" onClick={() => loadTickets(event.id)}>{ticketEventId === event.id ? 'Refresh tickets' : 'Manage tickets'}</button>{event.status === 'draft' && <button className="button small" onClick={() => updateEventStatus(event.id, 'publish')}>Publish</button>}{event.status !== 'cancelled' && event.status !== 'completed' && <button className="button danger small" onClick={() => updateEventStatus(event.id, 'cancel')}>Cancel event</button>}</div></div>
        {ticketEventId === event.id && <div className="organizer-ticket-manager">
          <h4>Ticket types</h4>
          {ticketError && <p className="event-inline-error" role="alert">{ticketError}</p>}
          <form className="organizer-ticket-form" onSubmit={createTicket}>
            <label className="field"><span>Name</span><input required minLength="2" maxLength="120" value={ticketForm.name} onChange={(inputEvent) => setTicketForm((current) => ({ ...current, name: inputEvent.target.value }))} /></label>
            <label className="field"><span>Price (ETB)</span><input required type="number" min="0" step="0.01" value={ticketForm.price} onChange={(inputEvent) => setTicketForm((current) => ({ ...current, price: inputEvent.target.value }))} /></label>
            <label className="field"><span>Capacity</span><input required type="number" min="1" max="1000000" value={ticketForm.capacity} onChange={(inputEvent) => setTicketForm((current) => ({ ...current, capacity: inputEvent.target.value }))} /></label>
            <button className="button small" disabled={ticketBusy}>{ticketBusy ? 'Saving…' : 'Add ticket type'}</button>
          </form>
          {tickets.length === 0 ? <p className="muted">No ticket types configured.</p> : <div className="organizer-ticket-list">{tickets.map((ticket) => <div className="organizer-ticket-row" key={ticket.id}>
            <label className="field"><span>Ticket name</span><input value={ticket.name} maxLength="120" onChange={(inputEvent) => changeTicket(ticket.id, 'name', inputEvent.target.value)} /></label>
            <label className="field"><span>Price</span><input type="number" min="0" step="0.01" value={ticket.price} onChange={(inputEvent) => changeTicket(ticket.id, 'price', inputEvent.target.value)} /></label>
            <label className="field"><span>Capacity / sold</span><input type="number" min={ticket.soldQuantity} value={ticket.capacity} onChange={(inputEvent) => changeTicket(ticket.id, 'capacity', inputEvent.target.value)} /><small>{ticket.soldQuantity} sold</small></label>
            <label className="field"><span>Status</span><select value={ticket.status} onChange={(inputEvent) => changeTicket(ticket.id, 'status', inputEvent.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
            <button className="button secondary small" type="button" disabled={ticketBusy} onClick={() => saveTicket(ticket)}>Save</button>
          </div>)}</div>}
        </div>}
      </article>)}
    </div>}
  </section>;
}
