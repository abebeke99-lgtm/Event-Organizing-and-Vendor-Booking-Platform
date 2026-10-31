import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Accessibility, Activity, ArrowLeft, ArrowRight, Award, BadgeCheck, Bell, BookOpen, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Clock3, Compass, CreditCard, ExternalLink, Eye, EyeOff, Heart, History, Handshake, Languages, LayoutDashboard, Lightbulb, LifeBuoy, LogOut, Mail, MapPin, Menu, MessageSquareWarning, MonitorSmartphone, Moon, Phone, Search, Send, Settings, Shield, ShieldCheck, SlidersHorizontal, Sparkles, Star, Store, Sun, Tags, Target, UserRound, Users, Wallet, X } from 'lucide-react';
import { INQUIRY_TYPES, buildContactInfo, validateContactForm } from './contactUtils.js';
import { formatEventBudget, formatEventDate } from './eventUtils.js';
import { setLanguage, translate, translateText, useLanguage } from './language.js';
import { setTheme, useTheme } from './theme.js';
import { getDashboardDateRange } from './dashboardUtils.js';
import { clearDemoSession, findDemoLogin, isValidDemoPassword, readDemoSession, saveDemoAccount, saveDemoSession } from './utils/demoAuth.js';
import { EventDetailsPage, MyEventBookingsPage, OrganizerEventsManager } from './EventsExperience.jsx';

const DEMO_AUTH_ENABLED = import.meta.env.DEV && import.meta.env.VITE_DEMO_AUTH === 'true';
const menu = [
  ['overview','Dashboard Overview',LayoutDashboard], ['users','User Management',Users], ['roles','Role and Permission Management',Shield],
  ['vendors','Vendor Verification',BadgeCheck], ['categories','Service Category Management',Tags], ['events','Event Management',CalendarDays],
  ['bookings','Booking Management',ClipboardList], ['package-requests','Event Package Requests',ClipboardList], ['payments','Payment and Refund Management',CreditCard], ['reviews','Reviews and Complaints',MessageSquareWarning], ['complaints','Complaint Management',MessageSquareWarning],
  ['messages','Contact Messages',MessageSquareWarning], ['reports','Reports and Analytics',ChartNoAxesCombined], ['notifications','Notifications',Bell], ['audit-logs','Audit Logs',Activity],
  ['settings','System Settings',Settings], ['profile','Profile',UserRound]
];
const menuGroups = [
  { id: 'overview', label: 'Dashboard', items: [menu[0]] },
  { id: 'management', label: 'Platform Management', items: menu.slice(1, 8) },
  { id: 'operations', label: 'Operations', items: menu.slice(8, 12).concat([menu[13]]) },
  { id: 'insights', label: 'Insights and Security', items: [menu[12], menu[14]] },
  { id: 'configuration', label: 'Configuration', items: menu.slice(15, 17) },
];
const modules = {
  users:{title:'User Management', endpoint:'users', columns:['id','full_name','email','phone','roles','status','created_at'], fields:[['full_name','Full name','text'],['email','Email','email'],['phone','Phone','text']], create:true, actions:['role','status']},
  roles:{title:'Role and Permission Management', endpoint:'roles', columns:['id','name','description','is_active','created_at'], fields:[['name','Role name','text'],['description','Description','text']], create:true, actions:['permissions']},
  vendors:{title:'Vendor Verification', endpoint:'vendors', columns:['id','business_name','user_id','category_id','city','verification_status','verification_reason','verified_at'], actions:['verify','reject']},
  categories:{title:'Service Category Management', endpoint:'categories', columns:['id','name','description','is_active','created_at'], fields:[['name','Category name','text'],['description','Description','text']], create:true, actions:['edit','deactivate']},
  events:{title:'Event Management', endpoint:'events', columns:['id','title','event_type','organizer_id','city','venue','start_date','capacity','status'], fields:[['organizer_id','Organizer user ID','number'],['title','Title','text'],['event_type','Event type','text'],['description','Description (optional)','textarea'],['city','City (optional)','text'],['venue','Venue (optional)','text'],['cover_image_url','Cover image URL (optional)','url'],['start_date','Start date','datetime-local'],['end_date','End date (optional)','datetime-local'],['budget','Budget (optional)','number'],['capacity','Capacity (optional)','number'],['status','Status','select','draft,active,booked,in_progress,completed,cancelled'],['notes','Notes (optional)','textarea']], create:true, actions:['edit','deactivate']},
  bookings:{title:'Booking Management', endpoint:'bookings', columns:['id','event_id','vendor_id','service_description','quoted_amount','currency','status','moderation_reason','created_at'], actions:['moderate']},
  'package-requests':{title:'Event Package Requests', endpoint:'event-package-requests', columns:['id','event_id','event_title','event_type','requested_date','requested_location','requester_name','requester_email','service_category','guest_count','budget','notes','status','created_at'], actions:['package-status'], statuses:['new','reviewed','replied','closed']},
  payments:{title:'Payment and Refund Management', endpoint:'payments', columns:['id','booking_id','amount','currency','provider','provider_reference','status','created_at'], actions:['refund']},
  reviews:{title:'Reviews and Complaints', endpoint:'reviews', columns:['id','booking_id','rating','comment','status','created_at'], actions:['review']},
  complaints:{title:'Reviews and Complaints', endpoint:'complaints', columns:['id','user_id','booking_id','subject','details','status','resolution','created_at'], actions:['complaint']},
  messages:{title:'Contact Messages', endpoint:'contact', columns:['id','full_name','email','phone','subject','inquiry_type','message','status','created_at'], actions:['view','status','delete'], statuses:['new','reviewed','in_progress','replied','resolved','closed'], inquiryTypes:INQUIRY_TYPES},
  notifications:{title:'Notifications', endpoint:'notifications', columns:['id','user_id','title','message','status','created_at'], fields:[['user_id','Recipient user ID (optional)','number'],['title','Title','text'],['message','Message','textarea']], create:true},
  'audit-logs':{title:'Audit Logs', endpoint:'audit-logs', columns:['id','actor_id','action','entity_type','entity_id','details','ip_address','created_at'], readonly:true},
};
const permissions = ['users:read','users:write','vendors:verify','events:write','bookings:moderate','payments:read','reviews:moderate','categories:write','reports:read','notifications:write'];
const slugPath = (slug) => slug === 'overview' ? '/admin' : `/admin/${slug}`;
const dashboardPathForRole = (role) => role === 'admin' ? '/admin' : `/${role}/dashboard`;

const dashboardMenuIcons = {
  overview: LayoutDashboard,
  vendors: BriefcaseBusiness,
  services: Search,
  categories: Tags,
  bookings: ClipboardList,
  history: History,
  events: CalendarDays,
  favorites: Heart,
  quotations: MessageSquareWarning,
  payments: Wallet,
  messages: MessageSquareWarning,
  reviews: Star,
  notifications: Bell,
  profile: UserRound,
  account: UserRound,
  settings: Settings,
  verification: BadgeCheck,
  'add-edit-services': BriefcaseBusiness,
  pricing: CreditCard,
  availability: CalendarDays,
  requests: ClipboardList,
  confirmed: ClipboardList,
  reports: ChartNoAxesCombined,
};

function DashboardSidebar({ roleTitle, groups, activePage, onNavigate, onToggle, collapsed, mobileOpen, onCloseMobile, language, className = '' }) {
  const sidebarRef = useRef(null);
  const [expandedGroups, setExpandedGroups] = useState(() => Object.fromEntries(groups.map((group) => [group.id, true])));
  const [flyout, setFlyout] = useState(null);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setFlyout(null);
        if (window.matchMedia('(max-width: 760px)').matches) onCloseMobile();
      }
    }
    function handlePointerDown(event) {
      if (flyout && !sidebarRef.current?.contains(event.target)) setFlyout(null);
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [flyout, onCloseMobile]);

  function toggleGroup(event, group) {
    if (collapsed && group.flyoutWhenCollapsed && !window.matchMedia('(max-width: 760px)').matches) {
      const currentFlyout = flyout?.groupId === group.id;
      setExpandedGroups((current) => ({ ...current, [group.id]: true }));
      setFlyout(currentFlyout ? null : { groupId: group.id, top: event.currentTarget.getBoundingClientRect().top });
      return;
    }
    const shouldExpand = !expandedGroups[group.id];
    setExpandedGroups((current) => ({ ...current, [group.id]: shouldExpand }));
    setFlyout(null);
  }

  function renderItems(items, flyoutItems = false) {
    return items.map(([id, label, Icon]) => {
      const ItemIcon = Icon || dashboardMenuIcons[id] || LayoutDashboard;
      const accessibleLabel = translateText(label, language);
      return <button key={id} className={`nav-item ${activePage === id ? 'active' : ''}`} title={accessibleLabel} data-tooltip={accessibleLabel} aria-label={accessibleLabel} aria-current={activePage === id ? 'page' : undefined} onClick={() => {
        setFlyout(null);
        onNavigate(id);
        if (window.matchMedia('(max-width: 760px)').matches) onCloseMobile();
      }}><ItemIcon size={18}/><span>{accessibleLabel}</span>{!flyoutItems && id === 'vendors' && <span className="nav-dot"/>}</button>;
    });
  }

  return <aside ref={sidebarRef} className={`sidebar role-dashboard-sidebar ${className} ${mobileOpen ? 'open' : ''}`} aria-label={`${roleTitle} navigation`}>
    <button className="sidebar-collapse-toggle" type="button" onClick={onToggle} aria-label={collapsed ? 'Expand dashboard navigation' : 'Collapse dashboard navigation'} aria-expanded={!collapsed} title={collapsed ? 'Expand navigation' : 'Collapse navigation'}><span className="desktop-sidebar-chevron" aria-hidden="true">{collapsed ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}</span></button>
    <div className="sidebar-brand"><div className="brand-mark small" aria-label="EventFlow">EF</div><div className="sidebar-brand-copy"><strong>EventFlow</strong><span>{roleTitle}</span></div></div>
    <nav aria-label="Dashboard sections">{groups.map((group) => <div className={`nav-group ${group.flyoutWhenCollapsed ? 'has-collapsed-flyout' : 'nav-group-flat'}`} key={group.id}>
      <button className="nav-group-toggle" type="button" title={group.label} data-tooltip={group.label} aria-label={`${group.label} navigation section`} aria-expanded={collapsed && !mobileOpen ? flyout?.groupId === group.id : Boolean(expandedGroups[group.id])} onClick={(event) => toggleGroup(event, group)}><span>{group.label}</span><span className="nav-group-indicator" aria-hidden="true">{collapsed && !mobileOpen ? <ChevronRight size={15}/> : expandedGroups[group.id] ? '−' : '+'}</span></button>
      {expandedGroups[group.id] && <div className="sidebar-group-items">{renderItems(group.items)}</div>}
    </div>)}</nav>
    {flyout && (() => {
      const group = groups.find((entry) => entry.id === flyout.groupId);
      return group ? <div className="sidebar-flyout" style={{ top: `${Math.min(flyout.top, window.innerHeight - Math.min(group.items.length * 45 + 24, window.innerHeight - 24))}px` }} aria-label={`${group.label} navigation`}>{renderItems(group.items, true)}</div> : null;
    })()}
  </aside>;
}
const toDemoUser = (profile) => ({ ...profile, full_name: profile.name, id: `demo-${profile.email}` });
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

function DemoModeBanner() {
  return null;
}

async function api(path, options={}) {
  if (DEMO_AUTH_ENABLED) {
    if (options.signal?.aborted) throw Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
    const route = path.split('?')[0];
    if (options.method && options.method !== 'GET') {
      let data = {};
      if (options.body) {
        try {
          data = JSON.parse(options.body);
        } catch {
          throw new Error('Invalid demo request data.');
        }
      }
      return { data: { ...data, id: `demo-${Date.now()}` }, message: 'Demo mode: changes are not sent to a server.' };
    }
    if (route === '/admin/dashboard/overview') {
      return {
        data: {
          users: { total_users: 0 },
          vendors: { total_vendors: 0, verified_vendors: 0, pending_vendors: 0 },
          events: { total_events: 0, published_events: 0, upcoming_events: 0 },
          bookings: { total_bookings: 0, pending_bookings: 0, confirmed_bookings: 0, completed_bookings: 0, cancelled_bookings: 0 },
          payments: { total_payments: 0, successful_payments: 0, pending_payments: 0, refund_requests: 0 },
          complaints: { open_complaints: 0, total_complaints: 0 },
          reviews: { total_reviews: 0 },
          bookingTrend: [],
          eventCategories: [],
          revenueByCurrency: [],
          bookingStatuses: [],
          recentBookings: [],
          recentVendorRequests: [],
          recentComplaints: [],
          recentReviews: [],
        },
      };
    }
    if (route === '/platform/overview' || route === '/customer/overview' || route === '/vendor/overview') {
      return { data: {} };
    }
    if (route === '/about' || route === '/contact' || route === '/vendor/profile' || route === '/vendor/account' || route === '/customer/profile') {
      return { data: {} };
    }
    return { data: [], pagination: { page: 1, total: 0, totalPages: 1, limit: 12 } };
  }
  if (!apiBaseUrl && import.meta.env.PROD) {
    throw new Error('API is not configured. Set VITE_API_URL in the deployment environment and redeploy.');
  }
  try {
    const response = await axios.request({
      url: `${apiBaseUrl}/api${path}`,
      method: options.method || 'GET',
      data: options.body,
      signal: options.signal,
      withCredentials: true,
      headers: { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) },
    });
    if (response.status === 204) return null;
    return response.data === '' || response.data === undefined ? {} : response.data;
  } catch (error) {
    if (axios.isCancel(error)) {
      throw Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
    }
    if (axios.isAxiosError(error) && error.response) {
      const result = error.response.data;
      const message = result && typeof result === 'object' && (result.message || result.error);
      throw Object.assign(new Error(message || `Request failed (${error.response.status}).`), { status: error.response.status });
    }
    throw error;
  }
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
const PUBLIC_NOTIFICATION_ENDPOINTS = {
  admin: '/admin/notifications?page=1&pageSize=8',
  customer: '/customer/notifications',
  vendor: '/vendor/notifications',
};

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationItems, setNotificationItems] = useState([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationRetry, setNotificationRetry] = useState(0);
  const isAuthenticated = Boolean(user);
  const routePath = currentPath.split('?')[0];
  const accountMenuRef = useRef(null);
  const headerToolsRef = useRef(null);
  const role = user?.role || 'customer';
  const dashboardPath = dashboardPathForRole(role);
  const displayName = user?.name || user?.full_name || user?.email || 'EventHub User';
  const notificationEndpoint = isAuthenticated ? PUBLIC_NOTIFICATION_ENDPOINTS[role] : null;
  const unreadCount = notificationItems.filter((item) => !(item.read || item.status === 'read')).length;

  useEffect(() => {
    if (!notificationEndpoint) {
      setNotificationItems([]);
      setNotificationLoading(false);
      setNotificationError('');
      return undefined;
    }

    const controller = new AbortController();
    setNotificationLoading(true);
    setNotificationError('');
    api(notificationEndpoint, { signal: controller.signal })
      .then((response) => {
        if (!Array.isArray(response?.data)) throw new Error('Notifications could not be loaded because the response was invalid.');
        setNotificationItems(response.data);
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setNotificationError(error.message || 'Notifications could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setNotificationLoading(false);
      });

    return () => controller.abort();
  }, [notificationEndpoint, notificationRetry]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!headerToolsRef.current?.contains(event.target)) {
        setNotificationsOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return <header className="site-header"><div className="site-header-inner">
    <a className="site-brand" href="/" aria-label={translate('goHome', language)} onClick={(event) => { event.preventDefault(); onNavigate('/'); }}><span className="brand-mark small">EH</span><div><strong>EventHub</strong><small>{translate('platform', language)}</small></div></a>
    <button type="button" className="mobile-nav-toggle" aria-label={translate(mobileMenuOpen ? 'closeMenu' : 'openMenu', language)} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
    <nav className={`site-nav ${mobileMenuOpen ? 'open' : ''}`} aria-label={translate('mainNavigation', language)}>{PUBLIC_NAV_ITEMS.map((item) => <a key={item.path} href={item.path} className={`nav-link ${routePath === item.path || routePath.startsWith(`${item.path}/`) && item.path !== '/' ? 'active' : ''}`} aria-current={routePath === item.path || routePath.startsWith(`${item.path}/`) && item.path !== '/' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); onNavigate(item.path); }}>{translateText(item.label, language)}</a>)}</nav>
    <div className="header-actions">
      {isAuthenticated && <div className="public-header-tools" ref={headerToolsRef}>
        <div className="public-notification-anchor">
          <button type="button" className="icon-button public-notification-toggle" aria-label={`${translate('notifications', language)}${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><Bell size={17}/>{unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}</button>
          {notificationsOpen && <section className="public-notification-panel" aria-label={translate('notifications', language)} aria-live="polite">
            <div className="public-notification-heading"><strong>{translate('notifications', language)}</strong><span>{notificationEndpoint ? (unreadCount ? `${unreadCount} unread` : 'All caught up') : 'Notifications are not available for this account role.'}</span></div>
            {!notificationEndpoint ? <div className="public-notification-empty">Notifications are not available for this account role.</div> :
              notificationLoading ? <div className="public-notification-empty">Loading notifications…</div> :
                notificationError ? <div className="public-notification-error"><span>{notificationError}</span><button type="button" onClick={() => setNotificationRetry((retry) => retry + 1)}>Retry</button></div> :
                  notificationItems.length ? <ul>{notificationItems.slice(0, 8).map((item) => <li key={item.id}>
                    <strong>{item.title}</strong><p>{item.message}</p>
                    {(item.createdAt || item.created_at) && <time dateTime={item.createdAt || item.created_at}>{new Date(item.createdAt || item.created_at).toLocaleString()}</time>}
                  </li>)}</ul> : <div className="public-notification-empty">You’re all caught up.</div>}
          </section>}
        </div>
      </div>}
      <LanguageSelector/><ThemeToggle/>
      {isAuthenticated ? <details className="public-account" ref={accountMenuRef}>
      <summary className="public-account-trigger" aria-label={translate('accountControl', language)}><span className="public-account-avatar" aria-hidden="true">{displayName.trim().charAt(0).toUpperCase()}</span><span className="public-account-copy"><strong>{displayName}</strong><small>{translate(`${role}Dashboard`, language)}</small></span><ChevronDown size={15}/></summary>
      <div className="public-account-menu"><button type="button" onClick={() => { accountMenuRef.current.open = false; onNavigate(dashboardPath); }}>{translate('goToDashboard', language)}</button><button type="button" onClick={() => { accountMenuRef.current.open = false; onLogout(); }}>{translate('logout', language)}</button></div>
    </details> : <div className="public-auth-actions"><button type="button" className="button secondary small" onClick={onOpenLogin}>{translate('login', language)}</button><button type="button" className="button small" onClick={onOpenRegister}>{translate('register', language)}</button></div>}</div>
  </div></header>;
}

function LanguageSelector() {
  const language = useLanguage();
  return <label className="language-picker">
    <span className="visually-hidden">{translate('languageLabel', language)}</span>
    <select value={language} aria-label={translate('languageLabel', language)} onChange={(event) => setLanguage(event.target.value)}>
      <option value="en">English</option>
      <option value="am">አማርኛ</option>
    </select>
  </label>;
}

function ThemeToggle() {
  const language = useLanguage();
  const theme = useTheme();
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  return <button type="button" className="theme-toggle" aria-label={translate(theme === 'light' ? 'switchToDarkMode' : 'switchToLightMode', language)} title={translate(theme === 'light' ? 'switchToDarkMode' : 'switchToLightMode', language)} onClick={() => setTheme(nextTheme)}>
    {theme === 'light' ? <Moon size={16}/> : <Sun size={16}/>}<span>{translate(theme === 'light' ? 'lightMode' : 'darkMode', language)}</span>
  </button>;
}

function DashboardHeader({ user, onLogout, onToggleSidebar, sidebarExpanded }) {
  const [activePanel, setActivePanel] = useState('');
  const [viewingPhoto, setViewingPhoto] = useState(false);
  const [avatar, setAvatar] = useState(() => {
    try {
      return window.localStorage.getItem(`eventhub-demo-avatar:${user.email}`) || '';
    } catch {
      return '';
    }
  });
  const headerRef = useRef(null);
  const photoButtonRef = useRef(null);
  const closePhotoButtonRef = useRef(null);
  const role = user.role || 'customer';
  const name = user.name || user.full_name || 'EventHub User';
  const notifications = [
    { id: 'booking', title: 'Booking update', message: 'Your recent booking activity is ready to review.', unread: true },
    { id: 'profile', title: 'Profile reminder', message: 'Keep your account details up to date.', unread: true },
    { id: 'welcome', title: 'Welcome to EventHub', message: 'Explore your dashboard and discover what you can do.', unread: false },
  ];
  const [items, setItems] = useState(notifications);
  const unreadCount = items.filter((item) => item.unread).length;

  useEffect(() => {
    try {
      setAvatar(window.localStorage.getItem(`eventhub-demo-avatar:${user.email}`) || '');
    } catch {
      setAvatar('');
    }
  }, [user.email]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!headerRef.current?.contains(event.target)) setActivePanel('');
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setActivePanel('');
        setViewingPhoto(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!viewingPhoto) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closePhotoButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      photoButtonRef.current?.focus();
    };
  }, [viewingPhoto]);

  return <header className="dashboard-header" ref={headerRef}>
    <button className="icon-button dashboard-menu-toggle" type="button" onClick={onToggleSidebar} aria-label={sidebarExpanded ? 'Close dashboard navigation' : 'Open dashboard navigation'} aria-expanded={sidebarExpanded}><Menu size={19}/></button>
    <div className="dashboard-header-actions">
      <LanguageSelector/>
      <ThemeToggle/>
      <div className="dashboard-popover-anchor">
        <button className="icon-button notification-toggle" type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={activePanel === 'notifications'} onClick={() => setActivePanel((current) => current === 'notifications' ? '' : 'notifications')}><Bell size={19}/>{unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}</button>
        {activePanel === 'notifications' && <section className="dashboard-popover notification-popover" aria-label="Notifications">
          <div className="popover-heading"><div><strong>Notifications</strong><span>{unreadCount ? `${unreadCount} unread` : 'All caught up'}</span></div><button className="text-action" type="button" onClick={() => setItems((current) => current.map((item) => ({ ...item, unread: false })))} disabled={!unreadCount}>Mark all read</button></div>
          {items.length ? <div className="notification-list">{items.map((item) => <article className={`notification-item ${item.unread ? 'unread' : ''}`} key={item.id}><div><strong>{item.title}</strong><p>{item.message}</p></div>{item.unread && <button className="text-action" type="button" onClick={() => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, unread: false } : entry))}>Mark read</button>}</article>)}</div> : <div className="notification-empty"><Bell size={20}/><strong>No notifications</strong><span>You’re all caught up.</span></div>}
          <div className="popover-footer"><button className="text-action subtle-danger" type="button" onClick={() => setItems([])} disabled={!items.length}>Clear notifications</button></div>
        </section>}
      </div>
      <button ref={photoButtonRef} className="dashboard-photo-toggle" type="button" aria-label={`View ${name}'s profile photo`} title="View photo" onClick={() => { setActivePanel(''); setViewingPhoto(true); }}>
        <span className="dashboard-avatar">{avatar ? <img src={avatar} alt="" /> : <UserRound size={19}/>}</span>
      </button>
      <div className="dashboard-profile-copy"><strong>{name}</strong><small>{role}</small></div>
      <button className="icon-button dashboard-logout" type="button" aria-label="Logout" title="Logout" onClick={onLogout}><LogOut size={17}/></button>
    </div>
    {viewingPhoto && <div className="profile-photo-overlay" onClick={(event) => { if (event.target === event.currentTarget) setViewingPhoto(false); }}>
      <section className="profile-photo-modal" role="dialog" aria-modal="true" aria-labelledby="profile-photo-title">
        <button ref={closePhotoButtonRef} className="icon-button profile-photo-close" type="button" aria-label="Close photo" onClick={() => setViewingPhoto(false)}><X size={19}/></button>
        <h2 id="profile-photo-title">Profile photo</h2>
        <div className="profile-photo-preview">{avatar ? <img src={avatar} alt={`${name}'s profile`} /> : <UserRound size={104} aria-label="Default profile avatar"/>}</div>
        <strong className="profile-photo-name">{name}</strong>
        <span className="profile-photo-email">{user.email}</span>
        <span className="profile-photo-role">{role}</span>
      </section>
    </div>}
  </header>;
}

function DashboardSettings({ user }) {
  const storageKey = `eventhub-demo-settings:${user.email}`;
  const [initialPreferences] = useState(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === null) return { settings: { emailNotifications: true, weeklySummary: false }, error: '' };
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Saved preferences are invalid.');
      return { settings: { emailNotifications: parsed.emailNotifications !== false, weeklySummary: parsed.weeklySummary === true }, error: '' };
    } catch {
      return { settings: { emailNotifications: true, weeklySummary: false }, error: 'Preferences could not be loaded from browser storage.' };
    }
  });
  const [settings, setSettings] = useState(initialPreferences.settings);
  const [storageError, setStorageError] = useState(initialPreferences.error);
  function toggleSetting(key) {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError('');
    } catch {
      setStorageError('Changes apply for this visit, but browser storage is unavailable.');
    }
  }
  return <section className="dashboard-settings">
    <div className="page-heading"><div><p className="eyebrow">ACCOUNT</p><h2>Account settings</h2><p className="muted">Manage local preferences for this browser.</p></div></div>
    <div className="panel settings-preferences">
      <label><span><strong>Email notifications</strong><small>Show account and booking updates in this demo.</small></span><input type="checkbox" checked={Boolean(settings.emailNotifications)} onChange={() => toggleSetting('emailNotifications')}/></label>
      <label><span><strong>Weekly summary</strong><small>Enable a weekly activity summary preference.</small></span><input type="checkbox" checked={Boolean(settings.weeklySummary)} onChange={() => toggleSetting('weeklySummary')}/></label>
      {storageError && <p className="field-error" role="status">{storageError}</p>}
    </div>
  </section>;
}

function PasswordField({ name, label, value, onChange, autoComplete = 'current-password', language, placeholder, minLength, maxLength, describedBy, invalid = false }) {
  const [visible, setVisible] = useState(false);
  const inputId = `auth-${name}`;
  return <div className="field"><span id={`${inputId}-label`}>{label}</span><div className="password-input-wrap"><input id={inputId} aria-labelledby={`${inputId}-label`} aria-describedby={describedBy} aria-invalid={invalid || undefined} name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder} minLength={minLength} maxLength={maxLength} value={value} onChange={onChange} required /><button className="password-visibility" type="button" aria-label={translate(visible ? 'hidePassword' : 'showPassword', language)} title={translate(visible ? 'hidePassword' : 'showPassword', language)} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>;
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

function SearchResultsPage({ initialQuery, onNavigate }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState({ events: [], vendors: [], services: [], categories: [] });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(Boolean(initialQuery));
  const [searchError, setSearchError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const term = initialQuery.trim();
    if (!term) {
      setLoading(false);
      setResults({ events: [], vendors: [], services: [], categories: [] });
      setErrors({});
      return undefined;
    }

    let active = true;
    setLoading(true);
    setErrors({});
    const encoded = encodeURIComponent(term);
    Promise.allSettled([
      api(`/platform/events?search=${encoded}&page=1&limit=6`),
      api(`/platform/vendors?search=${encoded}&page=1&limit=6`),
      api(`/platform/services?search=${encoded}&page=1&limit=6`),
      api(`/platform/categories?search=${encoded}`),
    ]).then((responses) => {
      if (!active) return;
      const keys = ['events', 'vendors', 'services', 'categories'];
      const nextResults = {};
      const nextErrors = {};
      responses.forEach((result, index) => {
        const key = keys[index];
        if (result.status === 'rejected') {
          nextResults[key] = [];
          nextErrors[key] = result.reason?.message || `Unable to search ${key}.`;
        } else {
          nextResults[key] = Array.isArray(result.value?.data) ? result.value.data : [];
        }
      });
      setResults(nextResults);
      setErrors(nextErrors);
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [initialQuery, retryKey]);

  function submitSearch(event) {
    event.preventDefault();
    const term = query.trim();
    if (!term) {
      setSearchError('Enter a search term.');
      return;
    }
    setSearchError('');
    onNavigate(`/search?q=${encodeURIComponent(term)}`);
  }

  const sections = [
    { key: 'events', title: 'Events', getTitle: (item) => item.title, getPath: (item) => `/events/${encodeURIComponent(item.id)}` },
    { key: 'vendors', title: 'Vendors', getTitle: (item) => item.business_name || item.name, getPath: (item) => `/vendors/${encodeURIComponent(item.id)}` },
    { key: 'services', title: 'Services', getTitle: (item) => item.title, getPath: (item) => `/services/${encodeURIComponent(item.id)}` },
    { key: 'categories', title: 'Categories', getTitle: (item) => item.name, getPath: (item) => `/categories/${encodeURIComponent(item.slug || item.name)}` },
  ];
  const hasResults = Object.values(results).some((items) => items.length > 0);

  return <main className="page-shell"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">DISCOVERY</p><h1>Search EventFlow</h1><p className="muted">Search events, vendors, services, categories, and locations.</p></div></div>
    <form className="panel home-global-search" role="search" onSubmit={submitSearch}>
      <label className="search-box"><Search size={16}/><input autoFocus type="search" maxLength="120" value={query} onChange={(event) => { setQuery(event.target.value); setSearchError(''); }} aria-label="Search events, vendors, services, categories, and locations" placeholder="Try a service, city, or category" /></label>
      <button className="button" type="submit">Search</button>
    </form>
    {searchError && <p className="field-error" role="alert">{searchError}</p>}
    {loading ? <div className="loading" role="status"><span className="spinner"/>Searching public listings…</div>
      : initialQuery ? <div className="search-result-sections">
        {sections.map((section) => <section key={section.key} className="content-stack">
          <div className="section-header compact-header"><div><p className="eyebrow">{section.title.toUpperCase()}</p><h2>{section.title}</h2></div></div>
          {errors[section.key] ? <div className="alert error" role="alert">{errors[section.key]}<button className="button secondary small" type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry search</button></div>
            : results[section.key].length ? <div className="search-result-list">{results[section.key].map((item) => <button className="info-card" key={item.id} type="button" onClick={() => onNavigate(section.getPath(item))}>
              <strong>{section.getTitle(item) || 'Untitled listing'}</strong>
              <span>{item.city || item.location || item.type || item.category || item.description || ''}</span>
            </button>)}</div>
              : <p className="muted">No matching {section.title.toLowerCase()}.</p>}
        </section>)}
        {!hasResults && !Object.keys(errors).length && <div className="empty panel"><strong>No results found</strong><span>Try a different search term or browse the public listings.</span></div>}
      </div> : <div className="empty panel"><strong>Search public listings</strong><span>Enter an event, vendor, service, category, or location above.</span></div>}
  </div></main>;
}

function VendorApplicationPage({ user, onNavigate }) {
  const [application, setApplication] = useState(null);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ businessName: '', categoryId: '', city: '', description: '' });
  const [loading, setLoading] = useState(Boolean(user));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!user || !['customer', 'organizer'].includes(user.role)) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    Promise.allSettled([api('/platform/vendor-application'), api('/platform/categories')]).then(([applicationResult, categoryResult]) => {
      if (!active) return;
      if (applicationResult.status === 'rejected') {
        setError(applicationResult.reason?.message || 'Unable to load vendor application details.');
        return;
      }
      const applicationResponse = applicationResult.value;
      const categoryResponse = categoryResult.status === 'fulfilled' ? categoryResult.value : null;
      const current = applicationResponse?.data && !Array.isArray(applicationResponse.data) ? applicationResponse.data : null;
      setApplication(current);
      setCategories(Array.isArray(categoryResponse?.data) ? categoryResponse.data : []);
      if (categoryResult.status === 'rejected') setCategoryError(categoryResult.reason?.message || 'Service categories are unavailable.');
      if (current) {
        setForm({
          businessName: current.business_name || '',
          categoryId: current.category_id ? String(current.category_id) : '',
          city: current.city || '',
          description: current.description || '',
        });
      }
      setError('');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [user]);

  async function submitApplication(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api('/platform/vendor-application', {
        method: 'POST',
        body: JSON.stringify({
          businessName: form.businessName.trim(),
          categoryId: form.categoryId || null,
          city: form.city.trim(),
          description: form.description.trim(),
        }),
      });
      if (response?.data?.verificationStatus === 'pending') {
        setApplication({ ...response.data, business_name: form.businessName.trim() });
      }
      setNotice(response?.message || 'Your application was submitted for review.');
    } catch (issue) {
      setError(issue.message || 'Unable to submit your vendor application.');
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <main className="page-shell"><div className="content-stack"><div className="empty panel"><strong>Sign in to apply as a vendor</strong><span>Vendor applications are linked to your EventFlow account and reviewed before approval.</span><button className="button" type="button" onClick={() => { sessionStorage.setItem('eventhub_after_login', '/vendor-application'); onNavigate('/login'); }}>Sign in</button><button className="button secondary" type="button" onClick={() => onNavigate('/register?role=vendor')}>Create a vendor account</button></div></div></main>;
  if (user.role === 'vendor') return <main className="page-shell"><div className="empty panel"><strong>Vendor account</strong><span>Manage your vendor profile and application status from your dashboard.</span><button className="button" type="button" onClick={() => onNavigate('/vendor/dashboard')}>Open vendor dashboard</button></div></main>;
  if (user.role === 'admin') return <main className="page-shell"><div className="empty panel"><strong>Admin account</strong><span>Vendor approval and role management remain with the admin dashboard.</span><button className="button" type="button" onClick={() => onNavigate('/admin')}>Open admin dashboard</button></div></main>;
  if (!['customer', 'organizer'].includes(user.role)) return <main className="page-shell"><div className="alert error">This account is not eligible to submit a vendor application.</div></main>;

  return <main className="page-shell"><div className="content-stack vendor-application-page">
    <div className="section-header"><div><p className="eyebrow">VENDOR ONBOARDING</p><h1>Apply to become a vendor</h1><p className="muted">Applications are reviewed by the EventFlow team. Submitting this form does not grant vendor access.</p></div></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {categoryError && <div className="alert warning" role="status">{categoryError} You may submit without selecting a category.</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {loading ? <div className="loading" role="status"><span className="spinner"/>Loading application status…</div>
      : application?.verification_status === 'pending' ? <section className="panel vendor-application-status"><span className="pill pending">Pending review</span><h2>{application.business_name}</h2><p>Your application is already with our review team. You can’t submit another application while this one is pending.</p>{application.category_name && <p>Category: {application.category_name}</p>}</section>
        : application?.verification_status === 'verified' ? <section className="panel vendor-application-status"><span className="pill verified">Approved</span><h2>{application.business_name}</h2><p>Your vendor profile has been approved. Vendor permissions are not granted automatically; contact an administrator if your account role has not been updated.</p></section>
          : <form className="panel vendor-application-form" onSubmit={submitApplication}>
            {application?.verification_status === 'rejected' && <p className="alert error">Previous application was not approved: {application.verification_reason || 'No reason was provided.'} You may update the details and resubmit.</p>}
            <label className="field"><span>Business name</span><input name="businessName" minLength="2" maxLength="160" required value={form.businessName} onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))}/></label>
            <label className="field"><span>Service category</span><select name="categoryId" value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}><option value="">Select a category (optional)</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="field"><span>City or service area</span><input name="city" maxLength="120" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}/></label>
            <label className="field"><span>Business description</span><textarea name="description" rows="4" maxLength="1500" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}/></label>
            <button type="submit" className="button" disabled={busy || loading}>{busy ? 'Submitting…' : application?.verification_status === 'rejected' ? 'Resubmit application' : 'Submit application'}</button>
          </form>}
  </div></main>;
}

function PublicOverview({ user, currentPath, onNavigate, onLogout }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [vendors, setVendors] = useState([]);
  const [services, setServices] = useState([]);
  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState({});
  const [retryKey, setRetryKey] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchError, setSearchError] = useState('');
  const [requestService, setRequestService] = useState(null);
  const touchStartX = useRef(null);

  const featureSlides = useMemo(() => [
    { title: t('weddingPlanning'), image: 'https://images.unsplash.com/photo-1520854221256-17451cc331bf?auto=format&fit=crop&w=1200&q=80', description: t('weddingPlanningCopy') },
    { title: t('corporateEvents'), image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80', description: t('corporateEventsCopy') },
    { title: t('birthdayCelebrations'), image: 'https://images.unsplash.com/photo-1469371670807-013ccf25f16a?auto=format&fit=crop&w=1200&q=80', description: t('birthdayCelebrationsCopy') },
  ], [language]);

  const categoryExamples = [
    { name: t('weddings'), image: 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&w=900&q=80' },
    { name: t('catering'), image: 'https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=900&q=80' },
    { name: t('photography'), image: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=900&q=80' },
    { name: t('decorStyling'), image: 'https://images.unsplash.com/photo-1519167758481-83f550bbeb3b?auto=format&fit=crop&w=900&q=80' },
  ];
  const categoryCards = categories.slice(0, 4).map((category, index) => ({
    ...category,
    image: category.image || categoryExamples[index % categoryExamples.length].image,
    path: `/categories/${encodeURIComponent(category.slug || category.name)}`,
  }));
  const categoryChips = ['Weddings', 'Corporate', 'Graduations', 'Catering', 'Decor', 'Photography'].map((name) => {
    const category = categories.find((item) => `${item.name} ${item.slug}`.toLowerCase().includes(name.toLowerCase()));
    return {
      name: category?.name || name,
      path: category
        ? `/categories/${encodeURIComponent(category.slug || category.name)}`
        : `/categories?search=${encodeURIComponent(name)}`,
    };
  });

  useEffect(() => {
    const controller = new AbortController();
    async function loadLandingData() {
      setLoading(true);
      const results = await Promise.allSettled([
        api('/about/homepage-statistics', { signal: controller.signal }),
        api('/platform/categories', { signal: controller.signal }),
        api('/platform/vendors?page=1&limit=4&sort=recommended', { signal: controller.signal }),
        api('/platform/services?page=1&limit=4&sort=recommended', { signal: controller.signal }),
        api('/platform/events?page=1&limit=3&sort=upcoming', { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;

      const [statisticsResult, categoriesResult, vendorsResult, servicesResult, eventsResult] = results;
      const nextErrors = {};
      const getData = (result, key) => {
        if (result.status === 'rejected') {
          nextErrors[key] = result.reason?.message || `Unable to load ${key}.`;
          return null;
        }
        return result.value?.data;
      };
      const statistics = getData(statisticsResult, 'statistics');
      const categoryData = getData(categoriesResult, 'categories');
      const vendorData = getData(vendorsResult, 'vendors');
      const serviceData = getData(servicesResult, 'services');
      const eventData = getData(eventsResult, 'events');
      setSummary(statistics && typeof statistics === 'object' ? statistics : null);
      setCategories(Array.isArray(categoryData) ? categoryData : []);
      setVendors(Array.isArray(vendorData) ? vendorData : []);
      setServices(Array.isArray(serviceData) ? serviceData : []);
      setEvents(Array.isArray(eventData) ? eventData : []);
      setLoadErrors(nextErrors);
      setLoading(false);
    }

    loadLandingData();
    return () => controller.abort();
  }, [retryKey]);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion || carouselPaused) return undefined;
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % featureSlides.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [featureSlides.length, carouselPaused]);

  const displayVendors = vendors.slice(0, 4);
  const displayServices = services.slice(0, 4);
  const displayEvents = events.slice(0, 3);
  const stats = summary ? [
    { label: 'Average vendor rating', value: summary.averageVendorRating },
    { label: 'Confirmed or completed bookings', value: summary.confirmedOrCompletedBookingCount },
    { label: 'Approved active vendors', value: summary.activeVendorCount },
    { label: 'Published or completed events', value: summary.publishedEventCount },
    { label: 'Completed bookings', value: summary.completedBookingCount },
  ].filter((stat) => stat.value !== null && stat.value !== undefined) : [];

  function submitSearch(event) {
    event.preventDefault();
    const query = searchTerm.trim();
    if (!query) {
      setSearchError('Enter a search term to find events, vendors, services, categories, or locations.');
      return;
    }
    setSearchError('');
    onNavigate(`/search?q=${encodeURIComponent(query)}`);
  }

  function moveSlide(direction) {
    setActiveSlide((current) => (current + direction + featureSlides.length) % featureSlides.length);
  }

  function becomeVendor() {
    if (!user) {
      onNavigate('/register?role=vendor');
    } else if (user.role === 'vendor') {
      onNavigate('/vendor/dashboard');
    } else if (user.role === 'admin') {
      onNavigate('/admin');
    } else {
      onNavigate('/vendor-application');
    }
  }

  return <>
    <AppHeader user={user} currentPath={currentPath || '/'} onNavigate={onNavigate} onLogout={onLogout} onOpenLogin={() => onNavigate('/login')} onOpenRegister={() => onNavigate('/register')} />
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
          <form className="hero-search" role="search" onSubmit={submitSearch}>
            <input type="search" maxLength="120" value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setSearchError(''); }} placeholder={t('searchAll')} aria-label={t('searchAll')} />
            <button type="submit">{t('search')}</button>
          </form>
          {searchError && <p className="hero-search-error" role="alert">{searchError}</p>}
          <div className="chip-row">
            {categoryChips.map((item) => <button key={item.name} type="button" className="chip" onClick={() => onNavigate(item.path)}>{item.name}</button>)}
          </div>
        </div>

        <div className="hero-visual reveal reveal-right is-visible">
          <div className="hero-visual-card hero-card-main" role="group" aria-label="Venue inspiration">
            <img src="https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80" alt="Decorated event venue inspiration" loading="eager" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
            <div className="hero-overlay-card">
              <span>VENUE INSPIRATION</span>
              <strong>Explore event venues</strong>
              <small>Browse real, verified venue vendors and services.</small>
              <button type="button" className="button small" onClick={() => onNavigate('/vendors?search=venue')}>Browse venues</button>
            </div>
          </div>
        </div>
      </section>

      <Reveal className="stat-strip" direction="up">
        {loading ? <div className="home-stat-skeletons" role="status" aria-label="Loading homepage statistics"><span/><span/><span/><span/></div>
          : loadErrors.statistics ? <div className="home-data-error" role="alert"><span>Statistics are temporarily unavailable.</span><button type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry</button></div>
            : stats.map(({ label, value }) => <div key={label} className="stat-pill"><strong>{label.toLowerCase().includes('rating') ? `${Number(value).toFixed(1)}/5` : Number(value).toLocaleString()}</strong><span>{label}</span></div>)}
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('popularCategories')}</p>
            <h2>{t('exploreServicesByType')}</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/categories')}>{t('browseAll')}</button>
        </div>
        {loadErrors.categories && <div className="home-data-error" role="alert">{loadErrors.categories}<button type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry</button></div>}
        <div className="category-grid">
          {loading ? <div className="home-card-skeletons" role="status" aria-label="Loading popular categories"><span/><span/><span/><span/></div>
            : !loadErrors.categories && !categories.length
            ? <div className="empty-card">No public categories are available right now. <button type="button" className="button secondary small" onClick={() => onNavigate('/categories')}>Browse categories</button></div>
            : categoryCards.map((category) => (
            <button key={category.name} type="button" className="category-card" onClick={() => onNavigate(category.path)}>
              <img src={category.image} alt={category.name} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
              <span>{category.name}</span>
            </button>
          ))}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
              <p className="eyebrow">EVENT INSPIRATION</p>
            <h2>{t('eventInspiration')}</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/events')}>{t('viewAll')}</button>
        </div>

        <div className="carousel-shell" onMouseEnter={() => setCarouselPaused(true)} onMouseLeave={() => setCarouselPaused(false)} onFocusCapture={() => setCarouselPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCarouselPaused(false); }} onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => {
          if (touchStartX.current === null) return;
          const delta = event.changedTouches[0]?.clientX - touchStartX.current;
          if (Math.abs(delta) > 40) moveSlide(delta < 0 ? 1 : -1);
          touchStartX.current = null;
        }} onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); moveSlide(-1); }
          if (event.key === 'ArrowRight') { event.preventDefault(); moveSlide(1); }
        }} tabIndex="0" aria-label="Event inspiration carousel. Use the arrow keys to change slides.">
          <button type="button" className="carousel-control" aria-label="Previous slide" onClick={() => moveSlide(-1)}>{'‹'}</button>
          <div className="carousel-stage" aria-live="polite">
            {featureSlides.map((slide, index) => (
              <article key={slide.title} className={`slideshow-card ${index === activeSlide ? 'active' : ''}`}>
                <img src={slide.image} alt={slide.title} loading={index === activeSlide ? 'eager' : 'lazy'} onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                <div className="slideshow-content">
                  <p>{slide.title}</p>
                  <span>{slide.description}</span>
                  {index === activeSlide && <button type="button" className="button small" onClick={() => onNavigate('/events')}>Explore published events</button>}
                </div>
              </article>
            ))}
          </div>
          <button type="button" className="carousel-control" aria-label="Next slide" onClick={() => moveSlide(1)}>{'›'}</button>
        </div>
        <div className="carousel-dots" aria-label="slide navigation">
          {featureSlides.map((slide, index) => <button key={slide.title} type="button" className={index === activeSlide ? 'dot active' : 'dot'} aria-label={`Go to slide ${index + 1}`} aria-pressed={index === activeSlide} onClick={() => setActiveSlide(index)} />)}
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
        {loadErrors.vendors && <div className="home-data-error" role="alert">{loadErrors.vendors}<button type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry</button></div>}
        <div className="card-grid">
          {loading ? <div className="home-card-skeletons" role="status" aria-label="Loading featured vendors"><span/><span/><span/><span/></div>
            : displayVendors.length ? displayVendors.map((vendor) => {
              const vendorName = vendor.business_name || vendor.name || 'Vendor';
              const quoteService = Array.isArray(vendor.services) ? vendor.services.find((service) => service && service.published !== false && service.visibility !== 'private') : null;
              return (
            <article key={vendor.id} className="vendor-card">
              <div className="card-image-wrap">
                <img src={vendor.image || vendor.logo || 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=900&q=80'} alt={vendorName} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                {vendor.verified && <span className="verify-badge">{t('verified')}</span>}
              </div>
              <div className="card-body">
                <div className="meta-row"><span>{vendor.category || 'Event Services'}</span>{vendor.reviewCount > 0 && Number.isFinite(Number(vendor.rating)) && <span>★ {Number(vendor.rating).toFixed(1)}</span>}</div>
                <h3>{vendorName}</h3>
                <p>{vendor.description || vendor.city || vendor.location || translateText('Service area available', language)}</p>
                <div className="card-actions">
                  <button className="button secondary small" type="button" onClick={() => onNavigate(vendor.id ? `/vendors/${encodeURIComponent(vendor.id)}` : '/vendors')}>{t('viewProfile')}</button>
                  <button className="button small" type="button" onClick={() => quoteService ? setRequestService(quoteService) : onNavigate(`/vendors/${encodeURIComponent(vendor.id)}`)}>Request Quote</button>
                </div>
              </div>
            </article>
          );}) : loadErrors.vendors ? null : <div className="empty-card">{t('noVendorProfiles')} <button type="button" className="button secondary small" onClick={() => onNavigate('/vendors')}>Browse vendors</button></div>}
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
        {loadErrors.services && <div className="home-data-error" role="alert">{loadErrors.services}<button type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry</button></div>}
        <div className="card-grid">
          {loading ? <div className="home-card-skeletons" role="status" aria-label="Loading popular services"><span/><span/><span/><span/></div>
            : displayServices.length ? displayServices.map((service) => (
            <article key={service.id} className="service-card">
              <div className="card-image-wrap">
                <img src={service.image || service.coverImage || 'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=900&q=80'} alt={service.title} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
              </div>
              <div className="card-body">
                <div className="meta-row"><span>{service.category || 'Event service'}</span>{service.reviewCount > 0 && Number.isFinite(Number(service.rating)) && <span>★ {Number(service.rating).toFixed(1)}</span>}</div>
                <h3>{service.title}</h3>
                <p>{service.description || service.vendorName || 'Service details available on request.'}</p>
                <div className="pricing-row">
                  <strong>{service.price !== null && service.price !== undefined ? `${service.currency || 'ETB'} ${Number(service.price).toLocaleString()}` : t('requestQuote')}</strong>
                  <button type="button" className="button small" onClick={() => setRequestService(service)}>Request Service</button>
                </div>
                <button type="button" className="button secondary small" onClick={() => onNavigate(`/services/${encodeURIComponent(service.id)}`)}>View Details</button>
              </div>
            </article>
          )) : loadErrors.services ? null : <div className="empty-card">{t('noServicesPublished')} <button type="button" className="button secondary small" onClick={() => onNavigate('/services')}>Browse services</button></div>}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('publicEventDiscovery')}</p>
            <h2>{t('eventsNextMoment')}</h2>
          </div>
          <button type="button" className="button secondary small" onClick={() => onNavigate('/events')}>{t('viewAll')}</button>
        </div>
        {loadErrors.events && <div className="home-data-error" role="alert">{loadErrors.events}<button type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry</button></div>}
        <div className="event-grid">
          {loading ? <div className="home-card-skeletons" role="status" aria-label="Loading public events"><span/><span/><span/><span/></div>
            : displayEvents.length ? displayEvents.map((event) => (
            <article key={event.id} className="event-card">
              <img src={event.coverImage || event.image || 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=900&q=80'} alt={event.title} loading="lazy" onError={(imageEvent) => { imageEvent.currentTarget.style.display = 'none'; }} />
              <div className="event-content">
                <span className="event-tag">{event.type || 'Event'}</span>
                <h3>{event.title}</h3>
                <p>{formatEventDate(event.startDate || event.date, language) || translateText('Date available', language)}</p>
                <small>{[event.venue, event.location || event.city].filter(Boolean).join(' · ') || t('locationAvailable')}</small>
                <div className="card-actions">
                  <button type="button" className="button secondary small" onClick={() => onNavigate(`/events/${encodeURIComponent(event.id)}`)}>{t('viewDetails')}</button>
                  <button type="button" className="button small" onClick={() => onNavigate(`/events/${encodeURIComponent(event.id)}`)}>Book Now</button>
                </div>
              </div>
            </article>
          )) : loadErrors.events ? null : <div className="empty-card">{t('noPublicEvents')} <button type="button" className="button secondary small" onClick={() => onNavigate('/events')}>Explore events</button></div>}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="process-grid">
          {[
            ['1', t('discover'), t('discoverCopy')],
            ['2', t('compare'), t('compareCopy')],
            ['3', t('bookStep'), t('bookCopy')],
          ].map(([step, title, copy]) => (
            <button type="button" key={step} className="process-card" onClick={() => onNavigate(step === '1' ? '/vendors' : step === '2' ? '/services' : '/events')}>
              <span className="process-number">{step}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
              <span className="process-card-action">{step === '1' ? 'Explore vendors' : step === '2' ? 'Browse services' : 'Find events'}</span>
            </button>
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
            <button className="button pale" onClick={becomeVendor}>{user?.role === 'vendor' ? 'Open vendor dashboard' : t('becomeVendor')}</button>
          </div>
        </div>
      </Reveal>
    </main>
    <AppFooter />
    <BackToTopButton />
    {requestService && <QuoteRequestModal service={requestService} user={user} onNavigate={onNavigate} onClose={() => setRequestService(null)} />}
  </>;
}

function PublicPageLayout({ currentPath, user, onNavigate, onLogout, children }) {
  return <><AppHeader user={user} currentPath={currentPath} onNavigate={onNavigate} onLogout={onLogout} onOpenLogin={() => onNavigate('/login')} onOpenRegister={() => onNavigate('/register')} />{children}<AppFooter /></>;
}

function EventsPage({ onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const initialQuery = new URLSearchParams(window.location.search);
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
  const [search, setSearch] = useState(initialQuery.get('search') || '');
  const [location, setLocation] = useState(initialQuery.get('location') || '');
  const [category, setCategory] = useState(initialQuery.get('category') || '');
  const [startDate, setStartDate] = useState(initialQuery.get('startDate') || '');
  const [endDate, setEndDate] = useState(initialQuery.get('endDate') || '');
  const [minPrice, setMinPrice] = useState(initialQuery.get('minPrice') || '');
  const [maxPrice, setMaxPrice] = useState(initialQuery.get('maxPrice') || '');
  const [eventStatus, setEventStatus] = useState(initialQuery.get('status') || '');
  const [sort, setSort] = useState(initialQuery.get('sort') || 'upcoming');
  const [page, setPage] = useState(Math.max(1, Number(initialQuery.get('page')) || 1));
  const [filtersOpen, setFiltersOpen] = useState(false);
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
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
        if (minPrice) params.set('minPrice', minPrice);
        if (maxPrice) params.set('maxPrice', maxPrice);
        if (eventStatus) params.set('status', eventStatus);
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
  }, [search, location, category, startDate, endDate, minPrice, maxPrice, eventStatus, sort, page, reloadKey]);

  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({
      search: search.trim(), location, category, startDate, endDate, minPrice, maxPrice, status: eventStatus,
    })) {
      if (value) params.set(key, value);
    }
    if (sort !== 'upcoming') params.set('sort', sort);
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [search, location, category, startDate, endDate, minPrice, maxPrice, eventStatus, sort, page]);

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
    onNavigate(`/events/${encodeURIComponent(eventId)}`);
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
    setStartDate('');
    setEndDate('');
    setMinPrice('');
    setMaxPrice('');
    setEventStatus('');
    setSort('upcoming');
    setPage(1);
  }

  const activeFilters = [
    search.trim() && `Search: ${search.trim()}`,
    location && `Location: ${location}`,
    category && `Category: ${category}`,
    startDate && `From: ${startDate}`,
    endDate && `To: ${endDate}`,
    minPrice && `Min ETB ${minPrice}`,
    maxPrice && `Max ETB ${maxPrice}`,
    eventStatus && `Status: ${eventStatus}`,
  ].filter(Boolean);

  return <main className="page-shell"><div className="content-stack"><nav className="event-breadcrumb" aria-label="Breadcrumb"><button type="button" onClick={() => onNavigate('/')}>{t('homeNav')}</button><span>/</span><strong>Events</strong></nav><div className="section-header"><div><p className="eyebrow">EVENTS</p><h2>{t('upcomingExperiences')}</h2><p className="muted">{t('pageDescription')}</p></div><button className="button secondary" type="button" onClick={planEvent}>{t('planMyEvent')}</button></div>
    <div className="panel event-filter-panel">
      <button className="button secondary event-filter-toggle" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>Filters {filtersOpen ? '−' : '+'}</button>
      <div className={`toolbar stacked-toolbar ${filtersOpen ? 'is-open' : ''}`}>
        <input className="field-input" aria-label={t('searchEvents')} maxLength={120} value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder={t('searchEvents')} />
        <select className="filter-select" aria-label={t('allLocations')} value={location} onChange={(event) => { setPage(1); setLocation(event.target.value); }}>
          <option value="">{t('allLocations')}</option><option value="Addis Ababa">Addis Ababa</option><option value="Bahir Dar">Bahir Dar</option><option value="Hawassa">Hawassa</option><option value="Dire Dawa">Dire Dawa</option>
        </select>
        <select className="filter-select" aria-label={t('allCategories')} value={category} onChange={(event) => { setPage(1); setCategory(event.target.value); }}>
          <option value="">{t('allCategories')}</option>
          {categoryOptions.map((value) => <option key={value} value={value.toLowerCase()}>{t(value.toLowerCase()) === value.toLowerCase() ? value : t(value.toLowerCase())}</option>)}
        </select>
        <select className="filter-select" aria-label={t('upcoming')} value={sort} onChange={(event) => { setPage(1); setSort(event.target.value); }}>
          <option value="upcoming">{t('upcoming')}</option><option value="latest">{t('latest')}</option><option value="recent">Newest first</option><option value="price_asc">Price: Low to High</option><option value="price_desc">Price: High to Low</option><option value="alphabetical">{t('alphabetical')}</option>
        </select>
        <input className="filter-select" aria-label="Start date" type="date" value={startDate} onChange={(event) => { setPage(1); setStartDate(event.target.value); }} />
        <input className="filter-select" aria-label="End date" type="date" value={endDate} onChange={(event) => { setPage(1); setEndDate(event.target.value); }} />
        <input className="filter-select" aria-label="Minimum ticket price" type="number" min="0" placeholder="Min price" value={minPrice} onChange={(event) => { setPage(1); setMinPrice(event.target.value); }} />
        <input className="filter-select" aria-label="Maximum ticket price" type="number" min="0" placeholder="Max price" value={maxPrice} onChange={(event) => { setPage(1); setMaxPrice(event.target.value); }} />
        <select className="filter-select" aria-label="Event availability" value={eventStatus} onChange={(event) => { setPage(1); setEventStatus(event.target.value); }}>
          <option value="">All availability</option><option value="upcoming">Upcoming</option><option value="available">Available</option><option value="free">Free</option><option value="paid">Paid</option>
        </select>
        <button type="button" className="button secondary small" onClick={resetFilters}>Clear Filters</button>
      </div>
      {activeFilters.length > 0 && <div className="event-active-filters" aria-label="Active filters">
        <span>Active filters:</span>{activeFilters.map((filter) => <span className="event-filter-chip" key={filter}>{filter}</span>)}
      </div>}
    </div>

    {!loading && !error && <p className="event-results-count" role="status">{pagination.total} events found</p>}
    {loading ? <div className="loading" role="status"><span className="spinner" />{t('loadingEvents')}</div> : error ? <div className="alert error" role="alert">{error}<button type="button" className="button secondary small" onClick={() => setReloadKey((current) => current + 1)}>{t('retry')}</button></div> : <>
      {events.length ? <>
        <div className="card-grid event-list-grid">
          {events.map((event) => <article key={event.id} className="info-card event-tile">
            <div className="event-thumb" aria-hidden="true">{event.coverImage && <img src={event.coverImage} alt="" loading="lazy" onError={(imageEvent) => { imageEvent.currentTarget.style.display = 'none'; }} />}<span>{event.type || 'Event'}</span></div>
            <div className="event-tile-body">
              <span className="event-tag">{event.type || 'Event'}</span><h3>{event.title}</h3>
              <p>{[event.venue, event.location].filter(Boolean).join(', ') || t('locationTbd')}</p>
              <small>{formatEventDate(event.startDate, language) || t('dateTbd')}</small>
              <div className="pricing-row compact-row"><strong>{event.startingPrice === null || event.startingPrice === undefined ? 'Tickets unavailable' : Number(event.startingPrice) === 0 ? 'Free' : formatEventBudget(event.startingPrice, language)}</strong><button type="button" className="button secondary small" onClick={() => viewDetails(event.id)}>{t('viewDetails')}</button><button type="button" className="button small" onClick={() => viewDetails(event.id)}>Book Now</button></div>
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

function QuoteRequestModal({ service, user, onNavigate, onClose }) {
  const [form, setForm] = useState({ guestCount: '', budget: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!user) {
      sessionStorage.setItem('eventhub_after_login', window.location.pathname);
      onNavigate('/login');
      return;
    }
    if (!['customer', 'organizer'].includes(user.role)) {
      setError('Only customer and organizer accounts can request quotes.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = {
        serviceId: service.id,
        ...(form.guestCount ? { guestCount: Number(form.guestCount) } : {}),
        ...(form.budget ? { budget: Number(form.budget) } : {}),
        notes: form.notes.trim(),
      };
      await api('/platform/service-quote-requests', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSuccess('Your request was sent to the vendor. Track its status in your dashboard quotations.');
    } catch (issue) {
      setError(issue.message || 'Unable to send the quote request.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <form className="modal" role="dialog" aria-modal="true" aria-labelledby="quote-request-title" onSubmit={submit}>
      <div className="modal-head"><h2 id="quote-request-title">Request a quote</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Close" disabled={busy}><X size={18}/></button></div>
      <div className="modal-body">
        <p><strong>{service.title}</strong> · {service.vendorName}</p>
        <label className="field"><span>Guest count (optional)</span><input type="number" min="1" max="100000" step="1" value={form.guestCount} onChange={(event) => setForm((current) => ({ ...current, guestCount: event.target.value }))}/></label>
        <label className="field"><span>Budget (optional)</span><input type="number" min="0" max="100000000" step="0.01" value={form.budget} onChange={(event) => setForm((current) => ({ ...current, budget: event.target.value }))}/></label>
        <label className="field"><span>Requirements</span><textarea rows="4" maxLength="2000" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}/></label>
        {error && <div className="alert error" role="alert">{error}</div>}
        {success && <div className="alert success" role="status">{success}</div>}
      </div>
      <div className="modal-foot"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>{success ? 'Done' : 'Cancel'}</button>{!success && <button className="button" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>}</div>
    </form>
  </div>;
}

function VendorQuoteResponseForm({ quote, onResponded }) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function respond(event, status) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await api(`/platform/quotations/${quote.id}/respond`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          ...(status === 'sent' ? { amount: Number(amount) } : {}),
          notes,
        }),
      });
      onResponded(response.data);
    } catch (issue) {
      setError(issue.message || 'Unable to respond to this request.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="vendor-quote-response" onSubmit={(event) => respond(event, 'sent')}>
    {quote.notes && <small>{quote.notes}</small>}
    <label className="field"><span>Quote amount ({quote.currency || 'ETB'})</span><input type="number" min="0" max="100000000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required/></label>
    <label className="field"><span>Response details</span><textarea rows="2" maxLength="2000" value={notes} onChange={(event) => setNotes(event.target.value)}/></label>
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="card-actions"><button className="button small" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send quote'}</button><button className="button secondary small" type="button" disabled={busy} onClick={(event) => respond(event, 'declined')}>Decline</button></div>
  </form>;
}

function ServiceDetailPage({ serviceId, user, onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [service, setService] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadService() {
      setLoading(true);
      setError('');
      try {
        const response = await api(`/platform/services/${encodeURIComponent(serviceId)}`);
        if (active) setService(response.data || null);
      } catch (issue) {
        if (active) {
          setService(null);
          setError(issue.message || 'Unable to load this service.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    loadService();
    return () => { active = false; };
  }, [serviceId]);

  if (loading) return <main className="page-shell"><div className="loading" role="status"><span className="spinner"/>{t('loadingServices')}</div></main>;
  if (error || !service) return <main className="page-shell"><div className="empty panel"><strong>Service unavailable</strong><span>{error || 'This service is no longer available.'}</span><button className="button secondary" type="button" onClick={() => onNavigate('/services')}>Back to Services</button></div></main>;

  return <main className="page-shell"><div className="content-stack">
    <button className="text-action" type="button" onClick={() => onNavigate('/services')}>← Back to Services</button>
    <section className="info-card wide"><p className="eyebrow">{service.category}</p><h1>{service.title}</h1><p>{service.description}</p><div className="detail-meta-grid">
      <div><span>Provider</span><strong>{service.vendorName}</strong></div>
      <div><span>Location</span><strong>{service.city || t('locationAvailable')}</strong></div>
      <div><span>Starting price</span><strong>{service.price ? `${service.currency} ${Number(service.price).toLocaleString()}` : t('priceOnRequest')}</strong></div>
      {service.reviewCount > 0 && <div><span>Customer rating</span><strong>{Number(service.rating).toFixed(1)} / 5 ({service.reviewCount})</strong></div>}
    </div><button className="button" type="button" onClick={() => setRequestOpen(true)}>Request Service</button></section>
    <section className="panel"><div className="panel-header"><h2>Other services from this provider</h2></div>
      {service.packages?.filter((item) => item.id !== service.id).length ? <div className="card-grid">{service.packages.filter((item) => item.id !== service.id).map((item) => <article className="info-card" key={item.id}><h3>{item.title}</h3><p>{item.description || t('customServicePackage')}</p><div className="pricing-row"><strong>{item.price ? `${item.currency} ${Number(item.price).toLocaleString()}` : t('priceOnRequest')}</strong><button className="button secondary small" type="button" onClick={() => onNavigate(`/services/${item.id}`)}>View Details</button></div></article>)}</div> : <p>No other published services are listed for this provider.</p>}
    </section>
    {service.availability?.length > 0 && <section className="panel"><div className="panel-header"><h2>Availability</h2></div><div className="list-stack">{service.availability.map((entry) => <div className="list-card" key={String(entry.date)}><strong>{String(entry.date).slice(0, 10)}</strong><span>{entry.status}</span></div>)}</div></section>}
    <section className="panel"><div className="panel-header"><h2>Customer reviews</h2></div>
      {service.reviews?.length ? <div className="list-stack">{service.reviews.map((review, index) => <article className="list-card" key={`${review.createdAt}-${index}`}><div><strong>{review.customerName} · {'★'.repeat(review.rating)}</strong><small>{review.comment || 'Rating submitted'}</small></div></article>)}</div> : <p>No published reviews are available for this service yet.</p>}
    </section>
  </div>{requestOpen && <QuoteRequestModal service={service} user={user} onNavigate={onNavigate} onClose={() => setRequestOpen(false)}/>}</main>;
}

function VendorDetailPage({ vendorId, user, onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestService, setRequestService] = useState(null);

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
          <p>{vendor.verified ? t('verifiedBusinessProfile') : t('publicListing')}{vendor.reviewCount > 0 ? ` • ${vendor.reviewCount} ${t('vendorReviews')} • ★ ${Number(vendor.rating).toFixed(1)}` : ''}</p>
        </div>
        {vendor.services?.some((service) => service.published !== false && service.visibility !== 'private') && <button className="button" type="button" onClick={() => setRequestService(vendor.services.find((service) => service.published !== false && service.visibility !== 'private'))}>Request Quote</button>}
      </div>
      <div className="report-grid" style={{ marginTop: '18px' }}>
        <div className="info-card"><h3>{t('about')}</h3><p>{vendor.description || translateText('A trusted event partner helping clients plan memorable experiences.', language)}</p></div>
        <div className="info-card"><h3>{t('startingFrom')}</h3><p>{vendor.priceFrom ? `ETB ${Number(vendor.priceFrom).toLocaleString()}` : t('priceOnRequest')}</p></div>
        <div className="info-card"><h3>{t('location')}</h3><p>{vendor.city || t('serviceAreaRequest')}</p></div>
      </div>
    </article>

    <section className="content-stack">
      <div className="section-header compact-header"><div><p className="eyebrow">{t('publishedServices')}</p><h2>{t('availableServicePackages')}</h2></div></div>
      {Array.isArray(vendor.services) && vendor.services.length ? <div className="card-grid">{vendor.services.filter((service) => service && service.published !== false && service.visibility !== 'private').map((service) => <article key={service.id} className="info-card"><h3>{service.title}</h3><p>{service.description || t('customServicePackage')}</p><div className="pricing-row"><strong>{service.price ? `ETB ${Number(service.price).toLocaleString()}` : t('requestQuote')}</strong><button className="button secondary small" type="button" onClick={() => setRequestService(service)}>Request Quote</button></div></article>)}</div> : <div className="empty-card">{t('noPublishedServices')}</div>}
    </section>
    {vendor.reviews?.length > 0 && <section className="panel"><div className="panel-header"><h3>Customer reviews</h3></div><div className="list-stack">{vendor.reviews.map((review, index) => <article className="list-card" key={`${review.createdAt}-${index}`}><div><strong>{review.customerName} · {'★'.repeat(review.rating)}</strong><small>{review.comment || 'Rating submitted'}</small></div></article>)}</div></section>}
    {Array.isArray(vendor.availability) && vendor.availability.length > 0 && <section className="panel"><div className="panel-header"><h3>Availability</h3></div><div className="list-stack">{vendor.availability.map((entry) => <div className="list-card" key={entry.date}><strong>{String(entry.date).slice(0, 10)}</strong><span>{entry.status}</span></div>)}</div></section>}
  </div>{requestService && <QuoteRequestModal service={requestService} user={user} onNavigate={onNavigate} onClose={() => setRequestService(null)}/>}</main>;
}

function VendorsPage({ onNavigate, user }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [vendors, setVendors] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [category, setCategory] = useState(() => new URLSearchParams(window.location.search).get('category') || 'all');
  const [location, setLocation] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('recommended');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: 12 });
  const [notice, setNotice] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [filterError, setFilterError] = useState('');
  const [requestService, setRequestService] = useState(null);

  const fetchVendors = useCallback(async (nextPage, nextFilters) => {
    setLoading(true);
    setNotice('');
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: '12', sort: nextFilters.sort || 'recommended' });
      if (nextFilters.search) params.set('search', nextFilters.search);
      if (nextFilters.category && nextFilters.category !== 'all') params.set('category', nextFilters.category);
      if (nextFilters.location && nextFilters.location !== 'all') params.set('location', nextFilters.location);
      if (nextFilters.minPrice) params.set('minPrice', nextFilters.minPrice);
      if (nextFilters.maxPrice) params.set('maxPrice', nextFilters.maxPrice);
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
  }, []);

  useEffect(() => {
    let active = true;
    async function loadCategories() {
      try {
        const response = await api('/platform/categories');
        if (active) setCategoryOptions(Array.isArray(response.data) ? response.data : []);
      } catch (issue) {
        if (active) {
          setCategoryOptions([]);
          setCategoryError(issue.message || 'Unable to load vendor category filters.');
        }
      }
    }
    loadCategories();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (minPrice && maxPrice && Number(maxPrice) < Number(minPrice)) {
      setLoading(false);
      setFilterError('Maximum price must be greater than or equal to minimum price.');
      return;
    }
    setFilterError('');
    fetchVendors(page, { search, category, location, minPrice, maxPrice, sort });
  }, [fetchVendors, page, search, category, location, minPrice, maxPrice, sort]);

  const categories = Array.from(new Set(vendors.map((vendor) => vendor.category).filter(Boolean))).sort();
  const locations = Array.from(new Set(vendors.map((vendor) => vendor.city).filter(Boolean))).sort();

  const handleQuoteRequest = (vendorRecord) => {
    const selectedService = Array.isArray(vendorRecord?.services) ? vendorRecord.services.find((service) => service && service.published !== false && service.visibility !== 'private') : null;
    if (selectedService) setRequestService(selectedService);
    else setNotice('This vendor has no published services available for a quote request.');
  };

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{t('vendorsEyebrow')}</p><h2>{t('vendorsHeading')}</h2></div></div>
    {notice && <div className="alert success">{notice}</div>}
    {categoryError && <div className="alert error" role="alert">{categoryError}</div>}
    {filterError && <div className="alert error" role="alert">{filterError}</div>}
    <div className="panel" style={{ padding: '18px 20px' }}>
      <div className="toolbar">
        <div className="search-box"><Search size={16}/><input aria-label={t('searchVendors')} value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder={t('searchVendors')} /></div>
        <select className="filter-select" value={category} onChange={(event) => { setPage(1); setCategory(event.target.value); }}>
          <option value="all">{t('allCategories')}</option>
          {(categoryOptions.length ? categoryOptions.map((item) => item.name) : categories).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="filter-select" value={location} onChange={(event) => { setPage(1); setLocation(event.target.value); }}>
          <option value="all">{t('allLocations')}</option>
          {locations.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <input className="filter-select" aria-label="Minimum vendor price" type="number" min="0" value={minPrice} onChange={(event) => { setPage(1); setMinPrice(event.target.value); }} placeholder="Min price" />
        <input className="filter-select" aria-label="Maximum vendor price" type="number" min="0" value={maxPrice} onChange={(event) => { setPage(1); setMaxPrice(event.target.value); }} placeholder="Max price" />
        <select className="filter-select" value={sort} onChange={(event) => { setPage(1); setSort(event.target.value); }}>
          <option value="recommended">{t('recommended')}</option>
          <option value="highest-rated">{t('highestRated')}</option>
          <option value="most-reviewed">{t('mostReviewed')}</option>
          <option value="price-low">{t('priceLowHigh')}</option>
          <option value="price-high">{t('priceHighLow')}</option>
        </select>
        <button type="button" className="button secondary small" onClick={() => { setPage(1); setSearch(''); setCategory('all'); setLocation('all'); setMinPrice(''); setMaxPrice(''); setSort('recommended'); }}>{t('reset')}</button>
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
            <div className="meta-row"><span>{vendor.category || 'Event services'}</span>{vendor.reviewCount > 0 && <span>★ {Number(vendor.rating).toFixed(1)}</span>}</div>
            <h3>{vendor.business_name || vendor.name}</h3>
            <p>{vendor.city || t('locationAvailable')}</p><p>{vendor.description || ''}</p>
            <div className="pricing-row"><strong>{vendor.priceFrom ? `ETB ${Number(vendor.priceFrom).toLocaleString()}` : t('requestQuote')}</strong><span>{vendor.reviewCount || 0} {t('vendorReviews')}</span></div>
            <div className="card-actions">
              <button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${vendor.id}`)}>{t('viewProfile')}</button>
              <button className="button small" type="button" onClick={() => handleQuoteRequest(vendor)}>Request Quote</button>
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
  </div>{requestService && <QuoteRequestModal service={requestService} user={user} onNavigate={onNavigate} onClose={() => setRequestService(null)}/>}</main>;
}

function ServicesPage({ onNavigate, user }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [filters, setFilters] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { search: params.get('search') || '', category: params.get('category') || 'all', location: 'all', minPrice: '', maxPrice: '', sort: 'recommended' };
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [requestService, setRequestService] = useState(null);

  async function loadServices(nextFilters = filters, page = 1) {
    setLoading(true);
    setError('');
    if (nextFilters.minPrice && nextFilters.maxPrice && Number(nextFilters.maxPrice) < Number(nextFilters.minPrice)) {
      setError('Maximum price must be greater than or equal to minimum price.');
      setLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams({ page: String(page), limit: '12', sort: nextFilters.sort || 'recommended' });
      if (nextFilters.search) params.set('search', nextFilters.search);
      if (nextFilters.category && nextFilters.category !== 'all') params.set('category', nextFilters.category);
      if (nextFilters.location && nextFilters.location !== 'all') params.set('location', nextFilters.location);
      if (nextFilters.minPrice) params.set('minPrice', nextFilters.minPrice);
      if (nextFilters.maxPrice) params.set('maxPrice', nextFilters.maxPrice);
      const response = await api(`/platform/services?${params.toString()}`);
      setServices(Array.isArray(response.data) ? response.data : []);
      setPagination(response.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch (issue) {
      setServices([]);
      setError(issue.message || 'Unable to load services.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function loadCategories() {
      try {
        const response = await api('/platform/categories');
        if (active) setCategories(Array.isArray(response.data) ? response.data : []);
      } catch (issue) {
        if (active) {
          setCategories([]);
          setCategoryError(issue.message || 'Unable to load service category filters.');
        }
      }
    }
    loadCategories();
    loadServices(filters, 1);
    return () => { active = false; };
  }, []);

  const locations = Array.from(new Set(services.map((service) => service.city).filter(Boolean))).sort();
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const applyFilters = () => loadServices(filters, 1);
  const resetFilters = () => {
    const emptyFilters = { search: '', category: 'all', location: 'all', minPrice: '', maxPrice: '', sort: 'recommended' };
    setFilters(emptyFilters);
    loadServices(emptyFilters, 1);
  };

  return <main className="page-shell"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">{t('servicesEyebrow')}</p><h2>{t('servicesHeading')}</h2></div></div>
    {categoryError && <div className="alert error" role="alert">{categoryError}</div>}
    <div className="panel" style={{ padding: '18px 20px' }}><div className="toolbar stacked-toolbar">
      <input className="field-input" aria-label={t('searchServices')} value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder={t('searchServices')} />
      <select className="filter-select" aria-label={t('allCategories')} value={filters.category} onChange={(event) => updateFilter('category', event.target.value)}><option value="all">{t('allCategories')}</option>{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select>
      <select className="filter-select" aria-label={t('allLocations')} value={filters.location} onChange={(event) => updateFilter('location', event.target.value)}><option value="all">{t('allLocations')}</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select>
      <input className="filter-select" aria-label="Minimum price" type="number" min="0" value={filters.minPrice} onChange={(event) => updateFilter('minPrice', event.target.value)} placeholder="Min price" />
      <input className="filter-select" aria-label="Maximum price" type="number" min="0" value={filters.maxPrice} onChange={(event) => updateFilter('maxPrice', event.target.value)} placeholder="Max price" />
      <select className="filter-select" aria-label="Sort services" value={filters.sort} onChange={(event) => updateFilter('sort', event.target.value)}><option value="recommended">{t('recommended')}</option><option value="highest-rated">{t('highestRated')}</option><option value="price-low">{t('priceLowHigh')}</option><option value="price-high">{t('priceHighLow')}</option><option value="alphabetical">{t('alphabetical')}</option></select>
      <button type="button" className="button secondary small" onClick={resetFilters}>{t('reset')}</button><button type="button" className="button small" onClick={applyFilters}>{t('applyFilters')}</button>
    </div></div>
    {!loading && !error && <p role="status">{pagination.total || services.length} services found</p>}
    {loading ? <div className="loading" role="status"><span className="spinner"/>{t('loadingServices')}</div>
      : error ? <div className="alert error" role="alert">{error}<button type="button" className="button secondary small" onClick={() => loadServices(filters, pagination.page || 1)}>{t('retry')}</button></div>
        : services.length ? <>
          <div className="card-grid">{services.map((service) => <article key={service.id} className="info-card">
            <p className="eyebrow">{service.category}</p><h3>{service.title}</h3><p>{service.description || ''}</p>
            <p>{service.vendorName} · {service.city}</p>
            <div className="pricing-row compact-row"><strong>{service.price ? `${service.currency} ${Number(service.price).toLocaleString()}` : t('requestQuote')}</strong>{service.reviewCount > 0 && <span>{Number(service.rating).toFixed(1)}★ ({service.reviewCount})</span>}</div>
            <div className="card-actions"><button className="button secondary small" type="button" onClick={() => onNavigate(`/services/${service.id}`)}>View Details</button><button className="button small" type="button" onClick={() => setRequestService(service)}>Request Service</button></div>
          </article>)}</div>
          <div className="pagination-row" aria-label="Service pages"><button className="button secondary small" type="button" disabled={(pagination.page || 1) <= 1} onClick={() => loadServices(filters, (pagination.page || 1) - 1)}>{t('previous')}</button><span>{t('page')} {pagination.page || 1} {t('of')} {pagination.totalPages || 1}</span><button className="button secondary small" type="button" disabled={(pagination.page || 1) >= (pagination.totalPages || 1)} onClick={() => loadServices(filters, (pagination.page || 1) + 1)}>{t('next')}</button></div>
        </> : <EmptyState title={t('noServicesMatch')} message={t('emptyMessage')} />}
  </div>{requestService && <QuoteRequestModal service={requestService} user={user} onNavigate={onNavigate} onClose={() => setRequestService(null)}/>}</main>;
}

function CategoriesPage({ onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
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
  const [search, setSearch] = useState('');

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

  const query = search.trim().toLowerCase();
  const events = (category.events || []).filter((item) => `${item.title} ${item.description} ${item.location}`.toLowerCase().includes(query));
  const vendors = (category.vendors || []).filter((item) => `${item.business_name} ${item.category} ${item.city} ${item.description}`.toLowerCase().includes(query));
  const services = (category.services || []).filter((item) => `${item.title} ${item.vendorName} ${item.category} ${item.city} ${item.description}`.toLowerCase().includes(query));

  return <main className="page-shell"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">CATEGORY</p><h2>{category.name}</h2></div><button className="button secondary small" type="button" onClick={() => onNavigate('/categories')}>Back to categories</button></div>
    <div className="info-card wide"><img src={category.image} alt="" className="category-detail-image" /><div className="category-detail-copy"><p>{category.description || t('availableServiceCategory')}</p><div className="meta-row compact-row"><span>{category.eventCount || 0} events</span><span>{category.vendorCount || 0} active vendors</span><span>{category.serviceCount || 0} available services</span></div><button className="button" type="button" onClick={() => onNavigate(`/vendors?category=${encodeURIComponent(category.slug || category.name)}`)}>{t('viewVendors')}</button></div></div>
    <div className="panel"><label className="field"><span>Search related listings</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events, vendors, and services"/></label></div>
    <section className="content-stack"><div className="section-header compact-header"><div><p className="eyebrow">EVENTS</p><h3>Related events</h3></div></div>{events.length ? <div className="card-grid">{events.map((event) => <article className="info-card" key={event.id}><h3>{event.title}</h3><p>{event.location || t('locationAvailable')}</p><p>{formatEventDate(event.startDate, language)}</p><button className="button secondary small" type="button" onClick={() => onNavigate(`/events/${event.id}`)}>View event</button></article>)}</div> : <EmptyState title="No related events" message="There are no public events in this category right now."/>}</section>
    <section className="content-stack"><div className="section-header compact-header"><div><p className="eyebrow">VENDORS</p><h3>Relevant vendors</h3></div></div>{vendors.length ? <div className="card-grid">{vendors.map((vendor) => <article key={vendor.id} className="vendor-card"><div className="card-image-wrap"><img src={vendor.image || 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=900&q=80'} alt={vendor.business_name || vendor.name} loading="lazy" />{vendor.verified && <span className="verify-badge">Verified</span>}</div><div className="card-body"><div className="meta-row"><span>{vendor.category || 'Event services'}</span>{vendor.reviewCount > 0 && <span>★ {Number(vendor.rating).toFixed(1)}</span>}</div><h3>{vendor.business_name || vendor.name}</h3><p>{vendor.description || vendor.city || t('locationAvailable')}</p><div className="pricing-row"><strong>{vendor.priceFrom ? `ETB ${Number(vendor.priceFrom).toLocaleString()}` : t('requestQuote')}</strong><span>{vendor.reviewCount || 0} reviews</span></div><button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${vendor.id}`)}>{t('viewProfile')}</button></div></article>)}</div> : <EmptyState title="No vendors currently available" message="This category has no eligible vendors right now." />}</section>
    <section className="content-stack"><div className="section-header compact-header"><div><p className="eyebrow">SERVICES</p><h3>Available services</h3></div></div>{services.length ? <div className="card-grid">{services.map((service) => <article key={service.id} className="info-card"><h3>{service.title}</h3><p>{service.vendorName} · {service.city}</p><div className="pricing-row compact-row"><strong>{service.price ? `ETB ${Number(service.price).toLocaleString()}` : t('requestQuote')}</strong>{service.reviewCount > 0 && <span>{Number(service.rating).toFixed(1)}★</span>}</div><p>{service.description}</p><button className="button secondary small" type="button" onClick={() => onNavigate(`/services/${service.id}`)}>View details</button></article>)}</div> : <EmptyState title="No services listed" message="This category does not currently have published services available." />}</section>
  </div></main>;
}

function AboutPage({ onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadAboutStatistics() {
      try {
        setLoading(true);
        const response = await api('/about');
        if (active) {
          setStatistics(response?.data?.statistics || null);
          setError('');
        }
      } catch {
        if (active) {
          setError(t('aboutLoadError'));
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAboutStatistics();
    return () => { active = false; };
  }, [language, reloadKey]);

  if (loading) {
    return <main className="page-shell"><div className="content-stack"><div className="loading"><span className="spinner" />{t('loadingAbout')}</div></div></main>;
  }

  const missionObjectives = ['aboutMissionObjective1', 'aboutMissionObjective2', 'aboutMissionObjective3', 'aboutMissionObjective4', 'aboutMissionObjective5', 'aboutMissionObjective6'];
  const visionPriorities = ['aboutVisionPriority1', 'aboutVisionPriority2', 'aboutVisionPriority3', 'aboutVisionPriority4', 'aboutVisionPriority5', 'aboutVisionPriority6'];
  const coreValues = [
    { title: 'aboutValueCustomerTitle', description: 'aboutValueCustomerCopy', icon: Heart },
    { title: 'aboutValueTrustTitle', description: 'aboutValueTrustCopy', icon: ShieldCheck },
    { title: 'aboutValueInnovationTitle', description: 'aboutValueInnovationCopy', icon: Lightbulb },
    { title: 'aboutValueCollaborationTitle', description: 'aboutValueCollaborationCopy', icon: Handshake },
    { title: 'aboutValueQualityTitle', description: 'aboutValueQualityCopy', icon: Award },
    { title: 'aboutValueAccessibilityTitle', description: 'aboutValueAccessibilityCopy', icon: Accessibility },
  ];
  const workSteps = [
    { title: 'aboutStepDiscoverTitle', description: 'aboutStepDiscoverCopy', icon: Search },
    { title: 'aboutStepCompareTitle', description: 'aboutStepCompareCopy', icon: SlidersHorizontal },
    { title: 'aboutStepConnectTitle', description: 'aboutStepConnectCopy', icon: MessageSquareWarning },
    { title: 'aboutStepPlanTitle', description: 'aboutStepPlanCopy', icon: ClipboardCheck },
  ];
  const platformFeatures = [
    { title: 'aboutFeatureDiscoveryTitle', description: 'aboutFeatureDiscoveryCopy', icon: Search },
    { title: 'aboutFeatureMarketplaceTitle', description: 'aboutFeatureMarketplaceCopy', icon: Store },
    { title: 'aboutFeatureComparisonTitle', description: 'aboutFeatureComparisonCopy', icon: SlidersHorizontal },
    { title: 'aboutFeatureRequestsTitle', description: 'aboutFeatureRequestsCopy', icon: ClipboardList },
    { title: 'aboutFeatureResponsiveTitle', description: 'aboutFeatureResponsiveCopy', icon: MonitorSmartphone },
    { title: 'aboutFeatureSupportTitle', description: 'aboutFeatureSupportCopy', icon: LifeBuoy },
    { title: 'aboutFeatureDashboardsTitle', description: 'aboutFeatureDashboardsCopy', icon: LayoutDashboard },
    { title: 'aboutFeatureLanguagesTitle', description: 'aboutFeatureLanguagesCopy', icon: Languages },
  ];
  const audiences = [
    { title: 'aboutAudienceCustomersTitle', description: 'aboutAudienceCustomersCopy', action: 'aboutAudienceCustomersAction', destination: '/services', icon: UserRound },
    { title: 'aboutAudienceVendorsTitle', description: 'aboutAudienceVendorsCopy', action: 'aboutAudienceVendorsAction', destination: '/register?role=vendor', icon: BriefcaseBusiness },
    { title: 'aboutAudienceOrganizersTitle', description: 'aboutAudienceOrganizersCopy', action: 'aboutAudienceOrganizersAction', destination: '/events', icon: CalendarDays },
    { title: 'aboutAudienceAdminsTitle', description: 'aboutAudienceAdminsCopy', action: 'aboutAudienceAdminsAction', destination: '/login', icon: Shield },
  ];
  const marketplaceStats = [
    ['categoryCount', 'aboutStatCategories'],
    ['vendorCount', 'aboutStatVendors'],
    ['serviceCount', 'aboutStatServices'],
    ['completedBookingCount', 'aboutStatBookings'],
  ].filter(([key]) => statistics?.[key] !== null && statistics?.[key] !== undefined && Number.isFinite(Number(statistics[key])));

  return <main className="page-shell about-shell"><div className="content-stack about-page">
    <section className="about-hero">
      <div className="about-hero-copy">
        <p className="about-eyebrow">{t('aboutHeroEyebrow')}</p>
        <h1>{t('aboutHeroTitle')}</h1>
        <p className="about-hero-description">{t('aboutHeroCopy')}</p>
        <div className="about-button-row">
          <button type="button" className="button" onClick={() => onNavigate('/services')}>{t('aboutExploreServices')}<ArrowRight size={16} aria-hidden="true"/></button>
          <button type="button" className="button secondary" onClick={() => onNavigate('/vendors')}>{t('aboutFindVendors')}</button>
        </div>
        <div className="about-hero-promise"><ShieldCheck size={17} aria-hidden="true"/><span>{t('aboutHeroPromise')}</span></div>
      </div>
      <div className="about-hero-media">
        <img src="https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80" alt={t('aboutHeroImageAlt')} />
        <div className="about-image-note"><Sparkles size={18} aria-hidden="true"/><span>{t('aboutImageNote')}</span></div>
      </div>
    </section>

    {marketplaceStats.length > 0 && <section className="about-stats" aria-label={t('aboutMarketplaceStats')}>
      {marketplaceStats.map(([key, label]) => <article className="about-stat-card" key={key}><strong>{Number(statistics[key]).toLocaleString(language === 'am' ? 'am-ET' : 'en-US')}</strong><span>{t(label)}</span></article>)}
    </section>}

    {error && <div className="about-load-error" role="alert"><span>{error}</span><button type="button" className="button secondary small" onClick={() => setReloadKey((key) => key + 1)}>{t('retry')}</button></div>}

    <section className="about-purpose-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutPurposeEyebrow')}</p><h2>{t('aboutPurposeHeading')}</h2></div>
      <div className="about-purpose-grid">
        <article className="about-purpose-card">
          <div className="about-purpose-icon"><Target size={23} aria-hidden="true"/></div>
          <h3>{t('aboutMissionTitle')}</h3>
          <p>{t('aboutMissionCopy')}</p>
          <h4>{t('aboutMissionObjectives')}</h4>
          <ul>{missionObjectives.map((key) => <li key={key}><Check size={15} aria-hidden="true"/><span>{t(key)}</span></li>)}</ul>
        </article>
        <article className="about-purpose-card">
          <div className="about-purpose-icon"><Compass size={23} aria-hidden="true"/></div>
          <h3>{t('aboutVisionTitle')}</h3>
          <p>{t('aboutVisionCopy')}</p>
          <h4>{t('aboutVisionPriorities')}</h4>
          <ul>{visionPriorities.map((key) => <li key={key}><Check size={15} aria-hidden="true"/><span>{t(key)}</span></li>)}</ul>
        </article>
      </div>
    </section>

    <section className="about-story">
      <div className="about-story-mark" aria-hidden="true"><BookOpen size={29}/></div>
      <div><p className="about-eyebrow">{t('aboutStoryEyebrow')}</p><h2>{t('aboutStoryTitle')}</h2><p>{t('aboutStoryCopy')}</p></div>
    </section>

    <section className="about-content-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutValuesEyebrow')}</p><h2>{t('aboutValuesTitle')}</h2><p>{t('aboutValuesIntro')}</p></div>
      <div className="about-value-grid">{coreValues.map(({ title, description, icon: Icon }) => <article className="about-value-card" key={title}>
        <div className="about-card-icon"><Icon size={21} aria-hidden="true"/></div><h3>{t(title)}</h3><p>{t(description)}</p>
      </article>)}</div>
    </section>

    <section className="about-content-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutProcessEyebrow')}</p><h2>{t('aboutProcessTitle')}</h2><p>{t('aboutProcessIntro')}</p></div>
      <div className="about-step-grid">{workSteps.map(({ title, description, icon: Icon }, index) => <article className="about-step-card" key={title}>
        <div className="about-step-top"><span className="about-step-number">{String(index + 1).padStart(2, '0')}</span><Icon size={22} aria-hidden="true"/></div><h3>{t(title)}</h3><p>{t(description)}</p>
      </article>)}</div>
    </section>

    <section className="about-content-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutWhyEyebrow')}</p><h2>{t('aboutWhyTitle')}</h2><p>{t('aboutWhyIntro')}</p></div>
      <div className="about-feature-grid">{platformFeatures.map(({ title, description, icon: Icon }) => <article className="about-feature-card" key={title}>
        <Icon size={20} aria-hidden="true"/><div><h3>{t(title)}</h3><p>{t(description)}</p></div>
      </article>)}</div>
    </section>

    <section className="about-content-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutAudienceEyebrow')}</p><h2>{t('aboutAudienceTitle')}</h2><p>{t('aboutAudienceIntro')}</p></div>
      <div className="about-audience-grid">{audiences.map(({ title, description, action, destination, icon: Icon }) => <article className="about-audience-card" key={title}>
        <div className="about-card-icon"><Icon size={21} aria-hidden="true"/></div><h3>{t(title)}</h3><p>{t(description)}</p><button className="about-text-link" type="button" onClick={() => onNavigate(destination)}>{t(action)}<ArrowRight size={15} aria-hidden="true"/></button>
      </article>)}</div>
    </section>

    <section className="about-cta">
      <div><p className="about-eyebrow">{t('aboutCtaEyebrow')}</p><h2>{t('aboutCtaTitle')}</h2><p>{t('aboutCtaCopy')}</p></div>
      <div className="about-button-row">
        <button type="button" className="button" onClick={() => onNavigate('/vendors')}>{t('aboutFindVendors')}<ArrowRight size={16} aria-hidden="true"/></button>
        <button type="button" className="button about-cta-secondary" onClick={() => onNavigate('/events')}>{t('aboutExploreEvents')}</button>
        <button type="button" className="button about-cta-outline" onClick={() => onNavigate('/contact')}>{t('aboutContactUs')}</button>
      </div>
    </section>
  </div></main>;
}

function ContactPage() {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const emptyForm = {
    full_name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
  };
  const [page, setPage] = useState({ contact: {} });
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [contactDetailsOpen, setContactDetailsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);

    async function loadContactPage() {
      try {
        const response = await api('/contact');
        if (active) {
          setPage(response?.data || { contact: {} });
          setLoadError('');
        }
      } catch (issue) {
        if (active) setLoadError(t('contactLoadError'));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadContactPage();
    return () => { active = false; };
  }, [language, reloadKey]);

  function updateValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
    setSubmitError('');
    setSuccess('');
  }

  async function submitContact(event) {
    event.preventDefault();
    if (submitting) return;

    const { normalized, errors: validationErrors } = validateContactForm(form, language);
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    setSuccess('');
    setErrors({});

    try {
      const response = await api('/contact', {
        method: 'POST',
        body: JSON.stringify(normalized),
      });
      if (!response?.success || !response?.data?.id) {
        throw new Error(response?.message || t('contactSubmitError'));
      }
      const reference = response.data.reference;
      setSuccess(reference ? `${t('messageSaved')} ${t('reference')}: ${reference}` : t('messageSaved'));
      setForm({ ...emptyForm });
    } catch (issue) {
      setSubmitError(issue.status === 429 ? issue.message : issue.message || t('contactSubmitError'));
    } finally {
      setSubmitting(false);
    }
  }

  const contactInfo = buildContactInfo(page.contact || {});
  const hasContactInfo = Boolean(contactInfo.email || contactInfo.phone || contactInfo.address || contactInfo.hours || contactInfo.socials.length);
  if (loading) {
    return <main className="page-shell"><div className="content-stack"><div className="loading" role="status"><span className="spinner" />{t('loadingContactInfo')}</div></div></main>;
  }

  const phoneLink = contactInfo.phone.replace(/[^\d+]/g, '');
  const mapUrl = contactInfo.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contactInfo.address)}`
    : '';

  return <main className="page-shell contact-page">
    <div className="content-stack contact-content">
      {loadError && <div className="alert error contact-load-error" role="alert">{loadError}<button type="button" className="button secondary small" onClick={() => setReloadKey((value) => value + 1)}>{t('retry')}</button></div>}

      <div className="contact-layout">
        <section className="panel contact-card contact-information">
          <h2 className="contact-details-heading">
            <button type="button" id="contact-details-toggle" aria-expanded={contactDetailsOpen} aria-controls="contact-details-content" onClick={() => setContactDetailsOpen((open) => !open)}>
              <span>{t('contactDetails')}</span><ChevronDown size={20} aria-hidden="true" />
            </button>
          </h2>
          <div className={`contact-details-content ${contactDetailsOpen ? 'is-open' : ''}`} id="contact-details-content" role="region" aria-labelledby="contact-details-toggle" aria-hidden={!contactDetailsOpen}>
            <div className="contact-details-inner">
              {hasContactInfo ? <>
                <div className="contact-methods">
                  {contactInfo.email && <div className="contact-method">
                    <span className="contact-method-icon"><Mail size={19} aria-hidden="true" /></span>
                    <div><h3>{t('emailAddress')}</h3><a tabIndex={contactDetailsOpen ? 0 : -1} href={`mailto:${contactInfo.email}`}>{contactInfo.email}</a></div>
                  </div>}
                  {contactInfo.phone && <div className="contact-method">
                    <span className="contact-method-icon"><Phone size={19} aria-hidden="true" /></span>
                    <div><h3>{t('phone')}</h3><a tabIndex={contactDetailsOpen ? 0 : -1} href={`tel:${phoneLink}`}>{contactInfo.phone}</a></div>
                  </div>}
                  {contactInfo.address && <div className="contact-method">
                    <span className="contact-method-icon"><MapPin size={19} aria-hidden="true" /></span>
                    <div><h3>{t('office')}</h3><p>{contactInfo.address}</p><a tabIndex={contactDetailsOpen ? 0 : -1} className="contact-detail-link" href={mapUrl} target="_blank" rel="noreferrer">{t('viewMap')} <ExternalLink size={13} aria-hidden="true" /></a></div>
                  </div>}
                  {contactInfo.hours && <div className="contact-method">
                    <span className="contact-method-icon"><Clock3 size={19} aria-hidden="true" /></span>
                    <div><h3>{t('supportHours')}</h3><p>{contactInfo.hours}</p></div>
                  </div>}
                </div>
                {contactInfo.socials.length > 0 && <div className="contact-socials">
                  <h3>{t('followUs')}</h3>
                  <div>{contactInfo.socials.map((entry, index) => <a tabIndex={contactDetailsOpen ? 0 : -1} key={`${entry.url}-${index}`} href={entry.url} target="_blank" rel="noopener noreferrer"><Share2 size={15} aria-hidden="true" />{entry.label}<ExternalLink size={13} aria-hidden="true" /></a>)}</div>
                </div>}
              </> : <p className="contact-info-empty">{t('contactInfoUnavailable')}</p>}
            </div>
          </div>
        </section>

        <section className="panel contact-card contact-form-card" aria-labelledby="contact-form-title">
          <div className="contact-card-heading">
            <h2 id="contact-form-title">{t('sendMessage')}</h2>
            <p>{t('sendMessageDescription')}</p>
          </div>
          {submitError && <div className="alert error" role="alert">{submitError}</div>}
          {success && <div className="alert success" role="status">{success}</div>}
          <form className="contact-form" onSubmit={submitContact} noValidate>
            <div className="contact-form-grid">
              <label className="contact-field">
                <span>{t('fullName')} <b aria-hidden="true">*</b></span>
                <input name="full_name" autoComplete="name" maxLength="160" placeholder={t('fullNamePlaceholder')} aria-invalid={Boolean(errors.full_name)} aria-describedby={errors.full_name ? 'contact-name-error' : undefined} value={form.full_name} onChange={(event) => updateValue('full_name', event.target.value)} required />
                {errors.full_name && <small className="field-error" id="contact-name-error">{errors.full_name}</small>}
              </label>
              <label className="contact-field">
                <span>{t('emailAddress')} <b aria-hidden="true">*</b></span>
                <input name="email" type="email" autoComplete="email" maxLength="254" placeholder={t('emailPlaceholder')} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'contact-email-error' : undefined} value={form.email} onChange={(event) => updateValue('email', event.target.value)} required />
                {errors.email && <small className="field-error" id="contact-email-error">{errors.email}</small>}
              </label>
              <label className="contact-field">
                <span>{t('phoneOptional')}</span>
                <input name="phone" type="tel" autoComplete="tel" maxLength="40" placeholder={t('phonePlaceholder')} aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'contact-phone-error' : undefined} value={form.phone} onChange={(event) => updateValue('phone', event.target.value)} />
                {errors.phone && <small className="field-error" id="contact-phone-error">{errors.phone}</small>}
              </label>
              <label className="contact-field">
                <span>{t('subject')} <b aria-hidden="true">*</b></span>
                <input name="subject" minLength="4" maxLength="200" placeholder={t('subjectPlaceholder')} aria-invalid={Boolean(errors.subject)} aria-describedby={errors.subject ? 'contact-subject-error' : undefined} value={form.subject} onChange={(event) => updateValue('subject', event.target.value)} required />
                {errors.subject && <small className="field-error" id="contact-subject-error">{errors.subject}</small>}
              </label>
            </div>
            <label className="contact-field">
              <span>{t('message')} <b aria-hidden="true">*</b></span>
              <textarea name="message" rows="6" minLength="20" maxLength="2500" placeholder={t('messagePlaceholder')} aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? 'contact-message-error' : undefined} value={form.message} onChange={(event) => updateValue('message', event.target.value)} required />
              {errors.message && <small className="field-error" id="contact-message-error">{errors.message}</small>}
            </label>
            <button className="button contact-submit" type="submit" disabled={submitting}>
              {submitting ? <><span className="spinner" aria-hidden="true" />{t('sending')}</> : <>{t('sendMessageButton')} <Send size={16} aria-hidden="true" /></>}
            </button>
          </form>
        </section>
      </div>

    </div>
  </main>;
}

function AuthHomeLink() {
  return <a className="auth-home-link" href="/"><ArrowLeft size={16} aria-hidden="true" /><span>Back to Home</span></a>;
}

function LoginPage({ onLogin, demoMode = false }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { await onLogin(email, password); } catch (issue) { setError(translateText(issue.message, language)); } finally { setBusy(false); } }
  return <main className="login-wrap"><div className="login-card"><div className="brand-mark">EH</div><h1>{t('signIn')}</h1><p className="muted">{t('accessWorkspace')}</p>{error && <div className="alert error" role="alert">{error}</div>}<form onSubmit={submit}><label className="field"><span>{demoMode ? 'Email address or username' : t('emailAddress')}</span><input type={demoMode ? 'text' : 'email'} name="email" placeholder={demoMode ? 'Email address or username' : undefined} autoComplete="username" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><div className="field"><span id="login-password-label">{t('password')}</span><div className="password-input-wrap"><input aria-labelledby="login-password-label" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /><button className="password-visibility" type="button" aria-label={t(showPassword ? 'hidePassword' : 'showPassword')} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div><button className="button login-button" disabled={busy}>{busy ? t('signingIn') : t('signInSecurely')}</button></form><div className="inline-links"><button type="button" className="text-link" onClick={() => navigateBrowserPath('/register')}>{t('createAccount')}</button></div><div className="auth-home-footer"><AuthHomeLink /></div></div></main>;
}

function RegisterPage({ onRegister, onDemoRegistrationComplete, demoMode = false }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [form, setForm] = useState(() => {
    const requestedRole = new URLSearchParams(window.location.search).get('role');
    return { name: '', email: '', password: '', confirmPassword: '', role: ['customer', 'organizer', 'vendor'].includes(requestedRole) ? requestedRole : 'customer' };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const redirectTimer = useRef(null);
  const passwordValid = form.password.length >= 12
    && form.password.length <= 16
    && /[A-Z]/.test(form.password)
    && /[a-z]/.test(form.password)
    && /\d/.test(form.password);
  const passwordError = Boolean(form.password && !passwordValid);
  const confirmMismatch = Boolean(form.confirmPassword && form.confirmPassword !== form.password);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!passwordValid) return;
    if (form.password !== form.confirmPassword) return;
    setBusy(true);
    try {
      const result = await onRegister(form.name.trim(), form.email.trim(), form.password, form.role);
      setSuccess(translateText(result?.message, language) || t('registrationSuccess'));
      if (result?.demo && result.dashboardPath) {
        redirectTimer.current = window.setTimeout(() => {
          onDemoRegistrationComplete(result.profile, result.dashboardPath);
        }, 800);
      }
    } catch (issue) {
      setError(translateText(issue.message, language));
    } finally {
      setBusy(false);
    }
  }
  return <main className="login-wrap"><div className="login-card registration-card">
    <div className="brand-mark">EH</div>
    <p className="eyebrow">{t('eventHubAccount')}</p>
    <h1>{t('createAccountHeading')}</h1>
    <p className="muted">{t('registerAsRole')}</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    {success && <div className="alert success" role="status">{success}<div className="inline-links"><span>{t('alreadyHaveAccount')}</span><button type="button" className="text-link" onClick={() => { window.clearTimeout(redirectTimer.current); navigateBrowserPath('/login'); }}>{t('loginHere')}</button></div></div>}
    <form onSubmit={submit}>
      <label className="field"><span>{t('fullName')}</span><input name="name" autoComplete="name" minLength="2" maxLength="160" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
      <label className="field"><span>{t('emailAddress')}</span><input name="email" type="email" autoComplete="email" maxLength="254" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
      <div className="registration-password-field">
        <PasswordField
          name="password"
          label={t('password')}
          value={form.password}
          autoComplete="new-password"
          language={language}
          placeholder={t('passwordPlaceholder')}
          minLength={12}
          maxLength={16}
          describedBy={passwordError ? 'registration-password-error' : undefined}
          invalid={passwordError}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        {passwordError && <p id="registration-password-error" className="field-error" role="alert">{t('passwordInvalid')}</p>}
      </div>
      <div className="registration-confirm-field">
        <PasswordField
          name="confirm-password"
          label={t('confirmPassword')}
          value={form.confirmPassword}
          autoComplete="new-password"
          language={language}
          minLength={12}
          maxLength={16}
          describedBy={form.confirmPassword ? 'registration-confirm-feedback' : undefined}
          invalid={confirmMismatch}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
        />
        {form.confirmPassword && <p id="registration-confirm-feedback" className={confirmMismatch ? 'field-error' : 'field-success'} role={confirmMismatch ? 'alert' : 'status'} aria-live="polite">
          {!confirmMismatch && <Check size={13} aria-hidden="true" />}
          {confirmMismatch ? t('passwordMismatch') : t('passwordsMatch')}
        </p>}
      </div>
      <label className="field"><span>{t('accountType')}</span><select name="role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="customer">{t('customerDashboard')}</option><option value="organizer">{t('organizerDashboard')}</option><option value="vendor">{t('vendorDashboard')}</option></select></label>
      <button className="button login-button" disabled={busy || Boolean(success)}>{busy ? t('creatingAccount') : t('registerNow')}</button>
    </form>
    <div className="inline-links"><span>{t('alreadyHaveAccount')}</span><button type="button" className="text-link" onClick={() => navigateBrowserPath('/login')}>{t('loginHere')}</button></div>
    <div className="auth-home-footer"><AuthHomeLink /></div>
  </div></main>;
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

function VendorDashboard({ user, onLogout, onUserChange }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const vendorMenu = [
    ['overview', 'Dashboard Overview'], ['profile', 'Business Profile'], ['verification', 'Vendor Verification'], ['services', 'My Services'], ['add-edit-services', 'Add and Edit Services'], ['categories', 'Service Categories'], ['pricing', 'Pricing and Packages'], ['availability', 'Availability Calendar'], ['requests', 'Booking Requests'], ['confirmed', 'Confirmed Bookings'], ['history', 'Booking History'], ['quotations', 'Quotations'], ['payments', 'Payments and Earnings'], ['messages', 'Customer Messages'], ['reviews', 'Reviews and Ratings'], ['notifications', 'Notifications'], ['reports', 'Reports'], ['account', 'Profile']
  ];
  const [slug, setSlug] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">QUOTATIONS</p><h2>Service quotations</h2><p className="muted">Review customer requests and respond with a quote or decline them.</p></div></div><div className="panel" style={{padding:'20px'}}><div className="list-stack">{(data.quotations || []).map((quote) => <article key={quote.id} className="list-card"><div><strong>{quote.customer} · {quote.service}</strong><small>{quote.event || 'Event not specified'} {quote.validUntil ? `· Valid through ${quote.validUntil}` : ''}</small>{quote.status === 'Draft' ? <VendorQuoteResponseForm quote={quote} onResponded={(result) => setData((current) => ({ ...current, quotations: current.quotations.map((item) => item.id === result.id ? { ...item, status: result.status === 'sent' ? 'Sent' : 'Declined', amount: result.amount ?? item.amount, validUntil: result.validUntil ?? item.validUntil } : item) }))}/> : <><small>{quote.currency} {Number(quote.amount).toLocaleString()}</small>{quote.notes && <small>{quote.notes}</small>}</>}</div><span className={`pill ${quote.status === 'Draft' ? 'pending' : 'active'}`}>{quote.status}</span></article>)}</div></div></div>;
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

  function toggleSidebar() {
    if (window.matchMedia('(max-width: 760px)').matches) setSidebarOpen((current) => !current);
    else setSidebarCollapsed((current) => !current);
  }

  return <div className={`app-shell dashboard-role-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><DashboardSidebar roleTitle={t('vendorDashboard').toUpperCase()} groups={[{ id: 'vendor', label: t('businessArea'), items: vendorMenu }]} activePage={slug} onNavigate={setSlug} onToggle={toggleSidebar} collapsed={sidebarCollapsed} mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} language={language}/><div className={`mobile-scrim ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)}/><main className="main-area"><DashboardHeader user={user} onNavigate={(target) => setSlug(target === 'profile' ? 'account' : target)} onLogout={onLogout} onToggleSidebar={toggleSidebar} onUserChange={onUserChange} sidebarExpanded={window.matchMedia('(max-width: 760px)').matches ? sidebarOpen : !sidebarCollapsed}/><div className="content">{slug === 'settings' ? <DashboardSettings user={user}/> : renderSection()}</div><footer className="footer">{t('vendorPortal')} <span>•</span> {t('ownedRecordsOnly')}</footer></main></div>;
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

function CustomerDashboard({ user, onLogout, onUserChange }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const customerMenu = [
    ['overview', 'Dashboard Overview'], ['vendors', 'Browse Vendors'], ['services', 'Search Services'], ['categories', 'Service Categories'], ['bookings', 'My Bookings'], ['history', 'Booking History'], ['events', 'My Events'], ['favorites', 'Saved Vendors'], ['quotations', 'Request Quotations'], ['payments', 'Payments and Transactions'], ['messages', 'Messages'], ['reviews', 'Reviews and Ratings'], ['notifications', 'Notifications'], ['profile', 'Profile']
  ];

  const [slug, setSlug] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  function toggleSidebar() {
    if (window.matchMedia('(max-width: 760px)').matches) setSidebarOpen((current) => !current);
    else setSidebarCollapsed((current) => !current);
  }

  return <div className={`app-shell dashboard-role-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><DashboardSidebar roleTitle={t('customerDashboard').toUpperCase()} groups={[{ id: 'customer', label: t('bookings'), items: customerMenu }]} activePage={slug} onNavigate={setSlug} onToggle={toggleSidebar} collapsed={sidebarCollapsed} mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} language={language}/><div className={`mobile-scrim ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)}/><main className="main-area"><DashboardHeader user={user} onNavigate={setSlug} onLogout={onLogout} onToggleSidebar={toggleSidebar} onUserChange={onUserChange} sidebarExpanded={window.matchMedia('(max-width: 760px)').matches ? sidebarOpen : !sidebarCollapsed}/><div className="content">{slug === 'settings' ? <DashboardSettings user={user}/> : renderSection()}</div><footer className="footer">{t('customerPortal')} <span>•</span> {t('personalRecordsOnly')}</footer></main></div>;
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

function OrganizerDashboard({ user, onLogout, onUserChange }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [dashboardView, setDashboardView] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  function toggleSidebar() {
    if (window.matchMedia('(max-width: 760px)').matches) setSidebarOpen((current) => !current);
    else setSidebarCollapsed((current) => !current);
  }
  function renderDashboard(content) {
    const organizerMenu = [['overview', 'Dashboard Overview'], ['events', 'My Events and Tickets'], ['profile', 'My Profile'], ['settings', 'Account Settings']];
    return <div className={`app-shell dashboard-role-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><DashboardSidebar roleTitle="ORGANIZER DASHBOARD" groups={[{ id: 'organizer', label: 'WORKSPACE', items: organizerMenu }]} activePage={dashboardView} onNavigate={setDashboardView} onToggle={toggleSidebar} collapsed={sidebarCollapsed} mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} language={language}/><div className={`mobile-scrim ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)}/><main className="main-area"><DashboardHeader user={user} onNavigate={setDashboardView} onLogout={onLogout} onToggleSidebar={toggleSidebar} onUserChange={onUserChange} sidebarExpanded={window.matchMedia('(max-width: 760px)').matches ? sidebarOpen : !sidebarCollapsed}/><div className="content">{content}</div></main></div>;
  }

  if (error) return renderDashboard(<div className="alert error">{translateText(error, language)}</div>);
  if (!overview) return renderDashboard(<div className="loading"><span className="spinner"/>{t('loading')}</div>);

  const totalBudget = events.reduce((sum, event) => sum + Number(event.budget || 0), 0);
  const upcomingEvents = events.filter((event) => new Date(event.date) >= new Date()).slice(0, 3);
  const activeBookings = bookings.filter((booking) => ['pending', 'confirmed', 'accepted', 'under_review'].includes(String(booking.status).toLowerCase()));

  const profileContent = dashboardView === 'profile' ? <section className="dashboard-settings"><div className="page-heading"><div><p className="eyebrow">PROFILE</p><h2>My Profile</h2><p className="muted">Your organizer account information.</p></div></div><div className="panel settings-preferences"><div><span><strong>{user.name || user.full_name || 'Organizer'}</strong><small>{user.email}</small></span><span className="pill active">Organizer</span></div></div></section> : dashboardView === 'settings' ? <DashboardSettings user={user}/> : null;
  const eventManagerContent = dashboardView === 'events' ? <OrganizerEventsManager api={api} /> : null;
  return renderDashboard(profileContent || eventManagerContent || <section className="organizer-shell"><div className="welcome"><div><p className="eyebrow">{t('organizerDashboard')}</p><h2>{t('customerWelcome')}, {user.name || user.full_name || 'Organizer'}</h2><p className="muted">{t('secureOrganizerAccess')}</p></div></div>
    <div className="metric-grid">
      <article className="metric-card"><p>{t('activeEvents')}</p><strong>{events.length}</strong><span>{upcomingEvents.length} {t('upcoming')}</span></article>
      <article className="metric-card"><p>{t('vendorMatches')}</p><strong>{vendors.length}</strong><span>{t('verifiedRanked')}</span></article>
      <article className="metric-card"><p>{t('budgetAllocated')}</p><strong>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(totalBudget)}</strong><span>{t('currentPlans')}</span></article>
      <article className="metric-card"><p>{t('bookingsInMotion')}</p><strong>{activeBookings.length}</strong><span>{bookings.length} {t('totalTracked')}</span></article>
    </div>
    <div className="two-column-layout">
      <article className="panel">
        <div className="panel-header"><h3>{t('eventPipeline')}</h3><button className="button secondary small" onClick={() => setDashboardView('events')}>{t('createEvent')}</button></div>
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
  </section>);
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
  const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [query,setQuery]=useState(''); const [search,setSearch]=useState(''); const [status,setStatus]=useState(''); const [inquiryType,setInquiryType]=useState(''); const [modal,setModal]=useState(null); const [busy,setBusy]=useState(false); const [form,setForm]=useState({}); const [roleRows,setRoleRows]=useState([]);
  const statuses={users:['active','suspended','pending'],roles:['active','inactive'],categories:['active','inactive'],vendors:['pending','verified','rejected'],events:['draft','active','booked','in_progress','completed','cancelled'],bookings:['requested','quoted','accepted','rejected','cancelled','completed','under_review'],'package-requests':['new','reviewed','replied','closed'],payments:['pending','authorized','paid','failed','refunded','refund_pending'],reviews:['published','hidden','flagged'],complaints:['open','investigating','resolved','dismissed'],messages:['new','reviewed','in_progress','replied','resolved','closed'],notifications:['queued','sent','failed','read']}[slug]||[];
  const statusLabel=(value)=>slug==='messages'?({new:'New',reviewed:'Read',in_progress:'In Progress',replied:'Replied',resolved:'Resolved',closed:'Closed'}[value]||value):translateText(value,language);
  const load=useCallback(async(page=1)=>{setLoading(true);setError('');try{const params=new URLSearchParams({page:String(page),pageSize:String(pagination.pageSize)});if(search)params.set('q',search);if(status)params.set('status',slug==='roles'||slug==='categories'?(status==='active'?'1':'0'):status);if(inquiryType)params.set('inquiry_type',inquiryType);const result=await api(`/admin/${config.endpoint}?${params}`);setData(result.data);setPagination(result.pagination);}catch(issue){setError(issue.message);}finally{setLoading(false);}},[config.endpoint,inquiryType,pagination.pageSize,search,status,slug]);
  useEffect(()=>{load(1);},[load]);
  useEffect(()=>{if(slug==='users')api('/admin/roles?pageSize=100').then((r)=>setRoleRows(r.data.filter((x)=>x.is_active&&!x.is_admin))).catch(()=>{});},[slug]);
  function startCreate(){setForm({});setModal({kind:'create'});}
  function startEdit(row){setForm(Object.fromEntries(config.fields.map(([key])=>[key,row[key] ?? ''])));setModal({kind:'edit',row});}
  function startAction(kind,row){setForm(kind==='status'&&slug==='messages'?{status:row.status==='new'?'reviewed':row.status,admin_reply:row.admin_reply||''}:{});setModal({kind,row});}
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
  async function deleteContactMessage(row){
    if(!window.confirm(`Permanently delete contact message #${row.id}? This action is recorded in the audit log.`))return;
    setBusy(true);setError('');setNotice('');
    try{
      await api(`/admin/contact/${row.id}`,{method:'DELETE'});
      setNotice('Contact message deleted.');
      const lastPage=Math.max(1,Math.ceil((pagination.total-1)/pagination.pageSize));
      await load(Math.min(pagination.page,lastPage));
    }catch(issue){setError(issue.message);}finally{setBusy(false);}
  }
  const actions=(row)=>{const names=config.actions||[];return names.map((action)=>{
    if(action==='delete')return <button key={action} className="text-action subtle-danger" type="button" disabled={busy} onClick={()=>deleteContactMessage(row)}>Delete</button>;
    const label=action==='status'&&slug==='messages'?(row.status==='new'?'Mark read':'Update status'):{edit:'Edit',deactivate:'Deactivate',verify:'Verify',reject:'Reject',moderate:'Moderate',refund:'Request refund',role:'Change role',status:row.status==='suspended'?'Activate':'Suspend','package-status':'Update status',permissions:'Permissions',review:'Moderate review',complaint:'Update complaint',view:'View message'}[action];
    const danger=['deactivate','reject','refund'].includes(action)||(action==='status'&&slug!=='messages');
    return <button key={action} className={`text-action ${danger?'subtle-danger':''}`} type="button" onClick={()=>startAction(action==='package-status'?'package-status':action,row)}>{label}</button>;
  });};
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
      status: slug === 'messages' ? 'Update contact message' : 'Update account status',
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
                {['new', 'reviewed', 'in_progress', 'replied', 'resolved', 'closed'].map((value) => <option key={value} value={value}>{value === 'reviewed' ? 'Read' : value}</option>)}
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
                  {statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
              </select>
            )}
            {config.inquiryTypes && (
              <select className="filter-select" aria-label="Filter by inquiry type" value={inquiryType} onChange={(event) => setInquiryType(event.target.value)}>
                <option value="">All inquiry types</option>
                {config.inquiryTypes.map((option) => <option key={option.value} value={option.value}>{translateText(option.label, language)}</option>)}
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
                          <span className={`pill ${String(row[column]).toLowerCase()}`}>{column === 'status' ? statusLabel(row[column]) : display(row[column])}</span>
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
      {modal?.kind === 'view' ? <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="contact-message-title"><div className="modal-head"><h2 id="contact-message-title">Contact message #{modal.row.id}</h2><button className="icon-button" type="button" onClick={() => setModal(null)} aria-label="Close"><X size={18}/></button></div><div className="modal-body"><p><strong>From:</strong> {modal.row.full_name} ({modal.row.email})</p>{modal.row.phone && <p><strong>Phone:</strong> {modal.row.phone}</p>}<p><strong>Subject:</strong> {modal.row.subject}</p><p><strong>Inquiry:</strong> {modal.row.inquiry_type}</p><p><strong>Status:</strong> {modal.row.status}</p><p><strong>Received:</strong> {modal.row.created_at}</p><div className="panel" style={{ padding: '14px', whiteSpace: 'pre-wrap' }}>{modal.row.message}</div>{modal.row.admin_reply && <div><strong>Admin reply</strong><p>{modal.row.admin_reply}</p></div>}</div><div className="modal-foot"><button className="button secondary" type="button" onClick={() => setModal(null)}>Close</button><button className="button" type="button" onClick={() => startAction('status', modal.row)}>Update status</button></div></section></div> : modal && <Modal title={modalTitle()} onClose={() => setModal(null)} onSubmit={submit} busy={busy} submitLabel={modal.kind === 'refund' ? 'Submit request' : modal.kind === 'deactivate' ? 'Deactivate' : 'Save'} danger={['deactivate', 'reject', 'refund', 'status'].includes(modal.kind)}>{renderModalFields()}</Modal>}
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
  const [user,setUser]=useState(null);const [checking,setChecking]=useState(true);const [slug,setSlug]=useState('overview');const [sidebarOpen,setSidebarOpen]=useState(false);const [sidebarCollapsed,setSidebarCollapsed]=useState(false);const [globalError,setGlobalError]=useState('');const [showLogin,setShowLogin]=useState(false);const [portal,setPortal]=useState('admin');const [currentPath,setCurrentPath]=useState(() => window.location.pathname || '/');

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
      setSlug(['overview','users','roles','vendors','categories','events','bookings','package-requests','payments','reviews','complaints','messages','reports','notifications','audit-logs','settings','profile','account-settings'].includes(next) ? next : 'overview');
    }
  }, [normalizePath]);

  useEffect(()=>{
    const controller=new AbortController();
    resolve();
    const listener=()=>resolve();
    window.addEventListener('popstate',listener);
    if (DEMO_AUTH_ENABLED) {
      try {
        const demoProfile = readDemoSession();
        if (demoProfile) {
          setUser(toDemoUser(demoProfile));
          setPortal(demoProfile.role);
        }
      } catch (issue) {
        setGlobalError(issue.message);
      } finally {
        setChecking(false);
      }
    } else {
      api('/auth/me',{signal:controller.signal}).then((r)=>{setUser(r.user);setPortal('admin');}).catch((issue)=>{if(issue.name==='AbortError')return;return api('/platform/me',{signal:controller.signal}).then((r)=>{const profile=r?.data?.user||null;setUser(profile);if(profile?.role)setPortal(profile.role);}).catch((platformIssue)=>{if(platformIssue.name!=='AbortError')setUser(null);});}).finally(()=>{if(!controller.signal.aborted)setChecking(false);});
    }
    return()=>{controller.abort();window.removeEventListener('popstate',listener);};
  },[resolve]);

  async function login(email,password){
    if (DEMO_AUTH_ENABLED) {
      const credential = findDemoLogin(email, password);
      if (!credential) throw new Error('Demo sign-in failed. Choose one of the predefined demo accounts and enter its mock password.');
      const profile = saveDemoSession(credential);
      setUser(toDemoUser(profile));setPortal(profile.role);setGlobalError('');setShowLogin(false);
      navigatePublic(dashboardPathForRole(profile.role));
      return;
    }
    const adminResponse = await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
    setUser(adminResponse.user);setPortal('admin');setGlobalError('');setShowLogin(false);navigatePublic('/admin');
  }
  async function loginPublic(email,password){
    if (DEMO_AUTH_ENABLED) {
      await login(email, password);
      const continuation = sessionStorage.getItem('eventhub_after_login');
      const demoProfile = readDemoSession();
      if (continuation && (/^\/events\/\d+$/.test(continuation) || continuation === '/vendor-application' && ['customer', 'organizer'].includes(demoProfile?.role))) {
        sessionStorage.removeItem('eventhub_after_login');
        navigatePublic(continuation);
      }
      return;
    }
    try {
      const adminResponse = await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
      setUser(adminResponse.user);setPortal('admin');setGlobalError('');setShowLogin(false);navigatePublic('/admin');
      return;
    } catch (adminError) {
      const platformResponse = await api('/platform/login',{method:'POST',body:JSON.stringify({email,password})});
      const role = platformResponse?.data?.user?.role || 'customer';
      setUser(platformResponse.data.user);setPortal(role);setGlobalError('');setShowLogin(false);
      const rolePath = role === 'admin' ? '/admin' : role === 'organizer' ? '/organizer/dashboard' : role === 'vendor' ? '/vendor/dashboard' : '/customer/dashboard';
      const continuation = sessionStorage.getItem('eventhub_after_login');
      const canContinue = continuation && (
        role === 'customer' && (/^\/events\/\d+$/.test(continuation) || continuation === '/my-bookings' || continuation === '/vendor-application')
        || role === 'organizer' && continuation === '/vendor-application'
      );
      if (canContinue) sessionStorage.removeItem('eventhub_after_login');
      navigatePublic(canContinue ? continuation : rolePath);
    }
  }
  function completeDemoRegistration(profile, dashboardPath) {
    setUser(toDemoUser(profile));setPortal(profile.role);setGlobalError('');setShowLogin(false);
    navigatePublic(dashboardPath);
  }
  async function registerPublic(name,email,password,role='customer'){
    if (DEMO_AUTH_ENABLED) {
      if (!name || name.trim().length < 2) throw new Error('Enter your full name (at least 2 characters).');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter a valid email address.');
      if (!isValidDemoPassword(password)) throw new Error('Password must contain 12–16 characters, uppercase, lowercase, and a number.');
      if (!['customer','organizer','vendor'].includes(role)) throw new Error('Choose a valid account type.');
      const profile = saveDemoAccount({ name, email, role });
      saveDemoSession(profile);
      return { demo: true, profile, message: 'Demo registration successful', dashboardPath: dashboardPathForRole(role) };
    }
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
  function toggleAdminSidebar(){if(window.matchMedia('(max-width: 760px)').matches)setSidebarOpen((current)=>!current);else setSidebarCollapsed((current)=>!current);}
  async function logout(){
    try {
      if (DEMO_AUTH_ENABLED) clearDemoSession();
      else if (portal === 'admin') await api('/auth/logout',{method:'POST'});
      else if (user) await api('/platform/logout',{method:'POST'});
    } catch (issue) {
      setGlobalError(issue.message);
    } finally {
      setUser(null);setShowLogin(false);setPortal('admin');navigatePublic('/login');
    }
  }

  const publicRoutes = {
    '/': <PublicOverview user={user} currentPath={currentPath} onNavigate={navigatePublic} onLogout={logout} />,
    '/events': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><EventsPage onNavigate={navigatePublic} /></PublicPageLayout>,
    '/vendors': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><VendorsPage user={user} onNavigate={navigatePublic} /></PublicPageLayout>,
    '/services': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ServicesPage onNavigate={navigatePublic} /></PublicPageLayout>,
    '/categories': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><CategoriesPage onNavigate={navigatePublic} /></PublicPageLayout>,
    '/about': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><AboutPage onNavigate={navigatePublic} /></PublicPageLayout>,
    '/contact': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ContactPage /></PublicPageLayout>,
    '/login': <LoginPage onLogin={loginPublic} demoMode={DEMO_AUTH_ENABLED} />,
    '/register': <RegisterPage onRegister={registerPublic} onDemoRegistrationComplete={completeDemoRegistration} demoMode={DEMO_AUTH_ENABLED} />,
    '/forgot-password': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ForgotPasswordPage onSubmit={requestPasswordReset} /></PublicPageLayout>,
    '/reset-password': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ResetPasswordPage onSubmit={resetPassword} /></PublicPageLayout>,
    '/privacy': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><PrivacyPage /></PublicPageLayout>,
    '/terms': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><TermsPage /></PublicPageLayout>,
    '/help': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><HelpPage /></PublicPageLayout>,
  };

  const routePath = currentPath.split('?')[0];
  const eventRoute = routePath.match(/^\/events\/(\d+)$/);
  const serviceRoute = routePath.match(/^\/services\/(\d+)$/);
  const vendorRoute = routePath.match(/^\/vendors\/(\d+)$/);
  if(checking)return <div className="loading full-screen"><span className="spinner"/>Verifying administrator session…</div>;
  if (routePath === '/search') {
    const query = new URLSearchParams(currentPath.split('?')[1] || '').get('q') || '';
    return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><SearchResultsPage initialQuery={query} onNavigate={navigatePublic}/></PublicPageLayout>;
  }
  if (routePath === '/vendor-application') {
    return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><VendorApplicationPage user={user} onNavigate={navigatePublic}/></PublicPageLayout>;
  }
  if (eventRoute) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><EventDetailsPage eventId={eventRoute[1]} user={user} api={api} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/events') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><EventsPage onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/vendors' || routePath.startsWith('/vendors?')) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><VendorsPage user={user} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (vendorRoute) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><VendorDetailPage vendorId={vendorRoute[1]} user={user} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/services') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ServicesPage user={user} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (serviceRoute) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ServiceDetailPage serviceId={serviceRoute[1]} user={user} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/categories' || routePath.startsWith('/categories?')) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><CategoriesPage onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath.startsWith('/categories/')) {
    const slug = routePath.replace(/^\/categories\//, '');
    return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><CategoryDetailPage slug={slug} onNavigate={navigatePublic} /></PublicPageLayout>;
  }
  if (routePath === '/about') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><AboutPage onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/contact') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ContactPage /></PublicPageLayout>;
  if (routePath === '/') return publicRoutes['/'];
  if (routePath === '/my-bookings') {
    if (!user) return <LoginPage onLogin={loginPublic} demoMode={DEMO_AUTH_ENABLED} />;
    if (user.role !== 'customer') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><main className="page-shell"><div className="alert error">My Event Bookings is available to customer accounts.</div></main></PublicPageLayout>;
    return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><MyEventBookingsPage api={api} onNavigate={navigatePublic} /></PublicPageLayout>;
  }
  if(!user){
    if (currentPath.startsWith('/admin')) return DEMO_AUTH_ENABLED ? <LoginPage onLogin={login} demoMode /> : <Login onLogin={login}/>;
    if (routePath === '/login') return <LoginPage onLogin={loginPublic} demoMode={DEMO_AUTH_ENABLED}/>;
    if (routePath === '/register') return <RegisterPage onRegister={registerPublic} onDemoRegistrationComplete={completeDemoRegistration} demoMode={DEMO_AUTH_ENABLED}/>;
    if (DEMO_AUTH_ENABLED && /^\/(customer|organizer|vendor)\/dashboard$/.test(currentPath)) return <LoginPage onLogin={loginPublic} demoMode />;
    if (currentPath === '/forgot-password') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><ForgotPasswordPage onSubmit={requestPasswordReset} /></PublicPageLayout>;
    if (currentPath === '/reset-password') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><ResetPasswordPage onSubmit={resetPassword} /></PublicPageLayout>;
    if (currentPath === '/privacy') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><PrivacyPage /></PublicPageLayout>;
    if (currentPath === '/terms') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><TermsPage /></PublicPageLayout>;
    if (currentPath === '/help') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><HelpPage /></PublicPageLayout>;
    if (currentPath === '/events') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><EventsPage onNavigate={navigatePublic} /></PublicPageLayout>;
    if (publicRoutes[routePath]) return publicRoutes[routePath];
    return <NotFoundPage onNavigate={navigatePublic}/>;
  }

  if (portal === 'customer') return <><DemoModeBanner user={user}/><CustomerDashboard user={user} onLogout={logout} onUserChange={setUser}/></>;
  if (portal === 'organizer') return <><DemoModeBanner user={user}/><OrganizerDashboard user={user} onLogout={logout} onUserChange={setUser}/></>;
  if (portal === 'vendor') return <><DemoModeBanner user={user}/><VendorDashboard user={user} onLogout={logout} onUserChange={setUser}/></>;
  return <><DemoModeBanner user={user}/><div className={`app-shell dashboard-admin-shell ${sidebarCollapsed?'sidebar-collapsed':''}`}><DashboardSidebar roleTitle={translate('adminDashboard',language).toUpperCase()} groups={menuGroups.map((group) => ({ ...group, flyoutWhenCollapsed: true }))} activePage={slug} onNavigate={(target)=>navigate(target==='settings'?'account-settings':target)} onToggle={toggleAdminSidebar} collapsed={sidebarCollapsed} mobileOpen={sidebarOpen} onCloseMobile={()=>setSidebarOpen(false)} language={language} className="admin-dashboard-sidebar"/><div className={`mobile-scrim ${sidebarOpen?'visible':''}`} onClick={()=>setSidebarOpen(false)}/><main className="main-area"><DashboardHeader user={user} onNavigate={(target)=>navigate(target==='settings'?'account-settings':target)} onLogout={logout} onToggleSidebar={toggleAdminSidebar} onUserChange={setUser} sidebarExpanded={window.matchMedia('(max-width: 760px)').matches ? sidebarOpen : !sidebarCollapsed}/><div className="content">{globalError&&<div className="alert error">{globalError}<button className="dismiss" onClick={()=>setGlobalError('')}>{translate('dismiss',language)}</button></div>}{slug==='account-settings'?<DashboardSettings user={user}/>:slug==='overview'?<Overview onNavigate={navigate}/>:slug==='profile'?<DataPage slug="profile" user={user} onUserChange={setUser}/>:slug==='reports'?<Reports/>:slug==='settings'?<DataPage slug="settings" user={user} onUserChange={setUser}/>:<DataPage slug={slug} user={user} onUserChange={setUser}/>}</div><footer className="footer">{translate('adminDashboard',language)} <span>•</span> {translateText('Operational data is server-backed',language)}</footer></main></div></>;
}
