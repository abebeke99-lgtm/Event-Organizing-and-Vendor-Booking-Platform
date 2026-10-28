import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BadgeCheck, Bell, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, ChevronLeft, ChevronRight, ClipboardList, CreditCard, LayoutDashboard, LogOut, Menu, MessageSquareWarning, Search, Settings, Shield, Tags, UserRound, Users, X } from 'lucide-react';
import { INQUIRY_TYPES, buildContactInfo, validateContactForm } from './contactUtils.js';

const menu = [
  ['overview','Dashboard Overview',LayoutDashboard], ['users','User Management',Users], ['roles','Role and Permission Management',Shield],
  ['vendors','Vendor Verification',BadgeCheck], ['categories','Service Category Management',Tags], ['events','Event Management',CalendarDays],
  ['bookings','Booking Management',ClipboardList], ['payments','Payment and Refund Management',CreditCard], ['reviews','Reviews and Complaints',MessageSquareWarning],
  ['messages','Contact Messages',MessageSquareWarning], ['reports','Reports and Analytics',ChartNoAxesCombined], ['notifications','Notifications',Bell], ['audit-logs','Audit Logs',Activity],
  ['settings','System Settings',Settings], ['profile','Profile',UserRound], ['logout','Logout',LogOut]
];
const modules = {
  users:{title:'User Management', endpoint:'users', columns:['id','full_name','email','phone','roles','status','created_at'], fields:[['full_name','Full name','text'],['email','Email','email'],['phone','Phone','text']], create:true, actions:['role','status']},
  roles:{title:'Role and Permission Management', endpoint:'roles', columns:['id','name','description','is_active','created_at'], fields:[['name','Role name','text'],['description','Description','text']], create:true, actions:['permissions']},
  vendors:{title:'Vendor Verification', endpoint:'vendors', columns:['id','business_name','user_id','category_id','city','verification_status','verification_reason','verified_at'], actions:['verify','reject']},
  categories:{title:'Service Category Management', endpoint:'categories', columns:['id','name','description','is_active','created_at'], fields:[['name','Category name','text'],['description','Description','text']], create:true, actions:['edit','deactivate']},
  events:{title:'Event Management', endpoint:'events', columns:['id','title','event_type','organizer_id','city','start_date','budget','status'], fields:[['organizer_id','Organizer user ID','number'],['title','Title','text'],['event_type','Event type','text'],['city','City','text'],['start_date','Start date','datetime-local'],['end_date','End date','datetime-local'],['budget','Budget','number'],['status','Status','select','draft,active,booked,in_progress,completed,cancelled'],['notes','Notes','textarea']], create:true, actions:['edit','deactivate']},
  bookings:{title:'Booking Management', endpoint:'bookings', columns:['id','event_id','vendor_id','service_description','quoted_amount','currency','status','moderation_reason','created_at'], actions:['moderate']},
  payments:{title:'Payment and Refund Management', endpoint:'payments', columns:['id','booking_id','amount','currency','provider','provider_reference','status','created_at'], actions:['refund']},
  reviews:{title:'Reviews and Complaints', endpoint:'reviews', columns:['id','booking_id','rating','comment','status','created_at'], actions:['review']},
  complaints:{title:'Reviews and Complaints', endpoint:'complaints', columns:['id','user_id','booking_id','subject','details','status','resolution','created_at'], actions:['complaint']},
  messages:{title:'Contact Messages', endpoint:'contact', columns:['id','full_name','email','subject','inquiry_type','status','created_at'], actions:['status'], statuses:['new','reviewed','replied','closed']},
  notifications:{title:'Notifications', endpoint:'notifications', columns:['id','user_id','title','message','status','created_at'], fields:[['user_id','Recipient user ID (optional)','number'],['title','Title','text'],['message','Message','textarea']], create:true},
  'audit-logs':{title:'Audit Logs', endpoint:'audit-logs', columns:['id','actor_id','action','entity_type','entity_id','details','ip_address','created_at'], readonly:true},
};
const permissions = ['users:read','users:write','vendors:verify','events:write','bookings:moderate','payments:read','reviews:moderate','categories:write','reports:read','notifications:write'];
const slugPath = (slug) => slug === 'overview' ? '/admin' : `/admin/${slug}`;
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function api(path, options={}) {
  const response = await fetch(`${apiBaseUrl}/api${path}`, { credentials:'include', ...options, headers:{ ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) } });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}
function display(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean' || value === 0 || value === 1 && typeof value === 'number') return String(value);
  return String(value);
}
function Field({field,value,onChange}) {
  const [name,label,type,choices] = field;
  const common = { id:name, name, value:value ?? '', onChange:(event)=>onChange(name, event.target.value), required: !label.includes('optional') };
  return <label className="field"><span>{label}</span>{type === 'textarea' ? <textarea {...common} rows="3" /> : type === 'select' ? <select {...common}>{choices.split(',').map((item)=><option key={item} value={item}>{item}</option>)}</select> : <input {...common} type={type} step={type==='number'?'0.01':undefined} />}</label>;
}
function Modal({title,children,onClose,onSubmit,busy,submitLabel='Save',danger=false}) {
  return <div className="overlay" onMouseDown={(event)=>event.target===event.currentTarget && !busy && onClose()}><form className="modal" onSubmit={onSubmit}><div className="modal-head"><h2>{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18}/></button></div><div className="modal-body">{children}</div><div className="modal-foot"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className={`button ${danger?'danger':''}`} disabled={busy}>{busy?'Saving…':submitLabel}</button></div></form></div>;
}

const PUBLIC_NAV_ITEMS = [
  { key: 'home', label: 'Home', path: '/' },
  { key: 'events', label: 'Events', path: '/events' },
  { key: 'vendors', label: 'Find Vendors', path: '/vendors' },
  { key: 'services', label: 'Services', path: '/services' },
  { key: 'categories', label: 'Categories', path: '/categories' },
  { key: 'about', label: 'About Us', path: '/about' },
  { key: 'contact', label: 'Contact Us', path: '/contact' },
];

const ROUTE_LABELS = {
  '/': 'Home',
  '/events': 'Events',
  '/vendors': 'Find Vendors',
  '/services': 'Services',
  '/categories': 'Categories',
  '/about': 'About',
  '/contact': 'Contact',
  '/login': 'Login',
  '/register': 'Register',
  '/forgot-password': 'Reset Password',
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms and Conditions',
  '/help': 'Help Center',
};

function AppHeader({ user, currentPath, onNavigate, onLogout, onOpenLogin, onOpenRegister }) {
  const isAuthenticated = Boolean(user);
  const guestItems = [...PUBLIC_NAV_ITEMS];
  let roleItems = guestItems;

  if (isAuthenticated) {
    const role = user.role || 'customer';
    if (role === 'admin') {
      roleItems = [
        { key: 'dashboard', label: 'Admin Dashboard', path: '/admin/dashboard' },
        { key: 'users', label: 'User Management', path: '/admin/users' },
        { key: 'roles', label: 'Role and Permission Management', path: '/admin/roles' },
        { key: 'vendors', label: 'Vendor Verification', path: '/admin/vendor-verification' },
        { key: 'bookings', label: 'Bookings', path: '/admin/bookings' },
        { key: 'reports', label: 'Reports', path: '/admin/reports' },
        { key: 'system', label: 'System Control Center', path: '/admin/system-control' },
      ];
    } else if (role === 'organizer') {
      roleItems = [
        { key: 'dashboard', label: 'Organizer Dashboard', path: '/organizer/dashboard' },
        { key: 'events', label: 'My Events', path: '/organizer/events' },
        { key: 'vendors', label: 'Find Vendors', path: '/organizer/vendors' },
        { key: 'bookings', label: 'My Bookings', path: '/organizer/bookings' },
        { key: 'quotations', label: 'Quotations', path: '/organizer/quotations' },
        { key: 'budget', label: 'Budget', path: '/organizer/budget' },
      ];
    } else if (role === 'vendor') {
      roleItems = [
        { key: 'dashboard', label: 'Vendor Dashboard', path: '/vendor/dashboard' },
        { key: 'services', label: 'My Services', path: '/vendor/services' },
        { key: 'availability', label: 'Availability', path: '/vendor/availability' },
        { key: 'bookings', label: 'Booking Requests', path: '/vendor/bookings' },
        { key: 'quotations', label: 'Quotations', path: '/vendor/quotations' },
        { key: 'earnings', label: 'Earnings', path: '/vendor/earnings' },
      ];
    } else {
      roleItems = [
        { key: 'dashboard', label: 'Customer Dashboard', path: '/customer/dashboard' },
        { key: 'vendors', label: 'Browse Vendors', path: '/customer/vendors' },
        { key: 'bookings', label: 'My Bookings', path: '/customer/bookings' },
        { key: 'events', label: 'My Events', path: '/customer/events' },
        { key: 'favorites', label: 'Saved Vendors', path: '/customer/favorites' },
        { key: 'payments', label: 'Payments', path: '/customer/payments' },
      ];
    }
  }

  const navItems = isAuthenticated ? roleItems : guestItems;

  return <header className="site-header"><div className="site-header-inner"><button type="button" className="site-brand" onClick={() => onNavigate('/')} aria-label="Go to homepage"><span className="brand-mark small">EH</span><div><strong>EventHub</strong><small>Platform</small></div></button><nav className="site-nav" aria-label="Main navigation">{navItems.map((item) => <button key={item.path} type="button" className={`nav-link ${currentPath === item.path ? 'active' : ''}`} onClick={() => onNavigate(item.path)}>{item.label}</button>)}</nav><div className="header-actions"><button type="button" className="icon-button ghost" aria-label="Search"><Search size={16}/></button><button type="button" className="icon-button ghost" aria-label="Notifications"><Bell size={16}/></button>{isAuthenticated ? <><button type="button" className="button secondary small" onClick={() => onNavigate(roleItems[0]?.path || '/')}>{(user?.role || 'customer').charAt(0).toUpperCase() + (user?.role || 'customer').slice(1)} dashboard</button><button type="button" className="button secondary small" onClick={onLogout}>Logout</button></> : <><button type="button" className="button secondary small" onClick={onOpenLogin}>Login</button><button type="button" className="button small" onClick={onOpenRegister}>Register</button></>}</div></div></header>;
}

function AppFooter() {
  return <footer className="site-footer"><div className="site-footer-inner"><div className="footer-column"><div className="brand-pill"><div className="brand-mark small">EH</div><div><strong>EventHub</strong><small>Platform</small></div></div><p>One trusted marketplace for event planning, vendor discovery, booking coordination, and service fulfilment.</p></div><div className="footer-column"><h4>Explore</h4><a href="/events">Browse Events</a><a href="/vendors">Find Vendors</a><a href="/services">Browse Services</a><a href="/categories">Service Categories</a></div><div className="footer-column"><h4>Support</h4><a href="/help">Help Center</a><a href="/help">Frequently Asked Questions</a><a href="/help">Booking Guide</a><a href="/contact">Contact Support</a></div><div className="footer-column"><h4>Legal</h4><a href="/terms">Terms and Conditions</a><a href="/privacy">Privacy Policy</a><a href="/help">Cookie Policy</a><a href="/terms">Refund Policy</a></div></div><div className="site-footer-bottom"><span>© {new Date().getFullYear()} EventHub</span><span>hello@eventhub.example</span><span>+251 911 000 000</span></div></footer>;
}

function EmptyState({ title, message }) {
  return <div className="empty panel"><strong>{title}</strong><span>{message}</span></div>;
}

function Reveal({ children, className = '', direction = 'up', delay = 0, as: Component = 'div' }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion || !ref.current) {
      setVisible(true);
      return undefined;
    }

    const node = ref.current;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      });
    }, { threshold: 0.2 });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return React.createElement(Component, {
    ref,
    className: `reveal reveal-${direction} ${visible ? 'is-visible' : ''} ${className}`.trim(),
    style: { transitionDelay: `${delay}ms` },
    children,
  });
}

function BackToTopButton() {
  const [visible, setVisible] = useState(false);
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 260);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return <button type="button" className="back-to-top" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' })}>↑</button>;
}

function PublicOverview({ onOpenDashboard, currentPath, onNavigate }) {
  const [vendors, setVendors] = useState([]);
  const [services, setServices] = useState([]);
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState({ totalUsers: 0, totalVendors: 0, totalEvents: 0, totalBookings: 0 });
  const [activeSlide, setActiveSlide] = useState(0);

  const featureSlides = useMemo(() => [
    { title: 'Wedding planning', image: 'https://images.unsplash.com/photo-1520854221256-17451cc331bf?auto=format&fit=crop&w=1200&q=80', description: 'Plan elegant ceremonies, guest experiences, and event-day coordination.' },
    { title: 'Corporate events', image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80', description: 'Launch memorable conferences, launches, and executive experiences.' },
    { title: 'Birthdays & celebrations', image: 'https://images.unsplash.com/photo-1469371670807-013ccf25f16a?auto=format&fit=crop&w=1200&q=80', description: 'Create joyful milestone moments with curated vendors and services.' },
  ], []);

  const categoryCards = [
    { name: 'Weddings', image: 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&w=900&q=80', path: '/events' },
    { name: 'Catering', image: 'https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=900&q=80', path: '/services' },
    { name: 'Photography', image: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=900&q=80', path: '/vendors' },
    { name: 'Decor & Styling', image: 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80', path: '/categories' },
  ];

  useEffect(() => {
    async function loadLandingData() {
      try {
        const [overviewResponse, vendorsResponse, servicesResponse, eventsResponse] = await Promise.all([
          api('/platform/overview'),
          api('/platform/vendors'),
          api('/platform/services'),
          api('/platform/events'),
        ]);

        setSummary(overviewResponse?.data || {});
        setVendors(Array.isArray(vendorsResponse?.data) ? vendorsResponse.data : []);
        setServices(Array.isArray(servicesResponse?.data) ? servicesResponse.data : []);
        setEvents(Array.isArray(eventsResponse?.data) ? eventsResponse.data : []);
      } catch (error) {
        setVendors([]);
        setServices([]);
        setEvents([]);
      }
    }

    loadLandingData();
  }, []);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return undefined;
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % featureSlides.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [featureSlides]);

  const stats = [
    { label: 'Vendors live', value: `${summary.totalVendors || vendors.length || 120}+` },
    { label: 'Events planned', value: `${summary.totalEvents || events.length || 4800}` },
    { label: 'Bookings closed', value: `${summary.totalBookings || 9400}` },
  ];

  const displayVendors = vendors.slice(0, 4);
  const displayServices = services.slice(0, 4);
  const displayEvents = events.slice(0, 3);

  return <>
    <AppHeader user={null} currentPath={currentPath || '/'} onNavigate={onNavigate} onLogout={() => {}} onOpenLogin={() => onNavigate('/login')} onOpenRegister={() => onNavigate('/register')} />
    <main className="platform-landing">
      <section className="hero-section premium-hero">
        <div className="hero-copy reveal reveal-up is-visible">
          <p className="eyebrow">EVENT ORGANIZING & VENDOR BOOKING</p>
          <h1>Design unforgettable events with trusted partners.</h1>
          <p className="muted">Discover vetted vendors, compare service packages, and coordinate every detail from bookings to delivery in one polished platform.</p>
          <div className="cta-row">
            <button className="button" onClick={() => onNavigate('/vendors')}>Find Vendors</button>
            <button className="button secondary" onClick={() => onNavigate('/events')}>Explore Events</button>
          </div>
          <div className="hero-search">
            <input type="search" placeholder="Search vendors, services, and events" aria-label="Search vendors, services, and events" />
            <button type="button">Search</button>
          </div>
          <div className="chip-row">
            {['Weddings', 'Corporate', 'Graduations', 'Catering', 'Decor', 'Photography'].map((item) => <span key={item} className="chip">{item}</span>)}
          </div>
        </div>

        <div className="hero-visual reveal reveal-right is-visible">
          <div className="hero-visual-card hero-card-main">
            <img src="https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80" alt="Wedding venue celebration" />
            <div className="hero-overlay-card">
              <span>Featured venue</span>
              <strong>Fountain Hall</strong>
              <small>Wedding ceremony & reception</small>
            </div>
          </div>
          <div className="hero-floating-card hero-floating-top">
            <strong>4.9/5</strong>
            <span>Average vendor rating</span>
          </div>
          <div className="hero-floating-card hero-floating-bottom">
            <strong>320+</strong>
            <span>Urban event bookings</span>
          </div>
        </div>
      </section>

      <Reveal className="stat-strip" direction="up">
        {stats.map(({ label, value }) => <div key={label} className="stat-pill"><strong>{value}</strong><span>{label}</span></div>)}
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">POPULAR CATEGORIES</p>
            <h2>Explore event services by type</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/categories')}>Browse all</button>
        </div>
        <div className="category-grid">
          {categoryCards.map((category) => (
            <button key={category.name} type="button" className="category-card" onClick={() => onNavigate(category.path)}>
              <img src={category.image} alt={category.name} loading="lazy" />
              <span>{category.name}</span>
            </button>
          ))}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">FEATURED EVENTS</p>
            <h2>Event inspiration for every occasion</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/events')}>View all</button>
        </div>

        <div className="carousel-shell">
          <button type="button" className="carousel-control" aria-label="Previous slide" onClick={() => setActiveSlide((activeSlide - 1 + featureSlides.length) % featureSlides.length)}>{'‹'}</button>
          <div className="carousel-stage">
            {featureSlides.map((slide, index) => (
              <article key={slide.title} className={`slideshow-card ${index === activeSlide ? 'active' : ''}`}>
                <img src={slide.image} alt={slide.title} loading="eager" />
                <div className="slideshow-content">
                  <p>{slide.title}</p>
                  <span>{slide.description}</span>
                </div>
              </article>
            ))}
          </div>
          <button type="button" className="carousel-control" aria-label="Next slide" onClick={() => setActiveSlide((activeSlide + 1) % featureSlides.length)}>{'›'}</button>
        </div>
        <div className="carousel-dots" aria-label="slide navigation">
          {featureSlides.map((slide, index) => <button key={slide.title} type="button" className={index === activeSlide ? 'dot active' : 'dot'} aria-label={`Go to slide ${index + 1}`} onClick={() => setActiveSlide(index)} />)}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">FEATURED VENDORS</p>
            <h2>Trusted professionals for your next event</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/vendors')}>See all vendors</button>
        </div>
        <div className="card-grid">
          {displayVendors.length ? displayVendors.map((vendor) => (
            <article key={vendor.id} className="vendor-card">
              <div className="card-image-wrap">
                <img src={vendor.image || 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=900&q=80'} alt={vendor.name} loading="lazy" />
                <span className="verify-badge">{vendor.verified ? 'Verified' : 'Available'}</span>
              </div>
              <div className="card-body">
                <div className="meta-row"><span>{vendor.category || 'Event Services'}</span><span>★ {vendor.rating || 4.8}</span></div>
                <h3>{vendor.name}</h3>
                <p>{vendor.city || vendor.location || 'Service area available'}</p>
                <div className="card-actions">
                  <button className="button secondary small" type="button" onClick={() => onNavigate('/vendors')}>View profile</button>
                  <button className="icon-button ghost" type="button" aria-label={`Save ${vendor.name}`} onClick={() => onNavigate('/vendors')}>♥</button>
                </div>
              </div>
            </article>
          )) : <div className="empty-card">No vendor profiles are available right now.</div>}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">POPULAR SERVICES</p>
            <h2>Packages designed for smooth event execution</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/services')}>Browse services</button>
        </div>
        <div className="card-grid">
          {displayServices.length ? displayServices.map((service) => (
            <article key={service.id} className="service-card">
              <div className="card-image-wrap">
                <img src={service.image || 'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=900&q=80'} alt={service.title} loading="lazy" />
              </div>
              <div className="card-body">
                <div className="meta-row"><span>{service.category || 'Event service'}</span><span>★ {service.rating || 4.8}</span></div>
                <h3>{service.title}</h3>
                <p>{service.vendorName || 'EventHub vendor'}</p>
                <div className="pricing-row">
                  <strong>{service.price ? `${service.currency || 'ETB'} ${service.price}` : 'Request quote'}</strong>
                  <button type="button" className="button small" onClick={() => onNavigate('/services')}>Book</button>
                </div>
              </div>
            </article>
          )) : <div className="empty-card">No services are currently published.</div>}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">PUBLIC EVENT DISCOVERY</p>
            <h2>Events ready for your next memorable moment</h2>
          </div>
        </div>
        <div className="event-grid">
          {displayEvents.length ? displayEvents.map((event) => (
            <article key={event.id} className="event-card">
              <img src={event.image || 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=900&q=80'} alt={event.title} loading="lazy" />
              <div className="event-content">
                <span className="event-tag">{event.type || 'Event'}</span>
                <h3>{event.title}</h3>
                <p>{event.date || 'Date available'}</p>
                <small>{event.location || 'Location available'}</small>
                <button type="button" className="button secondary small" onClick={() => onNavigate('/events')}>View details</button>
              </div>
            </article>
          )) : <div className="empty-card">No public events are currently listed.</div>}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="process-grid">
          {[
            ['1', 'Discover', 'Browse verified vendors and service categories tailored to your event requirements.'],
            ['2', 'Compare', 'Shortlist formats, pricing, locations, and availability without losing visibility.'],
            ['3', 'Book', 'Request a quote, confirm details, and keep planning aligned across the event lifecycle.'],
          ].map(([step, title, copy]) => (
            <div key={step} className="process-card">
              <span className="process-number">{step}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="cta-banner">
          <div>
            <p className="eyebrow light">READY TO PLAN</p>
            <h2>Find the right people and services for your next event.</h2>
          </div>
          <div className="cta-banner-actions">
            <button className="button" onClick={() => onNavigate('/vendors')}>Find vendors</button>
            <button className="button pale" onClick={() => onNavigate('/register')}>Become a vendor</button>
          </div>
        </div>
      </Reveal>
    </main>
    <AppFooter />
    <BackToTopButton />
  </>;
}

function PublicPageLayout({ currentPath, user, onNavigate, onLogout, children }) {
  return <><AppHeader user={user} currentPath={currentPath} onNavigate={onNavigate} onLogout={onLogout} onOpenLogin={() => onNavigate('/login')} onOpenRegister={() => onNavigate('/register')} />{children}<AppFooter /></>;
}

function EventsPage({ onNavigate }) {
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('upcoming');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1, limit: 6 });

  useEffect(() => {
    async function loadEvents() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: '6', sort });
        if (search) params.set('search', search);
        if (category) params.set('category', category);
        if (location) params.set('location', location);

        const response = await api(`/platform/events?${params.toString()}`);
        const nextEvents = Array.isArray(response?.data) ? response.data : [];
        setEvents(nextEvents);
        setPagination(response?.pagination || { total: nextEvents.length, page, totalPages: 1, limit: 6, sort });
      } catch (error) {
        setEvents([]);
        setPagination({ total: 0, page: 1, totalPages: 1, limit: 6, sort });
      } finally {
        setLoading(false);
      }
    }
    loadEvents();
  }, [search, location, category, sort, page]);

  useEffect(() => {
    if (!selectedEvent && events.length) {
      setSelectedEvent(events[0]);
    }
  }, [events, selectedEvent]);

  function resetFilters() {
    setSearch('');
    setLocation('');
    setCategory('');
    setSort('upcoming');
    setPage(1);
  }

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">EVENTS</p><h2>Upcoming experiences</h2></div><button className="button secondary" onClick={() => onNavigate('/register')}>Plan my event</button></div>
    <div className="panel event-filter-panel">
      <div className="toolbar stacked-toolbar">
        <input className="field-input" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} placeholder="Search events, venues, or themes" />
        <select className="filter-select" value={location} onChange={(e) => { setPage(1); setLocation(e.target.value); }}>
          <option value="">All locations</option>
          <option value="Addis Ababa">Addis Ababa</option>
          <option value="Bahir Dar">Bahir Dar</option>
          <option value="Hawassa">Hawassa</option>
          <option value="Dire Dawa">Dire Dawa</option>
        </select>
        <select className="filter-select" value={category} onChange={(e) => { setPage(1); setCategory(e.target.value); }}>
          <option value="">All categories</option>
          <option value="wedding">Wedding</option>
          <option value="conference">Conference</option>
          <option value="social">Social</option>
          <option value="exhibition">Exhibition</option>
        </select>
        <select className="filter-select" value={sort} onChange={(e) => { setPage(1); setSort(e.target.value); }}>
          <option value="upcoming">Upcoming</option>
          <option value="earliest">Earliest</option>
          <option value="latest">Latest</option>
          <option value="alphabetical">Alphabetical</option>
        </select>
        <button type="button" className="button secondary small" onClick={resetFilters}>Reset</button>
      </div>
    </div>

    {loading ? <div className="loading"><span className="spinner"/>Loading event listings…</div> : events.length ? <div className="events-layout">
      <div className="card-grid event-list-grid">
        {events.map((event) => <article key={event.id} className={`info-card event-tile ${selectedEvent?.id === event.id ? 'selected' : ''}`} onClick={() => setSelectedEvent(event)}>
          <div className="event-thumb" style={{ backgroundImage: `linear-gradient(rgba(12,17,38,0.2), rgba(12,17,38,0.35)), url('https://images.unsplash.com/${event.id % 2 === 0 ? '1511578314322-379afb476865' : '1519741497674-611481863552'}?auto=format&fit=crop&w=900&q=80')` }} />
          <div className="event-tile-body">
            <span className="event-tag">{event.type || 'Event'}</span>
            <h3>{event.title}</h3>
            <p>{event.location || 'Location available'}</p>
            <small>{new Date(event.startDate || event.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>
            <div className="pricing-row compact-row"><strong>{event.budget ? `ETB ${Number(event.budget).toLocaleString()}` : 'Request quote'}</strong><button type="button" className="button secondary small" onClick={(e) => { e.stopPropagation(); setSelectedEvent(event); }}>View details</button></div>
          </div>
        </article>)}
      </div>

      {selectedEvent && <article className="info-card event-detail-card">
        <div className="event-detail-header">
          <div>
            <p className="eyebrow">EVENT HIGHLIGHT</p>
            <h3>{selectedEvent.title}</h3>
          </div>
          <button type="button" className="button secondary small" onClick={() => onNavigate('/services')}>Request packages</button>
        </div>
        <p>{selectedEvent.description || 'A curated event designed to deliver a memorable guest experience.'}</p>
        <div className="detail-meta-grid">
          <div><span>Category</span><strong>{selectedEvent.category || selectedEvent.type || 'Event'}</strong></div>
          <div><span>Location</span><strong>{selectedEvent.location || 'Location TBD'}</strong></div>
          <div><span>Date</span><strong>{new Date(selectedEvent.startDate || selectedEvent.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</strong></div>
          <div><span>Budget</span><strong>{selectedEvent.budget ? `ETB ${Number(selectedEvent.budget).toLocaleString()}` : 'On request'}</strong></div>
        </div>
      </article>}

      <div className="pagination-row">
        <button className="button secondary small" type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
        <span>Page {pagination.page || page} of {pagination.totalPages || 1}</span>
        <button className="button secondary small" type="button" disabled={page >= (pagination.totalPages || 1)} onClick={() => setPage((current) => Math.min(pagination.totalPages || 1, current + 1))}>Next</button>
      </div>
    </div> : <EmptyState title="No event listings are available" message="Check back when public event listings are published or adjust your filters." />}
  </div></main>;
}

function VendorDetailPage({ vendorId, onNavigate }) {
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bookingState, setBookingState] = useState('');

  useEffect(() => {
    async function loadVendor() {
      try {
        setLoading(true);
        const response = await api(`/platform/vendors/${vendorId}`);
        setVendor(response.data || null);
        setError('');
      } catch (issue) {
        setError(issue.message || 'Vendor record not found.');
      } finally {
        setLoading(false);
      }
    }

    loadVendor();
  }, [vendorId]);

  const handleBookService = async (service) => {
    const selectedService = service || vendor?.services?.[0];
    if (!selectedService) {
      setBookingState('This vendor is not currently offering any published services.');
      return;
    }

    try {
      setBookingState('Submitting booking request…');
      await api('/platform/bookings', {
        method: 'POST',
        body: JSON.stringify({
          serviceTitle: selectedService.title || `${vendor.business_name} service`,
          quotedAmount: Number(selectedService.price || vendor.priceFrom || 0),
          currency: 'ETB',
          status: 'pending',
        }),
      });
      setBookingState('Booking request created successfully.');
      window.setTimeout(() => onNavigate('/login'), 1000);
    } catch (issue) {
      setBookingState(issue.message || 'Unable to create the booking request.');
    }
  };

  if (loading) {
    return <main className="page-shell"><div className="content-stack"><div className="info-card wide"><div className="loading"><span className="spinner" />Loading vendor profile…</div></div></div></main>;
  }

  if (error || !vendor) {
    return <main className="page-shell"><div className="content-stack"><div className="info-card wide danger-card"><p className="eyebrow">PROFILE UNAVAILABLE</p><h2>Vendor not found</h2><p>{error || 'This vendor is not currently public or is unavailable.'}</p><button className="button" type="button" onClick={() => onNavigate('/vendors')}>Back to vendors</button></div></div></main>;
  }

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">VENDOR PROFILE</p><h2>{vendor.business_name || vendor.name}</h2></div><button className="button secondary small" type="button" onClick={() => onNavigate('/vendors')}>Browse all vendors</button></div>
    <article className="info-card wide">
      <div className="profile-panel">
        <div className="profile-avatar">{(vendor.business_name || vendor.name || 'V').slice(0, 1).toUpperCase()}</div>
        <div>
          <h3>{vendor.business_name || vendor.name}</h3>
          <p className="muted">{vendor.category || 'Event services'} • {vendor.city || 'Remote service area'}</p>
          <p>{vendor.verified ? 'Verified business profile' : 'Public listing'} • {vendor.reviewCount || 0} reviews • ★ {Number(vendor.rating || 0).toFixed(1)}</p>
        </div>
        <button className="button" type="button" onClick={() => handleBookService()}>{bookingState.startsWith('Submitting') ? 'Processing…' : 'Book service'}</button>
      </div>
      {bookingState && <div className="alert success" style={{ marginTop: '14px' }}>{bookingState}</div>}
      <div className="report-grid" style={{ marginTop: '18px' }}>
        <div className="info-card"><h3>About</h3><p>{vendor.description || 'A trusted event partner helping clients plan memorable experiences.'}</p></div>
        <div className="info-card"><h3>Starting from</h3><p>{vendor.priceFrom ? `ETB ${Number(vendor.priceFrom).toLocaleString()}` : 'Price on request'}</p></div>
        <div className="info-card"><h3>Location</h3><p>{vendor.city || 'Service area available on request'}</p></div>
      </div>
    </article>

    <section className="content-stack">
      <div className="section-header compact-header"><div><p className="eyebrow">PUBLISHED SERVICES</p><h2>Available service packages</h2></div></div>
      {Array.isArray(vendor.services) && vendor.services.length ? <div className="card-grid">{vendor.services.filter((service) => service && service.published !== false && service.visibility !== 'private').map((service) => <article key={service.id} className="info-card"><h3>{service.title}</h3><p>{service.description || 'Custom service package tailored to your event needs.'}</p><div className="pricing-row"><strong>{service.price ? `ETB ${Number(service.price).toLocaleString()}` : 'Request quote'}</strong><button className="button secondary small" type="button" onClick={() => handleBookService(service)}>Book service</button></div></article>)}</div> : <div className="empty-card">This vendor has no published services at the moment.</div>}
    </section>
  </div></main>;
}

function VendorsPage({ onNavigate, user }) {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [location, setLocation] = useState('all');
  const [sort, setSort] = useState('recommended');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: 12 });
  const [notice, setNotice] = useState('');

  const fetchVendors = useCallback(async (nextPage = page, nextFilters = { search, category, location, sort }) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: '12', sort: nextFilters.sort || 'recommended' });
      if (nextFilters.search) params.set('search', nextFilters.search);
      if (nextFilters.category && nextFilters.category !== 'all') params.set('category', nextFilters.category);
      if (nextFilters.location && nextFilters.location !== 'all') params.set('location', nextFilters.location);
      const response = await api(`/platform/vendors?${params.toString()}`);
      setVendors(response.data || []);
      setPagination({
        page: response.pagination?.page || 1,
        totalPages: response.pagination?.totalPages || 1,
        total: response.pagination?.total || 0,
        limit: response.pagination?.limit || 12,
      });
    } catch (issue) {
      setVendors([]);
      setPagination({ page: 1, totalPages: 1, total: 0, limit: 12 });
      setNotice(issue.message || 'Unable to load vendor listings.');
    } finally {
      setLoading(false);
    }
  }, [page, search, category, location, sort]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryCategory = params.get('category');
    if (queryCategory) {
      setCategory(queryCategory);
    } else {
      setCategory('all');
    }
  }, []);

  useEffect(() => {
    fetchVendors(1, { search, category, location, sort });
    setPage(1);
  }, [search, category, location, sort]);

  useEffect(() => {
    fetchVendors(page, { search, category, location, sort });
  }, [page]);

  const categories = Array.from(new Set(vendors.map((vendor) => vendor.category).filter(Boolean))).sort();
  const locations = Array.from(new Set(vendors.map((vendor) => vendor.city).filter(Boolean))).sort();

  const handleBookService = async (vendorRecord) => {
    const selectedService = Array.isArray(vendorRecord?.services) ? vendorRecord.services.find((service) => service && service.published !== false && service.visibility !== 'private') : null;
    const serviceTitle = selectedService?.title || `${vendorRecord.business_name || vendorRecord.name} service`;
    const amount = Number(selectedService?.price || vendorRecord.priceFrom || 0);

    try {
      await api('/platform/bookings', {
        method: 'POST',
        body: JSON.stringify({ serviceTitle, quotedAmount: amount, currency: 'ETB', status: 'pending' }),
      });
      setNotice(`Booking request created for ${serviceTitle}.`);
      if (!user) {
        window.setTimeout(() => onNavigate('/login'), 600);
      }
    } catch (issue) {
      setNotice(issue.message || 'Unable to create your booking request.');
    }
  };

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">VENDORS</p><h2>Verified event partners</h2></div></div>
    {notice && <div className="alert success">{notice}</div>}
    <div className="panel" style={{ padding: '18px 20px' }}>
      <div className="toolbar">
        <div className="search-box"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vendors, categories, or locations" /></div>
        <select className="filter-select" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="all">All categories</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="filter-select" value={location} onChange={(event) => setLocation(event.target.value)}>
          <option value="all">All locations</option>
          {locations.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="filter-select" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="recommended">Recommended</option>
          <option value="highest-rated">Highest rated</option>
          <option value="most-reviewed">Most reviewed</option>
          <option value="price-low">Price: low to high</option>
          <option value="price-high">Price: high to low</option>
        </select>
        <button type="button" className="button secondary small" onClick={() => { setSearch(''); setCategory('all'); setLocation('all'); setSort('recommended'); }}>Reset</button>
      </div>
    </div>

    {loading ? <div className="loading"><span className="spinner" />Loading vendor directory…</div> : vendors.length ? <>
      <div className="card-grid">
        {vendors.map((vendor) => <article key={vendor.id} className="vendor-card">
          <div className="card-image-wrap">
            <img src={vendor.image || 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=900&q=80'} alt={vendor.business_name || vendor.name} loading="lazy" />
            {vendor.verified && <span className="verify-badge">Verified</span>}
          </div>
          <div className="card-body">
            <div className="meta-row"><span>{vendor.category || 'Event services'}</span><span>★ {Number(vendor.rating || 0).toFixed(1)}</span></div>
            <h3>{vendor.business_name || vendor.name}</h3>
            <p>{vendor.city || 'Location available'}</p>
            <div className="pricing-row"><strong>{vendor.priceFrom ? `ETB ${Number(vendor.priceFrom).toLocaleString()}` : 'Request quote'}</strong><span>{vendor.reviewCount || 0} reviews</span></div>
            <div className="card-actions">
              <button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${vendor.id}`)}>View profile</button>
              <button className="button small" type="button" onClick={() => handleBookService(vendor)}>Book service</button>
            </div>
          </div>
        </article>)}
      </div>

      <div className="pagination"><span>Showing {vendors.length} of {pagination.total || vendors.length} vendors</span><div>
        <button className="icon-button" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={18}/></button>
        <span>Page {pagination.page || 1} of {Math.max(1, pagination.totalPages || 1)}</span>
        <button className="icon-button" type="button" disabled={page >= (pagination.totalPages || 1)} onClick={() => setPage((value) => Math.min(pagination.totalPages || 1, value + 1))}><ChevronRight size={18}/></button>
      </div></div>
    </> : <EmptyState title="No vendor matches found" message="Try a different search or filter to explore the verified directory." />}
  </div></main>;
}

function ServicesPage({ onNavigate }) {
  const [services, setServices] = useState([]);
  const [status, setStatus] = useState('');
  const [filters, setFilters] = useState({ search: '', category: 'all', location: 'all', minPrice: '', maxPrice: '', sort: 'recommended' });
  const [loading, setLoading] = useState(true);

  async function loadServices(nextFilters = filters) {
    setLoading(true);
    setStatus('');
    try {
      const params = new URLSearchParams({ page: '1', limit: '12', sort: nextFilters.sort || 'recommended' });
      if (nextFilters.search) params.set('search', nextFilters.search);
      if (nextFilters.category && nextFilters.category !== 'all') params.set('category', nextFilters.category);
      if (nextFilters.location && nextFilters.location !== 'all') params.set('location', nextFilters.location);
      if (nextFilters.minPrice) params.set('minPrice', nextFilters.minPrice);
      if (nextFilters.maxPrice) params.set('maxPrice', nextFilters.maxPrice);
      const response = await api(`/platform/services?${params.toString()}`);
      setServices(Array.isArray(response.data) ? response.data : []);
    } catch (issue) {
      setServices([]);
      setStatus(issue.message || 'Unable to load services.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadServices(filters); }, []);

  async function submitQuoteRequest(service) {
    try {
      setStatus('Submitting quote request…');
      const payload = {
        serviceId: service.id,
        serviceTitle: service.title,
        vendorId: service.vendorId,
        vendorName: service.vendorName || 'Vendor',
        eventDate: new Date().toISOString().slice(0, 10),
        guestCount: 100,
        budget: Number(service.price || 0),
        notes: `Requesting a quote for ${service.title}.`,
      };
      await api('/platform/service-quote-requests', { method: 'POST', body: JSON.stringify(payload) });
      setStatus('Quote request submitted successfully.');
    } catch (issue) {
      setStatus(issue.message || 'Unable to submit a quote request.');
    }
  }

  const categories = Array.from(new Set(services.map((service) => service.category).filter(Boolean))).sort();
  const locations = Array.from(new Set(services.map((service) => service.city).filter(Boolean))).sort();

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">SERVICES</p><h2>Popular packages</h2></div></div>{status && <div className="alert success">{status}</div>}<div className="panel" style={{ padding: '18px 20px' }}><div className="toolbar stacked-toolbar"><input className="field-input" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search service names or providers" /><select className="filter-select" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><select className="filter-select" value={filters.location} onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))}><option value="all">All locations</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select><select className="filter-select" value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}><option value="recommended">Recommended</option><option value="highest-rated">Highest rated</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select><button type="button" className="button secondary small" onClick={() => { const next = { search: '', category: 'all', location: 'all', minPrice: '', maxPrice: '', sort: 'recommended' }; setFilters(next); loadServices(next); }}>Reset</button><button type="button" className="button small" onClick={() => loadServices(filters)}>Apply filters</button></div></div>{loading ? <div className="loading"><span className="spinner"/>Loading services…</div> : services.length ? <div className="card-grid">{services.map((service) => <article key={service.id} className="info-card"><h3>{service.title}</h3><p>{service.vendorName || 'EventHub partner'}</p><small>{service.category} • {service.city}</small><div className="pricing-row compact-row"><strong>{service.price ? `${service.currency || 'ETB'} ${Number(service.price).toLocaleString()}` : 'Request quote'}</strong><span>{service.rating ? `${Number(service.rating).toFixed(1)}★` : 'New'}</span></div><p>{service.description || 'Custom package tailored to your event needs.'}</p><button className="button secondary small" onClick={() => submitQuoteRequest(service)}>Request quote</button></article>)}</div> : <EmptyState title="No services available" message="There are no public service listings that match your filters." />}</div></main>;
}

function CategoriesPage({ onNavigate }) {
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadCategories() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        const response = await api(`/platform/categories${params.size ? `?${params.toString()}` : ''}`);
        if (active) setCategories(Array.isArray(response.data) ? response.data : []);
      } catch (issue) {
        if (active) {
          setCategories([]);
          setError(issue.message || 'Unable to load categories.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadCategories();
    return () => { active = false; };
  }, [search]);

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">CATEGORIES</p><h2>Browse by service type</h2></div></div>{error && <div className="alert error">{error}</div>}<div className="panel" style={{ padding: '18px 20px' }}><div className="toolbar stacked-toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search categories or descriptions" /></div><button type="button" className="button secondary small" onClick={() => setSearch('')}>Clear</button></div></div>{loading ? <div className="loading"><span className="spinner" />Loading categories…</div> : categories.length ? <div className="card-grid soft-grid">{categories.map((category) => <article key={category.id} className="info-card"><img src={category.image || 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80'} alt={category.name} loading="lazy" className="category-card-image" /><h3>{category.name}</h3><p>{category.description || 'Available service category'}</p><div className="meta-row compact-row"><span>{category.vendorCount ? `${category.vendorCount} vendors` : 'No vendors currently available'}</span><span>{category.serviceCount ? `${category.serviceCount} services` : 'No services listed'}</span></div><div className="card-actions"><button className="button secondary small" type="button" onClick={() => onNavigate(`/categories/${category.slug || category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)}>Open category</button><button className="button small" type="button" onClick={() => onNavigate(`/vendors?category=${encodeURIComponent(category.slug || category.name)}`)}>View vendors</button></div></article>)}</div> : <EmptyState title="No categories found" message="There are no public categories matching your search right now." />}</div></main>;
}

function CategoryDetailPage({ slug, onNavigate }) {
  const [category, setCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadCategoryDetail() {
      setLoading(true);
      setError('');
      try {
        const response = await api(`/platform/categories/${encodeURIComponent(slug)}`);
        if (active) setCategory(response.data || null);
      } catch (issue) {
        if (active) {
          setCategory(null);
          setError(issue.message || 'Category not found.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    if (slug) loadCategoryDetail();
    return () => { active = false; };
  }, [slug]);

  if (loading) return <main className="page-shell"><div className="content-stack"><div className="loading"><span className="spinner" />Loading category…</div></div></main>;
  if (error) return <main className="page-shell"><div className="content-stack"><div className="empty panel"><strong>Category unavailable</strong><span>{error}</span><button className="button secondary small" type="button" onClick={() => onNavigate('/categories')}>Back to categories</button></div></div></main>;
  if (!category) return <main className="page-shell"><div className="content-stack"><EmptyState title="No category found" message="This category does not exist or is not public." /></div></main>;

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">CATEGORY</p><h2>{category.name}</h2></div><button className="button secondary small" type="button" onClick={() => onNavigate('/categories')}>Back to categories</button></div><div className="info-card wide"><img src={category.image || 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80'} alt={category.name} className="category-detail-image" /><div className="category-detail-copy"><p>{category.description || 'Available service category'}</p><div className="meta-row compact-row"><span>{category.vendorCount ? `${category.vendorCount} active vendors` : 'No vendors currently available'}</span><span>{category.serviceCount ? `${category.serviceCount} available services` : 'No services listed'}</span></div><button className="button" type="button" onClick={() => onNavigate(`/vendors?category=${encodeURIComponent(category.slug || category.name)}`)}>View vendors</button></div></div><div className="content-stack"><div className="section-header compact-header"><div><p className="eyebrow">VENDORS</p><h3>Relevant vendors</h3></div></div>{Array.isArray(category.vendors) && category.vendors.length ? <div className="card-grid">{category.vendors.map((vendor) => <article key={vendor.id} className="vendor-card"><div className="card-image-wrap"><img src={vendor.image || 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=900&q=80'} alt={vendor.business_name || vendor.name} loading="lazy" />{vendor.verified && <span className="verify-badge">Verified</span>}</div><div className="card-body"><div className="meta-row"><span>{vendor.category || 'Event services'}</span><span>★ {Number(vendor.rating || 0).toFixed(1)}</span></div><h3>{vendor.business_name || vendor.name}</h3><p>{vendor.city || 'Location available'}</p><div className="pricing-row"><strong>{vendor.priceFrom ? `ETB ${Number(vendor.priceFrom).toLocaleString()}` : 'Request quote'}</strong><span>{vendor.reviewCount || 0} reviews</span></div><div className="card-actions"><button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${vendor.id}`)}>View profile</button><button className="button small" type="button" onClick={() => onNavigate(`/vendors?category=${encodeURIComponent(category.slug || category.name)}`)}>Book service</button></div></div></article>)}</div> : <EmptyState title="No vendors currently available" message="This category has no eligible vendors right now." />}</div><div className="content-stack"><div className="section-header compact-header"><div><p className="eyebrow">SERVICES</p><h3>Available services</h3></div></div>{Array.isArray(category.services) && category.services.length ? <div className="card-grid">{category.services.map((service) => <article key={service.id} className="info-card"><h3>{service.title}</h3><p>{service.vendorName || 'EventHub partner'}</p><small>{service.category} • {service.city}</small><div className="pricing-row compact-row"><strong>{service.price ? `ETB ${Number(service.price).toLocaleString()}` : 'Request quote'}</strong><span>{service.rating ? `${Number(service.rating).toFixed(1)}★` : 'New'}</span></div><p>{service.description || 'Custom package tailored to your event needs.'}</p></article>)}</div> : <EmptyState title="No services listed" message="This category does not currently have published services available." />}</div></div></main>;
}

function AboutPage() {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadAboutContent() {
      try {
        setLoading(true);
        const response = await api('/about');
        if (active) {
          setContent(response?.data || null);
          setError('');
        }
      } catch (issue) {
        if (active) {
          setError(issue.message || 'Unable to load About page content.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAboutContent();
    return () => { active = false; };
  }, []);

  if (loading) {
    return <main className="page-shell"><div className="content-stack"><div className="loading"><span className="spinner" />Loading About page…</div></div></main>;
  }

  const payload = content || {
    hero: { heading: 'About EventHub', subtitle: 'Your trusted platform for planning and organizing memorable events.' },
    hero_heading: 'About EventHub',
    hero_subtitle: 'Your trusted platform for planning and organizing memorable events.',
    introduction: 'EventHub helps organizers and customers discover event services, compare categories, request quotations, and coordinate bookings in one place.',
    mission: 'Simplify event planning by connecting customers with the right service categories and vendors.',
    vision: 'Make event-service discovery more accessible, better organized, and easier to trust.',
    values: [
      { title: 'Trust and Transparency', description: 'Clear information and direct coordination between customers and providers.' },
      { title: 'Quality Service', description: 'Access to vetted, relevant, and highly rated vendors.' },
      { title: 'Customer Satisfaction', description: 'A better journey from discovery to event completion.' },
    ],
    benefits: [
      { title: 'Easy discovery', description: 'Browse categories, vendors, and services in one place.' },
      { title: 'Quick coordination', description: 'Request quotes and communicate with providers faster.' },
      { title: 'Better planning', description: 'Organize event details, budgets, and schedules in a single workflow.' },
    ],
    steps: [
      { title: 'Explore categories', description: 'Select a service type that matches your event needs.' },
      { title: 'Compare vendors', description: 'See service details, ratings, and location information.' },
      { title: 'Book and monitor', description: 'Confirm the booking and track progress from planning to completion.' },
    ],
    statistics: { categoryCount: 5, vendorCount: 24, serviceCount: 110, completedBookingCount: 680 },
    categories: [],
  };

  const hero = payload.hero || { heading: payload.hero_heading || 'About EventHub', subtitle: payload.hero_subtitle || 'Your trusted platform for planning and organizing memorable events.' };
  const values = Array.isArray(payload.values) && payload.values.length ? payload.values : [
    { title: 'Trust and Transparency', description: 'Clear information and direct coordination between customers and vendors.' },
    { title: 'Quality Service', description: 'Access to relevant, vetted, and highly rated vendors.' },
    { title: 'Customer Satisfaction', description: 'A smoother event planning experience from discovery to completion.' },
  ];
  const benefits = Array.isArray(payload.benefits) && payload.benefits.length ? payload.benefits : [
    { title: 'Easy discovery', description: 'Browse categories, vendors, and services in one place.' },
    { title: 'Quick coordination', description: 'Request quotes and communicate with providers faster.' },
    { title: 'Better planning', description: 'Organize event details, budgets, and schedules in a single workflow.' },
  ];
  const steps = Array.isArray(payload.steps) && payload.steps.length ? payload.steps : [
    { title: 'Explore categories', description: 'Select a service type that matches your event needs.' },
    { title: 'Compare vendors', description: 'See service details, ratings, and location information.' },
    { title: 'Book and monitor', description: 'Confirm the booking and track progress from planning to completion.' },
  ];

  const stats = payload.statistics || { categoryCount: 5, vendorCount: 24, serviceCount: 110, completedBookingCount: 680 };

  return <main className="page-shell"><div className="content-stack about-page"><section className="info-card wide about-hero"><div className="about-copy"><p className="eyebrow">ABOUT US</p><h2>{hero.heading}</h2><p className="muted">{hero.subtitle}</p><p>{payload.introduction || 'EventHub helps organizers and customers discover event services, compare categories, request quotations, and coordinate bookings in one place.'}</p><div className="cta-row"><button type="button" className="button" onClick={() => window.history.pushState({}, '', '/vendors')}>Find vendors</button><button type="button" className="button secondary" onClick={() => window.history.pushState({}, '', '/categories')}>Browse categories</button></div></div><div className="about-hero-media"><img src="https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80" alt="EventHub team planning" /><div className="hero-overlay-card"><strong>{stats.vendorCount || 24}+</strong><span>Verified vendors</span></div></div></section>

  <div className="metric-grid"><article className="metric-card"><p>Service categories</p><strong>{stats.categoryCount || 5}</strong><span>Platform categories</span></article><article className="metric-card"><p>Active vendors</p><strong>{stats.vendorCount || 24}</strong><span>Verified and public</span></article><article className="metric-card"><p>Published services</p><strong>{stats.serviceCount || 110}</strong><span>Ready for discovery</span></article><article className="metric-card"><p>Completed bookings</p><strong>{stats.completedBookingCount || 680}</strong><span>Successful outcomes</span></article></div>

  <div className="two-column-layout"><article className="panel"><div className="panel-header"><h3>Our mission</h3></div><p>{payload.mission || 'Simplify event planning by connecting customers with the right service categories and vendors.'}</p></article><article className="panel"><div className="panel-header"><h3>Our vision</h3></div><p>{payload.vision || 'Make event-service discovery more accessible, better organized, and easier to trust.'}</p></article></div>

  <section className="panel"><div className="panel-header"><h3>What we value</h3></div><div className="card-grid soft-grid">{values.map((item, index) => <article key={`${item.title}-${index}`} className="info-card"><h4>{item.title}</h4><p>{item.description}</p></article>)}</div></section>

  <section className="panel"><div className="panel-header"><h3>How it works</h3></div><div className="card-grid soft-grid">{steps.map((item, index) => <article key={`${item.title}-${index}`} className="info-card"><span className="eyebrow">STEP {index + 1}</span><h4>{item.title}</h4><p>{item.description}</p></article>)}</div></section>

  <section className="panel"><div className="panel-header"><h3>Why EventHub</h3></div><div className="list-stack">{benefits.map((item, index) => <div key={`${item.title}-${index}`} className="list-card"><div><strong>{item.title}</strong><small>{item.description}</small></div></div>)}</div></section>

  {error && <div className="alert error">{error}</div>}

  <section className="info-card wide cta-banner"><div><p className="eyebrow">READY TO PLAN?</p><h3>Build your next event with trusted partners.</h3></div><div className="cta-row"><button type="button" className="button" onClick={() => window.history.pushState({}, '', '/register')}>Create account</button><button type="button" className="button secondary" onClick={() => window.history.pushState({}, '', '/contact')}>Talk to support</button></div></section>
  </div></main>;
}

function ContactPage() {
  const [page, setPage] = useState({ contact: {}, faq: [] });
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    subject: '',
    inquiry_type: 'general_inquiry',
    message: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadContactPage() {
      try {
        const response = await api('/contact');
        if (active) {
          setPage(response?.data || { contact: {}, faq: [] });
          setError('');
        }
      } catch (issue) {
        if (active) setError(issue.message || 'Unable to load the Contact page.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadContactPage();
    return () => { active = false; };
  }, []);

  function updateValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  }

  async function submitContact(event) {
    event.preventDefault();
    const { normalized, errors: validationErrors } = validateContactForm(form);
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const response = await api('/contact', {
        method: 'POST',
        body: JSON.stringify(normalized),
      });
      setSuccess(`Your message has been sent successfully. Reference: ${response?.data?.reference || 'EH-000001'}`);
      setForm({
        full_name: '',
        email: '',
        phone: '',
        subject: '',
        inquiry_type: 'general_inquiry',
        message: '',
      });
    } catch (issue) {
      setError(issue.message || 'Unable to send your message right now.');
    } finally {
      setSubmitting(false);
    }
  }

  const contactInfo = buildContactInfo(page.contact || {});

  if (loading) {
    return <main className="page-shell"><div className="content-stack"><div className="loading"><span className="spinner" />Loading contact information…</div></div></main>;
  }

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">CONTACT</p><h2>Reach the support team</h2></div></div>
    <div className="two-column-layout">
      <section className="panel">
        <div className="panel-header"><h3>Contact details</h3></div>
        <div className="info-list">
          {contactInfo.email && <div className="list-card"><strong>Email</strong><small>{contactInfo.email}</small></div>}
          {contactInfo.phone && <div className="list-card"><strong>Phone</strong><small>{contactInfo.phone}</small></div>}
          {contactInfo.address && <div className="list-card"><strong>Office</strong><small>{contactInfo.address}</small></div>}
          {contactInfo.hours && <div className="list-card"><strong>Support hours</strong><small>{contactInfo.hours}</small></div>}
        </div>
        {contactInfo.socials?.length ? <div className="social-links"><strong>Follow us</strong><div className="link-stack">{contactInfo.socials.map((entry, index) => <a key={`${entry}-${index}`} href={entry.url || '#'} target="_blank" rel="noreferrer">{entry.label || 'Social link'}</a>)}</div></div> : null}
      </section>

      <section className="panel">
        <div className="panel-header"><h3>Send a message</h3></div>
        {error && <div className="alert error">{error}</div>}
        {success && <div className="alert success">{success}</div>}
        <form className="stack-form" onSubmit={submitContact} noValidate>
          <div className="form-grid two-col">
            <label className="field"><span>Full name</span><input value={form.full_name} onChange={(event) => updateValue('full_name', event.target.value)} required /></label>
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(event) => updateValue('email', event.target.value)} required /></label>
            <label className="field"><span>Phone</span><input value={form.phone} onChange={(event) => updateValue('phone', event.target.value)} placeholder="Optional" /></label>
            <label className="field"><span>Inquiry type</span><select value={form.inquiry_type} onChange={(event) => updateValue('inquiry_type', event.target.value)}>
              {INQUIRY_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>
          </div>
          <label className="field"><span>Subject</span><input value={form.subject} onChange={(event) => updateValue('subject', event.target.value)} required /></label>
          {errors.subject && <small className="field-error">{errors.subject}</small>}
          <label className="field"><span>Message</span><textarea rows="6" value={form.message} onChange={(event) => updateValue('message', event.target.value)} required /></label>
          {errors.message && <small className="field-error">{errors.message}</small>}
          <button className="button" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send inquiry'}</button>
        </form>
      </section>
    </div>

    <section className="panel"><div className="panel-header"><h3>Frequently asked questions</h3></div>
      <div className="accordion-stack">{(page.faq || []).map((item, index) => (
        <div key={`${item.question}-${index}`} className="info-card"><strong>{item.question}</strong><p>{item.answer}</p></div>
      ))}</div>
    </section>
  </div></main>;
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { await onLogin(email, password); } catch (issue) { setError(issue.message); } finally { setBusy(false); } }
  return <main className="login-wrap"><div className="login-card"><div className="brand-mark">EH</div><p className="eyebrow">EVENTHUB ACCOUNT</p><h1>Sign in</h1><p className="muted">Access your platform workspace and role dashboard.</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>Email address</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="button login-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button></form><div className="inline-links"><button type="button" className="text-link" onClick={() => window.history.pushState({}, '', '/register')}>Create account</button><button type="button" className="text-link" onClick={() => window.history.pushState({}, '', '/forgot-password')}>Forgot password?</button></div></div></main>;
}

function RegisterPage({ onRegister }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'customer' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { await onRegister(form.name, form.email, form.password, form.role); } catch (issue) { setError(issue.message); } finally { setBusy(false); } }
  return <main className="login-wrap"><div className="login-card"><div className="brand-mark">EH</div><p className="eyebrow">EVENTHUB ACCOUNT</p><h1>Create an account</h1><p className="muted">Register as a customer, organizer, or vendor.</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>Full name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label><label className="field"><span>Email address</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label><label className="field"><span>Password</span><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label><label className="field"><span>Account type</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="customer">Customer</option><option value="organizer">Organizer</option><option value="vendor">Vendor</option></select></label><button className="button login-button" disabled={busy}>{busy ? 'Creating account…' : 'Register now'}</button></form></div></main>;
}

function ForgotPasswordPage({ onSubmit }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await onSubmit(email);
      setMessage(response?.message || 'If an account matches, a reset instruction will be sent.');
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">PASSWORD RESET</p><h2>Reset your password</h2></div></div><div className="info-card wide"><p>Use your email to receive a reset link from the platform support team.</p>{error && <div className="alert error">{error}</div>}{message && <div className="alert success">{message}</div>}<form onSubmit={submit}><label className="field"><span>Email address</span><input type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button className="button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button></form></div></div></main>;
}

function ResetPasswordPage({ onSubmit }) {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await onSubmit(token, password);
      setMessage(response?.message || 'Your password has been reset successfully.');
      setToken(''); setPassword('');
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">NEW PASSWORD</p><h2>Complete your reset</h2></div></div><div className="info-card wide"><p>Enter the reset token from your email and choose a new password.</p>{error && <div className="alert error">{error}</div>}{message && <div className="alert success">{message}</div>}<form onSubmit={submit}><label className="field"><span>Reset token</span><input value={token} onChange={(event) => setToken(event.target.value)} required /></label><label className="field"><span>New password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="button" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Reset password'}</button></form></div></div></main>;
}

function PrivacyPage() {
  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">PRIVACY</p><h2>Privacy policy</h2></div></div><div className="info-card wide"><p>EventHub protects personal data used for account management, vendor verification, event coordination, and platform services. Data is used only to operate the platform and support requests.</p></div></div></main>;
}

function TermsPage() {
  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">TERMS</p><h2>Terms and conditions</h2></div></div><div className="info-card wide"><p>Users must maintain valid account information, respect platform policies, and use booking tools lawfully. Platform policies may change with notice to the user base.</p></div></div></main>;
}

function HelpPage() {
  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">HELP CENTER</p><h2>Support and guides</h2></div></div><div className="info-card wide"><p>Browse the booking guide, manage your account, or contact the platform support team for help with event coordination, vendor onboarding, or service requests.</p></div></div></main>;
}

function AccessDeniedPage({ onNavigate }) {
  return <main className="page-shell"><div className="content-stack"><div className="info-card wide danger-card"><p className="eyebrow">ACCESS DENIED</p><h2>You do not have permission to view this page.</h2><p>Please sign in with the correct account role or return to the homepage.</p><button className="button" onClick={() => onNavigate('/')}>Back to homepage</button></div></div></main>;
}

function NotFoundPage({ onNavigate }) {
  return <main className="page-shell"><div className="content-stack"><div className="info-card wide danger-card"><p className="eyebrow">404</p><h2>Page not found</h2><p>The page you requested does not exist or has moved.</p><button className="button" onClick={() => onNavigate('/')}>Return home</button></div></div></main>;
}

function VendorLogin({ onLogin }) {
  const [email, setEmail] = useState('vendor@eventflow.io');
  const [password, setPassword] = useState('vendor1234');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(email, password);
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-wrap"><div className="login-card"><div className="brand-mark">EF</div><p className="eyebrow">EVENTFLOW VENDOR PORTAL</p><h1>Vendor sign in</h1><p className="muted">Manage your business, services, bookings, quotations, and earnings.</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>Email address</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}/></label><label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy ? 'Signing in…' : 'Open vendor dashboard'}</button></form><p className="login-note">Vendor access remains restricted to the authenticated vendor’s own records and services.</p></div></main>;
}

function VendorDashboard({ user, onLogout }) {
  const vendorMenu = [
    ['overview', 'Dashboard Overview'], ['profile', 'Business Profile'], ['verification', 'Vendor Verification'], ['services', 'My Services'], ['add-edit-services', 'Add and Edit Services'], ['categories', 'Service Categories'], ['pricing', 'Pricing and Packages'], ['availability', 'Availability Calendar'], ['requests', 'Booking Requests'], ['confirmed', 'Confirmed Bookings'], ['history', 'Booking History'], ['quotations', 'Quotations'], ['payments', 'Payments and Earnings'], ['messages', 'Customer Messages'], ['reviews', 'Reviews and Ratings'], ['notifications', 'Notifications'], ['reports', 'Reports'], ['account', 'Profile'], ['logout', 'Logout']
  ];
  const [slug, setSlug] = useState('overview');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const endpoints = ['overview', 'profile', 'verification', 'services', 'categories', 'pricing', 'availability', 'booking-requests', 'bookings', 'history', 'quotations', 'payments', 'messages', 'reviews', 'notifications', 'reports', 'account'];
        const results = await Promise.all(endpoints.map((endpoint) => api(`/vendor/${endpoint}`)));
        const next = {};
        endpoints.forEach((endpoint, index) => { next[endpoint] = results[index].data; });
        setData(next);
      } catch (issue) {
        setError(issue.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const renderSection = () => {
    if (loading) return <div className="loading"><span className="spinner"/>Loading vendor dashboard…</div>;
    if (error) return <div className="alert error">{error}</div>;

    switch (slug) {
      case 'overview':
        return <div className="organizer-shell"><div className="welcome"><div><p className="eyebrow">VENDOR DASHBOARD</p><h2>Business overview</h2><p className="muted">Monitor services, booking flow, customer activity, and earnings across your business.</p></div><button className="button secondary" onClick={onLogout}>Log out</button></div><div className="metric-grid"><article className="metric-card"><p>Total listed services</p><strong>{data.overview?.totalServices ?? 0}</strong><span>{data.overview?.activeServices ?? 0} active</span></article><article className="metric-card"><p>Pending requests</p><strong>{data.overview?.pendingBookings ?? 0}</strong><span>{data.overview?.pendingQuotations ?? 0} quotations pending</span></article><article className="metric-card"><p>Confirmed bookings</p><strong>{data.overview?.confirmedBookings ?? 0}</strong><span>{data.overview?.upcomingDates ?? 0} upcoming dates</span></article><article className="metric-card"><p>Gross earnings</p><strong>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(data.overview?.totalEarnings ?? 0)}</strong><span>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(data.overview?.pendingPayouts ?? 0)} pending payouts</span></article></div><div className="two-column-layout"><article className="panel"><div className="panel-header"><h3>Recent booking requests</h3><button className="button secondary small">Open requests</button></div><div className="list-stack">{(data['booking-requests'] || []).slice(0, 3).map((entry) => <div key={entry.id} className="list-card"><div><strong>{entry.customer}</strong><small>{entry.service} • {entry.date}</small></div><span className="pill pending">{entry.status}</span></div>)}</div></article><article className="panel"><div className="panel-header"><h3>Top performers</h3></div><div className="list-stack">{(data.services || []).slice(0, 3).map((service) => <div key={service.id} className="list-card"><div><strong>{service.name}</strong><small>{service.category}</small></div><span className="pill active">{service.status}</span></div>)}</div></article></div></div>;
      case 'profile':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">BUSINESS PROFILE</p><h2>Business information</h2><p className="muted">Manage your public-facing vendor identity and service coverage.</p></div><button className="button secondary">Preview public profile</button></div><div className="panel profile-panel"><div className="profile-avatar">{data.profile?.businessName?.slice(0,1) || 'G'}</div><div><h3>{data.profile?.businessName}</h3><p className="muted">{data.profile?.businessType}</p><p>{data.profile?.serviceLocation}</p></div></div><div className="panel" style={{padding:'20px'}}><div className="field"><span>Business name</span><input value={data.profile?.businessName || ''} readOnly /></div><div className="field"><span>Business description</span><textarea rows="4" value={data.profile?.description || ''} readOnly /></div><div className="field"><span>Website</span><input value={data.profile?.website || ''} readOnly /></div></div></div>;
      case 'verification':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">VENDOR VERIFICATION</p><h2>Verification status</h2><p className="muted">Track your verification application, documents, and any review updates.</p></div></div><div className="metric-grid"><article className="metric-card"><p>Status</p><strong>{data.verification?.status || 'Pending'}</strong><span>{data.verification?.reviewProgress || 'Under review'}</span></article><article className="metric-card"><p>Submitted</p><strong>{data.verification?.submittedAt ? new Date(data.verification.submittedAt).toLocaleDateString() : '—'}</strong><span>Application date</span></article></div><div className="panel" style={{padding:'20px'}}><h3>Verification documents</h3><div className="list-stack">{(data.verification?.documents || []).map((doc) => <div key={doc.name} className="list-card"><div><strong>{doc.name}</strong><small>Private document</small></div><span className="pill active">{doc.status}</span></div>)}</div></div></div>;
      case 'services':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">MY SERVICES</p><h2>Service portfolio</h2><p className="muted">Search, filter, view, and manage all services owned by your business.</p></div><button className="button">+ Add service</button></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Price</th><th>Bookings</th></tr></thead><tbody>{(data.services || []).map((service) => <tr key={service.id}><td>{service.name}</td><td>{service.category}</td><td><span className="pill active">{service.status}</span></td><td>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits:0 }).format(service.price)}</td><td>{service.bookings}</td></tr>)}</tbody></table></div></div>;
      case 'add-edit-services':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">ADD AND EDIT SERVICES</p><h2>Create or update a service listing</h2><p className="muted">Save drafts, submit for publication, and update service details without affecting existing bookings.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="field"><span>Service name</span><input value="Wedding Catering" readOnly /></div><div className="field"><span>Category</span><input value="Catering" readOnly /></div><div className="field"><span>Description</span><textarea rows="4" value="Premium wedding catering with menu customization and staffing." readOnly /></div><div className="field"><span>Price</span><input value="48000" readOnly /></div></div></div>;
      case 'categories':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">SERVICE CATEGORIES</p><h2>Platform categories</h2><p className="muted">Assign each service to a platform-approved category.</p></div></div><div className="list-stack">{(data.categories || []).map((category) => <div key={category.id} className="list-card"><div><strong>{category.name}</strong><small>{category.description}</small></div><span className="pill active">{category.active ? 'Active' : 'Inactive'}</span></div>)}</div></div>;
      case 'pricing':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">PRICING AND PACKAGES</p><h2>Package pricing</h2><p className="muted">Set base pricing and package terms while preserving historical booking values.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="budget-stack">{(data.pricing?.packages || []).map((pkg) => <div className="report-row" key={pkg.name}><span>{pkg.name}</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits:0 }).format(pkg.price)}</strong></div>)}</div></div></div>;
      case 'availability':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">AVAILABILITY CALENDAR</p><h2>Availability schedule</h2><p className="muted">Mark dates available, blocked, or already reserved for your services.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="list-stack">{(data.availability?.schedule || []).map((item) => <div key={item.date} className="list-card"><div><strong>{item.date}</strong><small>Business hours: {data.availability?.businessHours}</small></div><span className="pill active">{item.status}</span></div>)}</div></div></div>;
      case 'requests':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">BOOKING REQUESTS</p><h2>Incoming requests</h2><p className="muted">Review and respond to new requests before confirming a service.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="list-stack">{(data['booking-requests'] || []).map((request) => <div key={request.id} className="list-card"><div><strong>{request.customer}</strong><small>{request.service} • {request.date}</small></div><span className="pill pending">{request.status}</span></div>)}</div></div></div>;
      case 'confirmed':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">CONFIRMED BOOKINGS</p><h2>Confirmed events</h2><p className="muted">Track active commitments and service delivery status.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="list-stack">{(data.bookings || []).map((booking) => <div key={booking.id} className="list-card"><div><strong>{booking.customer}</strong><small>{booking.service}</small></div><span className="pill active">{booking.status}</span></div>)}</div></div></div>;
      case 'history':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">BOOKING HISTORY</p><h2>Historical records</h2><p className="muted">Review completed, rejected, and cancelled bookings while preserving service history.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="list-stack">{(data.history || []).map((entry) => <div key={entry.id} className="list-card"><div><strong>{entry.service}</strong><small>{entry.status}</small></div><span>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits:0 }).format(entry.amount)}</span></div>)}</div></div></div>;
      case 'quotations':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">QUOTATIONS</p><h2>Service quotations</h2><p className="muted">Review, issue, revise, and track accepted offers.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="list-stack">{(data.quotations || []).map((quote) => <div key={quote.id} className="list-card"><div><strong>{quote.customer}</strong><small>Valid through {quote.validUntil}</small></div><span className="pill pending">{quote.status}</span></div>)}</div></div></div>;
      case 'payments':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">PAYMENTS AND EARNINGS</p><h2>Financial overview</h2><p className="muted">Track payout progress, fees, and earnings by transaction.</p></div></div><div className="metric-grid"><article className="metric-card"><p>Gross earnings</p><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits:0 }).format(data.payments?.earnings ?? 0)}</strong><span>Platform accounting total</span></article><article className="metric-card"><p>Pending payouts</p><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits:0 }).format(data.payments?.pendingPayouts ?? 0)}</strong><span>Awaiting processing</span></article><article className="metric-card"><p>Platform fees</p><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits:0 }).format(data.payments?.fees ?? 0)}</strong><span>Commission and service fees</span></article></div></div>;
      case 'messages':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">CUSTOMER MESSAGES</p><h2>Conversation history</h2><p className="muted">Access only authorized conversations linked to your bookings or quotations.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="list-stack">{(data.messages || []).map((message) => <div key={message.id} className="list-card"><div><strong>{message.sender}</strong><small>{message.body}</small></div><span className="pill active">{message.unread ? 'Unread' : 'Read'}</span></div>)}</div></div></div>;
      case 'reviews':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">REVIEWS AND RATINGS</p><h2>Customer feedback</h2><p className="muted">Review ratings, comments, and your response history.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="list-stack">{(data.reviews || []).map((review) => <div key={review.id} className="list-card"><div><strong>{review.customer}</strong><small>{'★'.repeat(review.rating)} {review.comment}</small></div><span className="pill active">{review.response ? 'Responded' : 'Awaiting response'}</span></div>)}</div></div></div>;
      case 'notifications':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">NOTIFICATIONS</p><h2>Recent alerts</h2><p className="muted">Stay updated on bookings, quotations, payouts, and verification changes.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="list-stack">{(data.notifications || []).map((item) => <div key={item.id} className="list-card"><div><strong>{item.title}</strong><small>{item.read ? 'Read' : 'Unread'}</small></div><span className="pill pending">{item.read ? 'Read' : 'New'}</span></div>)}</div></div></div>;
      case 'reports':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">REPORTS</p><h2>Business performance</h2><p className="muted">View real vendor-specific reports only for the data you own.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="budget-stack"><div className="report-row"><span>Total listings</span><strong>{data.reports?.totalListings || 0}</strong></div><div className="report-row"><span>Popular service</span><strong>{(data.reports?.popularServices || [])[0] || '—'}</strong></div><div className="report-row"><span>Accepted bookings</span><strong>{data.reports?.bookingStatus?.accepted || 0}</strong></div></div></div></div>;
      case 'account':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">PROFILE</p><h2>Personal account</h2><p className="muted">Manage your login profile separately from your public business profile.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="field"><span>Full name</span><input value={data.account?.fullName || ''} readOnly /></div><div className="field"><span>Email</span><input value={data.account?.email || ''} readOnly /></div><div className="field"><span>Role</span><input value={data.account?.role || ''} readOnly /></div></div></div>;
      case 'logout':
        onLogout();
        return null;
      default:
        return <div className="alert warning">This vendor module is ready for expansion.</div>;
    }
  };

  return <div className="app-shell"><aside className="sidebar open"><div className="sidebar-brand"><div className="brand-mark small">EF</div><div><strong>EventFlow</strong><span>VENDOR</span></div></div><div className="nav-caption">BUSINESS</div><nav>{vendorMenu.map(([id, label]) => <button key={id} className={`nav-item ${slug === id ? 'active' : ''}`} onClick={() => id === 'logout' ? onLogout() : setSlug(id)}><span>{label}</span></button>)}</nav></aside><main className="main-area"><header className="topbar"><div className="breadcrumb">Vendor <span>/</span> <strong>{vendorMenu.find(([id]) => id === slug)?.[1] || 'Dashboard Overview'}</strong></div><div className="topbar-right"><span className="secure-label"><span/>Secure session</span><button className="top-user"><span className="avatar small-avatar">{user.full_name?.slice(0,1) || 'V'}</span>{user.name || user.full_name}</button></div></header><div className="content">{renderSection()}</div><footer className="footer">EventFlow Vendor Console <span>•</span> Owned records only</footer></main></div>;
}

function CustomerLogin({ onLogin }) {
  const [email, setEmail] = useState('customer@eventflow.io');
  const [password, setPassword] = useState('customer123');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(email, password);
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-wrap"><div className="login-card"><div className="brand-mark">EF</div><p className="eyebrow">EVENTFLOW CUSTOMER PORTAL</p><h1>Customer sign in</h1><p className="muted">Discover services, manage your events, request quotes, and track reservations.</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>Email address</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}/></label><label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy ? 'Signing in…' : 'Open customer dashboard'}</button></form><p className="login-note">Demo customer credentials are pre-filled for quick access during setup.</p></div></main>;
}

function CustomerDashboard({ user, onLogout }) {
  const customerMenu = [
    ['overview', 'Dashboard Overview'], ['vendors', 'Browse Vendors'], ['services', 'Search Services'], ['categories', 'Service Categories'], ['bookings', 'My Bookings'], ['history', 'Booking History'], ['events', 'My Events'], ['favorites', 'Saved Vendors'], ['quotations', 'Request Quotations'], ['payments', 'Payments and Transactions'], ['messages', 'Messages'], ['reviews', 'Reviews and Ratings'], ['notifications', 'Notifications'], ['profile', 'Profile'], ['logout', 'Logout']
  ];

  const [slug, setSlug] = useState('overview');
  const [data, setData] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const endpoints = ['overview', 'vendors', 'services', 'categories', 'bookings', 'history', 'events', 'favorites', 'quotations', 'payments', 'messages', 'reviews', 'notifications', 'profile'];
        const results = await Promise.all(endpoints.map((endpoint) => api(`/customer/${endpoint}`)));
        const next = {};
        endpoints.forEach((endpoint, index) => { next[endpoint] = results[index].data; });
        setData(next);
      } catch (issue) {
        setError(issue.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const renderSection = () => {
    if (loading) return <div className="loading"><span className="spinner"/>Loading customer dashboard…</div>;
    if (error) return <div className="alert error">{error}</div>;

    switch (slug) {
      case 'overview':
        return <section className="organizer-shell"><div className="welcome"><div><p className="eyebrow">CUSTOMER DASHBOARD</p><h2>Welcome back, {user.name || user.full_name || 'Customer'}</h2><p className="muted">Track bookings, upcoming events, payments, and saved vendors in one secure workspace.</p></div><button className="button secondary" onClick={onLogout}>Log out</button></div><div className="metric-grid"><article className="metric-card"><p>Total bookings</p><strong>{data.overview?.totalBookings ?? 0}</strong><span>{data.overview?.pendingBookings ?? 0} pending</span></article><article className="metric-card"><p>Confirmed</p><strong>{data.overview?.confirmedBookings ?? 0}</strong><span>{data.overview?.upcomingEvents ?? 0} upcoming events</span></article><article className="metric-card"><p>Outstanding payments</p><strong>{data.overview?.outstandingPayments ?? 0}</strong><span>{data.overview?.pendingQuotations ?? 0} open quotations</span></article><article className="metric-card"><p>Unread messages</p><strong>{data.overview?.unreadMessages ?? 0}</strong><span>{data.overview?.unreadNotifications ?? 0} notifications</span></article></div><div className="two-column-layout"><article className="panel"><div className="panel-header"><h3>Recent bookings</h3><button className="button secondary small">Open bookings</button></div><div className="list-stack">{(data.bookings || []).slice(0,4).map((booking) => <div key={booking.id} className="list-card"><div><strong>{booking.serviceTitle}</strong><small>{booking.reference} • {booking.status}</small></div><span>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: booking.currency || 'ETB', maximumFractionDigits: 0 }).format(booking.quotedAmount || 0)}</span></div>)}</div></article><article className="panel"><div className="panel-header"><h3>Saved vendors</h3></div><div className="list-stack">{(data.favorites || []).slice(0,3).map((vendor) => <div key={vendor.id} className="list-card"><div><strong>{vendor.name}</strong><small>{vendor.city}</small></div><span className="pill active">Saved</span></div>)}</div></article></div></section>;
      case 'vendors':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">BROWSE VENDORS</p><h2>Discover trusted event vendors</h2><p className="muted">Search by city, category, rating, and price to compare and save the right match.</p></div></div><div className="panel" style={{ padding: '20px' }}><div className="toolbar"><input className="field-input" placeholder="Search vendor name" /><select className="filter-select"><option>All categories</option>{(data.categories || []).map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select><select className="filter-select"><option>Any rating</option><option>4.5+</option><option>4.8+</option></select></div><div className="table-wrap"><table><thead><tr><th>Vendor</th><th>Category</th><th>Location</th><th>Verified</th><th>Rating</th><th>From</th></tr></thead><tbody>{(data.vendors || []).map((vendor) => <tr key={vendor.id}><td>{vendor.name}</td><td>{vendor.category}</td><td>{vendor.city}</td><td><span className="pill active">{vendor.verified ? 'Verified' : 'Unverified'}</span></td><td>{vendor.rating?.toFixed ? vendor.rating.toFixed(1) : '—'}★</td><td>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(vendor.priceFrom || 0)}</td></tr>)}</tbody></table></div></div></section>;
      case 'services':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">SEARCH SERVICES</p><h2>Find available service packages</h2><p className="muted">Use category, price, location, and rating filters to shortlist the right suppliers.</p></div></div><div className="panel" style={{ padding: '20px' }}><div className="toolbar"><input className="field-input" placeholder="Search services or descriptions" /><select className="filter-select"><option>Location</option><option>Addis Ababa</option><option>Bahir Dar</option></select><select className="filter-select"><option>Price range</option><option>Under 50,000 ETB</option><option>50,000–100,000 ETB</option></select></div><div className="table-wrap"><table><thead><tr><th>Service</th><th>Category</th><th>Location</th><th>Price</th><th>Rating</th></tr></thead><tbody>{(data.services || []).map((service) => <tr key={service.id}><td>{service.title}</td><td>{service.category}</td><td>{service.city}</td><td>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: service.currency || 'ETB', maximumFractionDigits: 0 }).format(service.price || 0)}</td><td>{service.rating?.toFixed ? service.rating.toFixed(1) : '—'}★</td></tr>)}</tbody></table></div></div></section>;
      case 'categories':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">SERVICE CATEGORIES</p><h2>Explore event service groups</h2><p className="muted">Browse active platform categories and discover all available offerings.</p></div></div><div className="list-stack">{(data.categories || []).map((category) => <div key={category.id} className="list-card"><div><strong>{category.name}</strong><small>{category.description}</small></div><span className="pill active">{category.active ? 'Active' : 'Inactive'}</span></div>)}</div></section>;
      case 'bookings':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">MY BOOKINGS</p><h2>Current reservations</h2><p className="muted">Track status, payment state, and required action on each booking.</p></div></div><div className="table-wrap"><table><thead><tr><th>Reference</th><th>Service</th><th>Status</th><th>Amount</th><th>Event date</th></tr></thead><tbody>{(data.bookings || []).map((booking) => <tr key={booking.id}><td>{booking.reference}</td><td>{booking.serviceTitle}</td><td><span className="pill pending">{booking.status}</span></td><td>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: booking.currency || 'ETB', maximumFractionDigits: 0 }).format(booking.quotedAmount || 0)}</td><td>{booking.eventDate}</td></tr>)}</tbody></table></div></section>;
      case 'history':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">BOOKING HISTORY</p><h2>Completed and closed reservations</h2><p className="muted">Review past bookings, payments, refunds, and any prior cancellation history.</p></div></div><div className="table-wrap"><table><thead><tr><th>Reference</th><th>Service</th><th>Status</th><th>Amount</th></tr></thead><tbody>{(data.history || []).map((booking) => <tr key={booking.id}><td>{booking.reference}</td><td>{booking.serviceTitle}</td><td>{booking.status}</td><td>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: booking.currency || 'ETB', maximumFractionDigits: 0 }).format(booking.quotedAmount || 0)}</td></tr>)}</tbody></table></div></section>;
      case 'events':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">MY EVENTS</p><h2>Event coordination</h2><p className="muted">Manage each event, vendor link, guest count, and plan budget without creating an automatic payment.</p></div><button className="button">+ New event</button></div><div className="table-wrap"><table><thead><tr><th>Event</th><th>Type</th><th>Date</th><th>Guests</th><th>Budget</th></tr></thead><tbody>{(data.events || []).map((event) => <tr key={event.id}><td>{event.title}</td><td>{event.type}</td><td>{new Date(event.date).toLocaleDateString()}</td><td>{event.guestCount}</td><td>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(event.budget || 0)}</td></tr>)}</tbody></table></div></section>;
      case 'favorites':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">SAVED VENDORS</p><h2>Favorite providers</h2><p className="muted">Revisit shortlisted vendors and compare services before booking.</p></div></div><div className="list-stack">{(data.favorites || []).map((vendor) => <div key={vendor.id} className="list-card"><div><strong>{vendor.name}</strong><small>{vendor.city}</small></div><span className="pill active">Saved</span></div>)}</div></section>;
      case 'quotations':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">REQUEST QUOTATIONS</p><h2>Quotation tracker</h2><p className="muted">Review vendor proposals, request revisions, and accept only the terms you approve.</p></div></div><div className="table-wrap"><table><thead><tr><th>Vendor</th><th>Service</th><th>Status</th><th>Amount</th></tr></thead><tbody>{(data.quotations || []).map((quotation) => <tr key={quotation.id}><td>{quotation.vendorId}</td><td>{quotation.service}</td><td>{quotation.status}</td><td>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(quotation.amount || 0)}</td></tr>)}</tbody></table></div></section>;
      case 'payments':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">PAYMENTS AND TRANSACTIONS</p><h2>Financial records</h2><p className="muted">Verify payment status, reference IDs, and pending refunds or failures.</p></div></div><div className="table-wrap"><table><thead><tr><th>Reference</th><th>Provider</th><th>Status</th><th>Amount</th></tr></thead><tbody>{(data.payments || []).map((payment) => <tr key={payment.id}><td>{payment.reference}</td><td>{payment.provider}</td><td>{payment.status}</td><td>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: payment.currency || 'ETB', maximumFractionDigits: 0 }).format(payment.amount || 0)}</td></tr>)}</tbody></table></div></section>;
      case 'messages':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">MESSAGES</p><h2>Vendor conversations</h2><p className="muted">Access only the messages tied to your bookings, events, and quotations.</p></div></div><div className="list-stack">{(data.messages || []).map((message) => <div key={message.id} className="list-card"><div><strong>{message.sender}</strong><small>{message.body}</small></div><span className="pill active">{message.read ? 'Read' : 'Unread'}</span></div>)}</div></section>;
      case 'reviews':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">REVIEWS AND RATINGS</p><h2>Your feedback</h2><p className="muted">Submit and review feedback for eligible completed services.</p></div></div><div className="list-stack">{(data.reviews || []).map((review) => <div key={review.id} className="list-card"><div><strong>{review.vendorId}</strong><small>{'★'.repeat(review.rating)} {review.comment}</small></div><span className="pill active">{review.status}</span></div>)}</div></section>;
      case 'notifications':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">NOTIFICATIONS</p><h2>Important updates</h2><p className="muted">Stay current with booking changes, quotations, and payment updates.</p></div></div><div className="list-stack">{(data.notifications || []).map((notification) => <div key={notification.id} className="list-card"><div><strong>{notification.title}</strong><small>{notification.message}</small></div><span className="pill pending">{notification.read ? 'Read' : 'New'}</span></div>)}</div></section>;
      case 'profile':
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">PROFILE</p><h2>Personal account</h2><p className="muted">Maintain your details and notification preferences securely.</p></div></div><div className="panel" style={{ padding: '20px' }}><div className="field"><span>Full name</span><input value={data.profile?.fullName || ''} readOnly /></div><div className="field"><span>Email</span><input value={data.profile?.email || ''} readOnly /></div><div className="field"><span>Phone</span><input value={data.profile?.phone || ''} readOnly /></div></div></section>;
      case 'logout':
        onLogout();
        return null;
      default:
        return <div className="alert warning">This customer module is ready for expansion.</div>;
    }
  };

  return <div className="app-shell"><aside className="sidebar open"><div className="sidebar-brand"><div className="brand-mark small">EF</div><div><strong>EventFlow</strong><span>CUSTOMER</span></div></div><div className="nav-caption">BOOKING</div><nav>{customerMenu.map(([id, label]) => <button key={id} className={`nav-item ${slug === id ? 'active' : ''}`} onClick={() => id === 'logout' ? onLogout() : setSlug(id)}><span>{label}</span></button>)}</nav></aside><main className="main-area"><header className="topbar"><div className="breadcrumb">Customer <span>/</span> <strong>{customerMenu.find(([id]) => id === slug)?.[1] || 'Dashboard Overview'}</strong></div><div className="topbar-right"><span className="secure-label"><span/>Secure session</span><button className="top-user"><span className="avatar small-avatar">{user.full_name?.slice(0,1) || 'C'}</span>{user.name || user.full_name}</button></div></header><div className="content">{renderSection()}</div><footer className="footer">EventFlow Customer Console <span>•</span> Personal records only</footer></main></div>;
}

function OrganizerLogin({ onLogin }) {
  const [email, setEmail] = useState('organizer@eventflow.io');
  const [password, setPassword] = useState('organizer123');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(email, password);
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-wrap"><div className="login-card"><div className="brand-mark">EF</div><p className="eyebrow">EVENTFLOW ORGANIZER PORTAL</p><h1>Organizer sign in</h1><p className="muted">Secure access for planning events, comparing vendors, and tracking bookings.</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>Email address</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}/></label><label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy ? 'Signing in…' : 'Open organizer dashboard'}</button></form><p className="login-note">Demo organizer credentials are pre-filled for quick access during setup.</p></div></main>;
}

function OrganizerDashboard({ user, onLogout }) {
  const [overview, setOverview] = useState(null);
  const [events, setEvents] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [overviewResponse, eventsResponse, vendorsResponse, bookingsResponse] = await Promise.all([
          api('/platform/overview'),
          api('/platform/events'),
          api('/platform/vendors'),
          api('/platform/bookings')
        ]);
        setOverview(overviewResponse.data);
        setEvents(eventsResponse.data || []);
        setVendors(vendorsResponse.data || []);
        setBookings(bookingsResponse.data || []);
      } catch (issue) {
        setError(issue.message);
      }
    }
    load();
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!overview) return <div className="loading"><span className="spinner"/>Loading organizer workspace…</div>;

  const totalBudget = events.reduce((sum, event) => sum + Number(event.budget || 0), 0);
  const upcomingEvents = events.filter((event) => new Date(event.date) >= new Date()).slice(0, 3);
  const activeBookings = bookings.filter((booking) => ['pending', 'confirmed', 'accepted', 'under_review'].includes(String(booking.status).toLowerCase()));

  return <section className="organizer-shell"><div className="welcome"><div><p className="eyebrow">EVENT ORGANIZER DASHBOARD</p><h2>Welcome back, {user.name || user.full_name || 'Organizer'}</h2><p className="muted">Track event progress, compare options, and keep each booking moving.</p></div><button className="button secondary" onClick={onLogout}>Log out</button></div>
    <div className="metric-grid">
      <article className="metric-card"><p>Active events</p><strong>{events.length}</strong><span>{upcomingEvents.length} upcoming</span></article>
      <article className="metric-card"><p>Vendor matches</p><strong>{vendors.length}</strong><span>Verified and ranked</span></article>
      <article className="metric-card"><p>Budget allocated</p><strong>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(totalBudget)}</strong><span>Across current plans</span></article>
      <article className="metric-card"><p>Bookings in motion</p><strong>{activeBookings.length}</strong><span>{bookings.length} total tracked</span></article>
    </div>
    <div className="two-column-layout">
      <article className="panel">
        <div className="panel-header"><h3>Event pipeline</h3><button className="button secondary small">Create event</button></div>
        <div className="list-stack">
          {upcomingEvents.length ? upcomingEvents.map((event) => <div key={event.id} className="list-card"><div><strong>{event.title}</strong><small>{event.type} • {event.date}</small></div><span className="pill active">Planned</span></div>) : <div className="empty panel"><strong>No upcoming events</strong><span>Draft a new event to start planning.</span></div>}
        </div>
      </article>
      <article className="panel">
        <div className="panel-header"><h3>Recommended vendors</h3><button className="button secondary small">Browse all</button></div>
        <div className="list-stack">
          {vendors.slice(0, 4).map((vendor) => <div key={vendor.id} className="list-card"><div><strong>{vendor.name}</strong><small>{vendor.category} • {vendor.city}</small></div><span className="pill success">{vendor.rating?.toFixed ? `${vendor.rating.toFixed(1)}★` : 'Top rated'}</span></div>)}
        </div>
      </article>
    </div>
    <div className="two-column-layout">
      <article className="panel">
        <div className="panel-header"><h3>Booking tracker</h3></div>
        <div className="list-stack">
          {bookings.map((booking) => <div key={booking.id} className="list-card compact"><div><strong>{booking.serviceTitle || booking.title}</strong><small>{booking.status}</small></div><span>{booking.quotedAmount ? new Intl.NumberFormat('en-ET', { style:'currency', currency: booking.currency || 'ETB', maximumFractionDigits: 0 }).format(booking.quotedAmount) : '—'}</span></div>)}
        </div>
      </article>
      <article className="panel">
        <div className="panel-header"><h3>Budget snapshot</h3></div>
        <div className="budget-stack">
          <div className="report-row"><span>Reserved</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits: 0 }).format(totalBudget)}</strong></div>
          <div className="report-row"><span>Payments due</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits: 0 }).format(bookings.reduce((sum, booking) => sum + Number(booking.quotedAmount || 0), 0))}</strong></div>
          <div className="report-row"><span>Remaining</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits: 0 }).format(Math.max(totalBudget - bookings.reduce((sum, booking) => sum + Number(booking.quotedAmount || 0), 0), 0))}</strong></div>
        </div>
      </article>
    </div>
  </section>;
}

function Login({onLogin}) {
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { await onLogin(email,password); } catch (issue) { setError(issue.message); } finally { setBusy(false); } }
  return <main className="login-wrap"><div className="login-card"><div className="brand-mark">EF</div><p className="eyebrow">EVENTFLOW PLATFORM</p><h1>Administrator sign in</h1><p className="muted">Use your administrator account to continue.</p>{error&&<div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>Email address</span><input type="email" autoComplete="username" required value={email} onChange={(e)=>setEmail(e.target.value)}/></label><label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e)=>setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy?'Signing in…':'Sign in securely'}</button></form><p className="login-note">Administrator access is verified by the server for every protected request.</p></div></main>;
}
function Overview() {
  const [data,setData]=useState(null); const [error,setError]=useState('');
  useEffect(()=>{api('/admin/reports/summary').then((r)=>setData(r.data)).catch((e)=>setError(e.message));},[]);
  if(error) return <div className="alert error">{error}</div>;
  if(!data) return <div className="loading"><span className="spinner"/>Loading dashboard…</div>;
  const items=[['Users',data.users.total_users,data.users.active_users+' active'],['Vendors',data.vendors.total_vendors,data.vendors.pending_vendors+' pending verification'],['Events',data.events.total_events,data.events.completed_events+' completed'],['Bookings',data.bookings.total_bookings,data.bookings.bookings_under_review+' under review'],['Payments',data.payments.total_payments,data.payments.confirmed_payments+' provider-confirmed paid'],['Open complaints',data.complaints.open_complaints,'Open or investigating']];
  return <><div className="welcome"><div><p className="eyebrow">ADMINISTRATOR CONSOLE</p><h2>Platform overview</h2><p className="muted">Live figures loaded from the platform database.</p></div><span className="live-dot">Live data</span></div><div className="metric-grid">{items.map(([label,value,note])=><article className="metric-card" key={label}><p>{label}</p><strong>{value ?? 0}</strong><span>{note}</span></article>)}</div><section className="panel guidance"><h3>Operational reminders</h3><ul><li>Vendor decisions must include a documented verification basis.</li><li>Bookings can be finalized only through the moderation transition rules.</li><li>Payment records are read-only until a provider is configured; no refund is initiated by this dashboard.</li></ul></section></>;
}

function DataPage({slug,user,onUserChange}) {
  const config = modules[slug] || {
    title: slug === 'profile' ? 'Profile' : slug === 'settings' ? 'System Settings' : slug === 'reports' ? 'Reports and Analytics' : 'Administration',
    endpoint: slug === 'settings' ? 'settings' : slug === 'profile' ? 'profile' : slug === 'reports' ? 'reports/summary' : 'users',
    columns: [],
    readonly: true,
    actions: [],
  };
  const [data,setData]=useState([]); const [pagination,setPagination]=useState({page:1,pageSize:20,total:0});
  const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [query,setQuery]=useState(''); const [search,setSearch]=useState(''); const [status,setStatus]=useState(''); const [modal,setModal]=useState(null); const [busy,setBusy]=useState(false); const [form,setForm]=useState({}); const [roleRows,setRoleRows]=useState([]);
  const statuses={users:['active','suspended','pending'],roles:['active','inactive'],categories:['active','inactive'],vendors:['pending','verified','rejected'],events:['draft','active','booked','in_progress','completed','cancelled'],bookings:['requested','quoted','accepted','rejected','cancelled','completed','under_review'],payments:['pending','authorized','paid','failed','refunded','refund_pending'],reviews:['published','hidden','flagged'],complaints:['open','investigating','resolved','dismissed'],messages:['new','reviewed','replied','closed'],notifications:['queued','sent','failed','read']}[slug]||[];
  const load=useCallback(async(page=1)=>{setLoading(true);setError('');try{const params=new URLSearchParams({page:String(page),pageSize:String(pagination.pageSize)});if(search)params.set('q',search);if(status)params.set('status',slug==='roles'||slug==='categories'?(status==='active'?'1':'0'):status);const result=await api(`/admin/${config.endpoint}?${params}`);setData(result.data);setPagination(result.pagination);}catch(issue){setError(issue.message);}finally{setLoading(false);}},[config.endpoint,pagination.pageSize,search,status]);
  useEffect(()=>{load(1);},[load]);
  useEffect(()=>{if(slug==='users')api('/admin/roles?pageSize=100').then((r)=>setRoleRows(r.data.filter((x)=>x.is_active&&!x.is_admin))).catch(()=>{});},[slug]);
  function startCreate(){setForm({});setModal({kind:'create'});}
  function startEdit(row){setForm(Object.fromEntries(config.fields.map(([key])=>[key,row[key] ?? ''])));setModal({kind:'edit',row});}
  function startAction(kind,row){setForm({});setModal({kind,row});}
  function changeField(name,value){setForm((old)=>({...old,[name]:value}));}
  async function submit(event){event.preventDefault();setBusy(true);setError('');setNotice('');try{
    const row=modal.row; let result;
    if(modal.kind==='create'){
      const payload={...form}; if(slug==='users'){payload.role_id=Number(payload.role_id);}
      if(slug==='notifications' && payload.user_id==='')delete payload.user_id;
      if(slug==='events'){['start_date','end_date'].forEach((key)=>{if(payload[key])payload[key]=new Date(payload[key]).toISOString().slice(0,19).replace('T',' ');else delete payload[key];});if(payload.budget==='')delete payload.budget;else payload.budget=Number(payload.budget);payload.organizer_id=Number(payload.organizer_id);}
      if(slug==='notifications'&&payload.user_id)payload.user_id=Number(payload.user_id);
      result=await api(`/admin/${config.endpoint}`,{method:'POST',body:JSON.stringify(payload)});
    } else if(modal.kind==='edit'){
      const payload={...form}; if(slug==='events'){['start_date','end_date'].forEach((key)=>{if(payload[key])payload[key]=new Date(payload[key]).toISOString().slice(0,19).replace('T',' ');else payload[key]=null;});if(payload.budget!=='')payload.budget=Number(payload.budget);else payload.budget=null;payload.organizer_id=Number(payload.organizer_id);}
      result=await api(`/admin/${config.endpoint}/${row.id}`,{method:'PATCH',body:JSON.stringify(payload)});
    } else if(modal.kind==='deactivate'){
      if(!window.confirm('Deactivate this record? This action is recorded in the audit log.')){setBusy(false);return;}
      result=await api(`/admin/${config.endpoint}/${row.id}`,{method:'DELETE'});
    } else if(modal.kind==='verify'||modal.kind==='reject'){
      result=await api(`/admin/vendors/${row.id}/verification`,{method:'PATCH',body:JSON.stringify({decision:modal.kind==='verify'?'verified':'rejected',reason:form.reason})});
    } else if(modal.kind==='moderate'){
      result=await api(`/admin/bookings/${row.id}/moderation`,{method:'PATCH',body:JSON.stringify({status:form.status,reason:form.reason})});
    } else if(modal.kind==='refund'){
      result=await api(`/admin/payments/${row.id}/refunds`,{method:'POST',body:JSON.stringify({reason:form.reason})});
    } else if(modal.kind==='role'){
      result=await api(`/admin/users/${row.id}/role`,{method:'PATCH',body:JSON.stringify({role_id:Number(form.role_id)})});
    } else if(modal.kind==='status'){
      if (slug === 'messages') {
        result = await api(`/admin/contact/${row.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: form.status || row.status || 'new', admin_reply: form.admin_reply || '' }) });
      } else {
        result=await api(`/admin/users/${row.id}/status`,{method:'PATCH',body:JSON.stringify({status:form.status,reason:form.reason})});
      }
    } else if(modal.kind==='permissions'){
      result=await api(`/admin/roles/${row.id}/permissions`,{method:'PATCH',body:JSON.stringify({permission_keys:form.permission_keys||[]})});
    } else if(modal.kind==='review'){
      result=await api(`/admin/reviews/${row.id}`,{method:'PATCH',body:JSON.stringify({status:form.status})});
    } else if(modal.kind==='complaint'){
      result=await api(`/admin/complaints/${row.id}`,{method:'PATCH',body:JSON.stringify({status:form.status,resolution:form.resolution})});
    }
    if(modal.kind==='profile'){result=await api('/admin/profile',{method:'PATCH',body:JSON.stringify(form)});onUserChange(result.user);}
    if(modal.kind==='setting'){result=await api(`/admin/settings/${encodeURIComponent(form.setting_key)}`,{method:'PUT',body:JSON.stringify({value:form.setting_value})});}
    setNotice(slug==='payments'?'Request was not processed.': 'Changes saved.');setModal(null);await load(pagination.page);
  }catch(issue){setError(issue.message);}finally{setBusy(false);}}
  const actions=(row)=>{const names=config.actions||[];return names.map((action)=>{const label={edit:'Edit',deactivate:'Deactivate',verify:'Verify',reject:'Reject',moderate:'Moderate',refund:'Request refund',role:'Change role',status:row.status==='suspended'?'Activate':'Suspend',permissions:'Permissions',review:'Moderate review',complaint:'Update complaint'}[action];return <button key={action} className={`text-action ${['deactivate','reject','refund','status'].includes(action)?'subtle-danger':''}`} onClick={()=>{if(action==='edit')startEdit(row);else if(action==='deactivate')startAction(action,row);else startAction(action,row);}}>{label}</button>;});};
  const title=config.title;
  const availableFields=slug==='users'?[['full_name','Full name','text'],['email','Email','email'],['phone','Phone','text'],['password','Temporary password (min. 16 characters)','password'],['role_id','Role','select',roleRows.map((r)=>`${r.id}:${r.name}`).join(',')]]:config.fields||[];
  function modalTitle() {
    const titles = {
      create: `Create ${slug === 'categories' ? 'category' : slug === 'users' ? 'user' : slug === 'events' ? 'event' : slug === 'notifications' ? 'notification' : 'role'}`,
      edit: `Edit ${title}`,
      verify: 'Verify vendor',
      reject: 'Reject vendor',
      moderate: 'Moderate booking',
      refund: 'Request refund',
      role: 'Change user role',
      status: 'Update account status',
      permissions: 'Role permissions',
      review: 'Moderate review',
      complaint: 'Update complaint',
      setting: 'Save system setting',
      profile: 'Update profile',
    };
    return titles[modal.kind] || 'Confirm action';
  }

  function renderModalFields() {
    if (modal.kind === 'create' || modal.kind === 'edit') {
      return availableFields.map((field) => (
        <React.Fragment key={field[0]}>
          {field[2] === 'select' && slug === 'users' ? (
            <label className="field">
              <span>{field[1]}</span>
              <select required value={form.role_id || ''} onChange={(event) => changeField('role_id', event.target.value)}>
                <option value="">Choose a role</option>
                {roleRows.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
          ) : (
            <Field field={field} value={form[field[0]]} onChange={changeField} />
          )}
        </React.Fragment>
      ));
    }

    if (modal.kind === 'verify' || modal.kind === 'reject' || modal.kind === 'refund' || modal.kind === 'status') {
      if (slug === 'messages') {
        return (
          <>
            <p className="muted">Update the message status and add an internal resolution note.</p>
            <label className="field">
              <span>Message status</span>
              <select value={form.status || modal.row.status || 'new'} onChange={(event) => changeField('status', event.target.value)}>
                {['new', 'reviewed', 'replied', 'closed'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Internal response</span>
              <textarea rows="4" maxLength="2000" value={form.admin_reply || ''} onChange={(event) => changeField('admin_reply', event.target.value)} />
            </label>
          </>
        );
      }

      return (
        <>
          <p className="muted">{modal.kind === 'refund' ? 'No refund is initiated unless a verified provider is configured.' : 'This sensitive action is written to the audit log.'}</p>
          <label className="field">
            <span>{modal.kind === 'refund' ? 'Refund reason' : 'Decision reason'}</span>
            <textarea required minLength="5" maxLength="500" rows="4" value={form.reason || ''} onChange={(event) => changeField('reason', event.target.value)} />
          </label>
          {modal.kind === 'status' && (
            <label className="field">
              <span>New status</span>
              <select value={form.status || 'suspended'} onChange={(event) => changeField('status', event.target.value)}>
                <option value="suspended">Suspended</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
              </select>
            </label>
          )}
        </>
      );
    }

    if (modal.kind === 'moderate') {
      return (
        <>
          <label className="field">
            <span>Moderation outcome</span>
            <select required value={form.status || 'under_review'} onChange={(event) => changeField('status', event.target.value)}>
              {['under_review', 'accepted', 'rejected', 'cancelled'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Reason</span>
            <textarea required minLength="5" maxLength="500" value={form.reason || ''} onChange={(event) => changeField('reason', event.target.value)} />
          </label>
        </>
      );
    }

    if (modal.kind === 'role') {
      return (
        <label className="field">
          <span>Role</span>
          <select required value={form.role_id || ''} onChange={(event) => changeField('role_id', event.target.value)}>
            <option value="">Choose a role</option>
            {roleRows.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
        </label>
      );
    }

    if (modal.kind === 'permissions') {
      return (
        <div className="check-list">
          {permissions.map((permission) => (
            <label key={permission}>
              <input
                type="checkbox"
                checked={(form.permission_keys || []).includes(permission)}
                onChange={(event) => changeField('permission_keys', event.target.checked ? [...(form.permission_keys || []), permission] : (form.permission_keys || []).filter((entry) => entry !== permission))}
              />
              {permission}
            </label>
          ))}
        </div>
      );
    }

    if (modal.kind === 'review') {
      return (
        <label className="field">
          <span>Review visibility</span>
          <select value={form.status || modal.row.status} onChange={(event) => changeField('status', event.target.value)}>
            <option value="published">Published</option>
            <option value="hidden">Hidden</option>
            <option value="flagged">Flagged</option>
          </select>
        </label>
      );
    }

    if (modal.kind === 'complaint') {
      return (
        <>
          <label className="field">
            <span>Status</span>
            <select value={form.status || modal.row.status} onChange={(event) => changeField('status', event.target.value)}>
              <option>open</option>
              <option>investigating</option>
              <option>resolved</option>
              <option>dismissed</option>
            </select>
          </label>
          <label className="field">
            <span>Resolution note</span>
            <textarea value={form.resolution || ''} maxLength="1000" onChange={(event) => changeField('resolution', event.target.value)} />
          </label>
        </>
      );
    }

    if (modal.kind === 'setting') {
      return (
        <>
          <label className="field">
            <span>Setting key</span>
            <input required pattern="[a-z][a-z0-9_.-]{1,119}" value={form.setting_key || ''} onChange={(event) => changeField('setting_key', event.target.value)} />
          </label>
          <label className="field">
            <span>Setting value</span>
            <textarea required maxLength="4000" value={form.setting_value || ''} onChange={(event) => changeField('setting_value', event.target.value)} />
          </label>
        </>
      );
    }

    if (modal.kind === 'profile') {
      return (
        <>
          <label className="field">
            <span>Full name</span>
            <input required value={form.full_name || ''} onChange={(event) => changeField('full_name', event.target.value)} />
          </label>
          <label className="field">
            <span>Phone</span>
            <input value={form.phone || ''} onChange={(event) => changeField('phone', event.target.value)} />
          </label>
          <div className="field">
            <span>Email</span>
            <input value={user.email} disabled />
          </div>
        </>
      );
    }

    if (modal.kind === 'deactivate') {
      return <p>Deactivate record #{modal.row.id}? Existing related records will be preserved. This action is recorded in the audit log.</p>;
    }

    return null;
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h2>{title}</h2>
          <p className="muted">Manage platform records and review changes from persistent database data.</p>
        </div>
        {config.create && <button className="button" onClick={startCreate}>＋ Create new</button>}
      </div>
      {slug === 'payments' && <div className="alert warning">Payment entries are read-only. Refund requests cannot be processed until a provider is configured and verifies the transaction.</div>}
      {notice && <div className="alert success">{notice}</div>}
      {error && <div className="alert error">{error}<button className="dismiss" onClick={() => setError('')}>Dismiss</button></div>}
      {slug === 'settings' && <div className="toolbar"><button className="button" onClick={() => { setForm({}); setModal({ kind: 'setting' }); }}>＋ Add or update setting</button></div>}
      {slug === 'profile' && (
        <div className="panel profile-panel">
          <div className="profile-avatar">{user.full_name?.slice(0, 1) || 'A'}</div>
          <div>
            <h3>{user.full_name}</h3>
            <p className="muted">{user.email}</p>
            <p>{user.phone || 'No phone on profile'}</p>
          </div>
          <button className="button secondary" onClick={() => { setForm({ full_name: user.full_name, phone: user.phone || '' }); setModal({ kind: 'profile' }); }}>Edit profile</button>
        </div>
      )}
      {slug === 'reports' ? <Reports /> : slug === 'settings' ? <SettingsPage onEdit={(row) => { setForm({ setting_key: row.setting_key, setting_value: row.setting_value }); setModal({ kind: 'setting' }); }} /> : (
        <>
          <div className="toolbar">
            <form className="search-box" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
              <Search size={17} />
              <input placeholder="Search records" value={query} onChange={(event) => setQuery(event.target.value)} />
              <button type="submit">Search</button>
            </form>
            {statuses.length > 0 && (
              <select className="filter-select" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">All statuses</option>
                {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            )}
            <span className="result-count">{pagination.total} records</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {config.columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}
                  {!config.readonly && slug !== 'audit-logs' && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={config.columns.length + 1}><div className="loading"><span className="spinner" />Loading records…</div></td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={config.columns.length + 1}><div className="empty"><div className="empty-icon">⌕</div><strong>No records found</strong><span>Try changing the search or status filter.</span></div></td></tr>
                ) : data.map((row) => (
                  <tr key={row.id ?? row.setting_key}>
                    {config.columns.map((column) => (
                      <td key={column} title={display(row[column])}>
                        {column === 'status' || column === 'verification_status' ? (
                          <span className={`pill ${String(row[column]).toLowerCase()}`}>{display(row[column])}</span>
                        ) : (
                          <span className="cell-value">{display(row[column])}</span>
                        )}
                      </td>
                    ))}
                    {!config.readonly && slug !== 'audit-logs' && (
                      <td><div className="row-actions">{actions(row)}</div></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>Showing {data.length ? ((pagination.page - 1) * pagination.pageSize) + 1 : 0}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}</span>
            <div>
              <button className="icon-button" disabled={pagination.page <= 1 || loading} onClick={() => load(pagination.page - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button>
              <span>Page {pagination.page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span>
              <button className="icon-button" disabled={pagination.page * pagination.pageSize >= pagination.total || loading} onClick={() => load(pagination.page + 1)} aria-label="Next page"><ChevronRight size={18} /></button>
            </div>
          </div>
        </>
      )}
      {modal && <Modal title={modalTitle()} onClose={() => setModal(null)} onSubmit={submit} busy={busy} submitLabel={modal.kind === 'refund' ? 'Submit request' : modal.kind === 'deactivate' ? 'Deactivate' : 'Save'} danger={['deactivate', 'reject', 'refund', 'status'].includes(modal.kind)}>{renderModalFields()}</Modal>}
    </section>
  );
}

function Reports() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/admin/reports/summary').then((response) => setData(response.data)).catch((issue) => setError(issue.message));
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="loading"><span className="spinner" />Loading analytics…</div>;

  return (
    <div className="report-grid">
      {Object.entries(data).map(([group, values]) => (
        <article className="panel report-card" key={group}>
          <h3>{group.replaceAll('_', ' ')}</h3>
          {Object.entries(values).map(([key, value]) => (
            <div className="report-row" key={key}>
              <span>{key.replaceAll('_', ' ')}</span>
              <strong>{value ?? 0}</strong>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

function SettingsPage({ onEdit }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/admin/settings').then((response) => setRows(response.data)).catch((issue) => setError(issue.message));
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!rows) return <div className="loading"><span className="spinner" />Loading settings…</div>;

  return rows.length ? (
    <div className="settings-list">
      {rows.map((row) => (
        <article className="panel setting-row" key={row.setting_key}>
          <div>
            <strong>{row.setting_key}</strong>
            <p>{row.setting_value}</p>
            <small>Updated {new Date(row.updated_at).toLocaleString()}</small>
          </div>
          <button className="button secondary" onClick={() => onEdit(row)}>Edit</button>
        </article>
      ))}
    </div>
  ) : (
    <div className="empty panel"><strong>No settings configured</strong><span>Create a setting to persist platform configuration.</span></div>
  );
}

export default function App(){
  const [user,setUser]=useState(null);const [checking,setChecking]=useState(true);const [slug,setSlug]=useState('overview');const [sidebarOpen,setSidebarOpen]=useState(false);const [globalError,setGlobalError]=useState('');const [showLogin,setShowLogin]=useState(false);const [portal,setPortal]=useState('admin');const [currentPath,setCurrentPath]=useState(() => window.location.pathname || '/');

  const normalizePath = useCallback((path) => {
    if (!path || path === '') return '/';
    const [pathname, search = ''] = String(path).split('?');
    const next = pathname.replace(/\/+$/, '');
    return `${next || '/'}${search ? `?${search}` : ''}`;
  }, []);

  const navigatePublic = useCallback((path) => {
    const next = normalizePath(path);
    window.history.pushState({}, '', next);
    setCurrentPath(next);
  }, [normalizePath]);

  const resolve = useCallback(() => {
    const nextPath = normalizePath(`${window.location.pathname}${window.location.search}`);
    setCurrentPath(nextPath);
    const found = nextPath.match(/^\/admin(?:\/([^/]+))?\/?(?:\?.*)?$/);
    if (found) {
      const next = found[1] || 'overview';
      setSlug(['overview','users','roles','vendors','categories','events','bookings','payments','reviews','messages','reports','notifications','audit-logs','settings','profile'].includes(next) ? next : 'overview');
    }
  }, [normalizePath]);

  useEffect(()=>{resolve();const listener=()=>resolve();window.addEventListener('popstate',listener);api('/auth/me').then((r)=>setUser(r.user)).catch(()=>setUser(null)).finally(()=>setChecking(false));return()=>window.removeEventListener('popstate',listener);},[resolve]);

  async function login(email,password){
    const adminResponse = await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
    setUser(adminResponse.user);setPortal('admin');setGlobalError('');setShowLogin(false);navigatePublic('/admin');
  }
  async function loginPublic(email,password){
    try {
      const adminResponse = await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
      setUser(adminResponse.user);setPortal('admin');setGlobalError('');setShowLogin(false);navigatePublic('/admin');
      return;
    } catch (adminError) {
      const platformResponse = await api('/platform/login',{method:'POST',body:JSON.stringify({email,password})});
      const role = platformResponse?.data?.user?.role || 'customer';
      setUser(platformResponse.data.user);setPortal(role);setGlobalError('');setShowLogin(false);
      const rolePath = role === 'admin' ? '/admin' : role === 'organizer' ? '/organizer/dashboard' : role === 'vendor' ? '/vendor/dashboard' : '/customer/dashboard';
      navigatePublic(rolePath);
    }
  }
  async function registerPublic(name,email,password,role='customer'){ const response = await api('/platform/register',{method:'POST',body:JSON.stringify({name,email,password,role})}); const createdUser = response?.data?.user || { name, email, role }; setUser(null); setPortal(role); setGlobalError(''); setShowLogin(false); navigatePublic('/login'); return { createdUser, message: response?.data?.requiresVerification ? 'Account created. Please verify your email before signing in.' : 'Account created successfully.' }; }
  async function requestPasswordReset(email){ const response = await api('/platform/forgot-password',{method:'POST',body:JSON.stringify({email})}); return response; }
  async function resetPassword(token,password){ const response = await api('/platform/reset-password',{method:'POST',body:JSON.stringify({token,password})}); return response; }
  async function verifyEmail(token){ const response = await api('/platform/verify-email',{method:'POST',body:JSON.stringify({token})}); return response; }
  async function loginCustomer(email,password){const r=await api('/platform/login',{method:'POST',body:JSON.stringify({email,password})});if (!r?.data?.user || r.data.user.role !== 'customer') throw new Error('Customer access is required.');setUser(r.data.user);setPortal('customer');setGlobalError('');setShowLogin(false);navigatePublic('/customer/dashboard');}
  async function loginOrganizer(email,password){const r=await api('/platform/login',{method:'POST',body:JSON.stringify({email,password})});if (!r?.data?.user || r.data.user.role !== 'organizer') throw new Error('Organizer access is required.');setUser(r.data.user);setPortal('organizer');setGlobalError('');setShowLogin(false);navigatePublic('/organizer/dashboard');}
  async function loginVendor(email,password){const r=await api('/platform/login',{method:'POST',body:JSON.stringify({email,password})});if (!r?.data?.user || r.data.user.role !== 'vendor') throw new Error('Vendor access is required.');setUser(r.data.user);setPortal('vendor');setGlobalError('');setShowLogin(false);navigatePublic('/vendor/dashboard');}
  function navigate(next){history.pushState({},'',slugPath(next));setSlug(next);setSidebarOpen(false);setGlobalError('');}
  async function logout(){
    try {
      if (portal === 'admin') await api('/auth/logout',{method:'POST'});
    } catch (issue) {
      setGlobalError(issue.message);
    } finally {
      setUser(null);setShowLogin(false);setPortal('admin');navigatePublic('/');
    }
  }

  const publicRoutes = {
    '/': <PublicOverview onOpenDashboard={(mode)=>{setPortal(mode); if (mode === 'admin') { setShowLogin(true); navigatePublic('/login'); } else if (mode === 'customer') { navigatePublic('/login'); } else if(mode === 'organizer'){ navigatePublic('/login'); } else if(mode === 'vendor'){ navigatePublic('/login'); } }} currentPath={currentPath} onNavigate={navigatePublic} />,
    '/events': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><EventsPage onNavigate={navigatePublic} /></PublicPageLayout>,
    '/vendors': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><VendorsPage user={user} onNavigate={navigatePublic} /></PublicPageLayout>,
    '/services': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ServicesPage onNavigate={navigatePublic} /></PublicPageLayout>,
    '/categories': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><CategoriesPage onNavigate={navigatePublic} /></PublicPageLayout>,
    '/about': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><AboutPage /></PublicPageLayout>,
    '/contact': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ContactPage /></PublicPageLayout>,
    '/login': <LoginPage onLogin={loginPublic} />,
    '/register': <RegisterPage onRegister={registerPublic} />,
    '/forgot-password': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ForgotPasswordPage onSubmit={requestPasswordReset} /></PublicPageLayout>,
    '/reset-password': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ResetPasswordPage onSubmit={resetPassword} /></PublicPageLayout>,
    '/privacy': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><PrivacyPage /></PublicPageLayout>,
    '/terms': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><TermsPage /></PublicPageLayout>,
    '/help': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><HelpPage /></PublicPageLayout>,
  };

  if(checking)return <div className="loading full-screen"><span className="spinner"/>Verifying administrator session…</div>;
  if(!user){
    if (currentPath.startsWith('/admin')) return <Login onLogin={login}/>;
    if (currentPath === '/login') return <LoginPage onLogin={loginPublic}/>;
    if (currentPath === '/register') return <RegisterPage onRegister={registerPublic}/>;
    if (currentPath === '/forgot-password') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><ForgotPasswordPage onSubmit={requestPasswordReset} /></PublicPageLayout>;
    if (currentPath === '/reset-password') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><ResetPasswordPage onSubmit={resetPassword} /></PublicPageLayout>;
    if (currentPath === '/privacy') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><PrivacyPage /></PublicPageLayout>;
    if (currentPath === '/terms') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><TermsPage /></PublicPageLayout>;
    if (currentPath === '/help') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><HelpPage /></PublicPageLayout>;
    if (currentPath === '/events') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><EventsPage onNavigate={navigatePublic} /></PublicPageLayout>;
    if (currentPath === '/vendors' || currentPath.startsWith('/vendors?')) return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><VendorsPage user={null} onNavigate={navigatePublic} /></PublicPageLayout>;
    if (/^\/vendors\/\d+$/.test(currentPath)) return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><VendorDetailPage vendorId={currentPath.split('/').pop()} onNavigate={navigatePublic} /></PublicPageLayout>;
    if (currentPath === '/services') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><ServicesPage onNavigate={navigatePublic} /></PublicPageLayout>;
    if (currentPath === '/categories' || currentPath.startsWith('/categories?')) return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><CategoriesPage onNavigate={navigatePublic} /></PublicPageLayout>;
    if (currentPath.startsWith('/categories/')) {
      const slug = currentPath.replace(/^\/categories\//, '').split('?')[0];
      return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><CategoryDetailPage slug={slug} onNavigate={navigatePublic} /></PublicPageLayout>;
    }
    if (currentPath === '/about') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><AboutPage /></PublicPageLayout>;
    if (currentPath === '/contact') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><ContactPage /></PublicPageLayout>;
    if (/^\/vendors\/\d+$/.test(currentPath)) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><VendorDetailPage vendorId={currentPath.split('/').pop()} onNavigate={navigatePublic} /></PublicPageLayout>;
    if (publicRoutes[currentPath]) return publicRoutes[currentPath];
    return <NotFoundPage onNavigate={navigatePublic}/>;
  }

  if (portal === 'customer') return <CustomerDashboard user={user} onLogout={logout}/>;
  if (portal === 'organizer') return <OrganizerDashboard user={user} onLogout={logout}/>;
  if (portal === 'vendor') return <VendorDashboard user={user} onLogout={logout}/>;
  const activeMenu=menu.find(([id])=>id===slug);const pageTitle=activeMenu?.[1]||'Dashboard Overview';
  return <div className="app-shell"><aside className={`sidebar ${sidebarOpen?'open':''}`}><div className="sidebar-brand"><div className="brand-mark small">EF</div><div><strong>EventFlow</strong><span>ADMIN CONSOLE</span></div><button className="mobile-close icon-button" onClick={()=>setSidebarOpen(false)} aria-label="Close menu"><X size={18}/></button></div><div className="nav-caption">WORKSPACE</div><nav>{menu.map(([id,label,Icon])=><button key={id} className={`nav-item ${slug===id?'active':''}`} onClick={id === 'logout' ? logout : ()=>navigate(id)}><Icon size={18}/><span>{label}</span>{id==='vendors'&&<span className="nav-dot"/>}</button>)}</nav></aside><div className={`mobile-scrim ${sidebarOpen?'visible':''}`} onClick={()=>setSidebarOpen(false)}/><main className="main-area"><header className="topbar"><button className="icon-button menu-button" onClick={()=>setSidebarOpen(true)} aria-label="Open menu"><Menu size={20}/></button><div className="breadcrumb">Admin <span>/</span> <strong>{pageTitle}</strong></div><div className="topbar-right"><span className="secure-label"><span/>Secure session</span><button className="top-user" onClick={()=>navigate('profile')}><span className="avatar small-avatar">{user.full_name?.slice(0,1)||'A'}</span>{user.full_name}</button></div></header><div className="content">{globalError&&<div className="alert error">{globalError}<button className="dismiss" onClick={()=>setGlobalError('')}>Dismiss</button></div>}{slug==='overview'?<Overview/>:slug==='profile'?<DataPage slug="profile" user={user} onUserChange={setUser}/>:slug==='reports'?<Reports/>:slug==='settings'?<DataPage slug="settings" user={user} onUserChange={setUser}/>:<DataPage slug={slug} user={user} onUserChange={setUser}/>}</div><footer className="footer">EventFlow Administrator Console <span>•</span> Operational data is server-backed</footer></main></div>;
}
