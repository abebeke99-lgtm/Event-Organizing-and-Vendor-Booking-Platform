import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BadgeCheck, Bell, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, ChevronLeft, ChevronRight, ClipboardList, CreditCard, Eye, EyeOff, Languages, LayoutDashboard, LogOut, Menu, MessageSquareWarning, Search, Settings, Shield, Tags, UserRound, Users, X } from 'lucide-react';
import { INQUIRY_TYPES, buildContactInfo, validateContactForm } from './contactUtils.js';
import { formatEventBudget, formatEventDate } from './eventUtils.js';
import { setLanguage, translate, translateText, useLanguage } from './language.js';
import { getDashboardDateRange } from './dashboardUtils.js';

const menu = [
  ['overview','Dashboard Overview',LayoutDashboard], ['users','User Management',Users], ['roles','Role and Permission Management',Shield],
  ['vendors','Vendor Verification',BadgeCheck], ['categories','Service Category Management',Tags], ['events','Event Management',CalendarDays],
  ['bookings','Booking Management',ClipboardList], ['package-requests','Event Package Requests',ClipboardList], ['payments','Payment and Refund Management',CreditCard], ['reviews','Reviews and Complaints',MessageSquareWarning], ['complaints','Complaint Management',MessageSquareWarning],
  ['messages','Contact Messages',MessageSquareWarning], ['reports','Reports and Analytics',ChartNoAxesCombined], ['notifications','Notifications',Bell], ['audit-logs','Audit Logs',Activity],
  ['settings','System Settings',Settings], ['profile','Profile',UserRound], ['logout','Logout',LogOut]
];
const menuGroups = [
  { id: 'overview', label: 'Dashboard', items: [menu[0]] },
  { id: 'management', label: 'Platform Management', items: menu.slice(1, 8) },
  { id: 'operations', label: 'Operations', items: menu.slice(8, 12).concat(menu[13]) },
  { id: 'insights', label: 'Insights and Security', items: [menu[12], menu[14]] },
  { id: 'configuration', label: 'Configuration', items: menu.slice(15, 17).concat(menu[17]) },
];
const modules = {
  users:{title:'User Management', endpoint:'users', columns:['id','full_name','email','phone','roles','status','created_at'], fields:[['full_name','Full name','text'],['email','Email','email'],['phone','Phone','text']], create:true, actions:['role','status']},
  roles:{title:'Role and Permission Management', endpoint:'roles', columns:['id','name','description','is_active','created_at'], fields:[['name','Role name','text'],['description','Description','text']], create:true, actions:['permissions']},
  vendors:{title:'Vendor Verification', endpoint:'vendors', columns:['id','business_name','user_id','category_id','city','verification_status','verification_reason','verified_at'], actions:['verify','reject']},
  categories:{title:'Service Category Management', endpoint:'categories', columns:['id','name','description','is_active','created_at'], fields:[['name','Category name','text'],['description','Description','text']], create:true, actions:['edit','deactivate']},
  events:{title:'Event Management', endpoint:'events', columns:['id','title','event_type','organizer_id','city','start_date','budget','status'], fields:[['organizer_id','Organizer user ID','number'],['title','Title','text'],['event_type','Event type','text'],['city','City','text'],['start_date','Start date','datetime-local'],['end_date','End date','datetime-local'],['budget','Budget','number'],['status','Status','select','draft,active,booked,in_progress,completed,cancelled'],['notes','Notes','textarea']], create:true, actions:['edit','deactivate']},
  bookings:{title:'Booking Management', endpoint:'bookings', columns:['id','event_id','vendor_id','service_description','quoted_amount','currency','status','moderation_reason','created_at'], actions:['moderate']},
  'package-requests':{title:'Event Package Requests', endpoint:'event-package-requests', columns:['id','event_id','event_title','event_type','requested_date','requested_location','requester_name','requester_email','service_category','guest_count','budget','notes','status','created_at'], actions:['package-status'], statuses:['new','reviewed','replied','closed']},
  payments:{title:'Payment and Refund Management', endpoint:'payments', columns:['id','booking_id','amount','currency','provider','provider_reference','status','created_at'], actions:['refund']},
  reviews:{title:'Reviews and Complaints', endpoint:'reviews', columns:['id','booking_id','rating','comment','status','created_at'], actions:['review']},
  complaints:{title:'Reviews and Complaints', endpoint:'complaints', columns:['id','user_id','booking_id','subject','details','status','resolution','created_at'], actions:['complaint']},
  messages:{title:'Contact Messages', endpoint:'contact', columns:['id','full_name','email','subject','inquiry_type','status','created_at'], actions:['status'], statuses:['new','reviewed','replied','closed']},
  notifications:{title:'Notifications', endpoint:'notifications', columns:['id','user_id','title','message','status','created_at'], fields:[['user_id','Recipient user ID (optional)','number'],['title','Title','text'],['message','Message','textarea']], create:true},
  'audit-logs':{title:'Audit Logs', endpoint:'audit-logs', columns:['id','actor_id','action','entity_type','entity_id','details','ip_address','created_at'], readonly:true},
};
const permissions = ['users:read','users:write','vendors:verify','events:write','bookings:moderate','payments:read','reviews:moderate','categories:write','reports:read','notifications:write'];
const slugPath = (slug) => slug === 'overview' ? '/admin' : `/admin/${slug}`;
const configuredApiUrl = (import.meta.env.VITE_API_URL || '').trim();
let apiBaseUrl = '';
if (configuredApiUrl) {
  try {
    const parsedApiUrl = new URL(configuredApiUrl);
    if (parsedApiUrl.pathname !== '/' || parsedApiUrl.search || parsedApiUrl.hash
      || (import.meta.env.PROD && parsedApiUrl.protocol !== 'https:')) {
      throw new Error('Expected an HTTPS API origin without a path, query, or fragment.');
    }
    apiBaseUrl = parsedApiUrl.origin;
  } catch (error) {
    console.error(`Invalid VITE_API_URL: ${error.message}`);
  }
} else if (import.meta.env.PROD) {
  console.error('VITE_API_URL is missing. Configure it in Netlify with the Render API origin, without /api or a trailing slash, then redeploy.');
}

function navigateBrowserPath(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function api(path, options={}) {
  if (!apiBaseUrl && import.meta.env.PROD) {
    throw new Error('API is not configured. Set VITE_API_URL in the deployment environment and redeploy.');
  }
  const response = await fetch(`${apiBaseUrl}/api${path}`, { credentials:'include', ...options, headers:{ ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) } });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message || result.error || `Request failed (${response.status}).`), { status: response.status });
  return result;
}
function display(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean' || value === 0 || value === 1 && typeof value === 'number') return String(value);
  return String(value);
}
function Field({field,value,onChange}) {
  const language = useLanguage();
  const [name,label,type,choices] = field;
  const common = { id:name, name, value:value ?? '', onChange:(event)=>onChange(name, event.target.value), required: !label.includes('optional') };
  return <label className="field"><span>{translateText(label, language)}</span>{type === 'textarea' ? <textarea {...common} rows="3" /> : type === 'select' ? <select {...common}>{choices.split(',').map((item)=><option key={item} value={item}>{translateText(item, language)}</option>)}</select> : <input {...common} type={type} step={type==='number'?'0.01':undefined} />}</label>;
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
  const language = useLanguage();
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

  return <header className="site-header"><div className="site-header-inner"><button type="button" className="site-brand" onClick={() => onNavigate('/')} aria-label={translate('goHome', language)}><span className="brand-mark small">EH</span><div><strong>EventHub</strong><small>{translate('platform', language)}</small></div></button><nav className="site-nav" aria-label={translate('mainNavigation', language)}>{navItems.map((item) => <button key={item.path} type="button" className={`nav-link ${currentPath === item.path ? 'active' : ''}`} onClick={() => onNavigate(item.path)}>{translateText(item.label, language)}</button>)}<LanguageSelector/></nav><div className="header-actions"><button type="button" className="icon-button ghost" aria-label={translate('search', language)} title={translate('search', language)}><Search size={16}/></button><button type="button" className="icon-button ghost" aria-label={translate('notifications', language)} title={translate('notifications', language)}><Bell size={16}/></button>{isAuthenticated ? <><button type="button" className="button secondary small" onClick={() => onNavigate(roleItems[0]?.path || '/')}>{translate(`${user?.role || 'customer'}Dashboard`, language)}</button><button type="button" className="button secondary small" onClick={onLogout}>{translate('logout', language)}</button></> : <><button type="button" className="button secondary small" onClick={onOpenLogin}>{translate('login', language)}</button><button type="button" className="button small" onClick={onOpenRegister}>{translate('register', language)}</button></>}</div></div></header>;
}

function LanguageSelector() {
  const language = useLanguage();
  return <label className="language-picker"><Languages size={15} aria-hidden="true"/><span className="sr-only">{translate('language', language)}</span><select aria-label={translate('language', language)} value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en">English</option><option value="am">አማርኛ</option></select></label>;
}

function PasswordField({ name, label, value, onChange, autoComplete = 'current-password', language }) {
  const [visible, setVisible] = useState(false);
  const inputId = `auth-${name}`;
  return <div className="field"><span id={`${inputId}-label`}>{label}</span><div className="password-input-wrap"><input id={inputId} aria-labelledby={`${inputId}-label`} name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} required /><button className="password-visibility" type="button" aria-label={translate(visible ? 'hidePassword' : 'showPassword', language)} title={translate(visible ? 'hidePassword' : 'showPassword', language)} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>;
}

function AppFooter() {
  const language = useLanguage();
  return <footer className="site-footer"><div className="site-footer-inner"><div className="footer-column"><div className="brand-pill"><div className="brand-mark small">EH</div><div><strong>EventHub</strong><small>{translate('platform', language)}</small></div></div><p>{translate('footerDescription', language)}</p></div><div className="footer-column"><h4>{translate('explore', language)}</h4><a href="/events">{translate('browseEvents', language)}</a><a href="/vendors">{translate('findVendorsNav', language)}</a><a href="/services">{translate('browseServices', language)}</a><a href="/categories">{translate('serviceCategories', language)}</a></div><div className="footer-column"><h4>{translate('support', language)}</h4><a href="/help">{translate('helpCenter', language)}</a><a href="/help">{translate('frequentlyAskedQuestions', language)}</a><a href="/help">{translate('bookingGuide', language)}</a><a href="/contact">{translate('contactSupport', language)}</a></div><div className="footer-column"><h4>{translate('legal', language)}</h4><a href="/terms">{translate('termsConditions', language)}</a><a href="/privacy">{translate('privacyPolicy', language)}</a><a href="/help">{translate('cookiePolicy', language)}</a><a href="/terms">{translate('refundPolicy', language)}</a></div></div><div className="site-footer-bottom"><span>© {new Date().getFullYear()} EventHub</span><span>hello@eventhub.example</span><span>+251 911 000 000</span></div></footer>;
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
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [vendors, setVendors] = useState([]);
  const [services, setServices] = useState([]);
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState({ totalUsers: 0, totalVendors: 0, totalEvents: 0, totalBookings: 0 });
  const [activeSlide, setActiveSlide] = useState(0);

  const featureSlides = useMemo(() => [
    { title: t('weddingPlanning'), image: 'https://images.unsplash.com/photo-1520854221256-17451cc331bf?auto=format&fit=crop&w=1200&q=80', description: t('weddingPlanningCopy') },
    { title: t('corporateEvents'), image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80', description: t('corporateEventsCopy') },
    { title: t('birthdayCelebrations'), image: 'https://images.unsplash.com/photo-1469371670807-013ccf25f16a?auto=format&fit=crop&w=1200&q=80', description: t('birthdayCelebrationsCopy') },
  ], [language]);

  const categoryCards = [
    { name: t('weddings'), image: 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&w=900&q=80', path: '/events' },
    { name: t('catering'), image: 'https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=900&q=80', path: '/services' },
    { name: t('photography'), image: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=900&q=80', path: '/vendors' },
    { name: t('decorStyling'), image: 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80', path: '/categories' },
  ];

  useEffect(() => {
    const controller = new AbortController();
    async function loadLandingData() {
      try {
        const [overviewResponse, vendorsResponse, servicesResponse, eventsResponse] = await Promise.all([
          api('/platform/overview', { signal: controller.signal }),
          api('/platform/vendors', { signal: controller.signal }),
          api('/platform/services', { signal: controller.signal }),
          api('/platform/events', { signal: controller.signal }),
        ]);

        setSummary(overviewResponse?.data || {});
        setVendors(Array.isArray(vendorsResponse?.data) ? vendorsResponse.data : []);
        setServices(Array.isArray(servicesResponse?.data) ? servicesResponse.data : []);
        setEvents(Array.isArray(eventsResponse?.data) ? eventsResponse.data : []);
      } catch (error) {
        if (error.name === 'AbortError') return;
        setVendors([]);
        setServices([]);
        setEvents([]);
      }
    }

    loadLandingData();
    return () => controller.abort();
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
    { label: t('vendorsLive'), value: `${summary.totalVendors || vendors.length || 120}+` },
    { label: t('eventsPlanned'), value: `${summary.totalEvents || events.length || 4800}` },
    { label: t('bookingsClosed'), value: `${summary.totalBookings || 9400}` },
  ];

  const displayVendors = vendors.slice(0, 4);
  const displayServices = services.slice(0, 4);
  const displayEvents = events.slice(0, 3);

  return <>
    <AppHeader user={null} currentPath={currentPath || '/'} onNavigate={onNavigate} onLogout={() => {}} onOpenLogin={() => onNavigate('/login')} onOpenRegister={() => onNavigate('/register')} />
    <main className="platform-landing">
      <section className="hero-section premium-hero">
        <div className="hero-copy reveal reveal-up is-visible">
          <p className="eyebrow">{t('homeHeroEyebrow')}</p>
          <h1>{t('homeHeroTitle')}</h1>
          <p className="muted">{t('homeHeroCopy')}</p>
          <div className="cta-row">
            <button className="button" onClick={() => onNavigate('/vendors')}>{t('findVendorsNav')}</button>
            <button className="button secondary" onClick={() => onNavigate('/events')}>{t('exploreEvents')}</button>
          </div>
          <div className="hero-search">
            <input type="search" placeholder={t('searchAll')} aria-label={t('searchAll')} />
            <button type="button">{t('search')}</button>
          </div>
          <div className="chip-row">
            {['Weddings', 'Corporate', 'Graduations', 'Catering', 'Decor', 'Photography'].map((item) => <span key={item} className="chip">{item}</span>)}
          </div>
        </div>

        <div className="hero-visual reveal reveal-right is-visible">
          <div className="hero-visual-card hero-card-main">
            <img src="https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80" alt="Wedding venue celebration" />
            <div className="hero-overlay-card">
              <span>{t('featuredVenue')}</span>
              <strong>Fountain Hall</strong>
              <small>{t('weddingCeremonyReception')}</small>
            </div>
          </div>
          <div className="hero-floating-card hero-floating-top">
            <strong>4.9/5</strong>
            <span>{t('averageVendorRating')}</span>
          </div>
          <div className="hero-floating-card hero-floating-bottom">
            <strong>320+</strong>
            <span>{t('urbanEventBookings')}</span>
          </div>
        </div>
      </section>

      <Reveal className="stat-strip" direction="up">
        {stats.map(({ label, value }) => <div key={label} className="stat-pill"><strong>{value}</strong><span>{label}</span></div>)}
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('popularCategories')}</p>
            <h2>{t('exploreServicesByType')}</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/categories')}>{t('browseAll')}</button>
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
              <p className="eyebrow">{t('featuredEvents')}</p>
            <h2>{t('eventInspiration')}</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/events')}>{t('viewAll')}</button>
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
            <p className="eyebrow">{t('featuredVendors')}</p>
            <h2>{t('trustedProfessionals')}</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/vendors')}>{t('seeAllVendors')}</button>
        </div>
        <div className="card-grid">
          {displayVendors.length ? displayVendors.map((vendor) => (
            <article key={vendor.id} className="vendor-card">
              <div className="card-image-wrap">
                <img src={vendor.image || 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=900&q=80'} alt={vendor.name} loading="lazy" />
                <span className="verify-badge">{vendor.verified ? t('verified') : t('available')}</span>
              </div>
              <div className="card-body">
                <div className="meta-row"><span>{vendor.category || 'Event Services'}</span><span>★ {vendor.rating || 4.8}</span></div>
                <h3>{vendor.name}</h3>
                <p>{vendor.city || vendor.location || translateText('Service area available', language)}</p>
                <div className="card-actions">
                  <button className="button secondary small" type="button" onClick={() => onNavigate('/vendors')}>{t('viewProfile')}</button>
                  <button className="icon-button ghost" type="button" aria-label={`${translate('save', language)} ${vendor.name}`} onClick={() => onNavigate('/vendors')}>♥</button>
                </div>
              </div>
            </article>
          )) : <div className="empty-card">{t('noVendorProfiles')}</div>}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('popularServices')}</p>
            <h2>{t('smoothPackages')}</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/services')}>{t('browseServices')}</button>
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
                  <strong>{service.price ? `${service.currency || 'ETB'} ${service.price}` : t('requestQuote')}</strong>
                  <button type="button" className="button small" onClick={() => onNavigate('/services')}>{t('book')}</button>
                </div>
              </div>
            </article>
          )) : <div className="empty-card">{t('noServicesPublished')}</div>}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('publicEventDiscovery')}</p>
            <h2>{t('eventsNextMoment')}</h2>
          </div>
        </div>
        <div className="event-grid">
          {displayEvents.length ? displayEvents.map((event) => (
            <article key={event.id} className="event-card">
              <img src={event.image || 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=900&q=80'} alt={event.title} loading="lazy" />
              <div className="event-content">
                <span className="event-tag">{event.type || 'Event'}</span>
                <h3>{event.title}</h3>
                <p>{event.date || translateText('Date available', language)}</p>
                <small>{event.location || t('locationAvailable')}</small>
                <button type="button" className="button secondary small" onClick={() => onNavigate('/events')}>{t('viewDetails')}</button>
              </div>
            </article>
          )) : <div className="empty-card">{t('noPublicEvents')}</div>}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="process-grid">
          {[
            ['1', t('discover'), t('discoverCopy')],
            ['2', t('compare'), t('compareCopy')],
            ['3', t('bookStep'), t('bookCopy')],
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
            <p className="eyebrow light">{t('readyToPlan')}</p>
            <h2>{t('findRightPeople')}</h2>
          </div>
          <div className="cta-banner-actions">
            <button className="button" onClick={() => onNavigate('/vendors')}>{t('findVendorsNav')}</button>
            <button className="button pale" onClick={() => onNavigate('/register')}>{t('becomeVendor')}</button>
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
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [featured, setFeatured] = useState(null);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('upcoming');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1, limit: 6 });
  const [requestEvent, setRequestEvent] = useState(null);
  const [requestForm, setRequestForm] = useState({ event_title: '', event_type: '', requested_date: '', requested_location: '', requester_name: '', requester_email: '', service_category: '', guest_count: '', budget: '', notes: '' });
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [requestSuccess, setRequestSuccess] = useState('');

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(page), limit: '6', sort });
        if (search.trim()) params.set('search', search.trim());
        if (category) params.set('category', category);
        if (location) params.set('location', location);
        const response = await api(`/platform/events?${params.toString()}`);
        if (!active) return;
        setEvents(Array.isArray(response?.data) ? response.data : []);
        setPagination(response?.pagination || { total: 0, page: 1, totalPages: 1, limit: 6 });
      } catch (issue) {
        if (!active) return;
        setEvents([]);
        setPagination({ total: 0, page: 1, totalPages: 1, limit: 6 });
        setError(issue.status ? `${t('loadEventsError')} (${issue.status})` : t('loadEventsError'));
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, location, category, sort, page, reloadKey]);

  useEffect(() => {
    let active = true;
    api('/platform/events/categories').then((response) => {
      if (active) setCategories(Array.isArray(response?.data) ? response.data : []);
    }).catch(() => {
      if (active) setCategories([]);
    });
    api('/platform/events/featured').then((response) => {
      if (active) {
        setFeatured(response?.data || null);
        setFeaturedError('');
      }
    }).catch(() => {
      if (active) {
        setFeatured(null);
        setFeaturedError(t('featuredError'));
      }
    }).finally(() => {
      if (active) setFeaturedLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function viewDetails(eventId) {
    setDetailsLoading(true);
    setDetailsError('');
    setSelectedEvent(null);
    try {
      const response = await api(`/platform/events/${encodeURIComponent(eventId)}`);
      setSelectedEvent(response?.data || null);
      if (!response?.data) setDetailsError(t('detailNotFound'));
    } catch (issue) {
      setDetailsError(issue.status === 404 ? t('detailNotFound') : issue.status ? `${t('detailError')} (${issue.status})` : t('detailError'));
    } finally {
      setDetailsLoading(false);
    }
  }

  function openPackageRequest(event) {
    setRequestEvent(event);
    setRequestForm({ event_title: event.title || '', event_type: event.type || '', requested_date: '', requested_location: event.location || '', requester_name: '', requester_email: '', service_category: '', guest_count: '', budget: '', notes: '' });
    setRequestError('');
    setRequestSuccess('');
  }

  async function submitPackageRequest(event) {
    event.preventDefault();
    if (!requestEvent || requestBusy || requestSuccess) return;
    setRequestBusy(true);
    setRequestError('');
    try {
      await api('/platform/event-package-requests', {
        method: 'POST',
        body: JSON.stringify({
          event_id: requestEvent.id,
          event_title: requestForm.event_title.trim() || requestEvent.title,
          event_type: requestForm.event_type.trim() || null,
          requested_date: requestForm.requested_date ? new Date(requestForm.requested_date).toISOString().slice(0, 16) : null,
          requested_location: requestForm.requested_location.trim() || null,
          requester_name: requestForm.requester_name,
          requester_email: requestForm.requester_email,
          service_category: requestForm.service_category.trim() || null,
          guest_count: requestForm.guest_count ? Number(requestForm.guest_count) : null,
          budget: requestForm.budget ? Number(requestForm.budget) : null,
          notes: requestForm.notes.trim() || null,
        }),
      });
      setRequestSuccess(t('requestSuccess'));
    } catch (issue) {
      setRequestError(issue.status === 400 ? t('requestValidationError') : issue.status === 404 ? t('eventUnavailable') : issue.status ? `${t('requestFailure')} (${issue.status})` : t('requestFailure'));
    } finally {
      setRequestBusy(false);
    }
  }

  function updateRequestField(event) {
    const { name, value } = event.target;
    setRequestForm((current) => ({ ...current, [name]: value }));
  }

  function planEvent() {
    openPackageRequest({ id: null, title: '', type: '', location: null, startDate: null });
  }

  const categoryOptions = [...new Map(['wedding', 'conference', 'social', 'exhibition', ...categories.map((value) => String(value).trim()).filter(Boolean)].map((value) => [value.toLowerCase(), value])).values()];

  function resetFilters() {
    setSearch('');
    setLocation('');
    setCategory('');
    setSort('upcoming');
    setPage(1);
  }

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">EVENTS</p><h2>{t('upcomingExperiences')}</h2><p className="muted">{t('pageDescription')}</p></div><button className="button secondary" type="button" onClick={planEvent}>{t('planMyEvent')}</button></div>
    <div className="panel event-filter-panel">
      <div className="toolbar stacked-toolbar">
        <input className="field-input" aria-label={t('searchEvents')} maxLength={120} value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder={t('searchEvents')} />
        <select className="filter-select" aria-label={t('allLocations')} value={location} onChange={(event) => { setPage(1); setLocation(event.target.value); }}>
          <option value="">{t('allLocations')}</option><option value="Addis Ababa">Addis Ababa</option><option value="Bahir Dar">Bahir Dar</option><option value="Hawassa">Hawassa</option><option value="Dire Dawa">Dire Dawa</option>
        </select>
        <select className="filter-select" aria-label={t('allCategories')} value={category} onChange={(event) => { setPage(1); setCategory(event.target.value); }}>
          <option value="">{t('allCategories')}</option>
          {categoryOptions.map((value) => <option key={value} value={value.toLowerCase()}>{t(value.toLowerCase()) === value.toLowerCase() ? value : t(value.toLowerCase())}</option>)}
        </select>
        <select className="filter-select" aria-label={t('upcoming')} value={sort} onChange={(event) => { setPage(1); setSort(event.target.value); }}>
          <option value="upcoming">{t('upcoming')}</option><option value="earliest">{t('earliest')}</option><option value="latest">{t('latest')}</option><option value="alphabetical">{t('alphabetical')}</option>
        </select>
        <button type="button" className="button secondary small" onClick={resetFilters}>{t('reset')}</button>
      </div>
    </div>

    {loading ? <div className="loading" role="status"><span className="spinner" />{t('loadingEvents')}</div> : error ? <div className="alert error" role="alert">{error}<button type="button" className="button secondary small" onClick={() => setReloadKey((current) => current + 1)}>{t('retry')}</button></div> : <>
      {events.length ? <>
        <div className="card-grid event-list-grid">
          {events.map((event) => <article key={event.id} className="info-card event-tile">
            <div className="event-thumb" aria-hidden="true"><span>{event.type || 'Event'}</span></div>
            <div className="event-tile-body">
              <span className="event-tag">{event.type || 'Event'}</span><h3>{event.title}</h3>
              <p>{event.location || t('locationTbd')}</p>
              <small>{formatEventDate(event.startDate, language) || t('dateTbd')}</small>
              <div className="pricing-row compact-row"><strong>{formatEventBudget(event.budget, language) || '—'}</strong><button type="button" className="button secondary small" onClick={() => viewDetails(event.id)}>{t('viewDetails')}</button></div>
            </div>
          </article>)}
        </div>
      </> : <div className="empty panel"><strong>{t('emptyTitle')}</strong><span>{t('emptyMessage')}</span><button className="button secondary small" type="button" onClick={resetFilters}>{t('reset')}</button></div>}
      <div className="pagination-row" aria-label="Event pages">
        <button className="button secondary small" type="button" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>{t('previous')}</button>
        <span>{t('page')} {pagination.page || page} {t('of')} {pagination.totalPages || 1}</span>
        <button className="button secondary small" type="button" disabled={page >= (pagination.totalPages || 1)} onClick={() => setPage((current) => Math.min(pagination.totalPages || 1, current + 1))}>{t('next')}</button>
      </div>

      {detailsLoading && <div className="loading" role="status"><span className="spinner" />{t('detailLoading')}</div>}
      {detailsError && <div className="alert error" role="alert">{detailsError}</div>}
      {selectedEvent && <article className="info-card event-detail-card" aria-live="polite">
        <div className="event-detail-header"><div><p className="eyebrow">{t('viewDetails')}</p><h3>{selectedEvent.title}</h3></div><button type="button" className="button secondary small" onClick={() => openPackageRequest(selectedEvent)}>{t('requestPackages')}</button></div>
        <p>{selectedEvent.description || t('detailsUnavailable')}</p>
        <div className="detail-meta-grid">
          <div><span>{t('category')}</span><strong>{selectedEvent.type || '—'}</strong></div><div><span>{t('location')}</span><strong>{selectedEvent.location || t('locationTbd')}</strong></div>
          <div><span>{t('date')}</span><strong>{formatEventDate(selectedEvent.startDate, language) || t('dateTbd')}</strong></div><div><span>{t('budget')}</span><strong>{formatEventBudget(selectedEvent.budget, language) || '—'}</strong></div>
          <div><span>{t('status')}</span><strong>{selectedEvent.status || '—'}</strong></div>
        </div>
      </article>}

      <section className="event-highlight-section" aria-labelledby="event-highlight-title">
        <div className="event-highlight-heading"><p className="eyebrow">{t('eventHighlight')}</p></div>
        {featured ? <article className="event-highlight-content"><div><h3 id="event-highlight-title">{featured.title}</h3><span>{featured.type || '—'}</span></div><dl className="detail-meta-grid"><div><dt>{t('category')}</dt><dd>{featured.type || '—'}</dd></div><div><dt>{t('location')}</dt><dd>{featured.location || t('locationTbd')}</dd></div><div><dt>{t('date')}</dt><dd>{formatEventDate(featured.startDate, language) || t('dateTbd')}</dd></div><div><dt>{t('budget')}</dt><dd>{formatEventBudget(featured.budget, language) || '—'}</dd></div></dl><button type="button" className="button" onClick={() => openPackageRequest(featured)}>{t('requestPackages')}</button></article> : featuredLoading ? <div className="loading" role="status"><span className="spinner" />{t('detailLoading')}</div> : featuredError ? <div className="alert error" role="alert">{featuredError}</div> : <p>{t('noFeatured')}</p>}
      </section>
    </>}
  </div>

  {requestEvent && <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !requestBusy && setRequestEvent(null)}><form className="modal event-request-modal" role="dialog" aria-modal="true" aria-labelledby="package-request-heading" onSubmit={submitPackageRequest}>
    <div className="modal-head"><h2 id="package-request-heading">{t('requestTitle')}</h2><button className="icon-button" type="button" onClick={() => setRequestEvent(null)} aria-label={t('cancel')}><X size={18}/></button></div>
    <div className="modal-body">{requestEvent.id ? <><p><strong>{t('selectedEvent')}:</strong> {requestEvent.title}</p><p>{requestEvent.location || t('locationTbd')} · {formatEventDate(requestEvent.startDate, language) || t('dateTbd')}</p></> : <>
      <label className="field"><span>{t('eventTitle')}</span><input name="event_title" minLength="2" maxLength="180" required value={requestForm.event_title} onChange={updateRequestField}/></label>
      <label className="field"><span>{t('eventType')}</span><input name="event_type" maxLength="80" value={requestForm.event_type} onChange={updateRequestField}/></label>
      <label className="field"><span>{t('requestedDate')}</span><input name="requested_date" type="datetime-local" value={requestForm.requested_date} onChange={updateRequestField}/></label>
      <label className="field"><span>{t('requestedLocation')}</span><input name="requested_location" maxLength="120" value={requestForm.requested_location} onChange={updateRequestField}/></label>
    </>}
      <label className="field"><span>{t('requesterName')}</span><input name="requester_name" autoComplete="name" minLength="2" maxLength="160" required value={requestForm.requester_name} onChange={updateRequestField}/></label>
      <label className="field"><span>{t('requesterEmail')}</span><input name="requester_email" type="email" autoComplete="email" maxLength="254" required value={requestForm.requester_email} onChange={updateRequestField}/></label>
      <label className="field"><span>{t('serviceCategory')}</span><input name="service_category" maxLength="80" value={requestForm.service_category} onChange={updateRequestField}/></label>
      <label className="field"><span>{t('guestCount')}</span><input name="guest_count" type="number" min="1" max="50000" step="1" value={requestForm.guest_count} onChange={updateRequestField}/></label>
      <label className="field"><span>{t('preferredBudget')}</span><input name="budget" type="number" min="0" max="9999999999.99" step="0.01" value={requestForm.budget} onChange={updateRequestField}/></label>
      <label className="field"><span>{t('notes')}</span><textarea name="notes" maxLength="2000" rows="3" value={requestForm.notes} onChange={updateRequestField}/></label>
      {requestError && <div className="alert error" role="alert">{requestError}</div>}{requestSuccess && <div className="alert success" role="status">{requestSuccess}</div>}
    </div>
    <div className="modal-foot"><button type="button" className="button secondary" disabled={requestBusy} onClick={() => setRequestEvent(null)}>{t('cancel')}</button><button className="button" disabled={requestBusy || Boolean(requestSuccess)}>{requestBusy ? t('sending') : t('submitRequest')}</button></div>
  </form></div>}
  </main>;
}

function VendorDetailPage({ vendorId, onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
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
      setBookingState(t('serviceUnavailable'));
      return;
    }

    try {
      setBookingState(t('submittingBooking'));
      await api('/platform/bookings', {
        method: 'POST',
        body: JSON.stringify({
          serviceTitle: selectedService.title || `${vendor.business_name} service`,
          quotedAmount: Number(selectedService.price || vendor.priceFrom || 0),
          currency: 'ETB',
          status: 'pending',
        }),
      });
      setBookingState(t('bookingCreated'));
      window.setTimeout(() => onNavigate('/login'), 1000);
    } catch (issue) {
      setBookingState(t('unableCreateBooking'));
    }
  };

  if (loading) {
    return <main className="page-shell"><div className="content-stack"><div className="info-card wide"><div className="loading"><span className="spinner" />{t('loadingVendorProfile')}</div></div></div></main>;
  }

  if (error || !vendor) {
    return <main className="page-shell"><div className="content-stack"><div className="info-card wide danger-card"><p className="eyebrow">{t('profileUnavailable')}</p><h2>{t('vendorNotFound')}</h2><p>{error ? translateText(error, language) : t('vendorUnavailable')}</p><button className="button" type="button" onClick={() => onNavigate('/vendors')}>{t('browseAllVendors')}</button></div></div></main>;
  }

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{t('vendorProfile')}</p><h2>{vendor.business_name || vendor.name}</h2></div><button className="button secondary small" type="button" onClick={() => onNavigate('/vendors')}>{t('browseAllVendors')}</button></div>
    <article className="info-card wide">
      <div className="profile-panel">
        <div className="profile-avatar">{(vendor.business_name || vendor.name || 'V').slice(0, 1).toUpperCase()}</div>
        <div>
          <h3>{vendor.business_name || vendor.name}</h3>
          <p className="muted">{vendor.category || 'Event services'} • {vendor.city || 'Remote service area'}</p>
          <p>{vendor.verified ? t('verifiedBusinessProfile') : t('publicListing')} • {vendor.reviewCount || 0} {t('vendorReviews')} • ★ {Number(vendor.rating || 0).toFixed(1)}</p>
        </div>
        <button className="button" type="button" onClick={() => handleBookService()}>{bookingState.startsWith('Submitting') ? 'Processing…' : 'Book service'}</button>
      </div>
      {bookingState && <div className="alert success" style={{ marginTop: '14px' }}>{bookingState}</div>}
      <div className="report-grid" style={{ marginTop: '18px' }}>
        <div className="info-card"><h3>{t('about')}</h3><p>{vendor.description || translateText('A trusted event partner helping clients plan memorable experiences.', language)}</p></div>
        <div className="info-card"><h3>{t('startingFrom')}</h3><p>{vendor.priceFrom ? `ETB ${Number(vendor.priceFrom).toLocaleString()}` : t('priceOnRequest')}</p></div>
        <div className="info-card"><h3>{t('location')}</h3><p>{vendor.city || t('serviceAreaRequest')}</p></div>
      </div>
    </article>

    <section className="content-stack">
      <div className="section-header compact-header"><div><p className="eyebrow">{t('publishedServices')}</p><h2>{t('availableServicePackages')}</h2></div></div>
      {Array.isArray(vendor.services) && vendor.services.length ? <div className="card-grid">{vendor.services.filter((service) => service && service.published !== false && service.visibility !== 'private').map((service) => <article key={service.id} className="info-card"><h3>{service.title}</h3><p>{service.description || t('customServicePackage')}</p><div className="pricing-row"><strong>{service.price ? `ETB ${Number(service.price).toLocaleString()}` : t('requestQuote')}</strong><button className="button secondary small" type="button" onClick={() => handleBookService(service)}>{t('bookService')}</button></div></article>)}</div> : <div className="empty-card">{t('noPublishedServices')}</div>}
    </section>
  </div></main>;
}

function VendorsPage({ onNavigate, user }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
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

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{t('vendorsEyebrow')}</p><h2>{t('vendorsHeading')}</h2></div></div>
    {notice && <div className="alert success">{notice}</div>}
    <div className="panel" style={{ padding: '18px 20px' }}>
      <div className="toolbar">
        <div className="search-box"><Search size={16}/><input aria-label={t('searchVendors')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchVendors')} /></div>
        <select className="filter-select" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="all">{t('allCategories')}</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="filter-select" value={location} onChange={(event) => setLocation(event.target.value)}>
          <option value="all">{t('allLocations')}</option>
          {locations.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="filter-select" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="recommended">{t('recommended')}</option>
          <option value="highest-rated">{t('highestRated')}</option>
          <option value="most-reviewed">{t('mostReviewed')}</option>
          <option value="price-low">{t('priceLowHigh')}</option>
          <option value="price-high">{t('priceHighLow')}</option>
        </select>
        <button type="button" className="button secondary small" onClick={() => { setSearch(''); setCategory('all'); setLocation('all'); setSort('recommended'); }}>{t('reset')}</button>
      </div>
    </div>

    {loading ? <div className="loading"><span className="spinner" />{t('loadingVendorDirectory')}</div> : vendors.length ? <>
      <div className="card-grid">
        {vendors.map((vendor) => <article key={vendor.id} className="vendor-card">
          <div className="card-image-wrap">
            <img src={vendor.image || 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=900&q=80'} alt={vendor.business_name || vendor.name} loading="lazy" />
            {vendor.verified && <span className="verify-badge">{t('verified')}</span>}
          </div>
          <div className="card-body">
            <div className="meta-row"><span>{vendor.category || 'Event services'}</span><span>★ {Number(vendor.rating || 0).toFixed(1)}</span></div>
            <h3>{vendor.business_name || vendor.name}</h3>
            <p>{vendor.city || t('locationAvailable')}</p>
            <div className="pricing-row"><strong>{vendor.priceFrom ? `ETB ${Number(vendor.priceFrom).toLocaleString()}` : t('requestQuote')}</strong><span>{vendor.reviewCount || 0} {t('vendorReviews')}</span></div>
            <div className="card-actions">
              <button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${vendor.id}`)}>{t('viewProfile')}</button>
              <button className="button small" type="button" onClick={() => handleBookService(vendor)}>{t('bookService')}</button>
            </div>
          </div>
        </article>)}
      </div>

      <div className="pagination"><span>{t('showing')} {vendors.length} {t('of')} {pagination.total || vendors.length} {t('vendorsLabel')}</span><div>
        <button className="icon-button" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={18}/></button>
        <span>{t('page')} {pagination.page || 1} {t('of')} {Math.max(1, pagination.totalPages || 1)}</span>
        <button className="icon-button" type="button" disabled={page >= (pagination.totalPages || 1)} onClick={() => setPage((value) => Math.min(pagination.totalPages || 1, value + 1))}><ChevronRight size={18}/></button>
      </div></div>
    </> : <EmptyState title={t('noVendorMatches')} message={t('tryDifferentFilters')} />}
  </div></main>;
}

function ServicesPage({ onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
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
      setStatus(translateText('Submitting quote request…', language));
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
      setStatus(translateText('Quote request submitted successfully.', language));
    } catch (issue) {
      setStatus(issue.message || 'Unable to submit a quote request.');
    }
  }

  const categories = Array.from(new Set(services.map((service) => service.category).filter(Boolean))).sort();
  const locations = Array.from(new Set(services.map((service) => service.city).filter(Boolean))).sort();

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{t('servicesEyebrow')}</p><h2>{t('servicesHeading')}</h2></div></div>{status && <div className="alert success">{status}</div>}<div className="panel" style={{ padding: '18px 20px' }}><div className="toolbar stacked-toolbar"><input className="field-input" aria-label={t('searchServices')} value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder={t('searchServices')} /><select className="filter-select" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="all">{t('allCategories')}</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><select className="filter-select" value={filters.location} onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))}><option value="all">{t('allLocations')}</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select><select className="filter-select" value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}><option value="recommended">{t('recommended')}</option><option value="highest-rated">{t('highestRated')}</option><option value="price-low">{t('priceLowHigh')}</option><option value="price-high">{t('priceHighLow')}</option></select><button type="button" className="button secondary small" onClick={() => { const next = { search: '', category: 'all', location: 'all', minPrice: '', maxPrice: '', sort: 'recommended' }; setFilters(next); loadServices(next); }}>{t('reset')}</button><button type="button" className="button small" onClick={() => loadServices(filters)}>{t('applyFilters')}</button></div></div>{loading ? <div className="loading"><span className="spinner"/>{t('loadingServices')}</div> : services.length ? <div className="card-grid">{services.map((service) => <article key={service.id} className="info-card"><h3>{service.title}</h3><p>{service.vendorName || 'EventHub partner'}</p><small>{service.category} • {service.city}</small><div className="pricing-row compact-row"><strong>{service.price ? `${service.currency || 'ETB'} ${Number(service.price).toLocaleString()}` : t('requestQuote')}</strong><span>{service.rating ? `${Number(service.rating).toFixed(1)}★` : t('new')}</span></div><p>{service.description || translateText('Custom package tailored to your event needs.', language)}</p><button className="button secondary small" onClick={() => submitQuoteRequest(service)}>{t('requestQuote')}</button></article>)}</div> : <EmptyState title={t('noServicesMatch')} message={t('emptyMessage')} />}</div></main>;
}

function CategoriesPage({ onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
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

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{t('categoriesEyebrow')}</p><h2>{t('categoriesHeading')}</h2></div></div>{error && <div className="alert error">{translateText(error, language)}</div>}<div className="panel" style={{ padding: '18px 20px' }}><div className="toolbar stacked-toolbar"><div className="search-box"><Search size={16}/><input aria-label={t('searchCategories')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchCategories')} /></div><button type="button" className="button secondary small" onClick={() => setSearch('')}>{t('clear')}</button></div></div>{loading ? <div className="loading"><span className="spinner" />{t('loadingCategories')}</div> : categories.length ? <div className="card-grid soft-grid">{categories.map((category) => <article key={category.id} className="info-card"><img src={category.image || 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80'} alt={category.name} loading="lazy" className="category-card-image" /><h3>{category.name}</h3><p>{category.description || t('availableServiceCategory')}</p><div className="meta-row compact-row"><span>{category.vendorCount ? `${category.vendorCount} ${t('vendorsLabel')}` : t('noVendorsAvailable')}</span><span>{category.serviceCount ? `${category.serviceCount} ${t('availableServices')}` : t('noServicesListed')}</span></div><div className="card-actions"><button className="button secondary small" type="button" onClick={() => onNavigate(`/categories/${category.slug || category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)}>{t('openCategory')}</button><button className="button small" type="button" onClick={() => onNavigate(`/vendors?category=${encodeURIComponent(category.slug || category.name)}`)}>{t('viewVendors')}</button></div></article>)}</div> : <EmptyState title={t('noCategoriesFound')} message={t('noCategoriesMatch')} />}</div></main>;
}

function CategoryDetailPage({ slug, onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
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

  if (loading) return <main className="page-shell"><div className="content-stack"><div className="loading"><span className="spinner" />{t('loadingCategories')}</div></div></main>;
  if (error) return <main className="page-shell"><div className="content-stack"><div className="empty panel"><strong>{t('categoryUnavailable')}</strong><span>{translateText(error, language)}</span><button className="button secondary small" type="button" onClick={() => onNavigate('/categories')}>{t('backToCategories')}</button></div></div></main>;
  if (!category) return <main className="page-shell"><div className="content-stack"><EmptyState title={t('categoryNotFound')} message={t('categoryNotPublic')} /></div></main>;

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">CATEGORY</p><h2>{category.name}</h2></div><button className="button secondary small" type="button" onClick={() => onNavigate('/categories')}>Back to categories</button></div><div className="info-card wide"><img src={category.image || 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80'} alt={category.name} className="category-detail-image" /><div className="category-detail-copy"><p>{category.description || 'Available service category'}</p><div className="meta-row compact-row"><span>{category.vendorCount ? `${category.vendorCount} active vendors` : 'No vendors currently available'}</span><span>{category.serviceCount ? `${category.serviceCount} available services` : 'No services listed'}</span></div><button className="button" type="button" onClick={() => onNavigate(`/vendors?category=${encodeURIComponent(category.slug || category.name)}`)}>View vendors</button></div></div><div className="content-stack"><div className="section-header compact-header"><div><p className="eyebrow">VENDORS</p><h3>Relevant vendors</h3></div></div>{Array.isArray(category.vendors) && category.vendors.length ? <div className="card-grid">{category.vendors.map((vendor) => <article key={vendor.id} className="vendor-card"><div className="card-image-wrap"><img src={vendor.image || 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=900&q=80'} alt={vendor.business_name || vendor.name} loading="lazy" />{vendor.verified && <span className="verify-badge">Verified</span>}</div><div className="card-body"><div className="meta-row"><span>{vendor.category || 'Event services'}</span><span>★ {Number(vendor.rating || 0).toFixed(1)}</span></div><h3>{vendor.business_name || vendor.name}</h3><p>{vendor.city || 'Location available'}</p><div className="pricing-row"><strong>{vendor.priceFrom ? `ETB ${Number(vendor.priceFrom).toLocaleString()}` : 'Request quote'}</strong><span>{vendor.reviewCount || 0} reviews</span></div><div className="card-actions"><button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${vendor.id}`)}>View profile</button><button className="button small" type="button" onClick={() => onNavigate(`/vendors?category=${encodeURIComponent(category.slug || category.name)}`)}>Book service</button></div></div></article>)}</div> : <EmptyState title="No vendors currently available" message="This category has no eligible vendors right now." />}</div><div className="content-stack"><div className="section-header compact-header"><div><p className="eyebrow">SERVICES</p><h3>Available services</h3></div></div>{Array.isArray(category.services) && category.services.length ? <div className="card-grid">{category.services.map((service) => <article key={service.id} className="info-card"><h3>{service.title}</h3><p>{service.vendorName || 'EventHub partner'}</p><small>{service.category} • {service.city}</small><div className="pricing-row compact-row"><strong>{service.price ? `ETB ${Number(service.price).toLocaleString()}` : 'Request quote'}</strong><span>{service.rating ? `${Number(service.rating).toFixed(1)}★` : 'New'}</span></div><p>{service.description || 'Custom package tailored to your event needs.'}</p></article>)}</div> : <EmptyState title="No services listed" message="This category does not currently have published services available." />}</div></div></main>;
}

function AboutPage() {
  const language = useLanguage();
  const t = (key) => translate(key, language);
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
          setError(t('aboutLoadError'));
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAboutContent();
    return () => { active = false; };
  }, [language]);

  if (loading) {
    return <main className="page-shell"><div className="content-stack"><div className="loading"><span className="spinner" />{t('loadingAbout')}</div></div></main>;
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

  return <main className="page-shell"><div className="content-stack about-page"><section className="info-card wide about-hero"><div className="about-copy"><p className="eyebrow">{t('aboutUs')}</p><h2>{hero.heading}</h2><p className="muted">{hero.subtitle}</p><p>{payload.introduction || 'EventHub helps organizers and customers discover event services, compare categories, request quotations, and coordinate bookings in one place.'}</p><div className="cta-row"><button type="button" className="button" onClick={() => navigateBrowserPath('/vendors')}>{t('findVendorsNav')}</button><button type="button" className="button secondary" onClick={() => navigateBrowserPath('/categories')}>{t('browseAll')}</button></div></div><div className="about-hero-media"><img src="https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80" alt="EventHub team planning" /><div className="hero-overlay-card"><strong>{stats.vendorCount || 24}+</strong><span>{t('verified')}</span></div></div></section>

  <div className="metric-grid"><article className="metric-card"><p>{t('serviceCategories')}</p><strong>{stats.categoryCount || 5}</strong><span>{t('categoriesEyebrow')}</span></article><article className="metric-card"><p>{t('activeVendors')}</p><strong>{stats.vendorCount || 24}</strong><span>{t('verified')}</span></article><article className="metric-card"><p>{t('popularServices')}</p><strong>{stats.serviceCount || 110}</strong><span>{t('availableServices')}</span></article><article className="metric-card"><p>{t('bookingsClosed')}</p><strong>{stats.completedBookingCount || 680}</strong><span>{t('bookings')}</span></article></div>

  <div className="two-column-layout"><article className="panel"><div className="panel-header"><h3>{t('ourMission')}</h3></div><p>{payload.mission || 'Simplify event planning by connecting customers with the right service categories and vendors.'}</p></article><article className="panel"><div className="panel-header"><h3>{t('ourVision')}</h3></div><p>{payload.vision || 'Make event-service discovery more accessible, better organized, and easier to trust.'}</p></article></div>

  <section className="panel"><div className="panel-header"><h3>{t('whatWeValue')}</h3></div><div className="card-grid soft-grid">{values.map((item, index) => <article key={`${item.title}-${index}`} className="info-card"><h4>{item.title}</h4><p>{item.description}</p></article>)}</div></section>

  <section className="panel"><div className="panel-header"><h3>{t('howItWorks')}</h3></div><div className="card-grid soft-grid">{steps.map((item, index) => <article key={`${item.title}-${index}`} className="info-card"><span className="eyebrow">{t('step')} {index + 1}</span><h4>{item.title}</h4><p>{item.description}</p></article>)}</div></section>

  <section className="panel"><div className="panel-header"><h3>{t('whyEventHub')}</h3></div><div className="list-stack">{benefits.map((item, index) => <div key={`${item.title}-${index}`} className="list-card"><div><strong>{item.title}</strong><small>{item.description}</small></div></div>)}</div></section>

  {error && <div className="alert error">{error}<button type="button" className="button secondary small" onClick={() => window.location.reload()}>Retry</button></div>}

  <section className="info-card wide cta-banner"><div><p className="eyebrow">{t('readyToPlan')}</p><h3>{t('buildNextEvent')}</h3></div><div className="cta-row"><button type="button" className="button" onClick={() => navigateBrowserPath('/register')}>{t('createAccount')}</button><button type="button" className="button secondary" onClick={() => navigateBrowserPath('/contact')}>{t('talkToSupport')}</button></div></section>
  </div></main>;
}

function ContactPage() {
  const language = useLanguage();
  const t = (key) => translate(key, language);
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
        if (active) setError(t('contactLoadError'));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadContactPage();
    return () => { active = false; };
  }, [language]);

  function updateValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  }

  async function submitContact(event) {
    event.preventDefault();
    const { normalized, errors: validationErrors } = validateContactForm(form, language);
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
      setSuccess(`${t('emailSent')} ${t('reference')}: ${response?.data?.reference || 'EH-000001'}`);
      setForm({
        full_name: '',
        email: '',
        phone: '',
        subject: '',
        inquiry_type: 'general_inquiry',
        message: '',
      });
    } catch (issue) {
      setError(t('unableToSendMessage'));
    } finally {
      setSubmitting(false);
    }
  }

  const contactInfo = buildContactInfo(page.contact || {});

  if (loading) {
    return <main className="page-shell"><div className="content-stack"><div className="loading"><span className="spinner" />{t('loadingContactInfo')}</div></div></main>;
  }

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{t('contactUsNav')}</p><h2>{t('contactHeading')}</h2></div></div>
    <div className="two-column-layout">
      <section className="panel">
        <div className="panel-header"><h3>{t('contactDetails')}</h3></div>
        <div className="info-list">
          {contactInfo.email && <div className="list-card"><strong>{t('email')}</strong><small>{contactInfo.email}</small></div>}
          {contactInfo.phone && <div className="list-card"><strong>{t('phone')}</strong><small>{contactInfo.phone}</small></div>}
          {contactInfo.address && <div className="list-card"><strong>{t('office')}</strong><small>{contactInfo.address}</small></div>}
          {contactInfo.hours && <div className="list-card"><strong>{t('supportHours')}</strong><small>{contactInfo.hours}</small></div>}
        </div>
        {contactInfo.socials?.length ? <div className="social-links"><strong>{t('followUs')}</strong><div className="link-stack">{contactInfo.socials.map((entry, index) => <a key={`${entry}-${index}`} href={entry.url || '#'} target="_blank" rel="noreferrer">{entry.label || 'Social link'}</a>)}</div></div> : null}
      </section>

      <section className="panel">
        <div className="panel-header"><h3>{t('sendMessage')}</h3></div>
        {error && <div className="alert error">{error}<button type="button" className="button secondary small" onClick={() => window.location.reload()}>Retry</button></div>}
        {success && <div className="alert success">{success}</div>}
        <form className="stack-form" onSubmit={submitContact} noValidate>
          <div className="form-grid two-col">
            <label className="field"><span>{t('fullName')}</span><input value={form.full_name} onChange={(event) => updateValue('full_name', event.target.value)} required /></label>
            <label className="field"><span>{t('email')}</span><input type="email" value={form.email} onChange={(event) => updateValue('email', event.target.value)} required /></label>
            <label className="field"><span>{t('phone')}</span><input value={form.phone} onChange={(event) => updateValue('phone', event.target.value)} placeholder={t('optional')} /></label>
            <label className="field"><span>{t('inquiryType')}</span><select value={form.inquiry_type} onChange={(event) => updateValue('inquiry_type', event.target.value)}>
              {INQUIRY_TYPES.map((option) => <option key={option.value} value={option.value}>{translateText(option.label, language)}</option>)}
            </select></label>
          </div>
          <label className="field"><span>{t('subject')}</span><input value={form.subject} onChange={(event) => updateValue('subject', event.target.value)} required /></label>
          {errors.subject && <small className="field-error">{errors.subject}</small>}
          <label className="field"><span>{t('message')}</span><textarea rows="6" value={form.message} onChange={(event) => updateValue('message', event.target.value)} required /></label>
          {errors.message && <small className="field-error">{errors.message}</small>}
          <button className="button" type="submit" disabled={submitting}>{submitting ? t('sending') : t('sendInquiry')}</button>
        </form>
      </section>
    </div>

    <section className="panel"><div className="panel-header"><h3>{t('frequentlyAskedQuestions')}</h3></div>
      <div className="accordion-stack">{(page.faq || []).map((item, index) => (
        <div key={`${item.question}-${index}`} className="info-card"><strong>{item.question}</strong><p>{item.answer}</p></div>
      ))}</div>
    </section>
  </div></main>;
}

function LoginPage({ onLogin }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { await onLogin(email, password); } catch (issue) { setError(translateText(issue.message, language)); } finally { setBusy(false); } }
  return <main className="login-wrap"><div className="login-card"><div className="brand-mark">EH</div><p className="eyebrow">{t('eventHubAccount')}</p><h1>{t('signIn')}</h1><p className="muted">{t('accessWorkspace')}</p>{error && <div className="alert error" role="alert">{error}</div>}<form onSubmit={submit}><label className="field"><span>{t('emailAddress')}</span><input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><div className="field"><span id="login-password-label">{t('password')}</span><div className="password-input-wrap"><input aria-labelledby="login-password-label" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /><button className="password-visibility" type="button" aria-label={t(showPassword ? 'hidePassword' : 'showPassword')} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div><button className="button login-button" disabled={busy}>{busy ? t('signingIn') : t('signInSecurely')}</button></form><div className="inline-links"><button type="button" className="text-link" onClick={() => navigateBrowserPath('/register')}>{t('createAccount')}</button></div></div></main>;
}

function RegisterPage({ onRegister }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', role: 'customer' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function submit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (form.password !== form.confirmPassword) return setError(t('passwordMismatch'));
    if (form.password.length < 12 || !/[A-Z]/.test(form.password) || !/[a-z]/.test(form.password) || !/\d/.test(form.password)) return setError(t('passwordRequirements'));
    setBusy(true);
    try {
      const result = await onRegister(form.name, form.email, form.password, form.role);
      setSuccess(translateText(result?.message, language) || t('registrationSuccess'));
    } catch (issue) {
      setError(translateText(issue.message, language));
    } finally {
      setBusy(false);
    }
  }
  return <main className="login-wrap"><div className="login-card"><div className="auth-language-row"><LanguageSelector/></div><div className="brand-mark">EH</div><p className="eyebrow">{t('eventHubAccount')}</p><h1>{t('createAccountHeading')}</h1><p className="muted">{t('registerAsRole')}</p>{error && <div className="alert error" role="alert">{error}</div>}{success && <div className="alert success" role="status">{success}<div className="inline-links"><span>{t('alreadyHaveAccount')}</span><button type="button" className="text-link" onClick={() => navigateBrowserPath('/login')}>{t('loginHere')}</button></div></div>}<form onSubmit={submit}><label className="field"><span>{t('fullName')}</span><input name="name" autoComplete="name" minLength="2" maxLength="160" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label><label className="field"><span>{t('emailAddress')}</span><input name="email" type="email" autoComplete="email" maxLength="254" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label><PasswordField name="password" label={t('password')} value={form.password} autoComplete="new-password" language={language} onChange={(e) => setForm({ ...form, password: e.target.value })}/><p className="field-hint">{t('passwordRequirements')}</p><PasswordField name="confirm-password" label={t('confirmPassword')} value={form.confirmPassword} autoComplete="new-password" language={language} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}/><label className="field"><span>{t('accountType')}</span><select name="role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="customer">{t('customerDashboard')}</option><option value="organizer">{t('organizerDashboard')}</option><option value="vendor">{t('vendorDashboard')}</option></select></label><button className="button login-button" disabled={busy || Boolean(success)}>{busy ? t('creatingAccount') : t('registerNow')}</button></form><div className="inline-links"><span>{t('alreadyHaveAccount')}</span><button type="button" className="text-link" onClick={() => navigateBrowserPath('/login')}>{t('loginHere')}</button></div></div></main>;
}

function ForgotPasswordPage({ onSubmit }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await onSubmit(email);
      setMessage(response?.message ? translateText(response.message, language) : t('ifAccountMatches'));
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{t('resetEyebrow')}</p><h2>{t('resetYourPassword')}</h2></div></div><div className="info-card wide"><p>{t('resetEmailCopy')}</p>{error && <div className="alert error">{translateText(error, language)}</div>}{message && <div className="alert success">{message}</div>}<form onSubmit={submit}><label className="field"><span>{t('emailAddress')}</span><input type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button className="button" type="submit" disabled={busy}>{busy ? t('sending') : t('sendResetLink')}</button></form></div></div></main>;
}

function ResetPasswordPage({ onSubmit }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
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
      setMessage(response?.message ? translateText(response.message, language) : t('requestSuccess'));
      setToken(''); setPassword('');
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{t('completeResetEyebrow')}</p><h2>{t('completeReset')}</h2></div></div><div className="info-card wide"><p>{t('completeResetCopy')}</p>{error && <div className="alert error">{translateText(error, language)}</div>}{message && <div className="alert success">{message}</div>}<form onSubmit={submit}><label className="field"><span>{t('resetToken')}</span><input value={token} onChange={(event) => setToken(event.target.value)} required /></label><label className="field"><span>{t('newPassword')}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="button" type="submit" disabled={busy}>{busy ? t('update') : t('resetPassword')}</button></form></div></div></main>;
}

function PrivacyPage() {
  const language = useLanguage();
  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{translate('privacyLabel', language)}</p><h2>{translate('privacyHeading', language)}</h2></div></div><div className="info-card wide"><p>{translate('privacyCopy', language)}</p></div></div></main>;
}

function TermsPage() {
  const language = useLanguage();
  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{translate('termsLabel', language)}</p><h2>{translate('termsHeading', language)}</h2></div></div><div className="info-card wide"><p>{translate('termsCopy', language)}</p></div></div></main>;
}

function HelpPage() {
  const language = useLanguage();
  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{translate('helpLabel', language)}</p><h2>{translate('helpHeading', language)}</h2></div></div><div className="info-card wide"><p>{translate('helpCopy', language)}</p></div></div></main>;
}

function AccessDeniedPage({ onNavigate }) {
  const language = useLanguage();
  return <main className="page-shell"><div className="content-stack"><div className="info-card wide danger-card"><p className="eyebrow">{translate('accessDenied', language)}</p><h2>{translate('accessDeniedTitle', language)}</h2><p>{translate('accessDeniedCopy', language)}</p><button className="button" onClick={() => onNavigate('/')}>{translate('backHome', language)}</button></div></div></main>;
}

function NotFoundPage({ onNavigate }) {
  const language = useLanguage();
  return <main className="page-shell"><div className="content-stack"><div className="info-card wide danger-card"><p className="eyebrow">404</p><h2>{translate('pageNotFound', language)}</h2><p>{translate('pageNotFoundCopy', language)}</p><button className="button" onClick={() => onNavigate('/')}>{translate('returnHome', language)}</button></div></div></main>;
}

function VendorLogin({ onLogin }) {
  const language = useLanguage();
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

  return <main className="login-wrap"><div className="login-card"><div className="auth-language-row"><LanguageSelector/></div><div className="brand-mark">EF</div><p className="eyebrow">{translate('vendorPortal', language)}</p><h1>{translate('vendorSignIn', language)}</h1><p className="muted">{translate('manageYourBusiness', language)}</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>{translate('emailAddress', language)}</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}/></label><label className="field"><span>{translate('password', language)}</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy ? translate('signingIn', language) : translate('openVendorDashboard', language)}</button></form><p className="login-note">{translateText('Vendor access remains restricted to the authenticated vendor’s own records and services.', language)}</p></div></main>;
}

function VendorDashboard({ user, onLogout }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
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
    if (loading) return <div className="loading"><span className="spinner"/>{t('loading')}</div>;
    if (error) return <div className="alert error">{error}</div>;

    switch (slug) {
      case 'overview':
        return <div className="organizer-shell"><div className="welcome"><div><p className="eyebrow">{t('vendorDashboard')}</p><h2>{t('businessOverview')}</h2><p className="muted">{t('monitorBusiness')}</p></div><button className="button secondary" onClick={onLogout}>{t('logout')}</button></div><div className="metric-grid"><article className="metric-card"><p>{t('totalListedServices')}</p><strong>{data.overview?.totalServices ?? 0}</strong><span>{data.overview?.activeServices ?? 0} {t('activeLabel')}</span></article><article className="metric-card"><p>{t('pendingRequests')}</p><strong>{data.overview?.pendingBookings ?? 0}</strong><span>{data.overview?.pendingQuotations ?? 0} {t('pendingQuotations')}</span></article><article className="metric-card"><p>{t('confirmedBookingsLabel')}</p><strong>{data.overview?.confirmedBookings ?? 0}</strong><span>{data.overview?.upcomingDates ?? 0} {t('upcomingDates')}</span></article><article className="metric-card"><p>{t('grossEarnings')}</p><strong>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(data.overview?.totalEarnings ?? 0)}</strong><span>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(data.overview?.pendingPayouts ?? 0)} {t('pendingPayouts')}</span></article></div><div className="two-column-layout"><article className="panel"><div className="panel-header"><h3>{t('recentBookingRequests')}</h3><button className="button secondary small">{t('openRequests')}</button></div><div className="list-stack">{(data['booking-requests'] || []).slice(0, 3).map((entry) => <div key={entry.id} className="list-card"><div><strong>{entry.customer}</strong><small>{entry.service} • {entry.date}</small></div><span className="pill pending">{translateText(entry.status, language)}</span></div>)}</div></article><article className="panel"><div className="panel-header"><h3>{t('topPerformers')}</h3></div><div className="list-stack">{(data.services || []).slice(0, 3).map((service) => <div key={service.id} className="list-card"><div><strong>{service.name}</strong><small>{service.category}</small></div><span className="pill active">{translateText(service.status, language)}</span></div>)}</div></article></div></div>;
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

  return <div className="app-shell"><aside className="sidebar open"><div className="sidebar-brand"><div className="brand-mark small">EF</div><div><strong>EventFlow</strong><span>{t('vendorArea')}</span></div></div><div className="nav-caption">{t('businessArea')}</div><nav>{vendorMenu.map(([id, label]) => <button key={id} className={`nav-item ${slug === id ? 'active' : ''}`} onClick={() => id === 'logout' ? onLogout() : setSlug(id)}><span>{translateText(label, language)}</span></button>)}</nav></aside><main className="main-area"><header className="topbar"><div className="breadcrumb">{t('vendorArea')} <span>/</span> <strong>{translateText(vendorMenu.find(([id]) => id === slug)?.[1] || 'Dashboard Overview', language)}</strong></div><div className="topbar-right"><LanguageSelector/><span className="secure-label"><span/>{t('secureSession')}</span><button className="top-user"><span className="avatar small-avatar">{user.full_name?.slice(0,1) || 'V'}</span>{user.name || user.full_name}</button></div></header><div className="content">{renderSection()}</div><footer className="footer">{t('vendorPortal')} <span>•</span> {t('ownedRecordsOnly')}</footer></main></div>;
}

function CustomerLogin({ onLogin }) {
  const language = useLanguage();
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

  return <main className="login-wrap"><div className="login-card"><div className="auth-language-row"><LanguageSelector/></div><div className="brand-mark">EF</div><p className="eyebrow">{translate('customerPortal', language)}</p><h1>{translate('customerSignIn', language)}</h1><p className="muted">{translate('discoverManageEvents', language)}</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>{translate('emailAddress', language)}</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}/></label><label className="field"><span>{translate('password', language)}</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy ? translate('signingIn', language) : translate('openCustomerDashboard', language)}</button></form></div></main>;
}

function CustomerDashboard({ user, onLogout }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const customerMenu = [
    ['overview', 'Dashboard Overview'], ['vendors', 'Browse Vendors'], ['services', 'Search Services'], ['categories', 'Service Categories'], ['bookings', 'My Bookings'], ['history', 'Booking History'], ['events', 'My Events'], ['favorites', 'Saved Vendors'], ['quotations', 'Request Quotations'], ['payments', 'Payments and Transactions'], ['messages', 'Messages'], ['reviews', 'Reviews and Ratings'], ['notifications', 'Notifications'], ['profile', 'Profile'], ['logout', 'Logout']
  ];

  const [slug, setSlug] = useState('overview');
  const [data, setData] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [eventFormError, setEventFormError] = useState('');
  const [eventSaving, setEventSaving] = useState(false);
  const [eventForm, setEventForm] = useState({
    title: '',
    type: '',
    city: '',
    startDate: '',
    endDate: '',
    budget: '',
    guestCount: '',
    notes: '',
  });

  async function createEvent(event) {
    event.preventDefault();
    setEventSaving(true);
    setEventFormError('');
    try {
      const response = await api('/platform/events', {
        method: 'POST',
        body: JSON.stringify(eventForm),
      });
      setData((current) => ({ ...current, events: [response.data, ...(current.events || [])] }));
      setEventFormOpen(false);
      setEventForm({
        title: '',
        type: '',
        city: '',
        startDate: '',
        endDate: '',
        budget: '',
        guestCount: '',
        notes: '',
      });
    } catch (issue) {
      setEventFormError(issue.message);
    } finally {
      setEventSaving(false);
    }
  }

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
    if (loading) return <div className="loading"><span className="spinner"/>{t('loading')}</div>;
    if (error) return <div className="alert error">{error}</div>;

    switch (slug) {
      case 'overview':
        return <section className="organizer-shell"><div className="welcome"><div><p className="eyebrow">{t('customerDashboard')}</p><h2>{t('customerWelcome')}, {user.name || user.full_name || t('customerArea')}</h2><p className="muted">{t('trackBookings')}</p></div><div className="header-actions"><LanguageSelector/><button className="button secondary" onClick={onLogout}>{t('logout')}</button></div></div><div className="metric-grid"><article className="metric-card"><p>{t('totalBookings')}</p><strong>{data.overview?.totalBookings ?? 0}</strong><span>{data.overview?.pendingBookings ?? 0} {t('pendingLabel')}</span></article><article className="metric-card"><p>{t('confirmedLabel')}</p><strong>{data.overview?.confirmedBookings ?? 0}</strong><span>{data.overview?.upcomingEvents ?? 0} {t('upcomingEvents')}</span></article><article className="metric-card"><p>{t('outstandingPayments')}</p><strong>{data.overview?.outstandingPayments ?? 0}</strong><span>{data.overview?.pendingQuotations ?? 0} {t('openQuotations')}</span></article><article className="metric-card"><p>{t('unreadMessages')}</p><strong>{data.overview?.unreadMessages ?? 0}</strong><span>{data.overview?.unreadNotifications ?? 0} {t('notificationsLabel')}</span></article></div><div className="two-column-layout"><article className="panel"><div className="panel-header"><h3>{t('recentBookings')}</h3><button className="button secondary small">{t('openBookings')}</button></div><div className="list-stack">{(data.bookings || []).slice(0,4).map((booking) => <div key={booking.id} className="list-card"><div><strong>{booking.serviceTitle}</strong><small>{booking.reference} • {translateText(booking.status, language)}</small></div><span>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: booking.currency || 'ETB', maximumFractionDigits: 0 }).format(booking.quotedAmount || 0)}</span></div>)}</div></article><article className="panel"><div className="panel-header"><h3>{t('savedVendors')}</h3></div><div className="list-stack">{(data.favorites || []).slice(0,3).map((vendor) => <div key={vendor.id} className="list-card"><div><strong>{vendor.name}</strong><small>{vendor.city}</small></div><span className="pill active">{t('savedVendors')}</span></div>)}</div></article></div></section>;
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
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">MY EVENTS</p><h2>Event coordination</h2><p className="muted">Manage each event, vendor link, guest count, and plan budget without creating an automatic payment.</p></div><button className="button" onClick={() => { setEventFormError(''); setEventFormOpen(true); }}>+ New event</button></div>{eventFormOpen && <form className="panel" style={{ padding: '20px', marginBottom: '20px' }} onSubmit={createEvent}><h3>Create event</h3>{eventFormError && <div className="alert error">{eventFormError}</div>}<div className="form-grid"><label className="field"><span>Event name</span><input required minLength="2" maxLength="180" value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}/></label><label className="field"><span>Event type</span><input required minLength="2" maxLength="80" value={eventForm.type} onChange={(e) => setEventForm({ ...eventForm, type: e.target.value })}/></label><label className="field"><span>City</span><input maxLength="120" value={eventForm.city} onChange={(e) => setEventForm({ ...eventForm, city: e.target.value })}/></label><label className="field"><span>Start date</span><input type="datetime-local" required value={eventForm.startDate} onChange={(e) => setEventForm({ ...eventForm, startDate: e.target.value })}/></label><label className="field"><span>End date (optional)</span><input type="datetime-local" min={eventForm.startDate || undefined} value={eventForm.endDate} onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })}/></label><label className="field"><span>Budget (optional)</span><input type="number" min="0" max="100000000" step="0.01" value={eventForm.budget} onChange={(e) => setEventForm({ ...eventForm, budget: e.target.value })}/></label><label className="field"><span>Guest count (optional)</span><input type="number" min="1" max="100000" step="1" value={eventForm.guestCount} onChange={(e) => setEventForm({ ...eventForm, guestCount: e.target.value })}/></label><label className="field"><span>Notes</span><textarea rows="3" maxLength="2000" value={eventForm.notes} onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}/></label></div><div className="header-actions"><button className="button secondary" type="button" disabled={eventSaving} onClick={() => setEventFormOpen(false)}>Cancel</button><button className="button" disabled={eventSaving}>{eventSaving ? 'Creating…' : 'Save as draft'}</button></div></form>}<div className="table-wrap"><table><thead><tr><th>Event</th><th>Type</th><th>Date</th><th>Guests</th><th>Budget</th></tr></thead><tbody>{(data.events || []).map((event) => <tr key={event.id}><td>{event.title}</td><td>{event.type}</td><td>{new Date(event.startDate || event.date).toLocaleDateString()}</td><td>{event.guestCount ?? '—'}</td><td>{event.budget === null || event.budget === undefined ? '—' : new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(event.budget)}</td></tr>)}</tbody></table></div></section>;
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

  return <div className="app-shell"><aside className="sidebar open"><div className="sidebar-brand"><div className="brand-mark small">EF</div><div><strong>EventFlow</strong><span>{t('customerArea')}</span></div></div><div className="nav-caption">{t('bookings')}</div><nav>{customerMenu.map(([id, label]) => <button key={id} className={`nav-item ${slug === id ? 'active' : ''}`} onClick={() => id === 'logout' ? onLogout() : setSlug(id)}><span>{translateText(label, language)}</span></button>)}</nav></aside><main className="main-area"><header className="topbar"><div className="breadcrumb">{t('customerArea')} <span>/</span> <strong>{translateText(customerMenu.find(([id]) => id === slug)?.[1] || 'Dashboard Overview', language)}</strong></div><div className="topbar-right"><LanguageSelector/><span className="secure-label"><span/>{t('secureSession')}</span><button className="top-user"><span className="avatar small-avatar">{user.full_name?.slice(0,1) || 'C'}</span>{user.name || user.full_name}</button></div></header><div className="content">{renderSection()}</div><footer className="footer">{t('customerPortal')} <span>•</span> {t('personalRecordsOnly')}</footer></main></div>;
}

function OrganizerLogin({ onLogin }) {
  const language = useLanguage();
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

  return <main className="login-wrap"><div className="login-card"><div className="auth-language-row"><LanguageSelector/></div><div className="brand-mark">EF</div><p className="eyebrow">{translate('organizerPortal', language)}</p><h1>{translate('organizerSignIn', language)}</h1><p className="muted">{translate('secureOrganizerAccess', language)}</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>{translate('emailAddress', language)}</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}/></label><label className="field"><span>{translate('password', language)}</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy ? translate('signingIn', language) : translate('openOrganizerDashboard', language)}</button></form></div></main>;
}

function OrganizerDashboard({ user, onLogout }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
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

  if (error) return <div className="alert error">{translateText(error, language)}</div>;
  if (!overview) return <div className="loading"><span className="spinner"/>{t('loading')}</div>;

  const totalBudget = events.reduce((sum, event) => sum + Number(event.budget || 0), 0);
  const upcomingEvents = events.filter((event) => new Date(event.date) >= new Date()).slice(0, 3);
  const activeBookings = bookings.filter((booking) => ['pending', 'confirmed', 'accepted', 'under_review'].includes(String(booking.status).toLowerCase()));

  return <section className="organizer-shell"><div className="welcome"><div><p className="eyebrow">{t('organizerDashboard')}</p><h2>{t('customerWelcome')}, {user.name || user.full_name || 'Organizer'}</h2><p className="muted">{t('secureOrganizerAccess')}</p></div><div className="header-actions"><LanguageSelector/><button className="button secondary" onClick={onLogout}>{t('logout')}</button></div></div>
    <div className="metric-grid">
      <article className="metric-card"><p>{t('activeEvents')}</p><strong>{events.length}</strong><span>{upcomingEvents.length} {t('upcoming')}</span></article>
      <article className="metric-card"><p>{t('vendorMatches')}</p><strong>{vendors.length}</strong><span>{t('verifiedRanked')}</span></article>
      <article className="metric-card"><p>{t('budgetAllocated')}</p><strong>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(totalBudget)}</strong><span>{t('currentPlans')}</span></article>
      <article className="metric-card"><p>{t('bookingsInMotion')}</p><strong>{activeBookings.length}</strong><span>{bookings.length} {t('totalTracked')}</span></article>
    </div>
    <div className="two-column-layout">
      <article className="panel">
        <div className="panel-header"><h3>{t('eventPipeline')}</h3><button className="button secondary small">{t('createEvent')}</button></div>
        <div className="list-stack">
          {upcomingEvents.length ? upcomingEvents.map((event) => <div key={event.id} className="list-card"><div><strong>{event.title}</strong><small>{event.type} • {event.date}</small></div><span className="pill active">{t('eventPlanned')}</span></div>) : <div className="empty panel"><strong>{t('noUpcomingEvents')}</strong><span>{t('draftEventPrompt')}</span></div>}
        </div>
      </article>
      <article className="panel">
        <div className="panel-header"><h3>{t('recommendedVendors')}</h3><button className="button secondary small">{t('browseAll')}</button></div>
        <div className="list-stack">
          {vendors.slice(0, 4).map((vendor) => <div key={vendor.id} className="list-card"><div><strong>{vendor.name}</strong><small>{vendor.category} • {vendor.city}</small></div><span className="pill success">{vendor.rating?.toFixed ? `${vendor.rating.toFixed(1)}★` : 'Top rated'}</span></div>)}
        </div>
      </article>
    </div>
    <div className="two-column-layout">
      <article className="panel">
        <div className="panel-header"><h3>{t('bookingTracker')}</h3></div>
        <div className="list-stack">
          {bookings.map((booking) => <div key={booking.id} className="list-card compact"><div><strong>{booking.serviceTitle || booking.title}</strong><small>{booking.status}</small></div><span>{booking.quotedAmount ? new Intl.NumberFormat('en-ET', { style:'currency', currency: booking.currency || 'ETB', maximumFractionDigits: 0 }).format(booking.quotedAmount) : '—'}</span></div>)}
        </div>
      </article>
      <article className="panel">
        <div className="panel-header"><h3>{t('budgetSnapshot')}</h3></div>
        <div className="budget-stack">
          <div className="report-row"><span>{t('reserved')}</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits: 0 }).format(totalBudget)}</strong></div>
          <div className="report-row"><span>{t('paymentsDue')}</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits: 0 }).format(bookings.reduce((sum, booking) => sum + Number(booking.quotedAmount || 0), 0))}</strong></div>
          <div className="report-row"><span>{t('remaining')}</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits: 0 }).format(Math.max(totalBudget - bookings.reduce((sum, booking) => sum + Number(booking.quotedAmount || 0), 0), 0))}</strong></div>
        </div>
      </article>
    </div>
  </section>;
}

function Login({onLogin}) {
  const language = useLanguage();
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { await onLogin(email,password); } catch (issue) { setError(issue.message); } finally { setBusy(false); } }
  return <main className="login-wrap"><div className="login-card"><div className="auth-language-row"><LanguageSelector/></div><div className="brand-mark">EF</div><p className="eyebrow">{translate('platform', language).toUpperCase()}</p><h1>{translate('administratorSignIn', language)}</h1><p className="muted">{translate('useAdminAccount', language)}</p>{error&&<div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>{translate('emailAddress', language)}</span><input type="email" autoComplete="username" required value={email} onChange={(e)=>setEmail(e.target.value)}/></label><label className="field"><span>{translate('password', language)}</span><input type="password" autoComplete="current-password" required value={password} onChange={(e)=>setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy?translate('signingIn', language):translate('signInSecurely', language)}</button></form><p className="login-note">{translateText('Administrator access is verified by the server for every protected request.', language)}</p></div></main>;
}
function Overview({ onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [preset,setPreset]=useState('30d');
  const [dateRange,setDateRange]=useState(()=>getDashboardDateRange('30d'));
  const [appliedRange,setAppliedRange]=useState(()=>getDashboardDateRange('30d'));
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [retryCount,setRetryCount]=useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(appliedRange);
    setLoading(true);
    setError('');
    api(`/admin/dashboard/overview?${params}`, { signal: controller.signal })
      .then((response) => setData(response.data))
      .catch((issue) => { if (issue.name !== 'AbortError') setError(issue.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [appliedRange,retryCount]);

  const applyPreset = (nextPreset) => {
    setPreset(nextPreset);
    if (nextPreset !== 'custom') {
      const nextRange = getDashboardDateRange(nextPreset);
      setDateRange(nextRange);
      setAppliedRange(nextRange);
    }
  };
  const applyCustomRange = (event) => {
    event.preventDefault();
    setPreset('custom');
    setAppliedRange({ ...dateRange });
  };
  if (!data && loading) return <div className="loading dashboard-loading"><span className="spinner"/>{t('loading')} administrator dashboard…</div>;
  if (!data && error) return <section className="dashboard-error" role="alert"><div className="alert error">{translateText(error,language)}</div><button className="button" onClick={()=>setRetryCount((count)=>count+1)}>Retry dashboard</button></section>;

  const number = (value) => Number(value || 0).toLocaleString();
  const money = (value,currency) => {
    try { return new Intl.NumberFormat('en-ET',{style:'currency',currency,maximumFractionDigits:2}).format(Number(value || 0)); }
    catch { return `${number(value)} ${currency}`; }
  };
  const dateTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
  };
  const metricGroups = [
    { title: 'Registered users', total: data.users.total_users, values: [] },
    { title: 'Vendors', total: data.vendors.total_vendors, values: [['Verified',data.vendors.verified_vendors],['Pending applications',data.vendors.pending_vendors]] },
    { title: 'Events', total: data.events.total_events, values: [['Published',data.events.published_events],['Upcoming',data.events.upcoming_events]] },
    { title: 'Bookings', total: data.bookings.total_bookings, values: [['Pending',data.bookings.pending_bookings],['Confirmed',data.bookings.confirmed_bookings],['Completed',data.bookings.completed_bookings],['Cancelled',data.bookings.cancelled_bookings]] },
    { title: 'Payments', total: data.payments.total_payments, values: [['Successful',data.payments.successful_payments],['Pending / authorized',data.payments.pending_payments],['Refund requests',data.payments.refund_requests]] },
    { title: 'Open complaints', total: data.complaints.open_complaints, values: [['All complaints',data.complaints.total_complaints]] },
    { title: 'Reviews', total: data.reviews.total_reviews, values: [] },
  ];
  const maxActivity = Math.max(1,...data.bookingTrend.map((row)=>Math.max(Number(row.bookings),Number(row.paidTransactions))));
  const maxCategory = Math.max(1,...data.eventCategories.map((row)=>Number(row.total)));
  const maxRevenueByCurrency = Object.fromEntries(data.revenueByCurrency.map((row)=>[
    row.currency,
    Math.max(1,...data.bookingTrend.map((trend)=>Number(trend.salesByCurrency[row.currency] || 0))),
  ]));
  const bookingStatusTotal = data.bookingStatuses.reduce((total,row)=>total+Number(row.total),0);
  const statusColors = ['#3074b3','#38a98b','#edaa45','#7984ea','#d96b72','#94a3b8','#44a1aa'];
  let statusOffset = 0;
  const statusGradient = bookingStatusTotal ? data.bookingStatuses.map((row,index)=>{
    const end = statusOffset + Number(row.total) / bookingStatusTotal * 100;
    const segment = `${statusColors[index % statusColors.length]} ${statusOffset}% ${end}%`;
    statusOffset = end;
    return segment;
  }).join(', ') : '#e7eaf1 0% 100%';
  return <>
    <div className="welcome"><div><p className="eyebrow">{t('adminConsole')}</p><h2>{t('platformOverview')}</h2><p className="muted">Live database metrics for {appliedRange.startDate} through {appliedRange.endDate}. Revenue includes successful payments only and remains grouped by currency.</p></div><span className="live-dot">{t('liveDataLabel')}</span></div>
    {error&&<div className="alert error dashboard-inline-error" role="alert">{translateText(error,language)} <button className="text-action" onClick={()=>setRetryCount((count)=>count+1)}>Retry</button></div>}
    <section className="panel dashboard-filter" aria-label="Dashboard date filters">
      <div className="dashboard-filter-heading"><div><strong>Dashboard date range</strong><span>Updates counts, charts, and recent records</span></div>{loading&&<span className="dashboard-refreshing" role="status"><span className="spinner"/>Refreshing</span>}</div>
      <div className="dashboard-presets" role="group" aria-label="Date range presets">
        {[['today','Today'],['7d','Last 7 Days'],['30d','Last 30 Days'],['custom','Custom Range']].map(([value,label])=><button type="button" key={value} className={`button secondary dashboard-preset ${preset===value?'selected':''}`} aria-pressed={preset===value} onClick={()=>applyPreset(value)}>{label}</button>)}
      </div>
      {preset==='custom'&&<form className="dashboard-custom-range" onSubmit={applyCustomRange}>
        <label className="field"><span>From</span><input type="date" required value={dateRange.startDate} max={dateRange.endDate} onChange={(event)=>setDateRange((current)=>({...current,startDate:event.target.value}))}/></label>
        <label className="field"><span>Through</span><input type="date" required value={dateRange.endDate} min={dateRange.startDate} onChange={(event)=>setDateRange((current)=>({...current,endDate:event.target.value}))}/></label>
        <button className="button" disabled={loading}>Apply range</button>
      </form>}
    </section>
    <section className="dashboard-metrics" aria-label="Overview statistics">
      {metricGroups.map((metric)=><article className="metric-card dashboard-metric" key={metric.title}><p>{metric.title}</p><strong>{number(metric.total)}</strong>{metric.values.length>0&&<div className="dashboard-metric-details">{metric.values.map(([label,value])=><span key={label}><span>{label}</span><b>{number(value)}</b></span>)}</div>}</article>)}
    </section>
    <section className="panel dashboard-sales"><div className="dashboard-section-heading"><div><h3>Revenue</h3><p className="muted">Captured payments marked paid; failed, pending, and refund-request records are excluded.</p></div></div>
      {data.revenueByCurrency.length===0?<div className="empty"><strong>No successful payments in this range</strong><span>Revenue will appear when valid payment records are recorded.</span></div>:<div className="currency-totals">{data.revenueByCurrency.map((row)=><div className="report-row" key={row.currency}><span>{row.currency} revenue</span><strong>{money(row.total,row.currency)}</strong></div>)}</div>}
    </section>
    <section className="dashboard-quick-actions" aria-label="Quick actions">
      <h3>Quick actions</h3><div>{[['users','Users'],['vendors','Vendors'],['events','Events'],['bookings','Bookings'],['reports','Reports'],['settings','Settings']].map(([target,label])=><button type="button" className="button secondary" key={target} onClick={()=>onNavigate(target)}>{label}<ChevronRight size={15}/></button>)}</div>
    </section>
    <div className="dashboard-chart-grid">
      <section className="panel dashboard-chart-card"><div className="dashboard-section-heading"><div><h3>Booking trends</h3><p className="muted">Daily bookings and successful payment counts</p></div></div>
        {data.bookingTrend.length===0?<div className="empty"><strong>No booking activity in this range</strong></div>:<><div className="trend-legend"><span><i className="trend-bookings"/>Bookings</span><span><i className="trend-payments"/>Paid transactions</span></div><div className="trend-chart" role="list" aria-label="Daily bookings and paid transactions">{data.bookingTrend.map((row)=><div className="trend-month" key={row.period} role="listitem" aria-label={`${row.period}: ${row.bookings} bookings, ${row.paidTransactions} paid transactions`}><div className="trend-bars"><span className="trend-bar trend-bookings" style={{height:`${Math.max(3,Number(row.bookings)/maxActivity*100)}%`}} title={`${number(row.bookings)} bookings`}/><span className="trend-bar trend-payments" style={{height:`${Math.max(3,Number(row.paidTransactions)/maxActivity*100)}%`}} title={`${number(row.paidTransactions)} paid transactions`}/></div><strong>{row.period.slice(5)}</strong><small>{number(row.bookings)} bookings</small><small>{number(row.paidTransactions)} paid</small></div>)}</div></>}
      </section>
      <section className="panel dashboard-chart-card"><div className="dashboard-section-heading"><div><h3>Revenue trends</h3><p className="muted">Paid transaction totals shown separately by currency</p></div></div>
        {data.revenueByCurrency.length===0?<div className="empty"><strong>No revenue activity in this range</strong></div>:<div className="revenue-series">{data.revenueByCurrency.map(({currency})=><div className="revenue-series-item" key={currency}><div className="revenue-series-heading"><strong>{currency}</strong><span>{money(data.revenueByCurrency.find((row)=>row.currency===currency)?.total,currency)}</span></div><div className="trend-chart revenue-chart" role="list" aria-label={`${currency} daily revenue`}>{data.bookingTrend.map((row)=>{const amount=Number(row.salesByCurrency[currency]||0);return <div className="trend-month" key={`${currency}-${row.period}`} role="listitem" aria-label={`${row.period}: ${money(amount,currency)}`}><div className="trend-bars"><span className="trend-bar trend-revenue" style={{height:`${Math.max(amount?3:0,amount/maxRevenueByCurrency[currency]*100)}%`}} title={money(amount,currency)}/></div><strong>{row.period.slice(5)}</strong></div>;})}</div></div>)}</div>}
      </section>
      <section className="panel dashboard-chart-card"><div className="dashboard-section-heading"><div><h3>Events by category</h3><p className="muted">Event types created in the selected range</p></div></div>
        {data.eventCategories.length===0?<div className="empty"><strong>No events in this range</strong></div>:<div className="category-chart">{data.eventCategories.map((row,index)=><div className="category-bar-row" key={row.category}><div><span>{row.category}</span><strong>{number(row.total)}</strong></div><span className="category-bar-track"><i style={{width:`${Number(row.total)/maxCategory*100}%`,background:statusColors[index%statusColors.length]}}/></span></div>)}</div>}
      </section>
      <section className="panel dashboard-chart-card"><div className="dashboard-section-heading"><div><h3>Booking statuses</h3><p className="muted">Status distribution in the selected range</p></div></div>
        {bookingStatusTotal===0?<div className="empty"><strong>No bookings in this range</strong></div>:<div className="status-chart"><div className="status-donut" role="img" aria-label={`Booking status distribution across ${number(bookingStatusTotal)} bookings`} style={{background:`conic-gradient(${statusGradient})`}}><div><strong>{number(bookingStatusTotal)}</strong><span>bookings</span></div></div><div className="status-legend">{data.bookingStatuses.map((row,index)=><div key={row.status}><i style={{background:statusColors[index%statusColors.length]}}/><span>{translateText(row.status,language)}</span><strong>{number(row.total)}</strong></div>)}</div></div>}
      </section>
    </div>
    <div className="dashboard-recent-grid">
      <section className="panel dashboard-recent"><h3>Recent bookings</h3>{data.recentBookings.length===0?<div className="empty"><strong>No bookings in this range</strong></div>:<div className="dashboard-list">{data.recentBookings.map((row)=><article className="dashboard-list-row dashboard-booking-row" key={row.id}><div><strong>{row.event_title}</strong><span>{row.customer_name} · {row.vendor_name}</span><time dateTime={row.created_at}>{dateTime(row.created_at)}</time></div><span className={`pill ${row.status}`}>{translateText(row.status,language)}</span><strong>{money(row.quoted_amount,row.currency)}</strong></article>)}</div>}</section>
      <section className="panel dashboard-recent"><h3>Recent vendor applications</h3>{data.recentVendorRequests.length===0?<div className="empty"><strong>No pending vendor applications</strong></div>:<div className="dashboard-list">{data.recentVendorRequests.map((row)=><article className="dashboard-list-row" key={row.id}><div><strong>{row.business_name}</strong><span>{row.applicant_name} · {row.email}</span><time dateTime={row.created_at}>{dateTime(row.created_at)}</time></div><span className="pill pending">Pending</span></article>)}</div>}<button className="text-action dashboard-view-all" onClick={()=>onNavigate('vendors')}>Review vendors</button></section>
      <section className="panel dashboard-recent"><h3>Recent complaints</h3>{data.recentComplaints.length===0?<div className="empty"><strong>No complaints in this range</strong></div>:<div className="dashboard-list">{data.recentComplaints.map((row)=><article className="dashboard-list-row" key={row.id}><div><strong>{row.subject}</strong><span>{row.customer_name} · {dateTime(row.created_at)}</span></div><span className={`pill ${row.status}`}>{translateText(row.status,language)}</span></article>)}</div>}<button className="text-action dashboard-view-all" onClick={()=>onNavigate('complaints')}>Manage complaints</button></section>
      <section className="panel dashboard-recent"><h3>Recent reviews</h3>{data.recentReviews.length===0?<div className="empty"><strong>No reviews in this range</strong></div>:<div className="dashboard-list">{data.recentReviews.map((row)=><article className="dashboard-list-row" key={row.id}><div><strong>{'★'.repeat(Number(row.rating))} · {row.vendor_name}</strong><span>{row.customer_name} · {dateTime(row.created_at)}</span>{row.comment&&<span className="dashboard-review-comment">{row.comment}</span>}</div><span className={`pill ${row.status}`}>{translateText(row.status,language)}</span></article>)}</div>}<button className="text-action dashboard-view-all" onClick={()=>onNavigate('reviews')}>Manage reviews</button></section>
    </div>
  </>;
}

function DataPage({slug,user,onUserChange}) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const config = modules[slug] || {
    title: slug === 'profile' ? 'Profile' : slug === 'settings' ? 'System Settings' : slug === 'reports' ? 'Reports and Analytics' : 'Administration',
    endpoint: slug === 'settings' ? 'settings' : slug === 'profile' ? 'profile' : slug === 'reports' ? 'reports/summary' : 'users',
    columns: [],
    readonly: true,
    actions: [],
  };
  const [data,setData]=useState([]); const [pagination,setPagination]=useState({page:1,pageSize:20,total:0});
  const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [query,setQuery]=useState(''); const [search,setSearch]=useState(''); const [status,setStatus]=useState(''); const [modal,setModal]=useState(null); const [busy,setBusy]=useState(false); const [form,setForm]=useState({}); const [roleRows,setRoleRows]=useState([]);
  const statuses={users:['active','suspended','pending'],roles:['active','inactive'],categories:['active','inactive'],vendors:['pending','verified','rejected'],events:['draft','active','booked','in_progress','completed','cancelled'],bookings:['requested','quoted','accepted','rejected','cancelled','completed','under_review'],'package-requests':['new','reviewed','replied','closed'],payments:['pending','authorized','paid','failed','refunded','refund_pending'],reviews:['published','hidden','flagged'],complaints:['open','investigating','resolved','dismissed'],messages:['new','reviewed','replied','closed'],notifications:['queued','sent','failed','read']}[slug]||[];
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
    } else if(modal.kind==='package-status'){
      result=await api(`/admin/event-package-requests/${row.id}/status`,{method:'PATCH',body:JSON.stringify({status:form.status || row.status})});
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
  const actions=(row)=>{const names=config.actions||[];return names.map((action)=>{const label={edit:'Edit',deactivate:'Deactivate',verify:'Verify',reject:'Reject',moderate:'Moderate',refund:'Request refund',role:'Change role',status:row.status==='suspended'?'Activate':'Suspend','package-status':'Update status',permissions:'Permissions',review:'Moderate review',complaint:'Update complaint'}[action];return <button key={action} className={`text-action ${['deactivate','reject','refund','status'].includes(action)?'subtle-danger':''}`} onClick={()=>startAction(action==='package-status'?'package-status':action,row)}>{label}</button>;});};
  const title=translateText(config.title, language);
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
      'package-status': 'Update package request status',
      permissions: 'Role permissions',
      review: 'Moderate review',
      complaint: 'Update complaint',
      setting: 'Save system setting',
      profile: 'Update profile',
    };
    return translateText(titles[modal.kind] || 'Confirm action', language);
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

    if (modal.kind === 'verify' || modal.kind === 'reject' || modal.kind === 'refund' || modal.kind === 'status' || modal.kind === 'package-status') {
      if (slug === 'package-requests') {
        return <label className="field"><span>Request status</span><select value={form.status || modal.row.status} onChange={(event) => changeField('status', event.target.value)}>{['new', 'reviewed', 'replied', 'closed'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>;
      }
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
          <p className="eyebrow">{t('systemControl')}</p>
          <h2>{title}</h2>
          <p className="muted">{t('manageRecords')}</p>
        </div>
        {config.create && <button className="button" onClick={startCreate}>{t('createNew')}</button>}
      </div>
      {slug === 'payments' && <div className="alert warning">Payment entries are read-only. Refund requests cannot be processed until a provider is configured and verifies the transaction.</div>}
      {notice && <div className="alert success">{translateText(notice, language)}</div>}
      {error && <div className="alert error">{translateText(error, language)}<button className="dismiss" onClick={() => setError('')}>{t('dismiss')}</button></div>}
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
              <input placeholder={t('searchRecords')} value={query} onChange={(event) => setQuery(event.target.value)} />
              <button type="submit">{t('search')}</button>
            </form>
            {statuses.length > 0 && (
              <select className="filter-select" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">{t('allStatuses')}</option>
                  {statuses.map((value) => <option key={value} value={value}>{translateText(value, language)}</option>)}
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
                  <tr><td colSpan={config.columns.length + 1}><div className="loading"><span className="spinner" />{t('loading')}</div></td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={config.columns.length + 1}><div className="empty"><div className="empty-icon">⌕</div><strong>{t('noRecords')}</strong><span>{t('tryDifferentFilters')}</span></div></td></tr>
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
  const language = useLanguage();
  const [user,setUser]=useState(null);const [checking,setChecking]=useState(true);const [slug,setSlug]=useState('overview');const [sidebarOpen,setSidebarOpen]=useState(false);const [globalError,setGlobalError]=useState('');const [showLogin,setShowLogin]=useState(false);const [portal,setPortal]=useState('admin');const [currentPath,setCurrentPath]=useState(() => window.location.pathname || '/');
  const [expandedNavGroups,setExpandedNavGroups]=useState({overview:true,management:true,operations:true,insights:true,configuration:true});

  const normalizePath = useCallback((path) => {
    if (!path || path === '') return '/';
    const [pathname, search = ''] = String(path).split('?');
    const next = pathname.replace(/\/+$/, '');
    return `${next || '/'}${search ? `?${search}` : ''}`;
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';
  }, [language]);

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
      setSlug(['overview','users','roles','vendors','categories','events','bookings','package-requests','payments','reviews','complaints','messages','reports','notifications','audit-logs','settings','profile'].includes(next) ? next : 'overview');
    }
  }, [normalizePath]);

  useEffect(()=>{const controller=new AbortController();resolve();const listener=()=>resolve();window.addEventListener('popstate',listener);api('/auth/me',{signal:controller.signal}).then((r)=>setUser(r.user)).catch((issue)=>{if(issue.name!=='AbortError')setUser(null);}).finally(()=>{if(!controller.signal.aborted)setChecking(false);});return()=>{controller.abort();window.removeEventListener('popstate',listener);};},[resolve]);

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
  async function registerPublic(name,email,password,role='customer'){
    const response = await api('/platform/register',{method:'POST',body:JSON.stringify({name,email,password,role})});
    setUser(null);setPortal(role);setGlobalError('');setShowLogin(false);
    return response.data;
  }
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
      else if (user) await api('/platform/logout',{method:'POST'});
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
  const activeMenu=menu.find(([id])=>id===slug);const pageTitle=translateText(activeMenu?.[1]||'Dashboard Overview',language);
  return <div className="app-shell"><aside className={`sidebar ${sidebarOpen?'open':''}`}><div className="sidebar-brand"><div className="brand-mark small">EF</div><div><strong>EventFlow</strong><span>{translate('adminDashboard',language).toUpperCase()}</span></div><button className="mobile-close icon-button" onClick={()=>setSidebarOpen(false)} aria-label={translate('close',language)}><X size={18}/></button></div><div className="nav-caption">{translate('systemControl',language)}</div><nav>{menuGroups.map((group)=><div className="nav-group" key={group.id}><button className="nav-group-toggle" type="button" aria-expanded={Boolean(expandedNavGroups[group.id])} onClick={()=>setExpandedNavGroups((current)=>({...current,[group.id]:!current[group.id]}))}><span>{group.label}</span><span aria-hidden="true">{expandedNavGroups[group.id]?'−':'+'}</span></button>{expandedNavGroups[group.id]&&group.items.map(([id,label,Icon])=><button key={id} className={`nav-item ${slug===id?'active':''}`} aria-current={slug===id?'page':undefined} onClick={id === 'logout' ? logout : ()=>navigate(id)}><Icon size={18}/><span>{translateText(label,language)}</span>{id==='vendors'&&<span className="nav-dot"/>}</button>)}</div>)}</nav></aside><div className={`mobile-scrim ${sidebarOpen?'visible':''}`} onClick={()=>setSidebarOpen(false)}/><main className="main-area"><header className="topbar"><button className="icon-button menu-button" onClick={()=>setSidebarOpen(true)} aria-label={translate('mainNavigation',language)}><Menu size={20}/></button><div className="breadcrumb">{translate('adminDashboard',language)} <span>/</span> <strong>{pageTitle}</strong></div><div className="topbar-right"><LanguageSelector/><span className="secure-label"><span/>{translate('secureSession',language)}</span><button className="top-user" onClick={()=>navigate('profile')}><span className="avatar small-avatar">{user.full_name?.slice(0,1)||'A'}</span>{user.full_name}</button></div></header><div className="content">{globalError&&<div className="alert error">{globalError}<button className="dismiss" onClick={()=>setGlobalError('')}>{translate('dismiss',language)}</button></div>}{slug==='overview'?<Overview onNavigate={navigate}/>:slug==='profile'?<DataPage slug="profile" user={user} onUserChange={setUser}/>:slug==='reports'?<Reports/>:slug==='settings'?<DataPage slug="settings" user={user} onUserChange={setUser}/>:<DataPage slug={slug} user={user} onUserChange={setUser}/>}</div><footer className="footer">{translate('adminDashboard',language)} <span>•</span> {translateText('Operational data is server-backed',language)}</footer></main></div>;
}
