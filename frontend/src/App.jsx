import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import apiClient from './api/axios.js';
import { Activity, ArrowLeft, ArrowRight, Award, BadgeCheck, Bell, BookOpen, BriefcaseBusiness, Building2, Cake, CalendarDays, ChartNoAxesCombined, Check, ChevronDown, ChevronLeft, ChevronRight, Church, ClipboardCheck, ClipboardList, Clock3, Compass, CreditCard, ExternalLink, Eye, EyeOff, GraduationCap, Heart, History, Image, Languages, LayoutDashboard, LifeBuoy, LogOut, MapPin, Menu, MessageSquareWarning, MonitorSmartphone, Moon, Music2, Palette, PanelLeftClose, PanelLeftOpen, PartyPopper, Phone, Search, Send, Settings, Shield, ShieldCheck, SlidersHorizontal, Sparkles, Star, Store, Sun, Tags, Target, Trophy, UserRound, Users, Wallet, X } from 'lucide-react';
import { INQUIRY_TYPES, buildContactInfo, validateContactForm } from './contactUtils.js';
import { formatEventBudget, formatEventDate, formatEventDateOnly, formatEventTime } from './eventUtils.js';
import { formatNotificationBadgeCount, getLanguage, setLanguage, setPlatformDefaultLanguage, translate, translateText, useLanguage } from './language.js';
import { setTheme, useTheme } from './theme.js';
import { getDashboardDateRange } from './dashboardUtils.js';
import { summarizeOrganizerDashboard } from './organizerDashboardUtils.js';
import {
  clearPlatformSessionHint,
  createAuthSessionLoader,
  hasPlatformSessionHint,
  setPlatformSessionHint,
} from './authSession.js';
import { adminPathForSlug, adminSlugFromPath } from './adminNavigation.js';
import { withStableKeys } from './listKeys.js';
import { getHomepageCategoryCounts, getHomepageCategoryTranslationKey, getHomepageLocationOptions, getHomepageStatistics, getHomepageTestimonials } from './homepageUtils.js';
import { getHomepageVenueCards } from './homepageVenueUtils.js';
import HomepageSearch from './HomepageSearch.jsx';
import HomepageEventsSection from './HomepageEventsSection.jsx';
import HomepageImage from './HomepageImage.jsx';
import HomepageVenueCarousel from './HomepageVenueCarousel.jsx';
import HomepageTrustStrip from './HomepageTrustStrip.jsx';
import ContactTopBar from './ContactTopBar.js';
import AppFooter from './AppFooter.js';
import PublicNavigation from './PublicNavigation.jsx';
import { getEventCategoryTranslationKey, getListingFiltersFromPath, validateCategoryName } from './publicNavigationUtils.js';
import { CompareVendorsPage, EventCalendarPage, MyFavoritesPage, PopularVenuesPage, RecentlyViewedPage, RecommendationsPage } from './NavigationFeatures.jsx';
import { getComparedVendorIds, toggleComparedVendor } from './navigationFeatureUtils.js';
import HorizontalCarousel from './HorizontalCarousel.jsx';
import { clearDemoSession, findDemoLogin, isValidDemoPassword, readDemoProfile, readDemoSession, saveDemoAccount, saveDemoProfile, saveDemoSession } from './utils/demoAuth.js';
import { readDemoProfilePhoto, removeDemoProfilePhoto, saveDemoProfilePhoto } from './utils/demoProfileStorage.js';
import { createDemoDataService } from './demoData.js';
import { EventCountdown, EventDetailsPage, MyEventBookingsPage, OrganizerEventsManager } from './EventsExperience.jsx';
import OrganizerWorkspace from './OrganizerWorkspace.jsx';
import VendorWorkspace from './VendorWorkspace.jsx';
import CustomerWorkspace from './CustomerWorkspace.jsx';
import { CustomerBookingDetailsPage } from './CustomerBookings.jsx';
import ServiceCategoriesPage from './ServiceCategoriesPage.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { formatCustomerMoney } from './customerMoney.js';
import AdminUserManagement from './AdminUserManagement.jsx';
import AdminRoleManagement from './AdminRoleManagement.jsx';
import AdminVendorVerification from './AdminVendorVerification.jsx';
import AdminEventManagement from './AdminEventManagement.jsx';
import AdminBookingManagement from './AdminBookingManagement.jsx';
import AdminReviewsComplaints from './AdminReviewsComplaints.jsx';
import AdminPaymentManagement from './AdminPaymentManagement.jsx';
import AdminNotifications from './AdminNotifications.jsx';
import AdminAuditLogs from './AdminAuditLogs.jsx';
import AdminProfile from './AdminProfile.jsx';
import AdminSystemSettings from './AdminSystemSettings.jsx';
import AdminHeroImages from './AdminHeroImages.jsx';
import HomeHeroSlider from './HomeHeroSlider.jsx';
import './vendorDirectory.css';

const DEMO_AUTH_ENABLED = import.meta.env.DEV && import.meta.env.VITE_DEMO_AUTH === 'true';
const demoDataService = createDemoDataService({ getSession: readDemoSession });
const menu = [
  ['overview','nav.dashboard.overview',LayoutDashboard], ['users','nav.dashboard.userManagement',Users], ['roles','nav.dashboard.rolesPermissions',Shield],
  ['vendors','nav.dashboard.vendorVerification',BadgeCheck], ['categories','nav.dashboard.serviceCategoryManagement',Tags], ['events','nav.dashboard.eventManagement',CalendarDays],
  ['bookings','nav.dashboard.bookingManagement',ClipboardList], ['package-requests','nav.dashboard.eventPackageRequests',ClipboardList], ['payments','nav.dashboard.paymentRefundManagement',CreditCard], ['reviews','nav.dashboard.reviewsComplaints',MessageSquareWarning], ['complaints','nav.dashboard.complaintManagement',MessageSquareWarning],
  ['messages','nav.dashboard.contactMessages',MessageSquareWarning], ['reports','nav.dashboard.reportsAnalytics',ChartNoAxesCombined], ['notifications','nav.dashboard.notifications',Bell], ['audit-logs','nav.dashboard.auditLogs',Activity],
  ['settings','nav.dashboard.systemSettings',Settings], ['profile','nav.dashboard.profile',UserRound], ['hero-images','nav.dashboard.heroImages',Image]
];
const menuGroups = [
  { id: 'overview', label: 'nav.dashboard.groupOverview', items: [menu[0]] },
  { id: 'management', label: 'nav.dashboard.groupManagement', items: menu.slice(1, 8) },
  { id: 'operations', label: 'nav.dashboard.groupOperations', items: menu.slice(8, 12).concat([menu[13]]) },
  { id: 'insights', label: 'nav.dashboard.groupInsightsSecurity', items: [menu[12], menu[14]] },
  { id: 'configuration', label: 'nav.dashboard.groupConfiguration', items: menu.slice(15, 18) },
];
const modules = {
  users:{title:'User Management', endpoint:'users', columns:['id','full_name','email','phone','roles','status','created_at'], fields:[['full_name','Full name','text'],['email','Email','email'],['phone','Phone','text']], create:true, actions:['role','status']},
  roles:{title:'Role and Permission Management', endpoint:'roles', columns:['id','name','description','is_active','created_at'], fields:[['name','Role name','text'],['description','Description','text']], create:true, actions:['permissions']},
  vendors:{title:'Vendor Verification', endpoint:'vendors', columns:['id','business_name','user_id','category_id','city','verification_status','verification_reason','verified_at'], actions:['verify','reject']},
  categories:{title:'Service Category Management', endpoint:'categories', columns:['id','name','description','is_active','created_at'], fields:[['name','Category name','text'],['description','Description','text']], create:true, actions:['edit','deactivate']},
  events:{title:'Event Management', endpoint:'events', columns:['id','title','event_type','organizer_id','city','venue','start_date','capacity','status'], fields:[['organizer_id','Organizer user ID','number'],['title','Title','text'],['event_type','Event type','text'],['description','Description (optional)','textarea'],['city','City (optional)','text'],['venue','Venue (optional)','text'],['cover_image_url','Cover image URL (optional)','url'],['start_date','Start date','datetime-local'],['end_date','End date (optional)','datetime-local'],['budget','Budget (optional)','number'],['capacity','Capacity (optional)','number'],['status','Status','select','draft,active,booked,in_progress,completed,cancelled'],['notes','Notes (optional)','textarea']], create:true, actions:['edit','deactivate']},
  bookings:{title:'Booking Management', endpoint:'bookings', columns:['id','event_id','vendor_id','service_description','quoted_amount','currency','status','moderation_reason','created_at'], actions:['moderate']},
  'package-requests':{title:'Event Package Requests', endpoint:'event-package-requests', columns:['id','event_id','event_title','event_type','requested_date','requested_location','requester_name','requester_email','service_category','guest_count','budget','notes','status','created_at'], actions:['package-status'], statuses:['new','reviewed','replied','closed']},
  reviews:{title:'Reviews and Complaints', endpoint:'reviews', columns:['id','booking_id','rating','comment','status','created_at'], actions:['review']},
  complaints:{title:'Reviews and Complaints', endpoint:'complaints', columns:['id','user_id','booking_id','subject','details','status','resolution','created_at'], actions:['complaint']},
  messages:{title:'Contact Messages', endpoint:'contact', columns:['reference_id','full_name','email','phone','subject','inquiry_type','message','read_status','status','created_at','archived_at'], actions:['view','read','status','archive','delete'], statuses:['new','reviewed','in_progress','replied','resolved','closed'], inquiryTypes:INQUIRY_TYPES},
  notifications:{title:'Notifications', endpoint:'notifications', columns:['id','user_id','title','message','status','created_at'], readonly:true},
  'audit-logs':{title:'Audit Logs', endpoint:'audit-logs', columns:['id','actor_id','action','entity_type','entity_id','details','ip_address','created_at'], readonly:true},
};
const permissions = ['users:read','users:write','vendors:verify','events:write','bookings:moderate','payments:read','reviews:moderate','categories:write','reports:read','notifications:write'];
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

function AuthBrand({ showEventHubLogo = true, showInstitutionLogo = true }) {
  if (!showEventHubLogo && !showInstitutionLogo) return null;
  return <div className="auth-brand" aria-label="EventHub">
    {showEventHubLogo && <img className="auth-brand-logo" src="/eventhub-logo.png" alt="EventHub" />}
    {showInstitutionLogo && <img className="auth-institution-logo" src="/institution-logo.png" alt="Institutional logo" />}
  </div>;
}

function DashboardSidebar({ roleTitle, groups, activePage, onNavigate, collapsed, mobileOpen, onCloseMobile, language, className = '' }) {
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
      const accessibleLabel = translate(label, language);
      return <button key={id} className={`nav-item ${activePage === id ? 'active' : ''}`} title={accessibleLabel} data-tooltip={accessibleLabel} aria-label={accessibleLabel} aria-current={activePage === id ? 'page' : undefined} onClick={() => {
        setFlyout(null);
        onNavigate(id);
        if (window.matchMedia('(max-width: 760px)').matches) onCloseMobile();
      }}><ItemIcon size={18}/><span>{accessibleLabel}</span>{!flyoutItems && id === 'vendors' && <span className="nav-dot"/>}</button>;
    });
  }

  return <aside ref={sidebarRef} className={`sidebar role-dashboard-sidebar ${className} ${mobileOpen ? 'open' : ''}`} aria-label={`${roleTitle} ${translate('nav.dashboard.navigation', language)}`}>
    <div className="sidebar-brand"><img className="sidebar-brand-logo" src="/eventhub-logo.png" alt="EventHub"/><img className="sidebar-brand-symbol" src="/eventhub-symbol.png" alt="" aria-hidden="true"/><div className="sidebar-brand-copy"><span>{roleTitle}</span></div></div>
    <nav aria-label={translate('nav.dashboard.sections', language)}>{groups.map((group) => {
      const groupLabel = translate(group.label, language);
      return <div className={`nav-group ${group.flyoutWhenCollapsed ? 'has-collapsed-flyout' : 'nav-group-flat'}`} key={group.id}>
      <button className="nav-group-toggle" type="button" title={groupLabel} data-tooltip={groupLabel} aria-label={`${groupLabel} ${translate('nav.dashboard.navigation', language)}`} aria-expanded={collapsed && !mobileOpen ? flyout?.groupId === group.id : Boolean(expandedGroups[group.id])} onClick={(event) => toggleGroup(event, group)}><span>{groupLabel}</span><span className="nav-group-indicator" aria-hidden="true">{collapsed && !mobileOpen ? <ChevronRight size={15}/> : expandedGroups[group.id] ? '−' : '+'}</span></button>
      {expandedGroups[group.id] && <div className="sidebar-group-items">{renderItems(group.items)}</div>}
    </div>;
    })}</nav>
    {flyout && (() => {
      const group = groups.find((entry) => entry.id === flyout.groupId);
      return group ? <div className="sidebar-flyout" style={{ top: `${Math.min(flyout.top, window.innerHeight - Math.min(group.items.length * 45 + 24, window.innerHeight - 24))}px` }} aria-label={`${translate(group.label, language)} ${translate('nav.dashboard.navigation', language)}`}>{renderItems(group.items, true)}</div> : null;
    })()}
  </aside>;
}
const toDemoUser = (profile) => {
  const savedProfile = readDemoProfile(profile.email);
  const name = savedProfile?.name || profile.name;
  return {
    ...profile,
    ...savedProfile,
    name,
    full_name: name,
    id: `demo-${profile.email}`,
  };
};
function navigateBrowserPath(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function api(path, options={}) {
  if (DEMO_AUTH_ENABLED && !path.startsWith('/contact')) {
    if (options.signal?.aborted) throw Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
    const route = path.split('?')[0];
    const method = options.method || 'GET';
    const profilePhotoRoute = /^\/(?:admin|platform)\/profile\/photo$/.test(route);
    if (profilePhotoRoute) {
      const session = readDemoSession();
      if (!session) throw new Error('Please sign in to update your profile.');
      if (route.startsWith('/admin/') && session.role !== 'admin') {
        throw new Error('Administrator access required.');
      }
      if (route.startsWith('/platform/') && session.role === 'admin') {
        throw new Error('Platform account access required.');
      }

      if (method === 'GET') return readDemoProfilePhoto(session.email);
      if (method === 'DELETE') {
        await removeDemoProfilePhoto(session.email);
        return null;
      }
      if (method === 'PUT') {
        const photo = options.body;
        const mimeType = options.headers?.['Content-Type']?.toLowerCase();
        if (!(photo instanceof Blob) || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
          throw new Error('Choose a JPG, PNG, or WebP image.');
        }
        if (photo.size === 0) throw new Error('Choose an image to upload.');
        if (photo.size > 5 * 1024 * 1024) throw new Error('Profile photos must be 5 MB or smaller.');
        const bytes = new Uint8Array(await photo.slice(0, 12).arrayBuffer());
        const jpeg = mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        const png = mimeType === 'image/png' && bytes.length >= 8
          && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
        const webp = mimeType === 'image/webp' && bytes.length >= 12
          && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
          && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
        if (!jpeg && !png && !webp) throw new Error('The selected file does not match its image format.');
        await saveDemoProfilePhoto(session.email, photo);
        return { message: 'Profile photo saved in this browser’s demo storage.' };
      }
      throw new Error('This profile photo action is not supported.');
    }
    if (route === '/admin/profile' && method === 'PATCH') {
      const session = readDemoSession();
      if (!session) throw new Error('Please sign in to update your profile.');
      if (session.role !== 'admin') throw new Error('Administrator access required.');
      let data = {};
      try {
        data = JSON.parse(options.body || '{}');
      } catch {
        throw new Error('Invalid profile update data.');
      }
      const keys = Object.keys(data);
      if (!keys.length || keys.some((key) => !['full_name', 'phone'].includes(key))
        || typeof data.full_name !== 'string' || !data.full_name.trim() || data.full_name.trim().length > 160
        || !(typeof data.phone === 'string' || data.phone === null) || (data.phone || '').length > 40) {
        throw new Error('Enter a valid name and phone number.');
      }
      const savedProfile = saveDemoProfile(session.email, data);
      return {
        user: {
          id: `demo-${session.email}`,
          full_name: savedProfile.name,
          email: session.email,
          phone: savedProfile.phone,
          role: session.role,
        },
      };
    }
    return demoDataService.request(path, options);
  }
  try {
    const response = await apiClient.request({
      url: path,
      method: options.method || 'GET',
      data: options.body,
      signal: options.signal,
      responseType: options.responseType,
      headers: { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) },
    });
    if (['/platform/login', '/platform/register'].includes(path)) setPlatformSessionHint();
    if (path === '/platform/logout') clearPlatformSessionHint();
    if (response.status === 204) return null;
    return response.data === '' || response.data === undefined ? {} : response.data;
  } catch (error) {
    if (axios.isCancel(error)) {
      throw Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
    }
    throw error;
  }
}

const authSessionLoader = createAuthSessionLoader({
  getAdminSession: () => api('/auth/me'),
  getPlatformSession: () => api('/platform/me'),
  hasPlatformSession: hasPlatformSessionHint,
  clearPlatformSession: clearPlatformSessionHint,
});

function useAuthSessionSnapshot() {
  return useSyncExternalStore(
    authSessionLoader.subscribe,
    authSessionLoader.getSnapshot,
    authSessionLoader.getSnapshot,
  );
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

function resolveApiAssetUrl(path) {
  if (!path || !path.startsWith('/api/')) return path;
  const baseUrl = apiClient.defaults.baseURL;
  if (!baseUrl || baseUrl.startsWith('/')) return path;
  return new URL(path, baseUrl).toString();
}

function Modal({title,children,onClose,onSubmit,busy,submitLabel='Save',cancelLabel='Cancel',closeLabel='Close',danger=false}) {
  return <div className="overlay" onMouseDown={(event)=>event.target===event.currentTarget && !busy && onClose()}><form className="modal" onSubmit={onSubmit}><div className="modal-head"><h2>{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label={closeLabel}><X size={18}/></button></div><div className="modal-body">{children}</div><div className="modal-foot"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>{cancelLabel}</button><button className={`button ${danger?'danger':''}`} disabled={busy}>{busy?'Saving…':submitLabel}</button></div></form></div>;
}

const PUBLIC_NOTIFICATION_ENDPOINTS = {
  admin: '/admin/notifications?page=1&pageSize=8',
  customer: '/customer/notifications',
  organizer: '/platform/organizer/notifications',
  vendor: '/vendor/notifications',
};
const PUBLIC_NOTIFICATION_COUNT_ENDPOINTS = {
  customer: '/customer/overview',
  organizer: '/platform/organizer/overview',
  vendor: '/vendor/overview',
};

function getHeaderSearchSuggestion(type, item) {
  const id = item.id ?? item.slug ?? item.name;
  const name = type === 'vendors'
    ? item.business_name || item.name
    : type === 'categories'
      ? item.name
      : item.title;
  if (!name || id === undefined || id === null) return null;
  const path = type === 'categories'
    ? `/categories/${encodeURIComponent(item.slug || item.name)}`
    : `/${type}/${encodeURIComponent(id)}`;
  return {
    id: `${type}-${id}`,
    name,
    detail: item.city || item.location || item.category || item.type || '',
    path,
  };
}

function isUnreadNotification(item) {
  return !(item.read || item.status === 'read');
}

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

function SessionStatusNotice({ sessionState }) {
  const [retryReady, setRetryReady] = useState(() => !sessionState.retryAt || sessionState.retryAt <= Date.now());

  useEffect(() => {
    if (!sessionState.retryAt) {
      setRetryReady(true);
      return undefined;
    }
    const delay = sessionState.retryAt - Date.now();
    if (delay <= 0) {
      setRetryReady(true);
      return undefined;
    }
    setRetryReady(false);
    const timer = window.setTimeout(() => setRetryReady(true), delay);
    return () => window.clearTimeout(timer);
  }, [sessionState.retryAt]);

  return <div className={`auth-session-notice alert ${sessionState.status === 'rate-limited' ? 'warning' : 'error'}`} role="alert">
    <span>{sessionState.message}</span>
    <button className="text-link" type="button" disabled={!retryReady} onClick={() => { void authSessionLoader.load({ force: true }); }}>Retry session check</button>
  </div>;
}

function SessionRecoveryPage({ sessionState }) {
  return <main className="login-wrap"><section className="login-card">
    <AuthBrand />
    <h1>Session verification unavailable</h1>
    <p className="muted">We could not verify your account. Your public browsing remains available; retry before opening a protected workspace.</p>
    <SessionStatusNotice sessionState={sessionState}/>
    <a className="auth-home-link" href="/">Back to Home</a>
  </section></main>;
}

function AppHeader({ user, currentPath, onNavigate, onLogout, onOpenLogin, onOpenRegister }) {
  const language = useLanguage();
  const authSessionState = useAuthSessionSnapshot();
  const platformName = document.documentElement.dataset.platformName || 'EventHub';
  const platformLogo = document.documentElement.dataset.brandingLogoUrl || '';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationItems, setNotificationItems] = useState([]);
  const [notificationUnreadTotal, setNotificationUnreadTotal] = useState(null);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationActionError, setNotificationActionError] = useState('');
  const [notificationRetry, setNotificationRetry] = useState(0);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchRetry, setSearchRetry] = useState(0);
  const [activeSearchSuggestion, setActiveSearchSuggestion] = useState(-1);
  const isAuthenticated = Boolean(user);
  const routePath = currentPath.split('?')[0];
  const accountMenuRef = useRef(null);
  const headerToolsRef = useRef(null);
  const searchInputRef = useRef(null);
  const role = user?.role || 'customer';
  const notificationEndpoint = isAuthenticated && authSessionState.status === 'authenticated'
    ? PUBLIC_NOTIFICATION_ENDPOINTS[role]
    : null;
  const notificationBasePath = notificationEndpoint?.split('?')[0];
  const unreadCount = notificationUnreadTotal ?? notificationItems.filter(isUnreadNotification).length;
  const dashboardPath = dashboardPathForRole(role);
  const profilePath = role === 'admin'
    ? '/admin/profile'
    : `${dashboardPath}?view=${role === 'vendor' ? 'account' : 'profile'}`;
  const displayName = user?.name || user?.full_name || user?.email || 'EventHub User';

  useEffect(() => {
    if (!notificationEndpoint) {
      setNotificationItems([]);
      setNotificationUnreadTotal(null);
      setNotificationLoading(false);
      setNotificationError('');
      setNotificationsOpen(false);
      return undefined;
    }

    const controller = new AbortController();
    setNotificationUnreadTotal(null);
    setNotificationLoading(true);
    setNotificationError('');
    const unreadCountRequest = role === 'admin'
      ? Promise.resolve(null)
      : api(PUBLIC_NOTIFICATION_COUNT_ENDPOINTS[role], { signal: controller.signal });
    Promise.all([
      api(notificationEndpoint, { signal: controller.signal }),
      unreadCountRequest,
    ])
      .then(([response, countResponse]) => {
        if (!Array.isArray(response?.data)) throw new Error('Notifications could not be loaded because the response was invalid.');
        setNotificationItems(response.data);
        const unreadTotal = role === 'admin' ? response.unreadCount : countResponse?.data?.unreadNotifications;
        if (!Number.isFinite(unreadTotal)) throw new Error('The unread notification count could not be loaded.');
        setNotificationUnreadTotal(Math.max(0, unreadTotal));
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setNotificationError(error.message || 'Notifications could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setNotificationLoading(false);
      });

    return () => controller.abort();
  }, [notificationEndpoint, notificationRetry, role]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    searchInputRef.current?.focus();
    const term = searchQuery.trim();
    if (term.length < 2) {
      setSearchSuggestions([]);
      setSearchLoading(false);
      setSearchError('');
      setActiveSearchSuggestion(-1);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError('');
      const encodedQuery = encodeURIComponent(term);
      const responses = await Promise.allSettled([
        api(`/platform/events?search=${encodedQuery}&page=1&limit=3`, { signal: controller.signal }),
        api(`/platform/vendors?search=${encodedQuery}&page=1&limit=3`, { signal: controller.signal }),
        api(`/platform/services?search=${encodedQuery}&page=1&limit=3`, { signal: controller.signal }),
        api(`/platform/categories?search=${encodedQuery}`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;

      const suggestions = responses.flatMap((response, index) => {
        if (response.status !== 'fulfilled') return [];
        const type = ['events', 'vendors', 'services', 'categories'][index];
        const records = Array.isArray(response.value?.data) ? response.value.data : [];
        return records.map((item) => getHeaderSearchSuggestion(type, item)).filter(Boolean);
      }).slice(0, 8);
      setSearchSuggestions(suggestions);
      setSearchError(responses.every((response) => response.status === 'rejected') ? 'failed' : '');
      setSearchLoading(false);
      setActiveSearchSuggestion(-1);
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchOpen, searchQuery, searchRetry]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!headerToolsRef.current?.contains(event.target)) {
        setNotificationsOpen(false);
        setSearchOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setNotificationsOpen(false);
        setSearchOpen(false);
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
    if (searchOpen) setNotificationsOpen(false);
  }, [searchOpen]);

  function closeSearch() {
    setSearchOpen(false);
    setActiveSearchSuggestion(-1);
  }

  function submitHeaderSearch(event) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      searchInputRef.current?.focus();
      return;
    }
    closeSearch();
    onNavigate(`/search?q=${encodeURIComponent(query)}`);
  }

  function chooseHeaderSearchSuggestion(suggestion) {
    closeSearch();
    onNavigate(suggestion.path);
  }

  function handleHeaderSearchKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    } else if (event.key === 'ArrowDown' && searchSuggestions.length) {
      event.preventDefault();
      setActiveSearchSuggestion((index) => (index + 1) % searchSuggestions.length);
    } else if (event.key === 'ArrowUp' && searchSuggestions.length) {
      event.preventDefault();
      setActiveSearchSuggestion((index) => index <= 0 ? searchSuggestions.length - 1 : index - 1);
    } else if (event.key === 'Enter' && activeSearchSuggestion >= 0 && searchSuggestions[activeSearchSuggestion]) {
      event.preventDefault();
      chooseHeaderSearchSuggestion(searchSuggestions[activeSearchSuggestion]);
    }
  }

  async function markNotificationRead(notification) {
    if (!notificationBasePath || notificationBusy) return;
    setNotificationBusy(true);
    setNotificationActionError('');
    try {
      await api(`${notificationBasePath}/${notification.id}/read`, { method: 'POST' });
      setNotificationItems((items) => items.map((item) => item.id === notification.id
        ? { ...item, read: true, status: 'read' }
        : item));
      if (isUnreadNotification(notification)) {
        setNotificationUnreadTotal((count) => count === null ? null : Math.max(0, count - 1));
      }
    } catch (error) {
      setNotificationActionError(error.message || translate('notificationUpdateFailed', language));
    } finally {
      setNotificationBusy(false);
    }
  }

  async function markAllNotificationsRead() {
    if (!notificationBasePath || notificationBusy) return;
    setNotificationBusy(true);
    setNotificationActionError('');
    try {
      await api(`${notificationBasePath}/read-all`, { method: 'POST' });
      setNotificationItems((items) => items.map((item) => ({ ...item, read: true, status: 'read' })));
      setNotificationUnreadTotal(0);
    } catch (error) {
      setNotificationActionError(error.message || translate('notificationUpdateFailed', language));
    } finally {
      setNotificationBusy(false);
    }
  }

  function viewAllNotifications() {
    setNotificationsOpen(false);
    onNavigate(role === 'admin' ? '/admin/notifications' : `${dashboardPath}?view=notifications`);
  }

  return <><ContactTopBar/><header className="site-header"><div className="site-header-inner">
    <a className="site-brand" href="/" aria-label={translate('goHome', language)} onClick={(event) => { event.preventDefault(); onNavigate('/'); }}><img className="site-brand-logo" src={platformLogo || '/eventhub-logo.png'} alt={platformName} /></a>
    <button type="button" className="mobile-nav-toggle" aria-label={translate(mobileMenuOpen ? 'closeMenu' : 'openMenu', language)} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
    <PublicNavigation currentPath={currentPath} mobileOpen={mobileMenuOpen} onCloseMobile={closeMobileMenu} onNavigate={onNavigate} api={api} user={user} />
    <div className="header-actions public-header-actions">
      <div className="public-header-tools" ref={headerToolsRef}>
        <div className="public-search-anchor">
          <button type="button" className="public-header-icon-button public-global-search" aria-label={translate('search', language)} title={translate('search', language)} aria-expanded={searchOpen} aria-controls="header-search-panel" onClick={() => { setNotificationsOpen(false); setSearchOpen((open) => !open); }}><Search size={19} aria-hidden="true"/></button>
          {searchOpen && <section id="header-search-panel" className="public-search-panel" aria-label={translate('search', language)}>
            <form role="search" onSubmit={submitHeaderSearch}>
              <label className="visually-hidden" htmlFor="header-search-input">{translate('searchAll', language)}</label>
              <div className="public-search-input-row">
                <Search size={18} aria-hidden="true"/>
                <input
                  id="header-search-input"
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  maxLength="120"
                  placeholder={translate('searchAll', language)}
                  aria-label={translate('searchAll', language)}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={searchLoading || searchError !== '' || searchSuggestions.length > 0}
                  aria-controls="header-search-suggestions"
                  aria-activedescendant={activeSearchSuggestion >= 0 ? `header-search-option-${activeSearchSuggestion}` : undefined}
                  onChange={(event) => { setSearchQuery(event.target.value); setSearchError(''); setActiveSearchSuggestion(-1); }}
                  onKeyDown={handleHeaderSearchKeyDown}
                />
                <button type="submit" className="public-search-submit" aria-label={translate('search', language)} title={translate('search', language)}><Search size={17} aria-hidden="true"/></button>
              </div>
              {(searchLoading || searchError || searchSuggestions.length > 0 || searchQuery.trim().length >= 2) && <ul id="header-search-suggestions" className="public-search-suggestions" role="listbox">
                {searchLoading ? <li className="public-search-state" role="option" aria-selected="false">{translate('searchLoading', language)}</li>
                  : searchError ? <li className="public-search-state public-search-error" role="none"><span>{translate('searchFailed', language)}</span><button type="button" onClick={() => setSearchRetry((retry) => retry + 1)}>{translate('retry', language)}</button></li>
                    : searchSuggestions.length ? searchSuggestions.map((suggestion, index) => <li role="none" key={suggestion.id}>
                      <button id={`header-search-option-${index}`} type="button" role="option" aria-selected={activeSearchSuggestion === index} onClick={() => chooseHeaderSearchSuggestion(suggestion)}>
                        <span>{suggestion.name}</span>{suggestion.detail && <small>{suggestion.detail}</small>}
                      </button>
                    </li>)
                      : <li className="public-search-state" role="option" aria-selected="false">{translate('searchNoResults', language)}</li>}
              </ul>}
            </form>
          </section>}
        </div>
        {notificationEndpoint && <div className="public-notification-anchor">
          <button type="button" className="public-header-icon-button public-notification-toggle" aria-label={`${translate('notifications', language)}${unreadCount ? `, ${unreadCount} ${translate('unread', language)}` : ''}`} title={translate('notifications', language)} aria-expanded={notificationsOpen} aria-controls="header-notifications-panel" onClick={() => { setSearchOpen(false); setNotificationsOpen((open) => !open); }}><Bell size={19} aria-hidden="true"/>{unreadCount > 0 && <span className="notification-count" aria-label={`${unreadCount} ${translate('unread', language)}`}>{formatNotificationBadgeCount(unreadCount)}</span>}</button>
          {notificationsOpen && <section id="header-notifications-panel" className="public-notification-panel" aria-label={translate('notifications', language)} aria-live="polite">
            <div className="public-notification-heading">
              <div><strong>{translate('notifications', language)}</strong><span>{unreadCount ? `${unreadCount} ${translate('unread', language)}` : translate('allCaughtUp', language)}</span></div>
              {unreadCount > 0 && <button type="button" onClick={markAllNotificationsRead} disabled={notificationBusy}>{translate('markAllAsRead', language)}</button>}
            </div>
            {notificationLoading ? <div className="public-notification-empty" role="status">{translate('notificationsLoading', language)}</div>
              : notificationError ? <div className="public-notification-error"><span>{notificationError}</span><button type="button" onClick={() => setNotificationRetry((retry) => retry + 1)}>{translate('retry', language)}</button></div>
                : notificationItems.length ? <ul>{notificationItems.slice(0, 8).map((item) => <li key={item.id} className={isUnreadNotification(item) ? 'unread' : ''}>
                  <strong>{item.title}</strong><p>{item.message}</p>
                  {(item.createdAt || item.created_at) && <time dateTime={item.createdAt || item.created_at}>{new Date(item.createdAt || item.created_at).toLocaleString()}</time>}
                  {isUnreadNotification(item) && <button type="button" onClick={() => markNotificationRead(item)} disabled={notificationBusy}>{translate('markAsRead', language)}</button>}
                </li>)}</ul> : <div className="public-notification-empty">{translate('allCaughtUp', language)}</div>}
            {notificationActionError && <div className="public-notification-error" role="alert">{translate('notificationUpdateFailed', language)} {notificationActionError}</div>}
            <div className="public-notification-footer"><button type="button" onClick={viewAllNotifications}>{translate('viewAllNotifications', language)}</button></div>
          </section>}
        </div>}
      </div>
      <LanguageSelector user={user}/><ThemeToggle/>
      {isAuthenticated ? <details className="public-account" ref={accountMenuRef}>
      <summary className="public-account-trigger" aria-label={translate('accountControl', language)}><span className="public-account-avatar" aria-hidden="true">{displayName.trim().charAt(0).toUpperCase()}</span><span className="public-account-copy"><strong>{displayName}</strong><small>{translate(`${role}Dashboard`, language)}</small></span><ChevronDown size={15}/></summary>
      <div className="public-account-menu"><button type="button" onClick={() => { accountMenuRef.current.open = false; onNavigate(profilePath); }}>{translate('profile', language)}</button><button type="button" onClick={() => { accountMenuRef.current.open = false; onNavigate(dashboardPath); }}>{translate('goToDashboard', language)}</button><button type="button" onClick={() => { accountMenuRef.current.open = false; onLogout(); }}>{translate('logout', language)}</button></div>
    </details> : <div className="public-auth-actions"><button type="button" className="button secondary small" onClick={onOpenLogin}>{translate('login', language)}</button><button type="button" className="button small" onClick={onOpenRegister}>{translate('register', language)}</button></div>}</div>
  </div></header>{['error', 'rate-limited'].includes(authSessionState.status) && <SessionStatusNotice sessionState={authSessionState}/>}</>;
}

function LanguageSelector({ user, isAdmin = false }) {
  const language = useLanguage();
  const [preferenceError, setPreferenceError] = useState('');
  const [savingPreference, setSavingPreference] = useState(false);
  async function changeLanguage(event) {
    const nextLanguage = event.target.value;
    setLanguage(nextLanguage);
    setPreferenceError('');
    if (!user || DEMO_AUTH_ENABLED) return;
    const roles = Array.isArray(user.roles) ? user.roles : String(user.roles || '').split(',');
    const adminAccount = isAdmin || user.role === 'admin' || roles.some((roleName) => roleName.trim().toLowerCase() === 'admin');
    const endpoint = adminAccount ? '/admin/profile/language' : '/platform/preferences/language';
    setSavingPreference(true);
    try {
      await api(endpoint, {
        method: 'PATCH',
        body: JSON.stringify({ language: nextLanguage }),
      });
    } catch {
      setPreferenceError(translate('languagePreferenceSaveFailed', nextLanguage));
    } finally {
      setSavingPreference(false);
    }
  }

  return <span className="language-picker-wrap">
    <label className="language-picker">
      <span className="visually-hidden">{translate('languageLabel', language)}</span>
      <select value={language} aria-label={translate('languageLabel', language)} onChange={changeLanguage} disabled={savingPreference}>
        <option value="en">English</option>
        <option value="am">አማርኛ</option>
      </select>
    </label>
    {preferenceError && <span className="language-preference-error" role="alert">{preferenceError}</span>}
  </span>;
}

function ThemeToggle() {
  const language = useLanguage();
  const theme = useTheme();
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  return <button type="button" className="theme-toggle" aria-label={translate(theme === 'light' ? 'switchToDarkMode' : 'switchToLightMode', language)} title={translate(theme === 'light' ? 'switchToDarkMode' : 'switchToLightMode', language)} onClick={() => setTheme(nextTheme)}>
    {theme === 'light' ? <Moon size={16}/> : <Sun size={16}/>}<span>{translate(theme === 'light' ? 'lightMode' : 'darkMode', language)}</span>
  </button>;
}

function ProfilePhotoDisplay({ user, isAdmin = false }) {
  const language = useLanguage();
  const [photoUrl, setPhotoUrl] = useState('');
  const roleNames = Array.isArray(user.roles) ? user.roles.join(' ').toLowerCase() : String(user.roles || '').toLowerCase();
  const endpoint = isAdmin || user.role === 'admin' || /admin/i.test(roleNames)
    ? '/admin/profile/photo'
    : '/platform/profile/photo';
  const name = user.name || user.full_name || 'EventHub User';

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setPhotoUrl('');
    api(endpoint, { responseType: 'blob' })
      .then((photo) => {
        if (!active || !photo?.size) return;
        objectUrl = URL.createObjectURL(photo);
        setPhotoUrl(objectUrl);
      })
      .catch((issue) => {
        if (active) console.error('Profile photo could not be loaded:', issue.message);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint, user.id, user.email, user.profilePhotoVersion]);

  return <div className="profile-avatar" aria-label={translate('profilePhoto', language)}>
    {photoUrl ? <img src={photoUrl} alt={`${name}'s profile`} /> : name.trim().charAt(0).toUpperCase() || <UserRound size={20}/>}
  </div>;
}

function DashboardHeader({ user, onLogout, onToggleSidebar, onUserChange, onNavigate, sidebarExpanded, isAdmin = false, isOrganizer = false, isVendor = false, isCustomer = false }) {
  const language = useLanguage();
  const [activePanel, setActivePanel] = useState('');
  const [viewingPhoto, setViewingPhoto] = useState(false);
  const [avatar, setAvatar] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [photoSuccess, setPhotoSuccess] = useState('');
  const headerRef = useRef(null);
  const photoButtonRef = useRef(null);
  const closePhotoButtonRef = useRef(null);
  const photoInputRef = useRef(null);
  const avatarObjectUrlRef = useRef('');
  const previewObjectUrlRef = useRef('');
  const role = user.role || 'customer';
  const name = user.name || user.full_name || 'EventHub User';
  const roleNames = Array.isArray(user.roles) ? user.roles.join(' ').toLowerCase() : String(user.roles || '').toLowerCase();
  const photoEndpoint = isAdmin || user.role === 'admin' || /admin/i.test(roleNames)
    ? '/admin/profile/photo'
    : '/platform/profile/photo';
  const hasServerNotifications = isAdmin || isOrganizer || isVendor || isCustomer;
  const localNotifications = [
    { id: 'booking', title: 'Booking update', message: 'Your recent booking activity is ready to review.', unread: true },
    { id: 'profile', title: 'Profile reminder', message: 'Keep your account details up to date.', unread: true },
    { id: 'welcome', title: 'Welcome to EventHub', message: 'Explore your dashboard and discover what you can do.', unread: false },
  ];
  const [items, setItems] = useState(() => hasServerNotifications ? [] : localNotifications);
  const [notificationLoading, setNotificationLoading] = useState(hasServerNotifications);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const unreadCount = items.filter((item) => item.unread).length;

  const loadAdminNotifications = useCallback(async () => {
    if (!hasServerNotifications) return;
    setNotificationLoading(true);
    setNotificationError('');
    try {
      const endpoint = isAdmin
        ? '/admin/notifications?page=1&pageSize=5&sortBy=created_at&sortDirection=desc'
        : isOrganizer ? '/platform/organizer/notifications' : isVendor ? '/vendor/notifications' : '/customer/notifications';
      const response = await api(endpoint);
      setItems((response.data || []).map((item) => ({ ...item, unread: !item.read })));
    } catch (issue) {
      setNotificationError(issue.message || 'Notifications could not be loaded.');
    } finally {
      setNotificationLoading(false);
    }
  }, [hasServerNotifications, isAdmin, isOrganizer, isVendor]);

  useEffect(() => {
    if (hasServerNotifications) loadAdminNotifications();
  }, [hasServerNotifications, loadAdminNotifications]);

  async function markNotificationRead(item) {
    if (!item.unread) return;
    if (!hasServerNotifications) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, unread: false } : entry));
      return;
    }
    setNotificationBusy(true);
    setNotificationError('');
    try {
      const endpoint = isAdmin
        ? `/admin/notifications/${item.id}/read`
        : isOrganizer ? `/platform/organizer/notifications/${item.id}/read`
          : isVendor ? `/vendor/notifications/${item.id}/read` : `/customer/notifications/${item.id}/read`;
      await api(endpoint, { method: 'POST' });
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, unread: false } : entry));
    } catch (issue) {
      setNotificationError(issue.message || 'The notification could not be marked as read.');
    } finally {
      setNotificationBusy(false);
    }
  }

  async function markAllNotificationsRead() {
    if (!hasServerNotifications) {
      setItems((current) => current.map((item) => ({ ...item, unread: false })));
      return;
    }
    setNotificationBusy(true);
    setNotificationError('');
    try {
      const endpoint = isAdmin ? '/admin/notifications/read-all'
        : isOrganizer ? '/platform/organizer/notifications/read-all'
          : isVendor ? '/vendor/notifications/read-all' : '/customer/notifications/read-all';
      await api(endpoint, { method: 'POST' });
      setItems((current) => current.map((item) => ({ ...item, unread: false })));
    } catch (issue) {
      setNotificationError(issue.message || 'Notifications could not be marked as read.');
    } finally {
      setNotificationBusy(false);
    }
  }

  function updateAvatar(url, ownsObjectUrl = false, refreshProfileViews = false) {
    if (avatarObjectUrlRef.current && avatarObjectUrlRef.current !== url) {
      URL.revokeObjectURL(avatarObjectUrlRef.current);
    }
    avatarObjectUrlRef.current = ownsObjectUrl ? url : '';
    setAvatar(url);
    onUserChange?.((current) => current ? {
      ...current,
      profilePhotoUrl: url,
      ...(refreshProfileViews ? { profilePhotoVersion: Date.now() } : {}),
    } : current);
  }

  function discardPhotoPreview() {
    if (previewObjectUrlRef.current && previewObjectUrlRef.current !== avatarObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
    }
    previewObjectUrlRef.current = '';
    setPreviewUrl('');
    setSelectedPhoto(null);
  }

  useEffect(() => {
    try {
      window.localStorage.removeItem(`eventhub-demo-avatar:${user.email}`);
    } catch (issue) {
      console.error('Legacy browser-stored profile photo could not be removed:', issue);
    }
  }, [user.email]);

  useEffect(() => {
    let active = true;
    let loadedUrl = '';
    setPhotoLoading(true);
    setPhotoError('');
    api(photoEndpoint, { responseType: 'blob' })
      .then((photo) => {
        if (!active) return;
        if (!photo?.size) {
          updateAvatar('');
          return;
        }
        loadedUrl = URL.createObjectURL(photo);
        updateAvatar(loadedUrl, true);
      })
      .catch((issue) => {
        if (active) setPhotoError(issue.message || translate('photoLoadError', language));
      })
      .finally(() => {
        if (active) setPhotoLoading(false);
      });
    return () => {
      active = false;
      if (loadedUrl) {
        URL.revokeObjectURL(loadedUrl);
        if (avatarObjectUrlRef.current === loadedUrl) avatarObjectUrlRef.current = '';
      }
    };
  }, [photoEndpoint, user.id, user.email, user.profilePhotoVersion]);

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

  function chooseProfilePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      discardPhotoPreview();
      setPhotoError(translate('photoInvalidType', language));
      setPhotoSuccess('');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      discardPhotoPreview();
      setPhotoError(translate('photoTooLarge', language));
      setPhotoSuccess('');
      return;
    }
    if (previewObjectUrlRef.current && previewObjectUrlRef.current !== avatarObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
    }
    const nextPreview = URL.createObjectURL(file);
    previewObjectUrlRef.current = nextPreview;
    setSelectedPhoto(file);
    setPreviewUrl(nextPreview);
    setPhotoError('');
    setPhotoSuccess('');
  }

  async function uploadProfilePhoto() {
    if (!selectedPhoto) return;
    setPhotoSaving(true);
    setPhotoError('');
    setPhotoSuccess('');
    try {
      await api(photoEndpoint, {
        method: 'PUT',
        body: selectedPhoto,
        headers: { 'Content-Type': selectedPhoto.type },
      });
      const savedPreview = previewObjectUrlRef.current;
      previewObjectUrlRef.current = '';
      updateAvatar(savedPreview, true, true);
      setPreviewUrl('');
      setSelectedPhoto(null);
      setPhotoSuccess(translate(DEMO_AUTH_ENABLED ? 'demoPhotoSaved' : 'photoSaved', language));
    } catch (issue) {
      setPhotoError(issue.message || translate('photoUploadError', language));
    } finally {
      setPhotoSaving(false);
    }
  }

  async function removeProfilePhoto() {
    setPhotoSaving(true);
    setPhotoError('');
    setPhotoSuccess('');
    try {
      await api(photoEndpoint, { method: 'DELETE' });
      discardPhotoPreview();
      updateAvatar('', false, true);
      setPhotoSuccess(translate(DEMO_AUTH_ENABLED ? 'demoPhotoRemoved' : 'photoRemoved', language));
    } catch (issue) {
      setPhotoError(issue.message || translate('photoUploadError', language));
    } finally {
      setPhotoSaving(false);
    }
  }

  function closeProfilePhoto() {
    discardPhotoPreview();
    setViewingPhoto(false);
  }

  return <header className={`dashboard-header ${sidebarExpanded ? 'sidebar-expanded' : ''}`} ref={headerRef}>
    <button className="icon-button dashboard-sidebar-toggle" type="button" onClick={onToggleSidebar} aria-label={sidebarExpanded ? 'Collapse dashboard navigation' : 'Expand dashboard navigation'} aria-expanded={sidebarExpanded} title={sidebarExpanded ? 'Collapse navigation' : 'Expand navigation'}>{sidebarExpanded ? <PanelLeftClose size={19}/> : <PanelLeftOpen size={19}/>}</button>
    <div className="dashboard-header-actions">
      <LanguageSelector user={user} isAdmin={isAdmin}/>
      <ThemeToggle/>
      <div className="dashboard-popover-anchor">
        <button className="icon-button notification-toggle" type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={activePanel === 'notifications'} onClick={() => { const opening = activePanel !== 'notifications'; setActivePanel(opening ? 'notifications' : ''); if (opening && hasServerNotifications) loadAdminNotifications(); }}><Bell size={19}/>{unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}</button>
        {activePanel === 'notifications' && <section className="dashboard-popover notification-popover" aria-label="Notifications">
          <div className="popover-heading"><div><strong>Notifications</strong><span>{unreadCount ? `${unreadCount} unread` : 'All caught up'}</span></div><button className="text-action" type="button" onClick={markAllNotificationsRead} disabled={!unreadCount || notificationBusy}>Mark all read</button></div>
          {notificationError && <div className="alert error" role="alert">{notificationError}</div>}
          {notificationLoading ? <div className="notification-empty" role="status">Loading notifications...</div> : items.length ? <div className="notification-list">{items.map((item) => <article className={`notification-item ${item.unread ? 'unread' : ''}`} key={item.id}><div>{(isOrganizer || isVendor || isCustomer) && item.relatedType ? <button className="organizer-notification-link" type="button" onClick={() => { if (item.unread) markNotificationRead(item); setActivePanel(''); onNavigate?.(item.relatedType === 'booking' ? 'bookings' : item.relatedType === 'quotation' ? 'quotations' : item.relatedType === 'review' ? 'reviews' : 'events'); }}>{item.title}<ExternalLink size={13}/></button> : <strong>{item.title}</strong>}<p>{item.message}</p></div>{item.unread && <button className="text-action" type="button" onClick={() => markNotificationRead(item)} disabled={notificationBusy}>Mark read</button>}</article>)}</div> : <div className="notification-empty"><Bell size={20}/><strong>No notifications</strong><span>You’re all caught up.</span></div>}
          <div className="popover-footer">{hasServerNotifications ? <button className="text-action" type="button" onClick={() => { setActivePanel(''); onNavigate?.('notifications'); }}>View all notifications</button> : <button className="text-action subtle-danger" type="button" onClick={() => setItems([])} disabled={!items.length}>Clear notifications</button>}</div>
        </section>}
      </div>
      <button ref={photoButtonRef} className="dashboard-photo-toggle" type="button" aria-label={`${translate('profilePhoto', language)}: ${name}`} title={translate('profilePhoto', language)} onClick={() => { setActivePanel(''); setPhotoError(''); setPhotoSuccess(''); setViewingPhoto(true); }}>
        <span className="dashboard-avatar">{avatar ? <img src={avatar} alt="" /> : <UserRound size={19}/>}</span>
      </button>
      <div className="dashboard-profile-copy"><strong>{name}</strong><small>{role}</small></div>
      <button className="icon-button dashboard-logout" type="button" aria-label={translate('logout', language)} title={translate('logout', language)} onClick={onLogout}><LogOut size={17}/></button>
    </div>
    {viewingPhoto && <div className="profile-photo-overlay" onClick={(event) => { if (event.target === event.currentTarget) closeProfilePhoto(); }}>
      <section className="profile-photo-modal" role="dialog" aria-modal="true" aria-labelledby="profile-photo-title">
        <button ref={closePhotoButtonRef} className="icon-button profile-photo-close" type="button" aria-label={translate('close', language)} onClick={closeProfilePhoto}><X size={19}/></button>
        <h2 id="profile-photo-title">{translate('profilePhoto', language)}</h2>
        <div className="profile-photo-preview">{previewUrl || avatar ? <img src={previewUrl || avatar} alt={`${name}'s profile`} /> : <UserRound size={104} aria-label={translate('defaultProfileAvatar', language)}/>}</div>
        <strong className="profile-photo-name">{name}</strong>
        <span className="profile-photo-email">{user.email}</span>
        <span className="profile-photo-role">{role}</span>
        <input ref={photoInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseProfilePhoto} aria-label={translate('choosePhoto', language)} />
        {photoError && <p className="profile-photo-message error" role="alert">{photoError}</p>}
        {photoSuccess && <p className="profile-photo-message success" role="status">{photoSuccess}</p>}
        {photoLoading && <p className="profile-photo-loading" role="status">{translate('photoLoading', language)}</p>}
        <div className="profile-photo-actions">
          {photoSaving && <p className="profile-photo-loading" role="status">{translate('photoSaving', language)}</p>}
          {selectedPhoto ? <>
            <button type="button" className="button" onClick={uploadProfilePhoto} disabled={photoLoading || photoSaving}>{translate('uploadPhoto', language)}</button>
            <button type="button" className="button secondary" onClick={discardPhotoPreview} disabled={photoLoading || photoSaving}>{translate('cancel', language)}</button>
          </> : <>
            <button type="button" className="button" onClick={() => photoInputRef.current?.click()} disabled={photoLoading || photoSaving}>{avatar ? translate('changePhoto', language) : translate('uploadPhoto', language)}</button>
            {avatar && <button type="button" className="button secondary" onClick={removeProfilePhoto} disabled={photoLoading || photoSaving}>{translate('removePhoto', language)}</button>}
          </>}
        </div>
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

function SearchResultsPage({ initialQuery, initialCategory = '', initialLocation = '', onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);
  const [location, setLocation] = useState(initialLocation);
  const [results, setResults] = useState({ events: [], vendors: [], services: [], categories: [] });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(Boolean(initialQuery || initialCategory || initialLocation));
  const [searchError, setSearchError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const term = initialQuery.trim();
    if (!term && !initialCategory && !initialLocation) {
      setLoading(false);
      setResults({ events: [], vendors: [], services: [], categories: [] });
      setErrors({});
      return undefined;
    }

    let active = true;
    setLoading(true);
    setErrors({});
    const params = new URLSearchParams();
    if (term) params.set('search', term);
    if (initialCategory) params.set('category', initialCategory);
    if (initialLocation) params.set('location', initialLocation);
    params.set('page', '1');
    params.set('limit', '6');
    const listingQuery = params.toString();
    const categorySearch = new URLSearchParams({ search: term || initialCategory }).toString();
    Promise.allSettled([
      api(`/platform/events?${listingQuery}`),
      api(`/platform/vendors?${listingQuery}`),
      api(`/platform/services?${listingQuery}`),
      api(`/platform/categories?${categorySearch}`),
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
  }, [initialQuery, initialCategory, initialLocation, retryKey]);

  function submitSearch(event) {
    event.preventDefault();
    const term = query.trim();
    if (!term && !category && !location) {
      setSearchError('Enter a search term or choose a category or location.');
      return;
    }
    setSearchError('');
    const params = new URLSearchParams();
    if (term) params.set('q', term);
    if (category) params.set('category', category);
    if (location) params.set('location', location);
    onNavigate(`/search?${params.toString()}`);
  }

  const sections = [
    { key: 'events', title: 'Events', getTitle: (item) => item.title, getPath: (item) => `/events/${encodeURIComponent(item.id)}` },
    { key: 'vendors', title: 'Vendors', getTitle: (item) => item.business_name || item.name, getPath: (item) => `/vendors/${encodeURIComponent(item.id)}` },
    { key: 'services', title: 'Services', getTitle: (item) => item.title, getPath: (item) => `/services/${encodeURIComponent(item.id)}` },
    { key: 'categories', title: 'Categories', getTitle: (item) => item.name, getPath: (item) => `/categories/${encodeURIComponent(item.slug || item.name)}` },
  ];
  const hasResults = Object.values(results).some((items) => items.length > 0);
  const categoryOptions = results.categories;
  const searchLocations = [...new Set([...getHomepageLocationOptions(results.events, results.vendors, results.services), initialLocation].filter(Boolean))];
  const hasSearch = Boolean(initialQuery || initialCategory || initialLocation);
  function getListingPath(key) {
    const params = new URLSearchParams();
    if (initialQuery.trim()) params.set('search', initialQuery.trim());
    if (initialCategory) params.set('category', initialCategory);
    if (initialLocation) params.set('location', initialLocation);
    return `/${key}${params.size ? `?${params.toString()}` : ''}`;
  }

  return <main className="page-shell"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">DISCOVERY</p><h1>Search EventHub</h1><p className="muted">Search events, vendors, services, categories, and locations.</p></div></div>
    <form className="panel home-global-search" role="search" onSubmit={submitSearch}>
      <label className="search-box"><Search size={16}/><input autoFocus type="search" maxLength="120" value={query} onChange={(event) => { setQuery(event.target.value); setSearchError(''); }} aria-label="Search events, vendors, services, categories, and locations" placeholder="Try a service, city, or category" /></label>
      <label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categoryOptions.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
      <label className="field"><span>Location</span><select value={location} onChange={(event) => setLocation(event.target.value)}><option value="">All locations</option>{searchLocations.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <button className="button" type="submit">Search</button>
    </form>
    {searchError && <p className="field-error" role="alert">{searchError}</p>}
    {loading ? <div className="loading" role="status"><span className="spinner"/>Searching public listings…</div>
      : hasSearch ? <div className="search-result-sections">
        {sections.map((section) => <section key={section.key} className="content-stack">
          <div className="section-header compact-header"><div><p className="eyebrow">{section.title.toUpperCase()}</p><h2>{section.title}</h2></div>{section.key !== 'categories' && <button className="button secondary small" type="button" onClick={() => onNavigate(getListingPath(section.key))}>{t('viewAll')}</button>}</div>
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
  const [documents, setDocuments] = useState([]);
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [form, setForm] = useState({ businessName: '', categoryId: '', city: '', description: '' });
  const [loading, setLoading] = useState(Boolean(user));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [categoryRetry, setCategoryRetry] = useState(0);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!user || !['customer', 'organizer'].includes(user.role)) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    Promise.allSettled([api('/platform/vendor-application'), api('/platform/categories'), api('/platform/vendor-application/documents')]).then(([applicationResult, categoryResult, documentResult]) => {
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
      if (documentResult.status === 'fulfilled') setDocuments(Array.isArray(documentResult.value?.data) ? documentResult.value.data : []);
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
      for (const file of selectedDocuments) {
        await api(`/platform/vendor-application/documents?filename=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': file.type },
        });
      }
      if (selectedDocuments.length) {
        const documentResponse = await api('/platform/vendor-application/documents');
        setDocuments(documentResponse.data || []);
        setSelectedDocuments([]);
      }
      setNotice(response?.message || 'Your application was submitted for review.');
    } catch (issue) {
      setError(issue.message || 'Unable to submit your vendor application.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadApplicationDocuments(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      for (const file of selectedDocuments) {
        await api(`/platform/vendor-application/documents?filename=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': file.type },
        });
      }
      const response = await api('/platform/vendor-application/documents');
      setDocuments(response.data || []);
      setSelectedDocuments([]);
      setNotice('Verification documents uploaded securely.');
    } catch (issue) {
      setError(issue.message || 'Unable to upload verification documents.');
    } finally {
      setBusy(false);
    }
  }

  function chooseVerificationDocuments(event) {
    const files = Array.from(event.target.files || []);
    const invalid = files.find((file) => !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024);
    if (invalid) {
      setError('Upload PDF, JPEG, or PNG files that are no larger than 5 MB each.');
      setSelectedDocuments([]);
      event.target.value = '';
      return;
    }
    setError('');
    setSelectedDocuments(files);
  }

  if (!user) return <main className="page-shell"><div className="content-stack"><div className="empty panel"><strong>Sign in to apply as a vendor</strong><span>Vendor applications are linked to your EventHub account and reviewed before approval.</span><button className="button" type="button" onClick={() => { sessionStorage.setItem('eventhub_after_login', '/vendor-application'); onNavigate('/login'); }}>Sign in</button><button className="button secondary" type="button" onClick={() => onNavigate('/register')}>{translate('publicCreateVendorAccount', language)}</button></div></div></main>;
  if (user.role === 'vendor') return <main className="page-shell"><div className="empty panel"><strong>Vendor account</strong><span>Manage your vendor profile and application status from your dashboard.</span><button className="button" type="button" onClick={() => onNavigate('/vendor/dashboard')}>Open vendor dashboard</button></div></main>;
  if (user.role === 'admin') return <main className="page-shell"><div className="empty panel"><strong>Admin account</strong><span>Vendor approval and role management remain with the admin dashboard.</span><button className="button" type="button" onClick={() => onNavigate('/admin')}>Open admin dashboard</button></div></main>;
  if (!['customer', 'organizer'].includes(user.role)) return <main className="page-shell"><div className="alert error">This account is not eligible to submit a vendor application.</div></main>;

  return <main className="page-shell"><div className="content-stack vendor-application-page">
    <div className="section-header"><div><p className="eyebrow">VENDOR ONBOARDING</p><h1>Apply to become a vendor</h1><p className="muted">Applications are reviewed by the EventHub team. Submitting this form does not grant vendor access.</p></div></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {categoryError && <div className="alert warning" role="status">{categoryError} You may submit without selecting a category.</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {loading ? <div className="loading" role="status"><span className="spinner"/>Loading application status…</div>
      : ['pending', 'under_review'].includes(application?.verification_status) ? <section className="panel vendor-application-status"><span className="pill pending">{application.verification_status === 'pending' ? 'Pending review' : 'Under review'}</span><h2>{application.business_name}</h2><p>Your application is with our review team. You may submit supporting documents while it is being reviewed.</p>{application.category_name && <p>Category: {application.category_name}</p>}<form onSubmit={uploadApplicationDocuments}><label className="field"><span>Verification documents (PDF, JPEG, PNG; up to 5 MB each)</span><input type="file" accept="application/pdf,image/jpeg,image/png" multiple onChange={chooseVerificationDocuments}/></label>{selectedDocuments.length > 0 && <p>{selectedDocuments.length} document(s) selected.</p>}<button type="submit" className="button secondary" disabled={busy || !selectedDocuments.length}>{busy ? 'Uploading…' : 'Upload documents'}</button></form>{documents.length > 0 && <div className="list-stack">{documents.map((document) => <div key={document.id} className="list-card"><strong>{document.original_name}</strong><small>{document.content_type} · {Math.ceil(document.file_size / 1024)} KB</small></div>)}</div>}</section>
        : application?.verification_status === 'verified' ? <section className="panel vendor-application-status"><span className="pill verified">Approved</span><h2>{application.business_name}</h2><p>Your vendor profile has been approved. Vendor permissions are not granted automatically; contact an administrator if your account role has not been updated.</p></section>
          : <form className="panel vendor-application-form" onSubmit={submitApplication}>
            {application?.verification_status === 'rejected' && <p className="alert error">Previous application was not approved: {application.verification_reason || 'No reason was provided.'} You may update the details and resubmit.</p>}
            {application?.verification_status === 'information_requested' && <p className="alert warning">Additional information was requested: {application.verification_reason || 'Review the requested information and update your application.'}</p>}
            <label className="field"><span>Business name</span><input name="businessName" minLength="2" maxLength="160" required value={form.businessName} onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))}/></label>
            <label className="field"><span>Service category</span><select name="categoryId" value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}><option value="">Select a category (optional)</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="field"><span>City or service area</span><input name="city" maxLength="120" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}/></label>
            <label className="field"><span>Business description</span><textarea name="description" rows="4" maxLength="1500" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}/></label>
            <label className="field"><span>Verification documents (PDF, JPEG, PNG; up to 5 MB each)</span><input type="file" accept="application/pdf,image/jpeg,image/png" multiple onChange={chooseVerificationDocuments}/></label>
            {selectedDocuments.length > 0 && <p>{selectedDocuments.length} document(s) selected.</p>}
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
  const [featuredEvents, setFeaturedEvents] = useState([]);
  const [popularVenues, setPopularVenues] = useState([]);
  const [categories, setCategories] = useState([]);
  const [eventCategories, setEventCategories] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState({});
  const [retryKey, setRetryKey] = useState(0);
  const [savedVendorIds, setSavedVendorIds] = useState([]);
  const [savedVendorCategories, setSavedVendorCategories] = useState([]);
  const [favoriteBusyId, setFavoriteBusyId] = useState(null);
  const [favoriteMessage, setFavoriteMessage] = useState('');
  const [favoriteError, setFavoriteError] = useState('');
  const [requestService, setRequestService] = useState(null);

  const translateCategoryName = (name) => {
    const key = getHomepageCategoryTranslationKey(name);
    return key ? t(key) : translateText(name, language);
  };

  const categoryCards = categories.map((category) => ({
    ...category,
    path: `/categories/${encodeURIComponent(category.slug || category.name)}`,
  }));

  useEffect(() => {
    const controller = new AbortController();
    async function loadLandingData() {
      setLoading(true);
      const results = await Promise.allSettled([
        api('/about/homepage-statistics', { signal: controller.signal }),
        api('/platform/categories', { signal: controller.signal }),
        api('/platform/vendors?page=1&limit=4&sort=recommended', { signal: controller.signal }),
        api('/platform/services?page=1&limit=4&sort=recommended', { signal: controller.signal }),
        api('/platform/events?filter=upcoming&page=1&limit=6&sort=upcoming', { signal: controller.signal }),
        api('/platform/events?filter=featured&status=upcoming&page=1&limit=6&sort=upcoming', { signal: controller.signal }),
        api('/platform/events/categories', { signal: controller.signal }),
        api('/platform/events/popular-venues?limit=12', { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;

      const [statisticsResult, categoriesResult, vendorsResult, servicesResult, eventsResult, featuredResult, eventCategoriesResult, venuesResult] = results;
      const nextErrors = {};
      const getData = (result, key, expected = 'array') => {
        if (result.status === 'rejected') {
          nextErrors[key] = true;
          return null;
        }
        const data = result.value?.data;
        const valid = expected === 'object'
          ? data && typeof data === 'object' && !Array.isArray(data)
          : Array.isArray(data);
        if (!valid) nextErrors[key] = true;
        return valid ? data : null;
      };
      const statistics = getData(statisticsResult, 'statistics', 'object');
      const categoryData = getData(categoriesResult, 'categories');
      const vendorData = getData(vendorsResult, 'vendors');
      const serviceData = getData(servicesResult, 'services');
      const eventData = getData(eventsResult, 'events');
      const featuredData = getData(featuredResult, 'featuredEvents');
      const eventCategoryData = getData(eventCategoriesResult, 'eventCategories');
      const venueData = getData(venuesResult, 'venues');
      const reviewVendors = Array.isArray(vendorData)
        ? vendorData.filter((vendor) => vendor?.id && (
          vendor.verified === true
          || vendor.verificationStatus === 'verified'
          || vendor.verification_status === 'verified'
        )).slice(0, 4)
        : [];
      const reviewResults = await Promise.allSettled(reviewVendors.map((vendor) =>
        api(`/platform/vendors/${encodeURIComponent(vendor.id)}`, { signal: controller.signal })));
      if (controller.signal.aborted) return;
      const validReviewResults = reviewResults.filter((result) =>
        result.status === 'fulfilled' && Array.isArray(result.value?.data?.reviews));
      if (reviewVendors.length > 0 && validReviewResults.length === 0) nextErrors.testimonials = true;
      const reviewGroups = reviewResults.flatMap((result, index) => (
        result.status === 'fulfilled' && Array.isArray(result.value?.data?.reviews)
          ? [{ vendor: reviewVendors[index], reviews: result.value.data.reviews }]
          : []
      ));
      setSummary(statistics && typeof statistics === 'object' ? statistics : null);
      setCategories(Array.isArray(categoryData) ? categoryData : []);
      setVendors(Array.isArray(vendorData) ? vendorData : []);
      setServices(Array.isArray(serviceData) ? serviceData : []);
      setEvents(Array.isArray(eventData) ? eventData : []);
      setFeaturedEvents(Array.isArray(featuredData) ? featuredData : featuredData && typeof featuredData === 'object' ? [featuredData] : []);
      setPopularVenues(getHomepageVenueCards(
        Array.isArray(venueData) ? venueData : [],
        [
          ...(Array.isArray(eventData) ? eventData : []),
          ...(Array.isArray(featuredData) ? featuredData : featuredData && typeof featuredData === 'object' ? [featuredData] : []),
        ],
      ));
      setEventCategories(Array.isArray(eventCategoryData) ? eventCategoryData : []);
      setTestimonials(getHomepageTestimonials(reviewGroups));
      setLoadErrors(nextErrors);
      setLoading(false);
    }

    loadLandingData();
    return () => controller.abort();
  }, [retryKey]);

  useEffect(() => {
    if (!user || !['customer', 'organizer'].includes(user.role)) {
      setSavedVendorIds([]);
      setSavedVendorCategories([]);
      return undefined;
    }
    const controller = new AbortController();
    const endpoint = user.role === 'organizer' ? '/platform/organizer/favorites' : '/customer/favorites';
    api(endpoint, { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) {
        const savedVendors = Array.isArray(response?.data) ? response.data : [];
        setSavedVendorIds(savedVendors.map((vendor) => Number(vendor.id)).filter(Number.isFinite));
        setSavedVendorCategories(savedVendors.map((vendor) => String(vendor.category || '').trim().toLocaleLowerCase()).filter(Boolean));
        setFavoriteError('');
      }
    }).catch((error) => {
      if (error.name !== 'AbortError' && !controller.signal.aborted) setFavoriteError(error.message || t('publicHomeFavoriteFailed'));
    });
    return () => controller.abort();
  }, [user?.id, user?.role]);

  const displayVendors = vendors.filter((vendor) => vendor.verified === true || vendor.verificationStatus === 'verified' || vendor.verification_status === 'verified').slice(0, 4);
  const displayServices = services.slice(0, 4);
  const stats = getHomepageStatistics(summary);
  const savedCategorySet = new Set(savedVendorCategories);
  const recommendedVendors = user && savedCategorySet.size
    ? displayVendors.filter((vendor) => !savedVendorIds.includes(Number(vendor.id)) && savedCategorySet.has(String(vendor.category || '').trim().toLocaleLowerCase()))
    : [];
  const servicePackages = services.flatMap((service) => (Array.isArray(service.packages) ? service.packages : [])
    .filter((item) => item?.isActive !== false && item?.is_active !== 0 && (!item?.status || ['active', 'published'].includes(String(item.status).toLowerCase())))
    .map((item) => ({ ...item, serviceId: service.id, serviceTitle: service.title })));
  async function toggleVendorFavorite(vendor) {
    const supportedRole = user && ['customer', 'organizer'].includes(user.role);
    if (!supportedRole) {
      try {
        sessionStorage.setItem('eventhub_after_login', '/');
      } catch (error) {
        console.error('Could not save the post-login destination:', error);
      }
      onNavigate('/login');
      return;
    }
    if (!vendor?.id || favoriteBusyId !== null) return;

    const vendorId = Number(vendor.id);
    const wasSaved = savedVendorIds.includes(vendorId);
    const nextSaved = wasSaved ? savedVendorIds.filter((id) => id !== vendorId) : [...savedVendorIds, vendorId];
    const endpoint = user.role === 'organizer' ? '/platform/organizer/favorites' : '/customer/favorites';
    setSavedVendorIds(nextSaved);
    setFavoriteBusyId(vendorId);
    setFavoriteError('');
    setFavoriteMessage('');
    try {
      await api(wasSaved ? `${endpoint}/${vendorId}` : endpoint, {
        method: wasSaved ? 'DELETE' : 'POST',
        body: wasSaved ? undefined : JSON.stringify({ vendorId }),
      });
      setFavoriteMessage(t(wasSaved ? 'publicHomeRemovedVendor' : 'publicHomeSavedVendor'));
    } catch (error) {
      setSavedVendorIds(savedVendorIds);
      setFavoriteError(error.message || t('publicHomeFavoriteFailed'));
    } finally {
      setFavoriteBusyId(null);
    }
  }

  function becomeVendor() {
    if (!user) {
      onNavigate('/vendor-application');
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
      <section className="homepage-hero">
        <HomeHeroSlider onNavigate={onNavigate} />
        <div className="homepage-hero-content">
          <p className="homepage-welcome-badge"><Sparkles size={14} aria-hidden="true"/>{t('publicHomeHeroWelcome')}</p>
          <h1 aria-label={`${t('publicHomeHeroTitle')} ${t('publicHomeHeroAccent')}`}>
            <span className="homepage-hero-title-line">{t('publicHomeHeroTitle')}</span>
            <span className="homepage-hero-accent">{t('publicHomeHeroAccent')}</span>
          </h1>
          <p>{t('publicHomeHeroDescription')}</p>
          <div className="cta-row">
            <button className="button" type="button" onClick={() => onNavigate('/events')}>{t('publicNavBrowseEvents')}</button>
            <button className="button homepage-hero-outline" type="button" onClick={() => onNavigate('/vendors')}>{t('findVendorsNav')}</button>
            <button className="button homepage-hero-outline" type="button" onClick={() => onNavigate('/services')}>{t('browseServices')}</button>
          </div>
        </div>
      </section>

      <div className="homepage-search-panel">
        <HomepageSearch api={api} onNavigate={onNavigate} />
        {categories.length > 0 && <div className="homepage-quick-categories" aria-label={t('publicHomeQuickCategories')}>
          <span>{t('publicHomeQuickCategories')}</span>
          {categories.slice(0, 5).map((category) => <button key={category.id} type="button" onClick={() => onNavigate(`/search?category=${encodeURIComponent(category.name)}`)}>{translateCategoryName(category.name)}</button>)}
        </div>}
      </div>

      <Reveal className="section-block" direction="up">
        <HomepageVenueCarousel
          venues={popularVenues}
          loading={loading}
          error={Boolean(loadErrors.venues)}
          onRetry={() => setRetryKey((value) => value + 1)}
          onNavigate={onNavigate}
        />
      </Reveal>

      <Reveal className="stat-strip" direction="up">
        {loading ? <div className="home-stat-skeletons" role="status" aria-label={t('publicHomeStatisticsLoading')}><span/><span/><span/><span/></div>
          : loadErrors.statistics ? <div className="home-data-error" role="alert"><span>{t('publicStatisticsUnavailable')}</span><button type="button" onClick={() => setRetryKey((value) => value + 1)}>{t('publicHomeRetry')}</button></div>
            : stats.map(({ label, value, rating }) => <div key={label} className="stat-pill"><strong>{rating ? `${value.toLocaleString(language === 'am' ? 'am-ET' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5` : value.toLocaleString(language === 'am' ? 'am-ET' : 'en-US')}</strong><span>{t(label)}</span></div>)}
      </Reveal>

      {!loading && <HomepageTrustStrip summary={summary} />}

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('popularCategories')}</p>
            <h2>{t('exploreServicesByType')}</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/categories')}>{t('browseAll')}</button>
        </div>
        {loadErrors.categories && <div className="home-data-error" role="alert">{t('publicHomeDataUnavailable')}<button type="button" onClick={() => setRetryKey((value) => value + 1)}>{t('publicHomeRetry')}</button></div>}
        <HorizontalCarousel label={t('popularCategories')}>
          {loading ? <div className="home-card-skeletons" role="status" aria-label={t('publicHomeCategoriesLoading')}><span/><span/><span/><span/></div>
            : !loadErrors.categories && !categories.length
            ? <div className="empty-card">{t('publicNoCategories')} <button type="button" className="button secondary small" onClick={() => onNavigate('/categories')}>{t('publicBrowseCategories')}</button></div>
            : categoryCards.map((category) => (
            <button key={category.name} type="button" className="category-card" onClick={() => onNavigate(category.path)}>
              <HomepageImage className="category-card-image" src={category.image} alt={translateCategoryName(category.name)} fallbackLabel={t('publicHomeImageUnavailable').replace('{name}', translateCategoryName(category.name))} />
              <span className="category-card-copy">
                <span className="category-card-name">{translateCategoryName(category.name)}</span>
                <span className="category-card-description">{category.description ? translateText(category.description, language) : t('availableServiceCategory')}</span>
                {(() => {
                  const counts = getHomepageCategoryCounts(category);
                  const labels = [];
                  if (counts.vendorCount !== null) labels.push(`${counts.vendorCount.toLocaleString(language === 'am' ? 'am-ET' : 'en-US')} ${t('publicHomeVendorCount')}`);
                  if (counts.serviceCount !== null) labels.push(`${counts.serviceCount.toLocaleString(language === 'am' ? 'am-ET' : 'en-US')} ${t('publicHomeServiceCount')}`);
                  return labels.length ? <span className="category-card-counts">{labels.join(' · ')}</span> : null;
                })()}
              </span>
            </button>
          ))}
        </HorizontalCarousel>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <HomepageEventsSection title={t('publicHomeFeaturedEvents')} events={featuredEvents} loading={loading} error={loadErrors.featuredEvents} onRetry={() => setRetryKey((value) => value + 1)} onNavigate={onNavigate}/>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('publicEventDiscovery')}</p>
            <h2>{t('publicHomeEventCategories')}</h2>
          </div>
          <button className="button secondary small" type="button" onClick={() => onNavigate('/events')}>{t('exploreEvents')}</button>
        </div>
        {loadErrors.eventCategories && <div className="home-data-error" role="alert">{t('publicHomeDataUnavailable')}<button type="button" onClick={() => setRetryKey((value) => value + 1)}>{t('publicHomeRetry')}</button></div>}
        <div className="card-grid">
          {loading ? <div className="home-card-skeletons" role="status" aria-label={t('publicHomeCategoriesLoading')}><span/><span/><span/><span/></div>
            : loadErrors.eventCategories ? null
              : eventCategories.length ? eventCategories.slice(0, 8).map((category) => (
                <button key={category.id} type="button" className="category-card" onClick={() => onNavigate(`/events?category=${encodeURIComponent(category.id)}`)}>
                  <HomepageImage className="category-card-image" src={category.image} alt={translateCategoryName(category.name)} fallbackLabel={t('publicHomeImageUnavailable').replace('{name}', translateCategoryName(category.name))}/>
                  <span className="category-card-copy">
                    <span className="category-card-name">{translateCategoryName(category.name)}</span>
                    <span className="category-card-description">{category.description ? translateText(category.description, language) : t('exploreEvents')}</span>
                    <span className="category-card-counts">{Number(category.total || 0).toLocaleString(language === 'am' ? 'am-ET' : 'en-US')} {t('publicHomeEventCount')}</span>
                  </span>
                </button>
              ))
              : <div className="empty-card">{t('publicNoCategories')} <button type="button" className="button secondary small" onClick={() => onNavigate('/events')}>{t('exploreEvents')}</button></div>}
        </div>
      </Reveal>

      {user && recommendedVendors.length > 0 && <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('featuredVendors')}</p>
            <h2>{t('publicHomeRecommendations')}</h2>
          </div>
          <button className="button secondary small" type="button" onClick={() => onNavigate('/vendors')}>{t('seeAllVendors')}</button>
        </div>
        <div className="card-grid">
          {recommendedVendors.slice(0, 4).map((vendor) => {
            const vendorName = vendor.business_name || vendor.name || t('publicHomeVendorFallback');
            return <article className="vendor-card" key={`recommended-${vendor.id}`}>
              <HomepageImage className="card-media-image" src={vendor.coverImageUrl || vendor.logoUrl || vendor.image || vendor.logo} alt={translateText(vendorName, language)} fallbackLabel={t('publicHomeImageUnavailable').replace('{name}', translateText(vendorName, language))}/>
              <div className="card-body">
                <div className="meta-row"><span>{vendor.category ? translateCategoryName(vendor.category) : t('publicHomeEventServices')}</span>{vendor.reviewCount > 0 && Number.isFinite(Number(vendor.rating)) && <span>★ {Number(vendor.rating).toFixed(1)}</span>}</div>
                <h3>{vendorName}</h3>
                <p>{vendor.description || vendor.city || vendor.location || t('publicHomeServiceAreaAvailable')}</p>
                <button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${encodeURIComponent(vendor.id)}`)}>{t('viewProfile')}</button>
              </div>
            </article>;
          })}
        </div>
      </Reveal>}

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('featuredVendors')}</p>
            <h2>{t('publicHomePopularVendors')}</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/vendors')}>{t('seeAllVendors')}</button>
        </div>
        {loadErrors.vendors && <div className="home-data-error" role="alert">{t('publicHomeDataUnavailable')}<button type="button" onClick={() => setRetryKey((value) => value + 1)}>{t('publicHomeRetry')}</button></div>}
        {favoriteError && <p className="alert error" role="alert">{translateText(favoriteError, language)}</p>}
        {favoriteMessage && <p className="alert success" role="status">{favoriteMessage}</p>}
        <div className="card-grid">
          {loading ? <div className="home-card-skeletons" role="status" aria-label={t('publicHomeVendorsLoading')}><span/><span/><span/><span/></div>
            : displayVendors.length ? displayVendors.map((vendor) => {
              const vendorName = vendor.business_name || vendor.name || t('publicHomeVendorFallback');
              const vendorImage = vendor.coverImageUrl || vendor.logoUrl || vendor.image || vendor.logo;
              const quoteService = Array.isArray(vendor.services) ? vendor.services.find((service) => service && service.published !== false && service.visibility !== 'private') : null;
              const isVerified = vendor.verified === true || vendor.verificationStatus === 'verified' || vendor.verification_status === 'verified';
              return (
              <article key={vendor.id} className="vendor-card">
                <div className="card-image-wrap">
                  <HomepageImage className="card-media-image" src={vendorImage} alt={translateText(vendorName, language)} fallbackLabel={t('publicHomeImageUnavailable').replace('{name}', translateText(vendorName, language))} />
                  {isVerified && <span className="verify-badge">{t('verified')}</span>}
              </div>
              <div className="card-body">
                <div className="meta-row"><span>{vendor.category ? translateCategoryName(vendor.category) : t('publicHomeEventServices')}</span>{vendor.reviewCount > 0 && Number.isFinite(Number(vendor.rating)) && <span>★ {Number(vendor.rating).toFixed(1)} ({vendor.reviewCount})</span>}</div>
                <h3>{vendorName}</h3>
                <p>{vendor.description || vendor.city || vendor.location || t('publicHomeServiceAreaAvailable')}</p>
                {Number.isFinite(Number(vendor.priceFrom)) && Number(vendor.priceFrom) > 0 && <p className="muted">{t('publicHomeFromPrice').replace('{amount}', Number(vendor.priceFrom).toLocaleString(language === 'am' ? 'am-ET' : 'en-US'))}</p>}
                <div className="card-actions">
                  <button className="button secondary small" type="button" onClick={() => onNavigate(vendor.id ? `/vendors/${encodeURIComponent(vendor.id)}` : '/vendors')}>{t('viewProfile')}</button>
                  <button className="button small" type="button" onClick={() => quoteService ? setRequestService(quoteService) : onNavigate(vendor.id ? `/vendors/${encodeURIComponent(vendor.id)}` : '/vendors')}>{t('publicRequestQuoteButton')}</button>
                  {(!user || ['customer', 'organizer'].includes(user.role)) && <button className="icon-button homepage-favorite-button" type="button" aria-label={`${t(savedVendorIds.includes(Number(vendor.id)) ? 'publicHomeRemoveSavedVendor' : 'publicHomeSaveVendor')}: ${vendorName}`} title={t(savedVendorIds.includes(Number(vendor.id)) ? 'publicHomeRemoveSavedVendor' : 'publicHomeSaveVendor')} aria-pressed={savedVendorIds.includes(Number(vendor.id))} disabled={favoriteBusyId === Number(vendor.id)} onClick={() => toggleVendorFavorite(vendor)}><Heart size={17} fill={savedVendorIds.includes(Number(vendor.id)) ? 'currentColor' : 'none'} aria-hidden="true"/></button>}
                </div>
              </div>
            </article>
          );}) : loadErrors.vendors ? null : <div className="empty-card">{t('noVendorProfiles')} <button type="button" className="button secondary small" onClick={() => onNavigate('/vendors')}>{t('seeAllVendors')}</button></div>}
        </div>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('publicHomeEventServices')}</p>
            <h2>{t('publicHomeAvailableServices')}</h2>
          </div>
          <button className="button secondary small" onClick={() => onNavigate('/services')}>{t('browseServices')}</button>
        </div>
        {loadErrors.services && <div className="home-data-error" role="alert">{t('publicHomeDataUnavailable')}<button type="button" onClick={() => setRetryKey((value) => value + 1)}>{t('publicHomeRetry')}</button></div>}
        <div className="card-grid">
          {loading ? <div className="home-card-skeletons" role="status" aria-label={t('publicHomeServicesLoading')}><span/><span/><span/><span/></div>
            : displayServices.length ? displayServices.map((service) => {
              const serviceImage = service.images?.[0]?.url || service.image || service.coverImage;
              return (
            <article key={service.id} className="service-card">
              <div className="card-image-wrap">
                <HomepageImage className="card-media-image" src={serviceImage} alt={service.title} fallbackLabel={t('publicHomeImageUnavailable').replace('{name}', service.title || t('publicHomeEventService'))} />
              </div>
              <div className="card-body">
                <div className="meta-row"><span>{service.category ? translateCategoryName(service.category) : t('publicHomeEventService')}</span>{service.reviewCount > 0 && Number.isFinite(Number(service.rating)) && <span>★ {Number(service.rating).toFixed(1)}</span>}</div>
                <h3>{service.title}</h3>
                <p>{service.description || service.vendorName || t('publicHomeServiceDetailsAvailable')}</p>
                <div className="pricing-row">
                  <strong>{service.price !== null && service.price !== undefined && service.price !== '' && Number.isFinite(Number(service.price)) && Number(service.price) >= 0 ? formatEventBudget(service.price, language) : t('requestQuote')}</strong>
                  <button type="button" className="button small" onClick={() => setRequestService(service)}>{t('publicRequestService')}</button>
                </div>
                <button type="button" className="button secondary small" onClick={() => onNavigate(`/services/${encodeURIComponent(service.id)}`)}>{t('publicHomeViewDetails')}</button>
              </div>
            </article>
          );}) : loadErrors.services ? null : <div className="empty-card">{t('noServicesPublished')} <button type="button" className="button secondary small" onClick={() => onNavigate('/services')}>{t('browseServices')}</button></div>}
        </div>
      </Reveal>

      {!loading && servicePackages.length > 0 && <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('publicHomeEventServices')}</p>
            <h2>{t('publicHomeServicePackages')}</h2>
          </div>
        </div>
        <div className="card-grid homepage-package-grid">
          {servicePackages.slice(0, 4).map((item, index) => {
            const features = Array.isArray(item.includedFeatures) ? item.includedFeatures.filter((feature) => typeof feature === 'string' && feature.trim()) : [];
            const extras = Array.isArray(item.extras) ? item.extras.filter((extra) => extra && typeof extra.name === 'string') : [];
            return <article className="info-card homepage-package-card" key={item.id || `${item.serviceId}-${index}`}>
              <p className="eyebrow">{item.serviceTitle}</p>
              <h3>{item.name}</h3>
              {item.description && <p>{item.description}</p>}
              <strong className="homepage-event-price">{formatEventBudget(item.price, language) || t('requestQuote')}</strong>
              {item.minimumBooking !== undefined && item.minimumBooking !== null && <small>{t('publicHomeMinimumBooking')}: {Number(item.minimumBooking).toLocaleString(language === 'am' ? 'am-ET' : 'en-US')}</small>}
              <div><strong>{t('publicHomePackageIncludes')}</strong>{features.length ? <ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul> : <p>{t('publicHomePackageNoFeatures')}</p>}</div>
              {extras.length > 0 && <div><strong>{t('publicHomePackageExtras')}</strong>{extras.map((extra) => <p key={extra.name}>{extra.name}{extra.price !== undefined ? ` · ${formatEventBudget(extra.price, language) || ''}` : ''}</p>)}</div>}
              <button type="button" className="button secondary small" onClick={() => onNavigate(`/services/${encodeURIComponent(item.serviceId)}`)}>{t('publicHomeViewDetails')}</button>
            </article>;
          })}
        </div>
      </Reveal>}

      <Reveal className="section-block" direction="up">
        <HomepageEventsSection title={t('publicHomeUpcomingEvents')} events={events} loading={loading} error={loadErrors.events} onRetry={() => setRetryKey((value) => value + 1)} onNavigate={onNavigate}/>
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('publicHomeTrustHeading')}</p>
            <h2>{t('publicHomeTestimonials')}</h2>
          </div>
        </div>
        {loadErrors.testimonials && <div className="home-data-error" role="alert">{t('publicHomeDataUnavailable')}<button type="button" onClick={() => setRetryKey((value) => value + 1)}>{t('publicHomeRetry')}</button></div>}
        {testimonials.length > 0 ? <div className="card-grid">
          {testimonials.map((testimonial) => <article className="info-card homepage-testimonial" key={testimonial.id}>
            <p className="meta-row" aria-label={`${testimonial.rating}/5`}><span aria-hidden="true">{'★'.repeat(testimonial.rating)}</span></p>
            <blockquote>{testimonial.quote}</blockquote>
            <p className="muted">{testimonial.customerName}{testimonial.vendorName ? ` · ${testimonial.vendorName}` : ''}</p>
          </article>)}
        </div> : !loadErrors.testimonials && <div className="empty-card" role="status">{t('publicHomeNoTestimonials')}</div>}
      </Reveal>

      <Reveal className="section-block" direction="up">
        <div className="section-header compact-header">
          <div>
            <p className="eyebrow">{t('publicHomeTrustHeading')}</p>
            <h2>{t('publicHomeHowItWorks')}</h2>
          </div>
        </div>
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
              <span className="process-card-action">{step === '1' ? t('publicHomeVendorAction') : step === '2' ? t('publicHomeServiceAction') : t('publicHomeEventAction')}</span>
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
            <button className="button" onClick={() => onNavigate('/register')}>{t('publicHomeRegister')}</button>
            <button className="button pale" onClick={() => onNavigate('/events')}>{t('publicHomeStartPlanning')}</button>
            <button className="button" onClick={() => onNavigate('/vendors')}>{t('findVendorsNav')}</button>
            <button className="button pale" onClick={becomeVendor}>{user?.role === 'vendor' ? t('publicHomeOpenVendorDashboard') : t('becomeVendor')}</button>
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

function getBrowseEventStatus(event) {
  const now = Date.now();
  const start = event?.startDate ? new Date(event.startDate).getTime() : NaN;
  const end = event?.endDate ? new Date(event.endDate).getTime() : NaN;
  if (String(event?.status || '').toLowerCase() === 'completed') return 'Past';
  if (Number.isFinite(start) && start > now) return 'Upcoming';
  if (Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now) return 'Ongoing';
  if (Number.isFinite(start) && start < now && (!Number.isFinite(end) || end < now)) return 'Past';
  return event?.status || 'Upcoming';
}

function EventsPage({ onNavigate, user, currentPath }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const initialQuery = getListingFiltersFromPath(currentPath);
  const routePath = String(currentPath).split('?')[0];
  const routeFilter = new URLSearchParams(String(currentPath).split('?')[1] || '').get('filter');
  const isUpcomingView = routePath === '/events/upcoming' || routeFilter === 'upcoming';
  const isFreeView = routeFilter === 'free';
  const isFeaturedView = routeFilter === 'featured';
  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [featured, setFeatured] = useState(null);
  const [featuredEventCount, setFeaturedEventCount] = useState(0);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [search, setSearch] = useState(initialQuery.search);
  const [location, setLocation] = useState(initialQuery.location);
  const [category, setCategory] = useState(initialQuery.category);
  const [startDate, setStartDate] = useState(initialQuery.startDate);
  const [endDate, setEndDate] = useState(initialQuery.endDate);
  const [datePreset, setDatePreset] = useState(initialQuery.datePreset);
  const [priceFilter, setPriceFilter] = useState(initialQuery.priceFilter);
  const [minPrice, setMinPrice] = useState(initialQuery.minPrice);
  const [maxPrice, setMaxPrice] = useState(initialQuery.maxPrice);
  const [eventStatus, setEventStatus] = useState(initialQuery.status);
  const [sort, setSort] = useState(initialQuery.sort);
  const [page, setPage] = useState(initialQuery.page);
  const [pageSize, setPageSize] = useState(initialQuery.limit);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1, limit: 6 });
  const [upcomingTotal, setUpcomingTotal] = useState(null);
  const [upcomingTotalError, setUpcomingTotalError] = useState('');
  const [eventCategoryTotal, setEventCategoryTotal] = useState(0);
  const [eventCategoryError, setEventCategoryError] = useState('');
  const [requestEvent, setRequestEvent] = useState(null);
  const [requestForm, setRequestForm] = useState({ event_title: '', event_type: '', requested_date: '', requested_location: '', requester_name: '', requester_email: '', service_category: '', guest_count: '', budget: '', notes: '' });
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [requestSuccess, setRequestSuccess] = useState('');
  const [eventShareMessage, setEventShareMessage] = useState('');
  const lastRoutePath = useRef(currentPath);
  const listingPageSize = isUpcomingView ? 6 : pageSize;
  const eventListingQuery = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(listingPageSize),
      sort: isUpcomingView || isFreeView ? 'upcoming' : sort,
    });
    if (isUpcomingView) {
      params.set('filter', 'upcoming');
    } else if (isFreeView || isFeaturedView) {
      params.set('filter', isFreeView ? 'free' : 'featured');
    }
    if (eventStatus) params.set('status', eventStatus);
    if (search.trim()) params.set('search', search.trim());
    if (category) params.set('category', category);
    if (location) params.set('location', location);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (datePreset) params.set('datePreset', datePreset);
    if (priceFilter) params.set('priceFilter', priceFilter);
    if (!isFreeView && minPrice !== '') params.set('minPrice', minPrice);
    if (!isFreeView && maxPrice !== '') params.set('maxPrice', maxPrice);
    return params.toString();
  }, [
    isUpcomingView, isFreeView, isFeaturedView, page, listingPageSize, sort, eventStatus,
    datePreset, search, category, location, startDate, endDate, minPrice,
    maxPrice, priceFilter,
  ]);
  const eventListingUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (isFreeView || isFeaturedView) params.set('filter', isFreeView ? 'free' : 'featured');
    for (const [key, value] of Object.entries({
      search: search.trim(), location, category, startDate, endDate, datePreset, priceFilter,
      minPrice: isFreeView ? '' : minPrice, maxPrice: isFreeView ? '' : maxPrice,
      filter: isFreeView || isFeaturedView ? '' : ['upcoming', 'free'].includes(eventStatus) ? eventStatus : '',
      status: isFreeView || isFeaturedView ? '' : ['upcoming', 'free'].includes(eventStatus) ? '' : eventStatus,
    })) {
      if (value) params.set(key, value);
    }
    if (sort !== 'upcoming') params.set('sort', sort);
    if (page > 1) params.set('page', String(page));
    if (pageSize !== 6) params.set('limit', String(pageSize));
    const query = params.toString();
    return `${routePath}${query ? `?${query}` : ''}`;
  }, [
    routePath, isFreeView, isFeaturedView, search, location, category, startDate, endDate, datePreset,
    priceFilter, minPrice, maxPrice, eventStatus, sort, page, pageSize,
  ]);

  useEffect(() => {
    if (lastRoutePath.current === currentPath) return;
    lastRoutePath.current = currentPath;
    const filters = getListingFiltersFromPath(currentPath);
    setSearch(filters.search);
    setLocation(filters.location);
    setCategory(filters.category);
    setStartDate(filters.startDate);
    setEndDate(filters.endDate);
    setDatePreset(filters.datePreset);
    setPriceFilter(filters.priceFilter);
    setMinPrice(filters.minPrice);
    setMaxPrice(filters.maxPrice);
    setEventStatus(filters.status);
    setSort(filters.sort);
    setPage(filters.page);
    setPageSize(filters.limit);
  }, [currentPath]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await api(`/platform/events?${eventListingQuery}`);
        if (!active) return;
        setEvents(Array.isArray(response?.data) ? response.data : []);
        const nextPagination = response?.pagination || { total: 0, page: 1, totalPages: 1, limit: 6 };
        setPagination(nextPagination);
        if (nextPagination.page !== page) setPage(nextPagination.page);
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
  }, [eventListingQuery, reloadKey]);

  useEffect(() => {
    if (isUpcomingView) return undefined;
    window.history.replaceState({}, '', eventListingUrl);
  }, [eventListingUrl, isUpcomingView]);

  useEffect(() => {
    if (!isUpcomingView && !isFreeView) return undefined;
    let active = true;
    setUpcomingTotalError('');
    api(`/platform/events?filter=${isFreeView ? 'free' : 'upcoming'}&limit=1`).then((response) => {
      if (active) setUpcomingTotal(Number(response?.pagination?.total || 0));
    }).catch((issue) => {
      if (active) {
        setUpcomingTotal(null);
        setUpcomingTotalError(issue.status ? `${t('loadEventsError')} (${issue.status})` : t('loadEventsError'));
      }
    });
    return () => { active = false; };
  }, [isUpcomingView, isFreeView, reloadKey]);

  useEffect(() => {
    let active = true;
    if (!isUpcomingView) {
      setEventCategoryError('');
      api('/platform/events/categories').then((response) => {
        if (active) {
          const availableCategories = Array.isArray(response?.data) ? response.data : [];
          setCategories(availableCategories);
          setEventCategoryTotal(availableCategories.reduce((total, item) => total + Number(item.total || 0), 0));
        }
      }).catch((issue) => {
        if (active) {
          setCategories([]);
          setEventCategoryTotal(0);
          setEventCategoryError(issue.status ? `${t('loadEventsError')} (${issue.status})` : t('loadEventsError'));
        }
      });
    }
    api('/platform/events/featured').then((response) => {
      if (active) {
        const featuredEvents = Array.isArray(response?.data) ? response.data : [];
        setFeatured(featuredEvents[0] || null);
        setFeaturedEventCount(featuredEvents.length);
        setFeaturedError('');
      }
    }).catch(() => {
      if (active) {
        setFeatured(null);
        setFeaturedEventCount(0);
        setFeaturedError(t('featuredError'));
      }
    }).finally(() => {
      if (active) setFeaturedLoading(false);
    });
    return () => { active = false; };
  }, [isUpcomingView, reloadKey]);

  async function viewDetails(eventId) {
    onNavigate(`/events/${encodeURIComponent(eventId)}`);
  }

  async function shareEvent(event) {
    const url = `${window.location.origin}/events/${encodeURIComponent(event.id)}`;
    try {
      if (navigator.share) await navigator.share({ title: event.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setEventShareMessage(t('eventLinkCopied'));
      }
    } catch (issue) {
      if (issue.name !== 'AbortError') setEventShareMessage(t('eventShareFailed'));
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

  const categoryOptions = [...new Set(categories.map((value) => String(value?.name || '').trim()).filter(Boolean))];
  const selectedCategory = categories.find((value) => String(value?.id) === category
    || String(value?.slug || '').toLowerCase() === category.toLowerCase()
    || String(value?.name || '').toLowerCase() === category.toLowerCase());
  const translateEventCategory = (value) => {
    const key = getEventCategoryTranslationKey(value);
    return key ? t(key) : value;
  };
  const totalPages = Math.max(1, pagination.totalPages || 1);
  const pageWindowStart = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pageNumbers = Array.from({ length: Math.min(5, totalPages) }, (_, index) => pageWindowStart + index);
  const resetFilters = () => {
    setSearch('');
    setLocation('');
    setCategory('');
    setStartDate('');
    setEndDate('');
    setDatePreset('');
    setPriceFilter('');
    setMinPrice('');
    setMaxPrice('');
    setEventStatus(isFreeView ? 'free' : isUpcomingView ? 'upcoming' : '');
    setSort('upcoming');
    setPage(1);
    setPageSize(6);
  };

  const categoryTitle = selectedCategory?.name ? translateEventCategory(selectedCategory.name) : translateEventCategory(category);
  const routeSort = new URLSearchParams(String(currentPath).split('?')[1] || '').get('sort') || '';
  const pageTitle = category ? categoryTitle
    : isFreeView ? t('freePageTitle')
      : isUpcomingView ? t('upcomingPageTitle')
        : isFeaturedView ? t('nav.events.featured')
          : routeSort === 'popular' ? t('nav.events.popular')
            : ['newest', 'recent'].includes(routeSort) ? t('nav.events.recent')
              : t('browseEventsTitle');
  const pageDescription = category
    ? selectedCategory?.description || `${t('pageDescription')} ${categoryTitle}.`
    : isFreeView ? t('freePageDescription')
      : isUpcomingView ? t('upcomingPageDescription')
        : isFeaturedView ? t('featuredPageDescription')
          : routeSort === 'popular' ? t('popularPageDescription')
            : ['newest', 'recent'].includes(routeSort) ? t('recentPageDescription')
              : t('pageDescription');
  return <main className={`page-shell${isUpcomingView ? ' upcoming-events-page' : ''}${isFreeView ? ' free-events-page' : ''}`}><div className="content-stack"><section className="events-discovery-hero"><div className="section-header"><div><p className="eyebrow">EVENTHUB · EVENTS</p><h1>{pageTitle}</h1><p className="muted">{pageDescription}</p></div><div className="events-hero-actions">{user?.role === 'organizer' && <button className="button" type="button" onClick={() => onNavigate('/organizer/dashboard?view=events')}>{t('createEvent')}</button>}{!isUpcomingView && !isFreeView && <button className="button secondary" type="button" onClick={planEvent}>{t('planMyEvent')}</button>}</div></div><div className="events-discovery-stats">{category ? <div><strong>{selectedCategory?.total?.toLocaleString() || (loading ? '—' : '0')}</strong><span>published {categoryTitle} events</span></div> : isUpcomingView || isFreeView ? <div><strong>{upcomingTotal === null ? '—' : upcomingTotal.toLocaleString()}</strong><span>{isFreeView ? t('totalFreeEvents') : t('totalUpcomingEvents')}</span></div> : <><div><strong>{eventCategoryTotal.toLocaleString()}</strong><span>{t('eventsListedCount')}</span></div><div><strong>{categoryOptions.length.toLocaleString()}</strong><span>{t('eventCategoriesCount')}</span></div><div><strong>{featuredEventCount.toLocaleString()}</strong><span>{t('featuredEventsCount')}</span></div></>}</div>{!isUpcomingView && eventCategoryError && <p className="event-count-error" role="alert">{eventCategoryError}<button type="button" className="button secondary small" onClick={() => setReloadKey((current) => current + 1)}>{t('retry')}</button></p>}{(isUpcomingView || isFreeView) && upcomingTotalError && <p className="event-count-error" role="alert">{upcomingTotalError}<button type="button" className="button secondary small" onClick={() => setReloadKey((current) => current + 1)}>{t('retry')}</button></p>}</section>

    <form className="panel event-filter-panel event-listing-filters" role="search" onSubmit={(submitEvent) => submitEvent.preventDefault()}>
      <div className="event-filters-heading">
        <div><SlidersHorizontal size={17} aria-hidden="true"/><h2>{t('filterEvents')}</h2></div>
        <button type="button" className="button secondary small" onClick={resetFilters}>{t('reset')}</button>
      </div>
      <div className="event-filters-grid">
        <label className="field event-filter-search">
          <span>{t('searchEvents')}</span>
          <span className="event-filter-input-wrap"><Search size={16} aria-hidden="true"/><input className="filter-select" type="search" maxLength={120} value={search} onChange={(changeEvent) => { setPage(1); setSearch(changeEvent.target.value); }} placeholder={t('searchEvents')}/></span>
        </label>
        <label className="field">
          <span>{t('eventCategoryLabel')}</span>
          <select className="filter-select" value={selectedCategory ? String(selectedCategory.id) : category} onChange={(changeEvent) => { setPage(1); setCategory(changeEvent.target.value); }}>
            <option value="">{t('allEventCategories')}</option>
            {categories.map((item) => <option key={item.id} value={String(item.id)}>{translateEventCategory(item.name)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('eventLocationLabel')}</span>
          <input className="filter-select" type="search" maxLength={120} value={location} onChange={(changeEvent) => { setPage(1); setLocation(changeEvent.target.value); }} placeholder={t('allLocations')}/>
        </label>
        <label className="field">
          <span>{t('eventAvailability')}</span>
          <select className="filter-select" value={eventStatus || 'all'} disabled={isUpcomingView || isFreeView} onChange={(changeEvent) => { setPage(1); setEventStatus(changeEvent.target.value === 'all' ? '' : changeEvent.target.value); }}>
            <option value="all">{t('allEvents')}</option>
            <option value="upcoming">{t('upcomingEventsFilter')}</option>
            <option value="ongoing">{t('ongoingEventsFilter')}</option>
            <option value="past">{t('pastEventsFilter')}</option>
            <option value="available">{t('availableEventsFilter')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('upcomingDateFilter')}</span>
          <select className="filter-select" value={datePreset} onChange={(changeEvent) => { setPage(1); setDatePreset(changeEvent.target.value); setStartDate(''); setEndDate(''); }}>
            <option value="">{t('anyEventDate')}</option>
            <option value="upcoming">{t('upcomingEventsFilter')}</option>
            <option value="today">{t('today')}</option>
            <option value="tomorrow">{t('tomorrow')}</option>
            <option value="this_week">{t('thisWeek')}</option>
            <option value="this_weekend">{t('thisWeekend')}</option>
            <option value="this_month">{t('thisMonth')}</option>
            <option value="next_month">{t('nextMonth')}</option>
          </select>
        </label>
        <label className="field event-custom-date">
          <span>{t('fromDate')}</span>
          <input className="filter-select" type="date" value={startDate} max={endDate || undefined} onChange={(changeEvent) => { setPage(1); setStartDate(changeEvent.target.value); setDatePreset(''); }}/>
        </label>
        <label className="field event-custom-date">
          <span>{t('toDate')}</span>
          <input className="filter-select" type="date" value={endDate} min={startDate || undefined} onChange={(changeEvent) => { setPage(1); setEndDate(changeEvent.target.value); setDatePreset(''); }}/>
        </label>
        <label className="field">
          <span>{t('anyTicketPrice')}</span>
          <select className="filter-select" value={priceFilter} disabled={isFreeView} onChange={(changeEvent) => { setPage(1); setPriceFilter(changeEvent.target.value); }}>
            <option value="">{t('anyTicketPrice')}</option>
            <option value="free">{t('eventsFree')}</option>
            <option value="paid">{t('eventsPaid')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('minimumPrice')}</span>
          <input className="filter-select" type="number" min="0" step="0.01" value={minPrice} disabled={isFreeView} onChange={(changeEvent) => { setPage(1); setMinPrice(changeEvent.target.value); }}/>
        </label>
        <label className="field">
          <span>{t('maximumPrice')}</span>
          <input className="filter-select" type="number" min="0" step="0.01" value={maxPrice} disabled={isFreeView} onChange={(changeEvent) => { setPage(1); setMaxPrice(changeEvent.target.value); }}/>
        </label>
        <label className="field">
          <span>{t('sortEvents')}</span>
          <select className="filter-select" value={sort} onChange={(changeEvent) => { setPage(1); setSort(changeEvent.target.value); }}>
            <option value="upcoming">{t('sortSoonest')}</option>
            <option value="date_earliest">{t('sortDateEarliest')}</option>
            <option value="date_latest">{t('sortDateLatest')}</option>
            <option value="newest">{t('sortNewest')}</option>
            <option value="oldest">{t('sortOldest')}</option>
            <option value="title_asc">{t('sortTitleAsc')}</option>
            <option value="title_desc">{t('sortTitleDesc')}</option>
            <option value="price_asc">{t('sortPriceAsc')}</option>
            <option value="price_desc">{t('sortPriceDesc')}</option>
            <option value="popular">{t('mostBooked')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('resultsPerPage')}</span>
          <select className="filter-select" value={pageSize} disabled={isUpcomingView} onChange={(changeEvent) => { setPage(1); setPageSize(Number(changeEvent.target.value)); }}>
            {[6, 12, 24, 50].map((size) => <option key={size} value={size}>{size} {t('perPage')}</option>)}
          </select>
        </label>
      </div>
    </form>

    {!loading && !error && <p className="event-results-count" role="status">{isFreeView ? `${Number(pagination?.total || 0).toLocaleString(language === 'am' ? 'am-ET' : 'en-US')} ${t('freeEventsResult')}` : isUpcomingView ? `${Number(pagination?.total || 0).toLocaleString(language === 'am' ? 'am-ET' : 'en-US')} ${t('upcomingEventsResult')}` : t('eventsFoundCount').replace('{count}', Number(pagination?.total || 0).toLocaleString(language === 'am' ? 'am-ET' : 'en-US'))}</p>}
    {loading ? <div className="card-grid event-list-grid event-skeleton-grid" role="status" aria-label={t('loadingEvents')}>{Array.from({ length: 6 }, (_, index) => <div className="event-skeleton-card" key={index} aria-hidden="true"><span /><div><i /><i /><i /></div></div>)}</div> : error ? <div className="alert error" role="alert"><span>{error}</span><button type="button" className="button secondary small" onClick={() => setReloadKey((current) => current + 1)}>{t('retry')}</button></div> : <>
      {events.length ? <>
        <div className="card-grid event-list-grid">
          {events.map((event) => {
            const timingStatus = getBrowseEventStatus(event);
            const timingStatusLabel = timingStatus === 'Upcoming' ? t('upcomingEventsFilter') : timingStatus === 'Ongoing' ? t('ongoingEventsFilter') : timingStatus === 'Past' ? t('pastEventsFilter') : translateText(timingStatus, language);
            const availableQuantity = Number(event.availableQuantity || 0);
            const freeAvailableQuantity = Number(event.freeAvailableQuantity ?? availableQuantity);
            const displayedAvailability = isFreeView ? freeAvailableQuantity : availableQuantity;
            const price = event.startingPrice === null || event.startingPrice === undefined ? null : Number(event.startingPrice);
            return <article key={event.id} className="info-card event-tile">
              <div className="event-thumb">{event.coverImage && <img src={event.coverImage} alt={event.title} width="960" height="540" loading="lazy" onError={(imageEvent) => { imageEvent.currentTarget.style.display = 'none'; }} />}<span>{event.type ? translateEventCategory(event.type) : t('eventType')}</span></div>
              <div className="event-tile-body">
                <span className="event-tag">{event.type ? translateEventCategory(event.type) : t('eventType')}</span><h3>{event.title}</h3>
                <p className="event-card-description">{event.description || t('eventDescriptionUnavailable')}</p>
                <div className="event-card-details">
                  <p><CalendarDays size={15} aria-hidden="true" /><span>{formatEventDateOnly(event.startDate, language) || t('dateTbd')}</span></p>
                  <p><Clock3 size={15} aria-hidden="true" /><span>{t('eventsStartsAt')} {formatEventTime(event.startDate, language) || t('timeTbd')}{event.endDate ? ` · ${t('eventsEndsAt')} ${formatEventTime(event.endDate, language) || t('timeTbd')}` : ''} EAT</span></p>
                  <p><MapPin size={15} aria-hidden="true" /><span>{[event.venue, event.location].filter(Boolean).join(', ') || t('locationTbd')}</span></p>
                  {event.organizerName && <p><Users size={15} aria-hidden="true" /><span>{t('eventsOrganizedBy')}: {event.organizerName}</span></p>}
                </div>
                {(isUpcomingView || isFreeView) && <EventCountdown startDate={event.startDate} />}
                <div className="event-card-status"><span className={`event-listing-status status-${timingStatus.toLowerCase()}`}>{timingStatusLabel}</span><span className="event-ticket-availability">{displayedAvailability > 0 ? `${displayedAvailability.toLocaleString(language === 'am' ? 'am-ET' : 'en-US')} ${t('ticketsAvailable')}` : t('ticketsUnavailable')}</span></div>
                <div className="event-card-price"><strong>{isFreeView ? `${t('eventsFree')} · ETB 0` : price === null ? t('ticketsUnavailable') : price === 0 ? `${t('eventsFree')} · ETB 0` : formatEventBudget(price, language)}</strong><span className={isFreeView || price === 0 ? 'event-price-label free' : 'event-price-label'}>{isFreeView || price === 0 ? t('eventsFree') : price === null ? '' : t('eventsPaid')}</span></div>
                <div className="pricing-row compact-row event-card-actions"><button type="button" className="button secondary small" onClick={() => shareEvent(event)}>{t('eventsShare')}</button><button type="button" className="button secondary small" onClick={() => viewDetails(event.id)}>{t('viewDetails')}</button>{displayedAvailability > 0 && price !== null && <button type="button" className="button small" onClick={() => viewDetails(event.id)}>{price === 0 ? t('registerFreeTicket') : t('eventsBookNow')}</button>}</div>
              </div>
            </article>;
          })}
        </div>
        {eventShareMessage && <p className="event-inline-message" role="status">{eventShareMessage}</p>}
      </> : <div className="empty panel event-empty-state"><strong>{t('emptyTitle')}</strong><span>{t('emptyMessage')}</span></div>}
      {pagination.total > 0 && <div className="pagination-row" aria-label={t('eventPages')}>
        <span className="event-page-count">{t('showingEventsRange')
          .replace('{from}', Math.min(pagination.total, (pagination.page - 1) * pagination.limit + 1).toLocaleString(language === 'am' ? 'am-ET' : 'en-US'))
          .replace('{to}', Math.min(pagination.total, pagination.page * pagination.limit).toLocaleString(language === 'am' ? 'am-ET' : 'en-US'))
          .replace('{total}', pagination.total.toLocaleString(language === 'am' ? 'am-ET' : 'en-US'))}</span>
        <div className="event-page-controls">
          <button className="button secondary small" type="button" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>{t('previous')}</button>
          {pageNumbers.map((pageNumber) => <button key={pageNumber} className={`button small event-page-number ${pageNumber === pagination.page ? 'active' : 'secondary'}`} type="button" aria-current={pageNumber === pagination.page ? 'page' : undefined} onClick={() => setPage(pageNumber)}>{pageNumber}</button>)}
          <button className="button secondary small" type="button" disabled={pagination.page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>{t('next')}</button>
        </div>
      </div>}

      {detailsLoading && <div className="loading" role="status"><span className="spinner" />{t('detailLoading')}</div>}
      {detailsError && <div className="alert error" role="alert">{detailsError}</div>}
      {selectedEvent && <article className="info-card event-detail-card" aria-live="polite">
        <div className="event-detail-header"><div><p className="eyebrow">{t('viewDetails')}</p><h3>{selectedEvent.title}</h3></div><button type="button" className="button secondary small" onClick={() => openPackageRequest(selectedEvent)}>{t('requestPackages')}</button></div>
        <p>{selectedEvent.description || t('detailsUnavailable')}</p>
        <div className="detail-meta-grid">
          <div><span>{t('category')}</span><strong>{selectedEvent.type ? translateEventCategory(selectedEvent.type) : '—'}</strong></div><div><span>{t('location')}</span><strong>{selectedEvent.location || t('locationTbd')}</strong></div>
          <div><span>{t('date')}</span><strong>{formatEventDate(selectedEvent.startDate, language) || t('dateTbd')}</strong></div><div><span>{t('budget')}</span><strong>{formatEventBudget(selectedEvent.budget, language) || '—'}</strong></div>
          <div><span>{t('status')}</span><strong>{selectedEvent.status || '—'}</strong></div>
        </div>
      </article>}

      <section className="event-highlight-section" aria-labelledby="event-highlight-title">
        <div className="event-highlight-heading"><p className="eyebrow">{t('eventHighlight')}</p></div>
        {featured ? <article className="event-highlight-content"><div><h3 id="event-highlight-title">{featured.title}</h3><span>{featured.type ? translateEventCategory(featured.type) : '—'}</span></div><dl className="detail-meta-grid"><div><dt>{t('category')}</dt><dd>{featured.type ? translateEventCategory(featured.type) : '—'}</dd></div><div><dt>{t('location')}</dt><dd>{featured.location || t('locationTbd')}</dd></div><div><dt>{t('date')}</dt><dd>{formatEventDate(featured.startDate, language) || t('dateTbd')}</dd></div><div><dt>{t('budget')}</dt><dd>{formatEventBudget(featured.budget, language) || '—'}</dd></div></dl><button type="button" className="button" onClick={() => openPackageRequest(featured)}>{t('requestPackages')}</button></article> : featuredLoading ? <div className="loading" role="status"><span className="spinner" />{t('detailLoading')}</div> : featuredError ? <div className="alert error" role="alert">{featuredError}</div> : <p>{t('noFeatured')}</p>}
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

function QuoteRequestModal({ service, services = [service], vendorId = service?.vendorId, user, onNavigate, onClose, title = 'Request a quote' }) {
  const activeServices = (Array.isArray(services) ? services : [service])
    .filter((item) => item && item.published !== false && item.visibility !== 'private');
  const [serviceId, setServiceId] = useState(String(service?.id || ''));
  const [form, setForm] = useState({
    eventType: '',
    eventName: '',
    eventDate: '',
    eventLocation: '',
    contactPhone: user?.phone || '',
    guestCount: '',
    budget: '',
    requiredServices: '',
    additionalRequirements: '',
    message: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const requestKey = useRef(window.crypto?.randomUUID?.() || '');
  const selectedService = activeServices.find((item) => String(item.id) === serviceId) || service;
  const minimumEventDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setSuccess('');
    setError('');
    requestKey.current = window.crypto?.randomUUID?.() || '';
  }

  function updateService(event) {
    setServiceId(event.target.value);
    setSuccess('');
    setError('');
    requestKey.current = window.crypto?.randomUUID?.() || '';
  }

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
    if (!selectedService?.id || (vendorId && Number(selectedService.vendorId) !== Number(vendorId))) {
      setError('Select a service offered by this vendor.');
      return;
    }
    if (new Date(form.eventDate).getTime() <= Date.now()) {
      setError('Choose a future event date and time.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = {
        vendorId: Number(vendorId || selectedService.vendorId),
        serviceId: Number(selectedService.id),
        ...(requestKey.current ? { requestKey: requestKey.current } : {}),
        ...(form.eventName.trim() ? { eventName: form.eventName.trim() } : {}),
        eventDate: form.eventDate,
        eventLocation: form.eventLocation.trim(),
        eventType: form.eventType.trim(),
        contactPhone: form.contactPhone.trim(),
        ...(form.guestCount ? { guestCount: Number(form.guestCount) } : {}),
        ...(form.budget ? { budget: Number(form.budget) } : {}),
        requiredServices: form.requiredServices.trim(),
        additionalRequirements: form.additionalRequirements.trim(),
        message: form.message.trim(),
      };
      const response = await api('/platform/service-quote-requests', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!response?.data?.id) throw new Error('The server did not confirm that your request was saved.');
      setSuccess(`Request #${response.data.id} was saved. Track its status in your dashboard quotations.`);
    } catch (issue) {
      setError(issue.message || 'Unable to send the quote request.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <form className="modal quote-request-modal" role="dialog" aria-modal="true" aria-labelledby="quote-request-title" onSubmit={submit}>
      <div className="modal-head"><h2 id="quote-request-title">{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Close" disabled={busy}><X size={18}/></button></div>
      <div className="modal-body">
        <p><strong>{selectedService?.vendorName || service?.vendorName}</strong></p>
        {activeServices.length > 1
          ? <label className="field"><span>Service</span><select name="serviceId" required value={serviceId} onChange={updateService}>{activeServices.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
          : <p className="quote-selected-service"><strong>Service:</strong> {selectedService?.title}</p>}
        <label className="field"><span>Customer full name</span><input value={user?.full_name || ''} readOnly aria-readonly="true" /></label>
        <label className="field"><span>Contact phone</span><input name="contactPhone" type="tel" autoComplete="tel" minLength="7" maxLength="30" pattern="\+?[0-9][0-9 ()-]{5,28}" required value={form.contactPhone} onChange={updateField} /></label>
        <label className="field"><span>Event type</span><input name="eventType" minLength="2" maxLength="80" required value={form.eventType} onChange={updateField} placeholder="Wedding, conference, celebration..." /></label>
        <label className="field"><span>Event name (optional)</span><input name="eventName" maxLength="180" value={form.eventName} onChange={updateField}/></label>
        <label className="field"><span>Event date</span><input name="eventDate" type="datetime-local" min={minimumEventDate} required value={form.eventDate} onChange={updateField}/></label>
        <label className="field"><span>Event location</span><input name="eventLocation" maxLength="120" required value={form.eventLocation} onChange={updateField}/></label>
        <label className="field"><span>Expected guest count (optional)</span><input name="guestCount" type="number" min="1" max="100000" step="1" value={form.guestCount} onChange={updateField}/></label>
        <label className="field"><span>Budget range in {selectedService?.currency || 'ETB'} (optional)</span><input name="budget" type="number" min="0" max="100000000" step="0.01" value={form.budget} onChange={updateField}/></label>
        <label className="field"><span>Required services / scope</span><textarea name="requiredServices" rows="2" maxLength="1000" value={form.requiredServices} onChange={updateField}/></label>
        <label className="field"><span>Additional requirements</span><textarea name="additionalRequirements" rows="3" maxLength="2000" value={form.additionalRequirements} onChange={updateField}/></label>
        <label className="field"><span>Message to vendor</span><textarea name="message" rows="3" maxLength="2000" value={form.message} onChange={updateField}/></label>
        <section className="quote-request-summary" aria-label="Review request details"><h3>Review request</h3><p><strong>Vendor and service:</strong> {selectedService?.vendorName} · {selectedService?.title}</p><p><strong>Event:</strong> {form.eventType || 'Event type'}{form.eventName ? ` · ${form.eventName}` : ''}{form.eventDate ? ` · ${form.eventDate.replace('T', ' ')}` : ''}</p><p><strong>Location:</strong> {form.eventLocation || 'Not entered'}{form.guestCount ? ` · ${form.guestCount} guests` : ''}</p><p><strong>Budget:</strong> {form.budget ? `${selectedService?.currency || 'ETB'} ${Number(form.budget).toLocaleString()}` : 'Not specified'}</p></section>
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
  const [reloadToken, setReloadToken] = useState(0);
  const [requestTitle, setRequestTitle] = useState('publicBookService');

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
  }, [serviceId, reloadToken]);

  if (loading) return <main className="page-shell"><div className="loading" role="status"><span className="spinner"/>{t('loadingServices')}</div></main>;
  if (error || !service) return <main className="page-shell"><div className="empty panel"><strong>Service unavailable</strong><span>{error || 'This service is no longer available.'}</span>{error && <button className="button secondary" type="button" onClick={() => setReloadToken((value) => value + 1)}>{t('retry')}</button>}<button className="button secondary" type="button" onClick={() => onNavigate('/services')}>Back to Services</button></div></main>;

  const availabilityItems = withStableKeys(
    (Array.isArray(service.availability) ? service.availability : []).filter((entry) => entry?.date != null),
    (entry) => String(entry.date),
  );
  const reviewItems = withStableKeys(service.reviews || [], (review) => review.id ?? JSON.stringify([
    review.createdAt ?? null,
    review.customerName ?? null,
    review.rating ?? null,
    review.comment ?? '',
  ]));

  return <main className="page-shell"><div className="content-stack">
    <button className="text-action" type="button" onClick={() => onNavigate('/services')}>← Back to Services</button>
    <div className="public-vendor-gallery">{service.images?.length
      ? service.images.map((image) => <VendorMedia key={image.id} src={image.url} alt={image.name || service.title} loading="lazy" />)
      : <VendorMedia className="public-service-image" src={null} alt={service.title || t('publicServiceImageUnavailable')} />}</div>
    <section className="info-card wide"><p className="eyebrow">{service.category}</p><h1>{service.title}</h1><p>{service.description}</p><div className="detail-meta-grid">
      <div><span>Provider</span><strong>{service.vendorId ? <button className="text-action" type="button" onClick={() => onNavigate(`/vendors/${service.vendorId}`)}>{service.vendorName}</button> : service.vendorName}</strong></div>
      <div><span>Location</span><strong>{service.city || t('serviceAreaRequest')}</strong></div>
      <div><span>Starting price</span><strong>{service.price !== null && service.price !== undefined ? `${service.currency} ${Number(service.price).toLocaleString()}` : t('priceOnRequest')}</strong></div>
      {service.reviewCount > 0 && <div><span>Customer rating</span><strong>{Number(service.rating).toFixed(1)} / 5 ({service.reviewCount})</strong></div>}
      {service.available && <div><span>Availability</span><strong>{t('publicAvailableNow')}</strong></div>}
    </div><div className="card-actions"><button className="button" type="button" onClick={() => { setRequestTitle('publicBookService'); setRequestOpen(true); }}>{t('publicBookService')}</button><button className="button secondary" type="button" onClick={() => { setRequestTitle('publicContactVendor'); setRequestOpen(true); }}>{t('publicContactVendor')}</button></div></section>
    <section className="panel"><div className="panel-header"><h2>Service packages</h2></div>
      {service.packages?.length ? <div className="card-grid">{service.packages.map((item) => <article className="info-card" key={item.id}><h3>{item.name}</h3><p>{item.description || t('customServicePackage')}</p><strong>{item.currency} {Number(item.price).toLocaleString()}</strong><small>Minimum booking: {item.minimumBooking}</small>{item.includedFeatures?.length > 0 && <ul>{item.includedFeatures.map((feature) => <li key={feature}>{feature}</li>)}</ul>}{item.extras?.length > 0 && <div className="public-package-extras"><strong>Optional extras</strong>{item.extras.map((extra) => <p key={extra.name}>{extra.name} · {item.currency} {Number(extra.price).toLocaleString()} {extra.description && `· ${extra.description}`}</p>)}</div>}</article>)}</div> : <p>No packages are published for this service yet.</p>}
    </section>
    {availabilityItems.length > 0 && <section className="panel"><div className="panel-header"><h2>Availability</h2></div><div className="list-stack">{availabilityItems.map(({ item: entry, key }) => <div className="list-card" key={key}><strong>{String(entry.date).slice(0, 10)}</strong><span>{entry.status}</span></div>)}</div></section>}
    <section className="panel"><div className="panel-header"><h2>Customer reviews</h2></div>
      {reviewItems.length ? <div className="list-stack">{reviewItems.map(({ item: review, key }) => <article className="list-card" key={key}><div><strong>{review.customerName} · {'★'.repeat(review.rating)}</strong><small>{review.comment || 'Rating submitted'}</small></div></article>)}</div> : <p>No published reviews are available for this service yet.</p>}
    </section>
  </div>{requestOpen && <QuoteRequestModal service={service} user={user} onNavigate={onNavigate} onClose={() => setRequestOpen(false)} title={t(requestTitle)}/>}</main>;
}

function VendorMedia({ src, alt, className = '', loading = 'lazy' }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return <div className={`media-placeholder ${className}`} role="img" aria-label={`${alt} image unavailable`} />;
  }
  return <img
    className={className}
    src={resolveApiAssetUrl(src)}
    alt={alt}
    loading={loading}
    onError={() => setFailed(true)}
  />;
}

function VendorBookingRequestModal({ service, onNavigate, onClose }) {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    api('/customer/events').then((response) => {
      if (!active) return;
      const availableEvents = (Array.isArray(response.data) ? response.data : []).filter((event) => (
        ['active', 'published', 'upcoming', 'open'].includes(String(event.status || '').toLowerCase())
        && new Date(String(event.startDate || event.date || '').replace(' ', 'T')).getTime() > Date.now()
      ));
      setEvents(availableEvents);
    }).catch((issue) => {
      if (active) setError(issue.message || 'Your events could not be loaded.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/platform/bookings', {
        method: 'POST',
        body: JSON.stringify({ eventId: Number(eventId), serviceId: Number(service.id), notes }),
      });
      setSuccess(true);
    } catch (issue) {
      setError(issue.message || 'The booking request could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-label="Request vendor booking">
      <div className="modal-head"><h2>Request a booking</h2><button className="icon-button" type="button" aria-label="Close" disabled={busy} onClick={onClose}>×</button></div>
      <div className="modal-body">
        {success ? <p role="status">Your booking request was sent. You can track its status in your bookings.</p> : <>
          <p>{service.title} · {service.vendorName}</p>
          {loading ? <div className="loading" role="status"><span className="spinner"/>Loading your events…</div> : events.length ? <label className="field"><span>Event</span><select required value={eventId} onChange={(change) => setEventId(change.target.value)}><option value="">Choose an event</option>{events.map((item) => <option value={item.id} key={item.id}>{item.title} · {new Date(String(item.startDate || item.date).replace(' ', 'T')).toLocaleDateString()}</option>)}</select></label> : <div className="empty panel"><strong>No future events are open for booking.</strong><button className="text-action" type="button" onClick={() => onNavigate('/customer/dashboard?view=events')}>Create or update an event</button></div>}
          {events.length > 0 && <label className="field"><span>Requirements (optional)</span><textarea maxLength={500} value={notes} onChange={(change) => setNotes(change.target.value)}/></label>}
          {error && <div className="alert error" role="alert">{error}</div>}
        </>}
      </div>
      <div className="modal-foot">{success
        ? <><button className="button secondary" type="button" onClick={onClose}>Close</button><button className="button" type="button" onClick={() => onNavigate('/customer/dashboard?view=bookings')}>View bookings</button></>
        : <><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button" type="submit" disabled={busy || loading || !eventId || !events.length}>{busy ? 'Sending…' : 'Send booking request'}</button></>}
      </div>
    </form>
  </div>;
}

function VendorDetailPage({ vendorId, user, onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [requestService, setRequestService] = useState(null);
  const [bookingService, setBookingService] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadVendor() {
      try {
        setLoading(true);
        setError('');
        setNotFound(false);
        const response = await api(`/platform/vendors/${vendorId}`, { signal: controller.signal });
        setVendor(response.data || null);
      } catch (issue) {
        if (issue.name !== 'AbortError') {
          setVendor(null);
          setNotFound(issue.response?.status === 404 || issue.status === 404);
          setError(issue.message || 'Unable to load this vendor profile.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadVendor();
    return () => controller.abort();
  }, [vendorId, reloadToken]);

  if (loading) {
    return <main className="page-shell"><div className="content-stack"><div className="info-card wide"><div className="loading"><span className="spinner" />{t('loadingVendorProfile')}</div></div></div></main>;
  }

  if (error || !vendor) {
    return <main className="page-shell"><div className="content-stack"><div className="info-card wide danger-card"><p className="eyebrow">{t('profileUnavailable')}</p><h2>{notFound ? t('vendorNotFound') : 'Unable to load vendor profile'}</h2><p>{error ? translateText(error, language) : t('vendorUnavailable')}</p>{!notFound && <button className="button secondary" type="button" onClick={() => setReloadToken((token) => token + 1)}>Retry</button>}<button className="button" type="button" onClick={() => onNavigate('/vendors')}>{t('browseAllVendors')}</button></div></div></main>;
  }

  const reviewItems = withStableKeys(vendor.reviews || [], (review) => review.id ?? JSON.stringify([
    review.createdAt ?? null,
    review.customerName ?? null,
    review.rating ?? null,
    review.comment ?? '',
  ]));
  const availabilityItems = withStableKeys(
    (Array.isArray(vendor.availability) ? vendor.availability : []).filter((entry) => entry?.date != null),
    (entry) => String(entry.date),
  );

  return <main className="page-shell"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{t('vendorProfile')}</p><h2>{vendor.business_name || vendor.name}</h2></div><button className="button secondary small" type="button" onClick={() => onNavigate('/vendors')}>{t('browseAllVendors')}</button></div>
    <article className="info-card wide">
      <div className="profile-panel">
        <VendorMedia className="public-vendor-logo" src={vendor.logoUrl || vendor.coverImageUrl} alt={`${vendor.business_name || vendor.name} profile`} />
        <div>
          <h3>{vendor.business_name || vendor.name}</h3>
          <p className="muted">{vendor.category || 'Event services'} • {vendor.city || t('locationAvailable')}</p>
          <p>{vendor.verified && <span className="verify-badge-inline">{t('verified')}</span>} {vendor.reviewCount > 0 ? `${vendor.reviewCount} ${t('vendorReviews')} • ★ ${Number(vendor.rating).toFixed(1)}` : 'No published reviews yet'}</p>
        </div>
        <div className="vendor-compare-actions">
          <button className="button secondary small" type="button" onClick={() => onNavigate(`/contact?vendor=${encodeURIComponent(vendor.business_name || vendor.name || 'vendor')}`)}>Contact Vendor</button>
          {vendor.services?.some((service) => service.published !== false && service.visibility !== 'private') && <button className="button" type="button" onClick={() => setRequestService(vendor.services.find((service) => service.published !== false && service.visibility !== 'private'))}>Request Quote</button>}
        </div>
      </div>
      <div className="report-grid" style={{ marginTop: '18px' }}>
        <div className="info-card"><h3>{t('about')}</h3><p className="vendor-description">{vendor.description || 'No business description has been provided.'}</p></div>
        <div className="info-card"><h3>{t('startingFrom')}</h3><p>{vendor.priceFrom !== null && vendor.priceFrom !== undefined ? `${vendor.currency || 'ETB'} ${Number(vendor.priceFrom).toLocaleString()}` : t('priceOnRequest')}</p></div>
        <div className="info-card"><h3>{t('location')}</h3><p>{vendor.city || t('serviceAreaRequest')}</p></div>
      </div>
    </article>

    {vendor.coverImageUrl && <VendorMedia className="public-vendor-cover" src={vendor.coverImageUrl} alt={`${vendor.business_name || vendor.name} cover`} />}
    {vendor.portfolio?.length > 0 && <section className="panel"><div className="panel-header"><h3>Portfolio</h3></div><div className="public-vendor-gallery">{vendor.portfolio.map((image) => <button className="vendor-gallery-item" key={image.id} type="button" onClick={() => setPreviewImage(image)} aria-label={`Preview ${image.name || 'vendor portfolio image'}`}><VendorMedia src={image.url} alt={image.name || 'Vendor portfolio'} /></button>)}</div></section>}

    <section className="content-stack">
      <div className="section-header compact-header"><div><p className="eyebrow">{t('publishedServices')}</p><h2>{t('availableServicePackages')}</h2></div></div>
      {Array.isArray(vendor.services) && vendor.services.length ? <div className="card-grid">{vendor.services.filter((service) => service && service.published !== false && service.visibility !== 'private').map((service) => <article key={service.id} className="info-card vendor-profile-service">
        {service.images?.[0] && <VendorMedia className="vendor-service-image" src={service.images[0].url} alt={`${service.title} portfolio`} />}
        <p className="eyebrow">{service.category || vendor.category}</p><h3>{service.title}</h3><p className="vendor-description">{service.description || 'No service description has been provided.'}</p>
        <div className="pricing-row"><strong>{service.price !== null && service.price !== undefined ? `${service.currency} ${Number(service.price).toLocaleString()}${service.packages?.length ? ' · starting price' : ''}` : t('priceOnRequest')}</strong><div className="customer-actions"><button className="button secondary small" type="button" onClick={() => setRequestService(service)}>Request Quote</button>{user?.role === 'customer' && Number(service.price) > 0 && <button className="button small" type="button" onClick={() => setBookingService(service)}>Request booking</button>}</div></div>
        {service.packages?.length > 0 && <div className="vendor-package-list"><h4>Packages</h4>{service.packages.map((item) => <div className="vendor-package-detail" key={item.id}><strong>{item.name} · {item.currency} {Number(item.price).toLocaleString()}</strong>{item.description && <p>{item.description}</p>}{item.includedFeatures?.length > 0 && <ul>{item.includedFeatures.map((feature) => <li key={feature}>{feature}</li>)}</ul>}{item.extras?.length > 0 && <p>Extras: {item.extras.map((extra) => `${extra.name} (${item.currency} ${Number(extra.price).toLocaleString()})`).join(', ')}</p>}</div>)}</div>}
      </article>)}</div> : <div className="empty-card">{t('noPublishedServices')}</div>}
    </section>
    <section className="panel"><div className="panel-header"><div><h3>Customer reviews</h3><p>{vendor.reviewCount || 0} published reviews · {vendor.reviewCount > 0 ? `${Number(vendor.rating).toFixed(1)} / 5` : 'No rating yet'}</p></div></div><div className="vendor-rating-distribution">{[5, 4, 3, 2, 1].map((rating) => <div key={rating}><span>{rating} stars</span><meter min="0" max={Math.max(1, vendor.reviewCount || 0)} value={vendor.ratingDistribution?.[rating] || 0} /><span>{vendor.ratingDistribution?.[rating] || 0}</span></div>)}</div>{reviewItems.length > 0 ? <div className="list-stack">{reviewItems.map(({ item: review, key }) => <article className="list-card" key={key}><div><strong>{review.customerName} · {'★'.repeat(review.rating)}</strong><small>{review.comment || 'Rating submitted'}</small></div></article>)}</div> : <p>No published reviews are available yet.</p>}</section>
    <section className="panel"><div className="panel-header"><h3>Availability</h3></div>{availabilityItems.length > 0 ? <div className="list-stack">{availabilityItems.map(({ item: entry, key }) => <div className="list-card" key={key}><strong>{String(entry.date).slice(0, 10)}</strong><span>{entry.status}</span></div>)}</div> : <p>No upcoming availability dates have been published.</p>}</section>
  </div>{requestService && <QuoteRequestModal service={requestService} services={vendor.services} vendorId={vendor.id} user={user} onNavigate={onNavigate} onClose={() => setRequestService(null)}/>}
  {bookingService && user?.role === 'customer' && <VendorBookingRequestModal service={bookingService} onNavigate={onNavigate} onClose={() => setBookingService(null)}/>}
  {previewImage && <div className="overlay vendor-image-preview" role="dialog" aria-modal="true" aria-label="Vendor image preview" onMouseDown={(event) => event.target === event.currentTarget && setPreviewImage(null)}><button className="icon-button" type="button" onClick={() => setPreviewImage(null)} aria-label="Close image preview"><X size={18}/></button><VendorMedia src={previewImage.url} alt={previewImage.name || 'Vendor portfolio'} loading="eager" /></div>}</main>;
}

function VendorsPage({ onNavigate, user, currentPath }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const initialParams = new URLSearchParams(String(currentPath).split('?')[1] || '');
  const [vendors, setVendors] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const initialFilters = getListingFiltersFromPath(currentPath);
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [search, setSearch] = useState(initialFilters.search);
  const [category, setCategory] = useState(initialFilters.category || 'all');
  const [location, setLocation] = useState(initialFilters.location);
  const [minPrice, setMinPrice] = useState(initialParams.get('minPrice') || '');
  const [maxPrice, setMaxPrice] = useState(initialParams.get('maxPrice') || '');
  const [minRating, setMinRating] = useState(initialParams.get('minRating') || '');
  const [availableOnly, setAvailableOnly] = useState(initialParams.get('availableOnly') === 'true');
  const [sort, setSort] = useState(initialParams.get('sort') || 'recommended');
  const [featuredOnly, setFeaturedOnly] = useState(initialParams.get('filter') === 'featured');
  const [verifiedOnly, setVerifiedOnly] = useState(initialParams.get('verified') === 'true');
  const [page, setPage] = useState(initialFilters.page);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: 12 });
  const [notice, setNotice] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [categoryRetry, setCategoryRetry] = useState(0);
  const [filterError, setFilterError] = useState('');
  const [requestVendor, setRequestVendor] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [comparisonSelection] = useState(() => {
    try { return { ids: getComparedVendorIds(), error: '' }; }
    catch (issue) { return { ids: [], error: issue.message || 'Saved comparison data could not be read.' }; }
  });
  const [comparedVendorIds, setComparedVendorIds] = useState(comparisonSelection.ids);
  const [compareNotice, setCompareNotice] = useState(comparisonSelection.error);
  const lastRoutePath = useRef(currentPath);

  useEffect(() => {
    if (lastRoutePath.current === currentPath) return;
    lastRoutePath.current = currentPath;
    const filters = getListingFiltersFromPath(currentPath);
    setSearchInput(filters.search);
    setSearch(filters.search);
    setCategory(filters.category || 'all');
    setLocation(filters.location);
    setPage(filters.page);
    const params = new URLSearchParams(String(currentPath).split('?')[1] || '');
    setMinPrice(params.get('minPrice') || '');
    setMaxPrice(params.get('maxPrice') || '');
    setMinRating(params.get('minRating') || '');
    setAvailableOnly(params.get('availableOnly') === 'true');
    setSort(params.get('sort') || 'recommended');
    setFeaturedOnly(params.get('filter') === 'featured');
    setVerifiedOnly(params.get('verified') === 'true');
  }, [currentPath]);

  const fetchVendors = useCallback(async (nextPage, nextFilters, signal) => {
    setLoading(true);
    setNotice('');
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: '12', sort: nextFilters.sort || 'recommended' });
      if (nextFilters.search) params.set('search', nextFilters.search);
      if (nextFilters.category && nextFilters.category !== 'all') params.set('category', nextFilters.category);
      if (nextFilters.location && nextFilters.location !== 'all') params.set('location', nextFilters.location);
      if (nextFilters.minPrice) params.set('minPrice', nextFilters.minPrice);
      if (nextFilters.maxPrice) params.set('maxPrice', nextFilters.maxPrice);
      if (nextFilters.minRating) params.set('minRating', nextFilters.minRating);
      if (nextFilters.verifiedOnly) params.set('verified', 'true');
      if (nextFilters.featuredOnly) params.set('filter', 'featured');
      if (nextFilters.availableOnly) params.set('availableOnly', 'true');
      const response = await api(`/platform/vendors?${params.toString()}`, { signal });
      setVendors(response.data || []);
      setPagination({
        page: response.pagination?.page || 1,
        totalPages: response.pagination?.totalPages || 1,
        total: response.pagination?.total || 0,
        limit: response.pagination?.limit || 12,
      });
    } catch (issue) {
      if (issue.name !== 'AbortError' && !signal?.aborted) {
        setVendors([]);
        setPagination({ page: 1, totalPages: 1, total: 0, limit: 12 });
        setNotice(issue.message || 'Unable to load vendor listings.');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadCategories() {
      setCategoryError('');
      try {
        const response = await api('/platform/categories', { signal: controller.signal });
        setCategoryOptions(Array.isArray(response.data) ? response.data : []);
      } catch (issue) {
        if (issue.name !== 'AbortError' && !controller.signal.aborted) {
          setCategoryOptions([]);
          setCategoryError(issue.message || 'Unable to load vendor category filters.');
        }
      }
    }
    loadCategories();
    return () => controller.abort();
  }, [categoryRetry]);

  useEffect(() => {
    const controller = new AbortController();
    if (minPrice && maxPrice && Number(maxPrice) < Number(minPrice)) {
      setLoading(false);
      setFilterError('Maximum price must be greater than or equal to minimum price.');
      return () => controller.abort();
    }
    setFilterError('');
    fetchVendors(page, { search, category, location, minPrice, maxPrice, minRating, verifiedOnly, featuredOnly, availableOnly, sort }, controller.signal);
    return () => controller.abort();
  }, [fetchVendors, page, search, category, location, minPrice, maxPrice, minRating, verifiedOnly, featuredOnly, availableOnly, sort, reloadToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category && category !== 'all') params.set('category', category);
    if (location) params.set('location', location);
    if (minPrice) params.set('minPrice', minPrice);
    if (maxPrice) params.set('maxPrice', maxPrice);
    if (minRating) params.set('minRating', minRating);
    if (verifiedOnly) params.set('verified', 'true');
    if (featuredOnly) params.set('filter', 'featured');
    if (availableOnly) params.set('availableOnly', 'true');
    if (sort !== 'recommended') params.set('sort', sort);
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    window.history.replaceState({}, '', `/vendors${query ? `?${query}` : ''}`);
  }, [search, category, location, minPrice, maxPrice, minRating, verifiedOnly, featuredOnly, availableOnly, sort, page]);

  const handleQuoteRequest = (vendorRecord) => {
    const services = Array.isArray(vendorRecord?.services) ? vendorRecord.services.filter((service) => service && service.published !== false && service.visibility !== 'private') : [];
    if (services.length) setRequestVendor(vendorRecord);
  };

  const handleContactVendor = (vendorRecord) => {
    const vendorName = vendorRecord?.business_name || vendorRecord?.name || 'vendor';
    onNavigate(`/contact?vendor=${encodeURIComponent(vendorName)}`);
  };

  const listingTitle = featuredOnly ? 'Featured Vendors'
    : verifiedOnly ? 'Verified Vendors'
      : sort === 'popular' ? 'Popular Vendors'
        : sort === 'recently-added' ? 'Newly Registered Vendors'
          : t('browseVendorsHeading');

  const toggleComparison = (vendorId) => {
    try {
      const result = toggleComparedVendor(vendorId);
      setComparedVendorIds(result.ids);
      setCompareNotice(result.limitReached ? t('navigationCompareLimit') : '');
    } catch (issue) {
      setCompareNotice(issue.message || t('navigationCompareLoadFailed'));
    }
  };

  return <main className="page-shell vendor-directory-page"><div className="content-stack"><div className="section-header"><div><p className="eyebrow">{t('vendorsEyebrow')}</p><h2>{listingTitle}</h2></div>
    <div className="vendor-compare-actions">{comparedVendorIds.length > 0 && <span>{t('navigationCompareSelected').replace('{count}', String(comparedVendorIds.length))}</span>}
      <button className="button secondary small" type="button" disabled={comparedVendorIds.length < 2} onClick={() => onNavigate('/compare')}>{t('navigationCompareSelectedAction')}</button>
    </div></div>
    {compareNotice && <p className="alert" role="status">{compareNotice}</p>}
    {categoryError && <div className="alert error" role="alert"><span>{categoryError}</span><button className="button secondary small" type="button" onClick={() => setCategoryRetry((value) => value + 1)}>Retry</button></div>}
    {filterError && <div className="alert error" role="alert">{filterError}</div>}
    <div className="panel" style={{ padding: '18px 20px' }}>
      <div className="toolbar vendor-directory-toolbar">
        <div className="search-box"><Search size={16}/><input aria-label={t('searchVendors')} value={searchInput} onChange={(event) => { setPage(1); setSearchInput(event.target.value); }} placeholder={t('searchVendors')} /></div>
        <select className="filter-select" aria-label={t('allCategories')} value={category} onChange={(event) => { setPage(1); setCategory(event.target.value); }}>
          <option value="all">{t('allCategories')}</option>
          {categoryOptions.map((item) => <option key={item.id} value={item.slug || item.name}>{item.name}</option>)}
        </select>
        <input className="filter-select" aria-label="Vendor city or location" value={location} onChange={(event) => { setPage(1); setLocation(event.target.value); }} placeholder={t('allLocations')} />
        <input className="filter-select" aria-label="Minimum vendor price" type="number" min="0" value={minPrice} onChange={(event) => { setPage(1); setMinPrice(event.target.value); }} placeholder="Min price" />
        <input className="filter-select" aria-label="Maximum vendor price" type="number" min="0" value={maxPrice} onChange={(event) => { setPage(1); setMaxPrice(event.target.value); }} placeholder="Max price" />
        <select className="filter-select" aria-label="Minimum vendor rating" value={minRating} onChange={(event) => { setPage(1); setMinRating(event.target.value); }}><option value="">Any rating</option><option value="3">3+ stars</option><option value="4">4+ stars</option><option value="4.5">4.5+ stars</option></select>
        <label className="vendor-verified-filter"><input type="checkbox" checked={verifiedOnly} onChange={(event) => { setPage(1); setVerifiedOnly(event.target.checked); }} /> Verified vendors</label>
        <label className="vendor-verified-filter"><input type="checkbox" checked={availableOnly} onChange={(event) => { setPage(1); setAvailableOnly(event.target.checked); }} /> Available</label>
        <select className="filter-select" aria-label="Sort vendors" value={sort} onChange={(event) => { setPage(1); setSort(event.target.value); }}>
          <option value="recommended">{t('recommended')}</option>
          <option value="popular">Most popular</option>
          <option value="highest-rated">{t('highestRated')}</option>
          <option value="most-reviewed">{t('mostReviewed')}</option>
          <option value="price-low">{t('priceLowHigh')}</option>
          <option value="price-high">{t('priceHighLow')}</option>
          <option value="recently-added">Newly registered</option>
        </select>
        <button type="button" className="button secondary small" onClick={() => { setPage(1); setSearchInput(''); setSearch(''); setCategory('all'); setLocation(''); setMinPrice(''); setMaxPrice(''); setMinRating(''); setVerifiedOnly(false); setFeaturedOnly(false); setAvailableOnly(false); setSort('recommended'); }}>{t('reset')}</button>
      </div>
    </div>

    {loading ? <div className="content-stack" role="status" aria-label="Loading vendor listings"><p className="loading"><span className="spinner" />{t('loadingVendorDirectory')}</p><div className="card-grid">{Array.from({ length: 6 }, (_, index) => <article className="vendor-card vendor-card-skeleton" key={index} aria-hidden="true"><div className="card-image-wrap vendor-skeleton-shimmer" /><div className="card-body"><div className="vendor-skeleton-line short vendor-skeleton-shimmer" /><div className="vendor-skeleton-line vendor-skeleton-shimmer" /><div className="vendor-skeleton-line long vendor-skeleton-shimmer" /></div></article>)}</div></div> : notice ? <div className="info-card wide danger-card" role="alert"><p>{notice}</p><button className="button secondary" type="button" onClick={() => setReloadToken((token) => token + 1)}>Retry</button></div> : vendors.length ? <>
      <div className="card-grid">
        {vendors.map((vendor) => <article key={vendor.id} className="vendor-card">
          <div className="card-image-wrap">
            <VendorMedia src={vendor.coverImageUrl || vendor.logoUrl} alt={vendor.business_name || vendor.name} />
            {vendor.verified && <span className="verify-badge">{t('verified')}</span>}
          </div>
          <div className="card-body">
            <div className="meta-row"><span>{vendor.category || 'Event services'}</span>{vendor.verified && <span className="verify-badge-inline">{t('verified')}</span>}</div>
            <h3>{vendor.business_name || vendor.name}</h3>
            <p>{vendor.city || t('locationAvailable')}</p>{vendor.description && <p className="vendor-card-description">{vendor.description}</p>}
            {vendor.services?.[0] && <p className="vendor-card-service"><strong>{vendor.services[0].title}</strong>{vendor.services[0].description ? ` · ${vendor.services[0].description}` : ''}</p>}
            <div className="pricing-row"><strong>{vendor.priceFrom !== null && vendor.priceFrom !== undefined ? `${vendor.currency || 'ETB'} ${Number(vendor.priceFrom).toLocaleString()}` : t('requestQuote')}</strong><span>{vendor.reviewCount > 0 ? `★ ${Number(vendor.rating).toFixed(1)} · ` : ''}{vendor.reviewCount} {t('vendorReviews')}</span></div>
            {vendor.available && <p className="vendor-availability-status">Available for new bookings</p>}
            <div className="card-actions">
              <button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${vendor.id}`)}>{t('viewProfile')}</button>
              <button className="button secondary small" type="button" aria-pressed={comparedVendorIds.includes(Number(vendor.id))} onClick={() => toggleComparison(vendor.id)}>
                {t(comparedVendorIds.includes(Number(vendor.id)) ? 'navigationRemoveFromCompare' : 'navigationAddToCompare')}
              </button>
              <button className="button secondary small" type="button" onClick={() => handleContactVendor(vendor)}>Contact Vendor</button>
              <button className="button small" type="button" disabled={!vendor.services?.some((service) => service && service.published !== false && service.visibility !== 'private')} onClick={() => handleQuoteRequest(vendor)}>Request Quote</button>
            </div>
          </div>
        </article>)}
      </div>

      <div className="pagination"><span>{t('showing')} {vendors.length} {t('of')} {pagination.total || vendors.length} {t('vendorsLabel')}</span><div>
        <button className="icon-button" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={18}/></button>
        <span>{t('page')} {pagination.page || 1} {t('of')} {Math.max(1, pagination.totalPages || 1)}</span>
        <button className="icon-button" type="button" disabled={page >= (pagination.totalPages || 1)} onClick={() => setPage((value) => Math.min(pagination.totalPages || 1, value + 1))}><ChevronRight size={18}/></button>
      </div></div>
    </> : <div className="vendor-directory-empty" role="status">
      <span className="vendor-directory-empty-icon"><Search size={20} aria-hidden="true" /></span>
      <h3>{t('noVendorMatches')}</h3>
      <p>{t('tryDifferentFilters')}</p>
    </div>}
  </div>{requestVendor && <QuoteRequestModal service={requestVendor.services?.find((service) => service && service.published !== false && service.visibility !== 'private')} services={requestVendor.services} vendorId={requestVendor.id} user={user} onNavigate={onNavigate} onClose={() => setRequestVendor(null)}/>}</main>;
}

function readServicePage(path = '') {
  const params = new URLSearchParams(String(path).split('?')[1] || '');
  return Math.max(1, Number(params.get('page')) || 1);
}

function serviceListingPath(page = 1, search = '', category = '') {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  if (category) params.set('category', category);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/services${query ? `?${query}` : ''}`;
}

function ServicesPage({ onNavigate, user, currentPath }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const initialFilters = getListingFiltersFromPath(currentPath);
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const serviceRequestController = useRef(null);
  const [page, setPage] = useState(() => readServicePage(currentPath));
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [search, setSearch] = useState(initialFilters.search);
  const [category, setCategory] = useState(initialFilters.category);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [categoryRetry, setCategoryRetry] = useState(0);
  const [requestService, setRequestService] = useState(null);
  const lastRoutePath = useRef(currentPath);

  useEffect(() => {
    if (lastRoutePath.current === currentPath) return;
    lastRoutePath.current = currentPath;
    const nextPage = readServicePage(currentPath);
    const nextFilters = getListingFiltersFromPath(currentPath);
    setPage(nextPage);
    setSearchInput(nextFilters.search);
    setSearch(nextFilters.search);
    setCategory(nextFilters.category);
    void loadServices(nextPage, nextFilters.search, nextFilters.category);
  }, [currentPath]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadCategories() {
      setCategoryError('');
      try {
        const response = await api('/platform/categories', { signal: controller.signal });
        if (!controller.signal.aborted) setCategories(Array.isArray(response.data) ? response.data : []);
      } catch (issue) {
        if (issue.name !== 'AbortError' && !controller.signal.aborted) {
          setCategories([]);
          setCategoryError(issue.message || 'Service categories could not be loaded.');
        }
      }
    }
    loadCategories();
    return () => controller.abort();
  }, [categoryRetry]);

  async function loadServices(nextPage = 1, nextSearch = search, nextCategory = category) {
    serviceRequestController.current?.abort();
    const controller = new AbortController();
    serviceRequestController.current = controller;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: '12', sort: 'recommended' });
      if (nextSearch.trim()) params.set('search', nextSearch.trim());
      if (nextCategory) params.set('category', nextCategory);
      const response = await api(`/platform/services?${params.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setServices(Array.isArray(response.data) ? response.data : []);
      setPagination(response.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch (issue) {
      if (!controller.signal.aborted) {
        setServices([]);
        setError(issue.message || 'Unable to load services.');
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    void loadServices(page);
    return () => serviceRequestController.current?.abort();
  }, []);

  const navigateToPage = (nextPage) => {
    const path = serviceListingPath(nextPage, search, category);
    setPage(nextPage);
    if (path === currentPath) void loadServices(nextPage);
    else onNavigate(path);
  };
  const updateServiceFilters = (nextSearch, nextCategory) => {
    const path = serviceListingPath(1, nextSearch, nextCategory);
    setSearch(nextSearch);
    setCategory(nextCategory);
    setPage(1);
    if (path === currentPath) void loadServices(1, nextSearch, nextCategory);
    else onNavigate(path);
  };
  return <main className="page-shell"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">{t('servicesEyebrow')}</p><h2>{t('servicesHeading')}</h2></div></div>
    {categoryError && <div className="alert error" role="alert">{categoryError}<button type="button" className="button secondary small" onClick={() => setCategoryRetry((value) => value + 1)}>{t('retry')}</button></div>}
    <form className="panel service-listing-filters" role="search" onSubmit={(event) => {
      event.preventDefault();
      updateServiceFilters(searchInput.trim(), category);
    }}>
      <label className="field"><span>Search services</span><input type="search" maxLength="120" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search services, vendors, or descriptions" /></label>
      <label className="field"><span>Category</span><select value={category} onChange={(event) => updateServiceFilters(searchInput.trim(), event.target.value)}><option value="">All categories</option>{categories.map((item) => <option value={item.slug || item.name} key={item.id}>{item.name}</option>)}</select></label>
      <button className="button" type="submit" disabled={loading}>{t('search')}</button>
    </form>
    {!loading && !error && <p role="status">{pagination.total ?? services.length} {t('publicServicesFound')}</p>}
    {loading ? <div className="content-stack" role="status" aria-label={t('loadingServices')}><div className="loading"><span className="spinner"/>{t('loadingServices')}</div><div className="card-grid">{Array.from({ length: 6 }, (_, index) => <article className="info-card service-card-skeleton" key={index} aria-hidden="true"><div className="public-service-image vendor-skeleton-shimmer" /><div className="vendor-skeleton-line short vendor-skeleton-shimmer" /><div className="vendor-skeleton-line vendor-skeleton-shimmer" /><div className="vendor-skeleton-line long vendor-skeleton-shimmer" /></article>)}</div></div>
      : error ? <div className="alert error" role="alert">{error}<button type="button" className="button secondary small" onClick={() => loadServices(pagination.page || page)}>{t('retry')}</button></div>
        : services.length ? <>
          <div className="card-grid">{services.map((service) => <article key={service.id} className="info-card">
            <VendorMedia className="public-service-image" src={service.images?.[0]?.url} alt={service.images?.[0]?.name || service.title || t('publicServiceImageUnavailable')} />
            {service.category && <p className="eyebrow">{service.category}</p>}<h3>{service.title}</h3><p>{service.description || ''}</p>
            <p>{[service.vendorName, service.city].filter(Boolean).join(' · ')}</p>
            <div className="pricing-row compact-row"><strong>{service.price !== null && service.price !== undefined ? `${service.currency} ${Number(service.price).toLocaleString()}` : t('requestQuote')}</strong>{service.reviewCount > 0 && <span>{Number(service.rating).toFixed(1)}★ ({service.reviewCount})</span>}</div>
            {service.available && <p className="vendor-availability-status">{t('publicAvailableNow')}</p>}
            <div className="card-actions"><button className="button secondary small" type="button" onClick={() => onNavigate(`/services/${service.id}`)}>{t('publicViewServiceDetails')}</button><button className="button small" type="button" onClick={() => setRequestService(service)}>{t('publicBookService')}</button></div>
          </article>)}</div>
          <div className="pagination-row" aria-label={t('publicServicePages')}><button className="button secondary small" type="button" disabled={(pagination.page || 1) <= 1 || loading} onClick={() => navigateToPage((pagination.page || 1) - 1)}>{t('previous')}</button><span>{t('page')} {pagination.page || 1} {t('of')} {pagination.totalPages || 1}</span><button className="button secondary small" type="button" disabled={(pagination.page || 1) >= (pagination.totalPages || 1) || loading} onClick={() => navigateToPage((pagination.page || 1) + 1)}>{t('next')}</button></div>
        </> : <EmptyState title={t('noServicesMatch')} message={t('emptyMessage')} />}
  </div>{requestService && <QuoteRequestModal service={requestService} user={user} onNavigate={onNavigate} onClose={() => setRequestService(null)} title={t('publicBookService')}/>}</main>;
}

function CategoriesPage({ onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadCategories() {
      setLoading(true);
      setError('');
      try {
        const response = await api('/platform/events/categories');
        if (active) setCategories(Array.isArray(response.data) ? response.data : []);
      } catch (issue) {
        if (active) {
          setCategories([]);
          setError(issue.message || t('categoriesLoadError'));
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadCategories();
    return () => { active = false; };
  }, [reloadKey]);

  const visibleCategories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return categories
      .filter((category) => `${category.name || ''} ${category.description || ''}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
  }, [categories, search]);
  const categoryIcons = {
    wedding: Heart,
    birthday: Cake,
    graduation: GraduationCap,
    conference: CalendarDays,
    'corporate events': Building2,
    'concerts & music': Music2,
    festivals: PartyPopper,
    'religious events': Church,
    'cultural events': Palette,
    'workshops & training': BookOpen,
    'sports events': Trophy,
    exhibitions: Image,
  };

  return <main className="page-shell"><div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">{t('categoriesEyebrow')}</p><h2>{t('eventCategoriesHeading')}</h2></div></div>
    <div className="panel" style={{ padding: '18px 20px' }}><div className="category-search-toolbar">
      <div className="search-box"><Search size={16}/><input aria-label={t('searchCategories')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchCategories')} /></div>
      <button type="button" className="button secondary small" onClick={() => setSearch('')}>{t('clear')}</button>
    </div></div>
    {error && <div className="alert error" role="alert">{translateText(error, language)}<button type="button" className="button secondary small" onClick={() => setReloadKey((value) => value + 1)}>{t('retry')}</button></div>}
    {loading ? <div className="card-grid soft-grid" role="status" aria-label={t('loadingCategories')}>
      {Array.from({ length: 6 }, (_, index) => <article key={index} className="info-card category-discovery-skeleton" aria-hidden="true"><div className="vendor-skeleton-line short vendor-skeleton-shimmer"/><div className="vendor-skeleton-line vendor-skeleton-shimmer"/><div className="vendor-skeleton-line long vendor-skeleton-shimmer"/></article>)}
    </div> : error ? null : visibleCategories.length ? <div className="card-grid soft-grid">
      {visibleCategories.map((category) => {
        const CategoryIcon = categoryIcons[String(category.name || '').toLocaleLowerCase()] || Tags;
        const categoryPath = `/events?category=${encodeURIComponent(category.slug || category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}`;
        const eventCount = Number(category.total || 0);
        return <article key={category.id} className="info-card event-category-card">
          {category.image
            ? <img src={resolveApiAssetUrl(category.image)} alt="" loading="lazy" className="category-card-image" />
            : <div className="event-category-icon" aria-hidden="true"><CategoryIcon size={28}/></div>}
          <h3>{category.name}</h3>
          <p>{category.description || t('exploreEvents')}</p>
          <p className="event-category-count">{eventCount.toLocaleString(language === 'am' ? 'am-ET' : 'en-US')} {t('eventsLabel')}</p>
          {eventCount === 0 && <p className="muted">{t('noPublishedEventsForCategory')}</p>}
          <button className="button" type="button" onClick={() => onNavigate(categoryPath)}>{t('browseEvents')}</button>
        </article>;
      })}
    </div> : <EmptyState title={t('noCategoriesFound')} message={t('noCategoriesMatch')} />}
  </div></main>;
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
    <div className="info-card wide">{category.image ? <img src={resolveApiAssetUrl(category.image)} alt="" className="category-detail-image" /> : <div className="media-placeholder category-detail-image" role="img" aria-label="Category image unavailable" />}<div className="category-detail-copy"><p>{category.description || t('availableServiceCategory')}</p><div className="meta-row compact-row"><span>{category.eventCount || 0} events</span><span>{category.vendorCount || 0} active vendors</span><span>{category.serviceCount || 0} available services</span></div><button className="button" type="button" onClick={() => onNavigate(`/vendors?category=${encodeURIComponent(category.slug || category.name)}`)}>{t('viewVendors')}</button></div></div>
    <div className="panel"><label className="field"><span>Search related listings</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events, vendors, and services"/></label></div>
    <section className="content-stack"><div className="section-header compact-header"><div><p className="eyebrow">EVENTS</p><h3>Related events</h3></div></div>{events.length ? <div className="card-grid">{events.map((event) => <article className="info-card" key={event.id}><h3>{event.title}</h3><p>{event.location || t('locationAvailable')}</p><p>{formatEventDate(event.startDate, language)}</p><button className="button secondary small" type="button" onClick={() => onNavigate(`/events/${event.id}`)}>View event</button></article>)}</div> : <EmptyState title="No related events" message="There are no public events in this category right now."/>}</section>
    <section className="content-stack"><div className="section-header compact-header"><div><p className="eyebrow">VENDORS</p><h3>Relevant vendors</h3></div></div>{vendors.length ? <div className="card-grid">{vendors.map((vendor) => <article key={vendor.id} className="vendor-card"><div className="card-image-wrap"><img src={vendor.image || 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=900&q=80'} alt={vendor.business_name || vendor.name} loading="lazy" />{vendor.verified && <span className="verify-badge">Verified</span>}</div><div className="card-body"><div className="meta-row"><span>{vendor.category || 'Event services'}</span>{vendor.reviewCount > 0 && <span>★ {Number(vendor.rating).toFixed(1)}</span>}</div><h3>{vendor.business_name || vendor.name}</h3><p>{vendor.description || vendor.city || t('locationAvailable')}</p><div className="pricing-row"><strong>{vendor.priceFrom ? `ETB ${Number(vendor.priceFrom).toLocaleString()}` : t('requestQuote')}</strong><span>{vendor.reviewCount || 0} reviews</span></div><button className="button secondary small" type="button" onClick={() => onNavigate(`/vendors/${vendor.id}`)}>{t('viewProfile')}</button></div></article>)}</div> : <EmptyState title="No vendors currently available" message="This category has no eligible vendors right now." />}</section>
    <section className="content-stack"><div className="section-header compact-header"><div><p className="eyebrow">SERVICES</p><h3>Available services</h3></div></div>{services.length ? <div className="card-grid">{services.map((service) => <article key={service.id} className="info-card"><h3>{service.title}</h3><p>{service.vendorName} · {service.city}</p><div className="pricing-row compact-row"><strong>{service.price ? `ETB ${Number(service.price).toLocaleString()}` : t('requestQuote')}</strong>{service.reviewCount > 0 && <span>{Number(service.rating).toFixed(1)}★</span>}</div><p>{service.description}</p><button className="button secondary small" type="button" onClick={() => onNavigate(`/services/${service.id}`)}>View details</button></article>)}</div> : <EmptyState title="No services listed" message="This category does not currently have published services available." />}</section>
  </div></main>;
}

function AboutPage({ onNavigate, currentPath }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const aboutPagePath = String(currentPath || '').split('?')[0];
  const pageKey = aboutPagePath.slice('/about/'.length);
  const [aboutData, setAboutData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [openFaq, setOpenFaq] = useState(null);
  const faqs = [
    ['aboutFaqQuestionEventHub', 'aboutFaqAnswerEventHub'],
    ['aboutFaqQuestionBook', 'aboutFaqAnswerBook'],
    ['aboutFaqQuestionVendors', 'aboutFaqAnswerVendors'],
    ['aboutFaqQuestionRegisterVendor', 'aboutFaqAnswerRegisterVendor'],
    ['aboutFaqQuestionPublishService', 'aboutFaqAnswerPublishService'],
    ['aboutFaqQuestionManageBookings', 'aboutFaqAnswerManageBookings'],
    ['aboutFaqQuestionSupport', 'aboutFaqAnswerSupport'],
    ['aboutFaqQuestionPassword', 'aboutFaqAnswerPassword'],
  ];

  useEffect(() => {
    let active = true;

    async function loadAboutPage() {
      try {
        setLoading(true);
        const response = await api('/about');
        if (active) {
          setAboutData(response?.data || null);
          setError('');
        }
      } catch (issue) {
        console.error('About page content could not be loaded:', issue);
        if (active) {
          setError(t('aboutLoadError'));
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAboutPage();
    return () => { active = false; };
  }, [language, reloadKey]);

  useEffect(() => {
    window.scrollTo(0, 0);
    setOpenFaq(null);
  }, [aboutPagePath]);

  const closingCallToAction = <section className="about-cta">
    <div><p className="about-eyebrow">{t('aboutCtaEyebrow')}</p><h2>{t('aboutCtaTitle')}</h2><p>{t('aboutCtaCopy')}</p></div>
    <div className="about-button-row">
      <button type="button" className="button" onClick={() => onNavigate('/vendors')}>{t('aboutFindVendors')}<ArrowRight size={16} aria-hidden="true"/></button>
      <button type="button" className="button about-cta-secondary" onClick={() => onNavigate('/events')}>{t('aboutExploreEvents')}</button>
      <button type="button" className="button about-cta-outline" onClick={() => onNavigate('/contact')}>{t('aboutContactUs')}</button>
    </div>
  </section>;

  if (loading) {
    return <main className="page-shell about-shell"><div className="content-stack about-page">
      <div className="content-stack" role="status" aria-label={t('loadingAbout')}>
        <div className="about-loading-skeleton"/><div className="about-loading-skeleton"/><div className="about-loading-skeleton"/>
      </div>
      {closingCallToAction}
    </div></main>;
  }

  const missionObjectives = ['aboutMissionObjective1', 'aboutMissionObjective2', 'aboutMissionObjective3', 'aboutMissionObjective4', 'aboutMissionObjective5', 'aboutMissionObjective6'];
  const visionPriorities = ['aboutVisionPriority1', 'aboutVisionPriority2', 'aboutVisionPriority3', 'aboutVisionPriority4', 'aboutVisionPriority5', 'aboutVisionPriority6'];
  const coreValues = [
    { title: 'trustTransparency', icon: ShieldCheck },
    { title: 'qualityService', icon: Award },
    { title: 'customerSatisfaction', icon: Heart },
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
    { title: 'aboutAudienceCustomersTitle', description: 'aboutWorkflowCustomersCopy', action: 'aboutAudienceCustomersAction', destination: '/events', icon: UserRound },
    { title: 'aboutAudienceOrganizersTitle', description: 'aboutWorkflowOrganizersCopy', action: 'aboutAudienceOrganizersAction', destination: '/login', icon: CalendarDays },
    { title: 'aboutAudienceVendorsTitle', description: 'aboutWorkflowVendorsCopy', action: 'aboutAudienceVendorsAction', destination: '/vendor-application', icon: BriefcaseBusiness },
    { title: 'aboutAudienceAdminsTitle', description: 'aboutWorkflowAdminsCopy', action: 'aboutAudienceAdminsAction', destination: '/login', icon: Shield },
  ];
  const partners = Array.isArray(aboutData?.partners) ? aboutData.partners : [];
  const team = Array.isArray(aboutData?.team) ? aboutData.team : [];
  const testimonials = Array.isArray(aboutData?.testimonials) ? aboutData.testimonials : [];
  const configuredContent = aboutData?.language === language ? aboutData : null;
  const displayValues = coreValues.map((value) => ({ ...value, title: t(value.title) }));

  return <main className="page-shell about-shell"><div className="content-stack about-page">
    {error && <div className="about-load-error" role="alert"><span>{error}</span><button type="button" className="button secondary small" onClick={() => setReloadKey((key) => key + 1)}>{t('retry')}</button></div>}

    {pageKey === 'mission-vision' && <>
    <section className="about-purpose-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutPurposeEyebrow')}</p><h2>{t('aboutPurposeHeading')}</h2></div>
      <div className="about-purpose-grid">
        <article className="about-purpose-card">
          <div className="about-purpose-icon"><Target size={23} aria-hidden="true"/></div>
          <h3>{t('aboutMissionTitle')}</h3>
          <p>{configuredContent?.mission || t('aboutMissionCopy')}</p>
          <h4>{t('aboutMissionObjectives')}</h4>
          <ul>{missionObjectives.map((key) => <li key={key}><Check size={15} aria-hidden="true"/><span>{t(key)}</span></li>)}</ul>
        </article>
        <article className="about-purpose-card">
          <div className="about-purpose-icon"><Compass size={23} aria-hidden="true"/></div>
          <h3>{t('aboutVisionTitle')}</h3>
          <p>{configuredContent?.vision || t('aboutVisionCopy')}</p>
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
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutValuesEyebrow')}</p><h2>{t('aboutValuesTitle')}</h2></div>
      <div className="about-value-grid">{displayValues.map(({ title, icon: Icon }) => <article className="about-value-card" key={title}>
        <div className="about-card-icon"><Icon size={21} aria-hidden="true"/></div><h3>{title}</h3>
      </article>)}</div>
    </section>
    </>}

    {pageKey === 'how-it-works' && <section className="about-content-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutProcessEyebrow')}</p><h2>{t('aboutProcessTitle')}</h2><p>{t('aboutProcessIntro')}</p></div>
      <div className="about-step-grid">{workSteps.map(({ title, description, icon: Icon }, index) => <article className="about-step-card" key={title}>
        <div className="about-step-top"><span className="about-step-number">{String(index + 1).padStart(2, '0')}</span><Icon size={22} aria-hidden="true"/></div><h3>{t(title)}</h3><p>{t(description)}</p>
      </article>)}</div>
    </section>}

    {pageKey === 'why-choose' && <>
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
    </>}

    {pageKey === 'team' && <section className="about-content-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutTeamEyebrow')}</p><h2>{t('aboutTeamTitle')}</h2><p>{t('aboutTeamIntro')}</p></div>
      {team.length ? <div className="about-people-grid">{team.map((member) => <article className="about-person-card" key={member.id}>
        {member.imageUrl && <img src={resolveApiAssetUrl(member.imageUrl)} alt="" loading="lazy"/>}
        <h3>{member.name}</h3><p>{member.role}</p>
      </article>)}</div> : <div className="about-empty-state" role={error ? 'alert' : 'status'}>{error ? t('aboutSectionUnavailable') : t('aboutTeamEmpty')}</div>}
    </section>}

    {pageKey === 'partners' && <section className="about-content-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutPartnersEyebrow')}</p><h2>{t('aboutPartnersTitle')}</h2><p>{t('aboutPartnersIntro')}</p></div>
      {partners.length ? <div className="about-partner-grid">{partners.map((partner) => <article className="about-partner-card" key={partner.id}>
        {partner.logoUrl && <img src={resolveApiAssetUrl(partner.logoUrl)} alt="" loading="lazy"/>}
        <div><h3>{partner.name}</h3>{partner.category && <p>{partner.category}</p>}{partner.city && <p>{partner.city}</p>}</div>
      </article>)}</div> : <div className="about-empty-state" role={error ? 'alert' : 'status'}>{error ? t('aboutSectionUnavailable') : t('aboutPartnersEmpty')}</div>}
    </section>}

    {pageKey === 'success-stories' && <section className="about-content-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutStoriesEyebrow')}</p><h2>{t('aboutStoriesTitle')}</h2><p>{t('aboutStoriesIntro')}</p></div>
      {error ? <div className="about-empty-state" role="alert">{t('aboutSectionUnavailable')}</div> : testimonials.length ? <div className="about-testimonial-grid">{testimonials.map((testimonial) => <article className="about-testimonial-card" key={testimonial.id}>
        <div className="about-testimonial-rating" aria-label={`${testimonial.rating} / 5`}>{Array.from({ length: testimonial.rating }, (_, index) => <Star size={16} fill="currentColor" key={index} aria-hidden="true"/>)}</div>
        <blockquote>{testimonial.quote}</blockquote>
        <p>{t('aboutTestimonialCustomer')}{testimonial.vendorName ? ` · ${testimonial.vendorName}` : ''}</p>
      </article>)}</div> : <div className="about-empty-state" role="status">{t('aboutStoriesEmpty')}</div>}
    </section>}

    {pageKey === 'faqs' && <section className="about-content-section">
      <div className="about-section-heading"><p className="about-eyebrow">{t('aboutFaqEyebrow')}</p><h2>{t('aboutFaqTitle')}</h2><p>{t('aboutFaqIntro')}</p></div>
      <div className="about-faq-list">{faqs.map(([question, answer], index) => <article className={`about-faq-item ${openFaq === index ? 'is-open' : ''}`} key={question}>
        <h3><button type="button" id={`about-faq-question-${index}`} aria-expanded={openFaq === index} aria-controls={`about-faq-answer-${index}`}
          onClick={() => setOpenFaq((current) => current === index ? null : index)}>{t(question)}<ChevronDown size={18} aria-hidden="true"/></button></h3>
        <div id={`about-faq-answer-${index}`} role="region" aria-labelledby={`about-faq-question-${index}`} hidden={openFaq !== index}><p>{t(answer)}</p></div>
      </article>)}</div>
    </section>}

    {closingCallToAction}
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
  const [contactDetailsOpen, setContactDetailsOpen] = useState(true);
  const [emailDeliveryWarning, setEmailDeliveryWarning] = useState('');
  const submitLock = useRef(false);

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
    setEmailDeliveryWarning('');
  }

  async function submitContact(event) {
    event.preventDefault();
    if (submitLock.current) return;

    const { normalized, errors: validationErrors } = validateContactForm(form, language);
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    setSubmitError('');
    setSuccess('');
    setErrors({});

    try {
      const response = await api('/contact', {
        method: 'POST',
        body: JSON.stringify(normalized),
      });
      if (!response?.success || !response?.data?.reference) {
        throw new Error(response?.message || t('contactSubmitError'));
      }
      const reference = response.data.reference;
      setSuccess(reference ? `${t('messageSaved')} ${t('reference')}: ${reference}` : t('messageSaved'));
      const emailDelivery = response.data.email;
      if (emailDelivery && (
        emailDelivery.administrator !== 'sent' || emailDelivery.customer !== 'sent'
      )) {
        setEmailDeliveryWarning(t('contactEmailDeliveryWarning'));
      }
      setForm({ ...emptyForm });
    } catch (issue) {
      setSubmitError(issue.status === 429 ? issue.message : issue.message || t('contactSubmitError'));
    } finally {
      submitLock.current = false;
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
                  <div>{withStableKeys(contactInfo.socials, (entry) => entry.url).map(({ item: entry, key }) => <a tabIndex={contactDetailsOpen ? 0 : -1} key={key} href={entry.url} target="_blank" rel="noopener noreferrer"><Share2 size={15} aria-hidden="true" />{entry.label}<ExternalLink size={13} aria-hidden="true" /></a>)}</div>
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
          {emailDeliveryWarning && <div className="alert error" role="status">{emailDeliveryWarning}</div>}
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

function LoginPage({ onLogin, demoMode = false, showForgotPassword = false }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rememberMeLabel = translateText('Remember me', language);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(email, password, rememberMe);
    } catch (issue) {
      setError(translateText(issue.message, language));
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-wrap"><div className="login-card">
    <AuthBrand showEventHubLogo={false} showInstitutionLogo={false} />
    <h1>{t('signIn')}</h1>
    <p className="muted">{t('accessWorkspace')}</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    <form className="login-form" onSubmit={submit}>
      <label className="auth-field">
        <span>{demoMode ? 'Email address or username' : t('emailAddress')}</span>
        <input type={demoMode ? 'text' : 'email'} name="email" placeholder={demoMode ? 'Email address or username' : undefined} autoComplete="username" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="auth-field" htmlFor="login-password">
        <span id="login-password-label">{t('password')}</span>
        <div className="password-input-wrap">
          <input id="login-password" aria-labelledby="login-password-label" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="password-visibility" type="button" aria-label={t(showPassword ? 'hidePassword' : 'showPassword')} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
        </div>
      </label>
      <div className="auth-form-options">
        <label className="remember-option">
          <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
          <span>{rememberMeLabel}</span>
        </label>
      </div>
      {showForgotPassword && <div className="auth-forgot-row">
        <button type="button" className="text-link auth-forgot-link" onClick={() => navigateBrowserPath('/forgot-password')}>{t('forgotPassword')}</button>
      </div>}
      <button type="submit" className="button login-button" disabled={busy}>{busy ? t('signingIn') : t('signInSecurely')}</button>
    </form>

    <div className="login-account-links">
      <button type="button" className="text-link" onClick={() => navigateBrowserPath('/register')}>{t('createAccount')}</button>
    </div>
    <div className="auth-home-footer"><AuthHomeLink /></div>
  </div></main>;
}

function RegisterPage({ onRegister, onRegistrationComplete, registrationEnabled = true }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const redirectTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(redirectTimer.current), []);
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
      const result = await onRegister(form.name.trim(), form.email.trim(), form.password);
      setSuccess(translateText(result?.message, language) || t('registrationSuccess'));
      redirectTimer.current = window.setTimeout(() => onRegistrationComplete(result), 1200);
    } catch (issue) {
      setError(translateText(issue.message, language));
    } finally {
      setBusy(false);
    }
  }
  return <main className="login-wrap"><div className="login-card registration-card">
    <AuthBrand showEventHubLogo={false} showInstitutionLogo={false} />
    <h1>{t('createAccountHeading')}</h1>
    <p className="muted">{t('registerAsRole')}</p>
    {!registrationEnabled && <div className="alert warning" role="status">{t('publicRegistrationDisabled')}</div>}
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
      <button className="button login-button" disabled={busy || Boolean(success) || !registrationEnabled}>{busy ? t('creatingAccount') : t('registerNow')}</button>
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
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const redirectTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(redirectTimer.current), []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setSuccess('');
    try {
      await onSubmit(email.trim());
      setSuccess(t('resetOtpSent'));
      redirectTimer.current = window.setTimeout(() => navigateBrowserPath('/verify-reset-otp'), 1200);
    } catch (issue) {
      setError(issue.code === 'DEMO_AUTH' ? t('resetDemoUnavailable') : issue.status === 503 ? t('resetServiceUnavailable') : translateText(issue.message, language));
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-wrap"><section className="login-card reset-card">
    <p className="eyebrow">{t('resetEyebrow')}</p>
    <h1>{t('forgotPasswordTitle')}</h1>
    <p className="muted">{t('resetEmailCopy')}</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    {success && <div className="alert success" role="status">{success}</div>}
    <form onSubmit={submit}>
      <label className="field"><span>{t('emailAddress')}</span><input name="email" type="email" autoComplete="email" maxLength="254" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <button className="button login-button" type="submit" disabled={busy || Boolean(success)}>{busy ? t('sending') : t('sendResetLink')}</button>
    </form>
    <div className="auth-home-footer"><a className="auth-home-link" href="/login" onClick={(event) => { event.preventDefault(); window.clearTimeout(redirectTimer.current); navigateBrowserPath('/login'); }}><ArrowLeft size={16} aria-hidden="true"/><span>{t('backToSignIn')}</span></a></div>
  </section></main>;
}

function VerifyResetOtpPage({ email: initialEmail, onEmailChange, onVerify, onResend }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [email, setEmail] = useState(initialEmail || '');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(initialEmail ? 60 : 0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initialEmail) return;
    setEmail(initialEmail);
    setSecondsLeft(60);
  }, [initialEmail]);
  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = window.setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await onVerify(email.trim(), otp);
      navigateBrowserPath('/reset-password');
    } catch (issue) {
      setError(issue.code === 'DEMO_AUTH' ? t('resetDemoUnavailable') : issue.status === 400 ? t('invalidOtp') : issue.status === 429 ? t('resetRateLimited') : issue.status === 503 ? t('resetServiceUnavailable') : translateText(issue.message, language));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    setError('');
    setMessage('');
    try {
      await onResend(email.trim());
      onEmailChange(email.trim());
      setOtp('');
      setSecondsLeft(60);
      setMessage(t('otpSent'));
    } catch (issue) {
      setError(issue.code === 'DEMO_AUTH' ? t('resetDemoUnavailable') : issue.status === 503 ? t('resetServiceUnavailable') : issue.status === 429 ? t('resetRateLimited') : translateText(issue.message, language));
    } finally {
      setResending(false);
    }
  }

  return <main className="login-wrap"><section className="login-card reset-card">
    <div className="auth-language-row auth-language-visible"><LanguageSelector/></div>
    <AuthBrand />
    <p className="eyebrow">{t('resetEyebrow')}</p>
    <h1>{t('verifyOtp')}</h1>
    <p className="muted">{t('ifAccountMatches')}</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    {message && <div className="alert success" role="status">{message}</div>}
    <form onSubmit={submit}>
      <label className="field"><span>{t('emailAddress')}</span><input name="otp-email" type="email" autoComplete="email" maxLength="254" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label className="field"><span>{t('otpCode')}</span><input className="otp-code-input" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
      <button className="button login-button" type="submit" disabled={busy || otp.length !== 6}>{busy ? t('verifyingOtp') : t('verifyOtp')}</button>
    </form>
    <button className="text-link otp-resend-button" type="button" onClick={resend} disabled={resending || secondsLeft > 0 || !email.trim()}>{resending ? t('sending') : secondsLeft > 0 ? `${t('resendIn')} ${secondsLeft} ${t('seconds')}` : t('resendOtp')}</button>
    <div className="auth-home-footer"><a className="auth-home-link" href="/forgot-password" onClick={(event) => { event.preventDefault(); navigateBrowserPath('/forgot-password'); }}><ArrowLeft size={16} aria-hidden="true"/><span>{t('back')}</span></a></div>
  </section></main>;
}

function ResetPasswordPage({ onSubmit }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');
  const passwordValid = password.length >= 12 && password.length <= 16
    && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!passwordValid) {
      setError(t('passwordInvalid'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      const response = await onSubmit(password);
      if (!response?.success) throw new Error(t('resetServiceUnavailable'));
      setCompleted(true);
      setPassword(''); setConfirmPassword('');
    } catch (issue) {
      setError(issue.code === 'DEMO_AUTH' ? t('resetDemoUnavailable') : issue.status === 400 ? t('resetAuthorizationExpired') : issue.status === 429 ? t('resetRateLimited') : issue.status === 503 ? t('resetServiceUnavailable') : translateText(issue.message, language));
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-wrap"><section className="login-card reset-card">
    <div className="auth-language-row auth-language-visible"><LanguageSelector/></div>
    <AuthBrand />
    <p className="eyebrow">{t('completeResetEyebrow')}</p>
    <h1>{completed ? t('passwordResetSuccessful') : t('resetPasswordTitle')}</h1>
    <p className="muted">{completed ? t('passwordResetSuccessCopy') : t('completeResetCopy')}</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    {completed ? <button className="button login-button" type="button" onClick={() => navigateBrowserPath('/login')}>{t('backToSignIn')}</button>
      : <form onSubmit={submit}>
          <div className="registration-password-field"><PasswordField name="reset-new-password" label={t('newPassword')} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" language={language} minLength={12} maxLength={16} invalid={Boolean(password && !passwordValid)} /></div>
          <div className="registration-confirm-field"><PasswordField name="reset-confirm-password" label={t('confirmPassword')} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" language={language} minLength={12} maxLength={16} invalid={Boolean(confirmPassword && confirmPassword !== password)} /></div>
          <button className="button login-button" type="submit" disabled={busy}>{busy ? t('updatingPassword') : t('resetPassword')}</button>
        </form>}
    {!completed && <div className="auth-home-footer"><a className="auth-home-link" href="/login" onClick={(event) => { event.preventDefault(); navigateBrowserPath('/login'); }}><ArrowLeft size={16} aria-hidden="true"/><span>{t('backToSignIn')}</span></a></div>}
  </section></main>;
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

  return <main className="login-wrap"><div className="login-card"><div className="auth-language-row auth-language-visible"><LanguageSelector/></div><AuthBrand/><p className="eyebrow">{translate('vendorPortal', language)}</p><h1>{translate('vendorSignIn', language)}</h1><p className="muted">{translate('manageYourBusiness', language)}</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>{translate('emailAddress', language)}</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}/></label><label className="field"><span>{translate('password', language)}</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy ? translate('signingIn', language) : translate('openVendorDashboard', language)}</button></form><p className="login-note">{translateText('Vendor access remains restricted to the authenticated vendor’s own records and services.', language)}</p></div></main>;
}

function VendorDashboard({ user, onLogout, onUserChange }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const vendorMenu = [
    ['overview', 'nav.dashboard.overview'], ['profile', 'nav.dashboard.businessProfile'], ['verification', 'nav.dashboard.vendorVerification'], ['services', 'nav.dashboard.myServices'], ['add-edit-services', 'nav.dashboard.addEditServices'], ['categories', 'nav.dashboard.serviceCategories'], ['pricing', 'nav.dashboard.pricingPackages'], ['availability', 'nav.dashboard.availabilityCalendar'], ['requests', 'nav.dashboard.bookingRequests'], ['confirmed', 'nav.dashboard.confirmedBookings'], ['history', 'nav.dashboard.bookingHistory'], ['coordination', 'nav.dashboard.eventCoordination'], ['quotations', 'nav.dashboard.quotations'], ['payments', 'nav.dashboard.paymentsEarnings'], ['messages', 'nav.dashboard.customerMessages'], ['reviews', 'nav.dashboard.reviewsRatings'], ['notifications', 'nav.dashboard.notifications'], ['reports', 'nav.dashboard.reports'], ['settings', 'nav.dashboard.businessSettings'], ['account', 'nav.dashboard.profile']
  ];
  const [slug, setSlug] = useState(() => new URLSearchParams(window.location.search).get('view') === 'account' ? 'account' : 'overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [documentBusy, setDocumentBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  async function uploadVendorVerificationDocuments(event) {
    const files = Array.from(event.target.files || []);
    const invalid = files.find((file) => !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024);
    if (invalid) {
      setError('Upload PDF, JPEG, or PNG files that are no larger than 5 MB each.');
      event.target.value = '';
      return;
    }
    if (!files.length) return;
    setDocumentBusy(true);
    setError('');
    try {
      for (const file of files) {
        await api(`/vendor/verification/documents?filename=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': file.type },
        });
      }
      const response = await api('/vendor/verification');
      setData((current) => ({ ...current, verification: response.data }));
      event.target.value = '';
    } catch (issue) {
      setError(issue.message || 'Unable to upload verification documents.');
    } finally {
      setDocumentBusy(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const endpoints = ['overview', 'profile', 'verification', 'services', 'categories', 'pricing', 'availability', 'booking-requests', 'bookings', 'history', 'tasks', 'quotations', 'payments', 'messages', 'reviews', 'notifications', 'reports', 'account', 'packages', 'media'];
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
  }, [refreshKey]);

  const renderSection = () => {
    if (loading) return <div className="loading"><span className="spinner"/>{t('loading')}</div>;
    if (error) return <div className="alert error">{error}</div>;
    if (slug !== 'verification') return <VendorWorkspace view={slug} data={data} api={api} user={user} onUserChange={onUserChange} onRefresh={() => setRefreshKey((current) => current + 1)} />;

    switch (slug) {
      case 'overview':
        return <div className="organizer-shell"><div className="welcome"><div><p className="eyebrow">{t('vendorDashboard')}</p><h2>{t('businessOverview')}</h2><p className="muted">{t('monitorBusiness')}</p></div><button className="button secondary" onClick={onLogout}>{t('logout')}</button></div><div className="metric-grid"><article className="metric-card"><p>{t('totalListedServices')}</p><strong>{data.overview?.totalServices ?? 0}</strong><span>{data.overview?.activeServices ?? 0} {t('activeLabel')}</span></article><article className="metric-card"><p>{t('pendingRequests')}</p><strong>{data.overview?.pendingBookings ?? 0}</strong><span>{data.overview?.pendingQuotations ?? 0} {t('pendingQuotations')}</span></article><article className="metric-card"><p>{t('confirmedBookingsLabel')}</p><strong>{data.overview?.confirmedBookings ?? 0}</strong><span>{data.overview?.upcomingDates ?? 0} {t('upcomingDates')}</span></article><article className="metric-card"><p>{t('grossEarnings')}</p><strong>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(data.overview?.totalEarnings ?? 0)}</strong><span>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(data.overview?.pendingPayouts ?? 0)} {t('pendingPayouts')}</span></article></div><div className="two-column-layout"><article className="panel"><div className="panel-header"><h3>{t('recentBookingRequests')}</h3><button className="button secondary small">{t('openRequests')}</button></div><div className="list-stack">{(data['booking-requests'] || []).slice(0, 3).map((entry) => <div key={entry.id} className="list-card"><div><strong>{entry.customer}</strong><small>{entry.service} • {entry.date}</small></div><span className="pill pending">{translateText(entry.status, language)}</span></div>)}</div></article><article className="panel"><div className="panel-header"><h3>{t('topPerformers')}</h3></div><div className="list-stack">{(data.services || []).slice(0, 3).map((service) => <div key={service.id} className="list-card"><div><strong>{service.name}</strong><small>{service.category}</small></div><span className="pill active">{translateText(service.status, language)}</span></div>)}</div></article></div></div>;
      case 'profile':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">BUSINESS PROFILE</p><h2>Business information</h2><p className="muted">Manage your public-facing vendor identity and service coverage.</p></div><button className="button secondary">Preview public profile</button></div><div className="panel profile-panel"><div className="profile-avatar">{data.profile?.businessName?.slice(0,1) || 'G'}</div><div><h3>{data.profile?.businessName}</h3><p className="muted">{data.profile?.businessType}</p><p>{data.profile?.serviceLocation}</p></div></div><div className="panel" style={{padding:'20px'}}><div className="field"><span>Business name</span><input value={data.profile?.businessName || ''} readOnly /></div><div className="field"><span>Business description</span><textarea rows="4" value={data.profile?.description || ''} readOnly /></div><div className="field"><span>Website</span><input value={data.profile?.website || ''} readOnly /></div></div></div>;
      case 'verification':
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">VENDOR VERIFICATION</p><h2>Verification status</h2><p className="muted">Track your vendor application, submitted documents, and review updates.</p></div></div><div className="metric-grid"><article className="metric-card"><p>Status</p><strong>{data.verification?.status || 'Pending'}</strong><span>{data.verification?.reasons?.[0] || data.verification?.reviewProgress || 'Under review'}</span></article><article className="metric-card"><p>Submitted</p><strong>{data.verification?.submittedAt ? new Date(data.verification.submittedAt).toLocaleDateString() : '—'}</strong><span>Application date</span></article></div><div className="panel" style={{padding:'20px'}}><h3>Verification documents</h3>{['pending','under_review','information_requested'].includes(data.verification?.status) && <label className="field"><span>{documentBusy ? 'Uploading…' : 'Add documents (PDF, JPEG, or PNG; up to 5 MB each)'}</span><input type="file" accept="application/pdf,image/jpeg,image/png" multiple disabled={documentBusy} onChange={uploadVendorVerificationDocuments}/></label>}<div className="list-stack">{(data.verification?.documents || []).map((doc) => <div key={doc.id} className="list-card"><div><strong>{doc.original_name}</strong><small>{doc.content_type} · {Math.ceil(doc.file_size / 1024)} KB · Private document</small></div><span className="pill active">Submitted</span></div>)}</div>{(data.verification?.history || []).length > 0 && <><h3>Verification history</h3><div className="list-stack">{data.verification.history.map((entry, index) => <div key={`${entry.created_at}-${index}`} className="list-card"><div><strong>{entry.from_status ? `${entry.from_status.replaceAll('_', ' ')} → ` : ''}{entry.to_status.replaceAll('_', ' ')}</strong><small>{entry.reason} · {new Date(entry.created_at).toLocaleString()}</small></div></div>)}</div></>}</div></div>;
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
        return <div className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">PROFILE</p><h2>Personal account</h2><p className="muted">Manage your login profile separately from your public business profile.</p></div></div><div className="panel profile-panel"><ProfilePhotoDisplay user={user}/><div><h3>{user.name || user.full_name}</h3><p className="muted">{user.email}</p><p>{user.role}</p></div></div><div className="panel" style={{padding:'20px'}}><div className="field"><span>Full name</span><input value={data.account?.fullName || ''} readOnly /></div><div className="field"><span>Email</span><input value={data.account?.email || ''} readOnly /></div><div className="field"><span>Role</span><input value={data.account?.role || ''} readOnly /></div></div></div>;
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

  return <div className={`app-shell dashboard-role-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><DashboardSidebar roleTitle={t('vendorDashboard').toUpperCase()} groups={[{ id: 'vendor', label: 'nav.dashboard.groupBusinessArea', items: vendorMenu }]} activePage={slug} onNavigate={setSlug} onToggle={toggleSidebar} collapsed={sidebarCollapsed} mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} language={language}/><div className={`mobile-scrim ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)}/><main className="main-area"><DashboardHeader user={user} isVendor onNavigate={(target) => setSlug(target === 'profile' ? 'account' : target)} onLogout={onLogout} onToggleSidebar={toggleSidebar} onUserChange={onUserChange} sidebarExpanded={window.matchMedia('(max-width: 760px)').matches ? sidebarOpen : !sidebarCollapsed}/><div className="content">{renderSection()}</div><footer className="footer">{t('vendorPortal')} <span>•</span> {t('ownedRecordsOnly')}</footer></main></div>;
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

  return <main className="login-wrap"><div className="login-card"><div className="auth-language-row auth-language-visible"><LanguageSelector/></div><AuthBrand/><p className="eyebrow">{translate('customerPortal', language)}</p><h1>{translate('customerSignIn', language)}</h1><p className="muted">{translate('discoverManageEvents', language)}</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>{translate('emailAddress', language)}</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}/></label><label className="field"><span>{translate('password', language)}</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy ? translate('signingIn', language) : translate('openCustomerDashboard', language)}</button></form></div></main>;
}

function CustomerDashboard({ user, onLogout, onUserChange, onNavigatePublic }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const customerMenu = [
    ['overview', 'nav.dashboard.overview'], ['vendors', 'nav.dashboard.browseVendors'], ['services', 'nav.dashboard.searchServices'], ['categories', 'nav.dashboard.serviceCategories'], ['bookings', 'nav.dashboard.myBookings'], ['history', 'nav.dashboard.bookingHistory'], ['events', 'nav.dashboard.myEvents'], ['favorites', 'nav.dashboard.wishlist'], ['quotations', 'nav.dashboard.requestQuotations'], ['payments', 'nav.dashboard.paymentsTransactions'], ['messages', 'nav.dashboard.messages'], ['reviews', 'nav.dashboard.reviewsRatings'], ['notifications', 'nav.dashboard.notifications'], ['profile', 'nav.dashboard.profile']
  ];

  const [slug, setSlug] = useState(() => new URLSearchParams(window.location.search).get('view') === 'profile' ? 'profile' : 'overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [data, setData] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
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

  useEffect(() => {
    const syncDashboardView = () => {
      const requestedView = new URLSearchParams(window.location.search).get('view');
      if (requestedView && customerMenu.some(([view]) => view === requestedView)) setSlug(requestedView);
    };
    syncDashboardView();
    window.addEventListener('popstate', syncDashboardView);
    return () => window.removeEventListener('popstate', syncDashboardView);
  }, []);

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
        setError('');
        const endpoints = ['overview', 'vendors', 'services', 'categories', 'bookings', 'events', 'favorites', 'saved-services', 'quotations', 'payments', 'refunds', 'messages', 'reviews', 'notifications', 'profile'];
        const results = await Promise.all(endpoints.map((endpoint) => api(`/customer/${endpoint}`)));
        const next = {};
        const objectEndpoints = new Set(['overview', 'profile']);
        endpoints.forEach((endpoint, index) => {
          next[endpoint] = results[index]?.data ?? (objectEndpoints.has(endpoint) ? {} : []);
        });
        setData(next);
      } catch (issue) {
        setError(issue.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refreshKey]);

  const renderSection = () => {
    if (loading) return <div className="loading"><span className="spinner"/>{t('loading')}</div>;
    if (error) return <div className="alert error" role="alert">{error}<button className="text-action" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Retry dashboard</button></div>;
    return <ErrorBoundary key={slug}>
      <CustomerWorkspace
        view={slug}
        data={data}
        api={api}
        user={user}
        onNavigate={setSlug}
        onNavigatePublic={onNavigatePublic}
        onUserChange={onUserChange}
        onRefresh={() => setRefreshKey((current) => current + 1)}
      />
    </ErrorBoundary>;

    switch (slug) {
      case 'overview':
        return <section className="organizer-shell"><div className="welcome"><div><p className="eyebrow">{t('customerDashboard')}</p><h2>{t('customerWelcome')}, {user.name || user.full_name || t('customerArea')}</h2><p className="muted">{t('trackBookings')}</p></div><div className="header-actions"><LanguageSelector user={user}/><button className="button secondary" onClick={onLogout}>{t('logout')}</button></div></div><div className="metric-grid"><article className="metric-card"><p>{t('totalBookings')}</p><strong>{data.overview?.totalBookings ?? 0}</strong><span>{data.overview?.pendingBookings ?? 0} {t('pendingLabel')}</span></article><article className="metric-card"><p>{t('confirmedLabel')}</p><strong>{data.overview?.confirmedBookings ?? 0}</strong><span>{data.overview?.upcomingEvents ?? 0} {t('upcomingEvents')}</span></article><article className="metric-card"><p>{t('outstandingPayments')}</p><strong>{data.overview?.outstandingPayments ?? 0}</strong><span>{data.overview?.pendingQuotations ?? 0} {t('openQuotations')}</span></article><article className="metric-card"><p>{t('unreadMessages')}</p><strong>{data.overview?.unreadMessages ?? 0}</strong><span>{data.overview?.unreadNotifications ?? 0} {t('notificationsLabel')}</span></article></div><div className="two-column-layout"><article className="panel"><div className="panel-header"><h3>{t('recentBookings')}</h3><button className="button secondary small">{t('openBookings')}</button></div><div className="list-stack">{(data.bookings || []).slice(0,4).map((booking) => <div key={booking.id} className="list-card"><div><strong>{booking.serviceTitle}</strong><small>{booking.reference} • {translateText(booking.status, language)}</small></div><span>{formatCustomerMoney(booking.quotedAmount, booking.currency)}</span></div>)}</div></article><article className="panel"><div className="panel-header"><h3>{t('savedVendors')}</h3></div><div className="list-stack">{(data.favorites || []).slice(0,3).map((vendor) => <div key={vendor.id} className="list-card"><div><strong>{vendor.name}</strong><small>{vendor.city}</small></div><span className="pill active">{t('savedVendors')}</span></div>)}</div></article></div></section>;
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
        return <section className="organizer-shell"><div className="page-heading"><div><p className="eyebrow">PROFILE</p><h2>Personal account</h2><p className="muted">Maintain your details and notification preferences securely.</p></div></div><div className="panel profile-panel"><ProfilePhotoDisplay user={user}/><div><h3>{user.name || user.full_name}</h3><p className="muted">{user.email}</p><p>{user.role}</p></div></div><div className="panel" style={{ padding: '20px' }}><div className="field"><span>Full name</span><input value={data.profile?.fullName || ''} readOnly /></div><div className="field"><span>Email</span><input value={data.profile?.email || ''} readOnly /></div><div className="field"><span>Phone</span><input value={data.profile?.phone || ''} readOnly /></div></div></section>;
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

  return <div className={`app-shell dashboard-role-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><DashboardSidebar roleTitle={t('customerDashboard').toUpperCase()} groups={[{ id: 'customer', label: t('bookings'), items: customerMenu }]} activePage={slug} onNavigate={setSlug} onToggle={toggleSidebar} collapsed={sidebarCollapsed} mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} language={language}/><div className={`mobile-scrim ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)}/><main className="main-area"><DashboardHeader user={user} isCustomer onNavigate={setSlug} onLogout={onLogout} onToggleSidebar={toggleSidebar} onUserChange={onUserChange} sidebarExpanded={window.matchMedia('(max-width: 760px)').matches ? sidebarOpen : !sidebarCollapsed}/><div className="content">{renderSection()}</div><footer className="footer">{t('customerPortal')} <span>•</span> {t('personalRecordsOnly')}</footer></main></div>;
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

  return <main className="login-wrap"><div className="login-card"><div className="auth-language-row auth-language-visible"><LanguageSelector/></div><AuthBrand/><p className="eyebrow">{translate('organizerPortal', language)}</p><h1>{translate('organizerSignIn', language)}</h1><p className="muted">{translate('secureOrganizerAccess', language)}</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>{translate('emailAddress', language)}</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}/></label><label className="field"><span>{translate('password', language)}</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy ? translate('signingIn', language) : translate('openOrganizerDashboard', language)}</button></form></div></main>;
}

function OrganizerDashboard({ user, onLogout, onUserChange }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [dashboardView, setDashboardView] = useState(() => new URLSearchParams(window.location.search).get('view') === 'profile' ? 'profile' : 'overview');
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
          api('/platform/organizer/overview'),
          api('/platform/events/mine'),
          api('/platform/vendors?page=1&limit=4&sort=recommended'),
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
    const organizerMenu = [
      ['overview', 'nav.dashboard.overview'], ['events', 'nav.dashboard.myEvents'], ['calendar', 'nav.dashboard.eventCalendar'],
      ['vendors', 'nav.dashboard.findVendors'], ['services', 'nav.dashboard.browseServices'], ['favorites', 'nav.dashboard.savedVendors'],
      ['bookings', 'nav.dashboard.bookingManagement'], ['quotations', 'nav.dashboard.requestQuotations'], ['budget', 'nav.dashboard.budgetExpenses'],
      ['coordination', 'nav.dashboard.vendorCoordination'], ['messages', 'nav.dashboard.messages'], ['notifications', 'nav.dashboard.notifications'],
      ['reports', 'nav.dashboard.reports'], ['profile', 'nav.dashboard.profile'], ['settings', 'nav.dashboard.accountSettings'],
    ];
    return <div className={`app-shell dashboard-role-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><DashboardSidebar roleTitle={translate('organizerDashboard', language).toUpperCase()} groups={[{ id: 'organizer', label: 'nav.dashboard.groupWorkspace', items: organizerMenu }]} activePage={dashboardView} onNavigate={setDashboardView} onToggle={toggleSidebar} collapsed={sidebarCollapsed} mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} language={language}/><div className={`mobile-scrim ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)}/><main className="main-area"><DashboardHeader user={user} isOrganizer onNavigate={setDashboardView} onLogout={onLogout} onToggleSidebar={toggleSidebar} onUserChange={onUserChange} sidebarExpanded={window.matchMedia('(max-width: 760px)').matches ? sidebarOpen : !sidebarCollapsed}/><div className="content">{content}</div></main></div>;
  }

  if (error) return renderDashboard(<div className="alert error">{translateText(error, language)}</div>);
  if (!overview) return renderDashboard(<div className="loading"><span className="spinner"/>{t('loading')}</div>);

  const derivedSummary = summarizeOrganizerDashboard(events, bookings);
  const summary = {
    totalEvents: overview.totalEvents ?? derivedSummary.totalEvents,
    upcomingCount: overview.upcomingEvents ?? derivedSummary.upcomingCount,
    ongoingCount: overview.ongoingEvents ?? derivedSummary.ongoingCount,
    totalBudget: overview.budget?.allocated ?? derivedSummary.totalBudget,
  };
  const upcomingEvents = derivedSummary.upcomingEvents.slice(0, 3);
  const activeBookings = bookings.filter((booking) => ['pending', 'confirmed', 'accepted', 'under_review'].includes(String(booking.status).toLowerCase()));

  const profileContent = dashboardView === 'settings' ? <DashboardSettings user={user}/> : null;
  const eventManagerContent = dashboardView === 'events' ? <OrganizerEventsManager api={api} /> : null;
  const workspaceContent = dashboardView !== 'overview' && dashboardView !== 'events' && dashboardView !== 'settings'
    ? <OrganizerWorkspace view={dashboardView} api={api} user={user} onNavigate={setDashboardView}/>
    : null;
  return renderDashboard(profileContent || eventManagerContent || workspaceContent || <section className="organizer-shell"><div className="welcome"><div><p className="eyebrow">{t('organizerDashboard')}</p><h2>{t('customerWelcome')}, {user.name || user.full_name || 'Organizer'}</h2><p className="muted">{t('secureOrganizerAccess')}</p></div></div>
    <div className="metric-grid">
      <article className="metric-card"><p>{t('activeEvents')}</p><strong>{summary.totalEvents}</strong><span>{summary.upcomingCount} {t('upcoming')} · {summary.ongoingCount} ongoing</span></article>
      <article className="metric-card"><p>{t('vendorMatches')}</p><strong>{vendors.length}</strong><span>{t('verifiedRanked')}</span></article>
      <article className="metric-card"><p>{t('budgetAllocated')}</p><strong>{new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 }).format(totalBudget)}</strong><span>{t('currentPlans')}</span></article>
      <article className="metric-card"><p>{t('bookingsInMotion')}</p><strong>{activeBookings.length}</strong><span>{bookings.length} {t('totalTracked')}</span></article>
    </div>
    <div className="two-column-layout">
      <article className="panel">
        <div className="panel-header"><h3>{t('eventPipeline')}</h3><button className="button secondary small" onClick={() => setDashboardView('events')}>{t('createEvent')}</button></div>
        <div className="list-stack">
          {upcomingEvents.length ? upcomingEvents.map((event) => <div key={event.id} className="list-card"><div><strong>{event.title}</strong><small>{event.type} • {formatEventDate(event.startDate || event.date, language)}</small></div><span className="pill active">{t('eventPlanned')}</span></div>) : <div className="empty panel"><strong>{t('noUpcomingEvents')}</strong><span>{t('draftEventPrompt')}</span></div>}
        </div>
      </article>
      <article className="panel">
        <div className="panel-header"><h3>{t('recommendedVendors')}</h3><button className="button secondary small" type="button" onClick={() => setDashboardView('vendors')}>{t('browseAll')}</button></div>
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
          <div className="report-row"><span>Allocated budget</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits: 0 }).format(summary.totalBudget)}</strong></div>
          <div className="report-row"><span>Planned expenses</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits: 0 }).format(overview.budget?.plannedExpenses || 0)}</strong></div>
          <div className="report-row"><span>Actual expenses</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits: 0 }).format(overview.budget?.actualExpenses || 0)}</strong></div>
          <div className="report-row"><span>Remaining budget</span><strong>{new Intl.NumberFormat('en-ET', { style:'currency', currency:'ETB', maximumFractionDigits: 0 }).format(overview.budget?.remaining ?? summary.totalBudget)}</strong></div>
        </div>
      </article>
    </div>
  </section>);
}

function Login({onLogin}) {
  const language = useLanguage();
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { await onLogin(email,password); } catch (issue) { setError(issue.message); } finally { setBusy(false); } }
  return <main className="login-wrap"><div className="login-card"><div className="auth-language-row auth-language-visible"><LanguageSelector/></div><AuthBrand/><p className="eyebrow">{translate('platform', language).toUpperCase()}</p><h1>{translate('administratorSignIn', language)}</h1><p className="muted">{translate('useAdminAccount', language)}</p>{error&&<div className="alert error">{error}</div>}<form onSubmit={submit}><label className="field"><span>{translate('emailAddress', language)}</span><input type="email" autoComplete="username" required value={email} onChange={(e)=>setEmail(e.target.value)}/></label><label className="field"><span>{translate('password', language)}</span><input type="password" autoComplete="current-password" required value={password} onChange={(e)=>setPassword(e.target.value)}/></label><button className="button login-button" disabled={busy}>{busy?translate('signingIn', language):translate('signInSecurely', language)}</button></form><p className="login-note">{translateText('Administrator access is verified by the server for every protected request.', language)}</p></div></main>;
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
    const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim())
      ? currency.trim().toUpperCase()
      : 'ETB';
    const amount = Number(value);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    try {
      return new Intl.NumberFormat('en-ET', {
        style: 'currency',
        currency: code,
        maximumFractionDigits: 2,
      }).format(safeAmount);
    } catch {
      return `${safeAmount.toLocaleString()} ${code}`;
    }
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

function AdminServiceCategories() {
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sortBy, setSortBy] = useState('display_order');
  const [sortDirection, setSortDirection] = useState('asc');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [removeImage, setRemoveImage] = useState(false);
  const [fileError, setFileError] = useState('');
  const [formError, setFormError] = useState('');
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');

  const load = useCallback(async (requestedPage = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(requestedPage),
        pageSize: String(pagination.pageSize),
        sortBy,
        sortDirection,
      });
      if (search) params.set('q', search);
      if (status) params.set('status', status);
      const result = await api(`/admin/categories?${params}`);
      setData(result.data);
      setPagination(result.pagination);
      setPage(requestedPage);
    } catch (issue) {
      setError(issue.message);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, search, sortBy, sortDirection, status]);

  useEffect(() => { void load(1); }, [load]);
  useEffect(() => () => {
    if (imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  function closeModal() {
    setModal(null);
    setImageFile(null);
    setImagePreview('');
    setRemoveImage(false);
    setFileError('');
    setFormError('');
  }

  function startCreate() {
    setForm({ name: '', description: '', display_order: '0' });
    setImageFile(null);
    setImagePreview('');
    setRemoveImage(false);
    setFileError('');
    setFormError('');
    setModal({ kind: 'create' });
  }

  function startEdit(category) {
    setForm({
      name: category.name || '',
      description: category.description || '',
      display_order: String(category.display_order ?? 0),
    });
    setImageFile(null);
    setImagePreview('');
    setRemoveImage(false);
    setFileError('');
    setFormError('');
    setModal({ kind: 'edit', row: category });
  }

  function chooseImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setFileError('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setImageFile(null);
      setImagePreview('');
      setFileError('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setImageFile(null);
      setImagePreview('');
      setFileError('Category images must be greater than 0 bytes and 5 MB or smaller.');
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setRemoveImage(false);
  }

  async function submitCategory(event) {
    event.preventDefault();
    const categoryNameError = validateCategoryName(form.name);
    if (categoryNameError) {
      setFormError(categoryNameError);
      return;
    }
    if (fileError) return;
    setBusy(true);
    setError('');
    setFormError('');
    setNotice('');
    let savedId;
    try {
      const payload = {
        name: form.name,
        description: form.description,
        display_order: Number(form.display_order),
      };
      if (modal.kind === 'create') {
        const result = await api('/admin/categories', { method: 'POST', body: JSON.stringify(payload) });
        savedId = result.data.id;
      } else {
        savedId = modal.row.id;
        await api(`/admin/categories/${savedId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      }

      try {
        if (imageFile) {
          await api(`/admin/categories/${savedId}/image`, {
            method: 'PUT',
            body: imageFile,
            headers: { 'Content-Type': imageFile.type },
          });
        } else if (removeImage && modal.row?.image) {
          await api(`/admin/categories/${savedId}/image`, { method: 'DELETE' });
        }
      } catch (imageIssue) {
        setNotice(`Category details were saved, but the image change failed: ${imageIssue.message}`);
        closeModal();
        await load(page);
        return;
      }

      setNotice(modal.kind === 'create' ? 'Category created.' : 'Category updated.');
      closeModal();
      await load(page);
    } catch (issue) {
      setFormError(issue.response?.data?.details?.find((detail) => detail.field === 'name')?.message
        || issue.response?.data?.error
        || issue.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(category) {
    const activating = !category.is_active;
    const message = activating
      ? `Activate “${category.name}”?`
      : `Deactivate “${category.name}”? ${category.service_count} associated service(s) will remain assigned but the category will be hidden from public browsing and new selections.`;
    if (!window.confirm(translateText(message))) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/admin/categories/${category.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: activating }),
      });
      setNotice(`Category ${activating ? 'activated' : 'deactivated'}.`);
      await load(page);
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  async function showHistory(category) {
    setHistory([]);
    setHistoryError('');
    setModal({ kind: 'history', row: category });
    try {
      const result = await api(`/admin/categories/${category.id}/history?pageSize=50`);
      setHistory(result.data);
    } catch (issue) {
      setHistoryError(issue.message);
    }
  }

  const title = modal?.kind === 'create' ? 'Create category' : `Edit ${modal?.row?.name || 'category'}`;
  const shownImage = imagePreview || (!removeImage && modal?.row?.image ? resolveApiAssetUrl(modal.row.image) : '');

  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SYSTEM CONTROL</p>
          <h2>Service Category Management</h2>
          <p className="muted">Manage the shared categories used by customer browsing and vendor service forms.</p>
        </div>
        <button className="button" type="button" onClick={startCreate}>Create category</button>
      </div>
      {notice && <div className="alert success" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="toolbar">
        <form className="search-box" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
          <Search size={17} />
          <input aria-label="Search categories" placeholder="Search name or description" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit">Search</button>
        </form>
        <select className="filter-select" aria-label="Filter category status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select className="filter-select" aria-label="Sort categories" value={`${sortBy}:${sortDirection}`} onChange={(event) => {
          const [nextSort, nextDirection] = event.target.value.split(':');
          setSortBy(nextSort);
          setSortDirection(nextDirection);
        }}>
          <option value="display_order:asc">Display order</option>
          <option value="name:asc">Name A–Z</option>
          <option value="name:desc">Name Z–A</option>
          <option value="service_count:desc">Most services</option>
          <option value="created_at:desc">Newest first</option>
        </select>
        <span className="result-count">{pagination.total} categories</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Image</th><th>Name</th><th>Description</th><th>Display order</th><th>Services</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7"><div className="loading"><span className="spinner" />Loading categories</div></td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan="7"><div className="empty"><strong>No categories found</strong><span>Try a different search or create a category.</span></div></td></tr>
            ) : data.map((category) => (
              <tr key={category.id}>
                <td>{category.image ? <img className="category-admin-thumbnail" src={resolveApiAssetUrl(category.image)} alt="" /> : <span className="category-admin-thumbnail category-admin-thumbnail-empty">—</span>}</td>
                <td><strong>{category.name}</strong></td>
                <td title={category.description || ''}><span className="cell-value">{category.description || '—'}</span></td>
                <td>{category.display_order}</td>
                <td>{category.service_count}</td>
                <td><span className={`pill ${category.is_active ? 'active' : 'inactive'}`}>{category.is_active ? 'Active' : 'Inactive'}</span></td>
                <td><div className="row-actions">
                  <button className="text-action" type="button" disabled={busy} onClick={() => startEdit(category)}>Edit</button>
                  <button className={`text-action ${category.is_active ? 'subtle-danger' : ''}`} type="button" disabled={busy} onClick={() => void toggleStatus(category)}>{category.is_active ? 'Deactivate' : 'Activate'}</button>
                  <button className="text-action" type="button" disabled={busy} onClick={() => void showHistory(category)}>History</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>Showing {data.length ? ((page - 1) * pagination.pageSize) + 1 : 0}–{Math.min(page * pagination.pageSize, pagination.total)} of {pagination.total}</span>
        <div>
          <button className="icon-button" type="button" disabled={page <= 1 || loading} onClick={() => void load(page - 1)} aria-label="Previous category page"><ChevronLeft size={18} /></button>
          <span>Page {page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span>
          <button className="icon-button" type="button" disabled={page * pagination.pageSize >= pagination.total || loading} onClick={() => void load(page + 1)} aria-label="Next category page"><ChevronRight size={18} /></button>
        </div>
      </div>
      {modal?.kind === 'history' ? (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="category-history-title">
            <div className="modal-head"><h2 id="category-history-title">Category history: {modal.row.name}</h2><button className="icon-button" type="button" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button></div>
            <div className="modal-body">
              {historyError ? <div className="alert error" role="alert">{historyError}</div> : history.length ? history.map((entry) => {
                let details = entry.details;
                if (typeof details === 'string') {
                  try { details = JSON.parse(details); } catch { details = { raw: details }; }
                }
                return <article className="category-history-entry" key={entry.id}>
                  <div><strong>{String(entry.action).replaceAll('_', ' ')}</strong><span>{entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'} · Actor #{entry.actor_id}</span></div>
                  <pre>{JSON.stringify(details, null, 2)}</pre>
                </article>;
              }) : <div className="empty"><strong>No category changes recorded yet</strong></div>}
            </div>
            <div className="modal-foot"><button className="button secondary" type="button" onClick={() => setModal(null)}>Close</button></div>
          </section>
        </div>
      ) : modal && (
        <Modal title={title} onClose={closeModal} onSubmit={submitCategory} busy={busy}>
          {formError && <div className="alert error" id="category-name-error" role="alert">{formError}</div>}
          <label className="field"><span>Category name</span><input required minLength={3} maxLength={60} aria-invalid={Boolean(formError)} aria-describedby={formError ? 'category-name-error' : undefined} value={form.name || ''} onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); setFormError(validateCategoryName(event.target.value)); }} /></label>
          <label className="field"><span>Description</span><textarea maxLength={500} value={form.description || ''} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label className="field"><span>Display order</span><input type="number" min="0" max="100000" step="1" required value={form.display_order ?? '0'} onChange={(event) => setForm((current) => ({ ...current, display_order: event.target.value }))} /></label>
          <div className="field">
            <span>Category image</span>
            {shownImage && <img className="category-admin-preview" src={shownImage} alt="Category preview" />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseImage} aria-label="Upload category image" />
            <small className="muted">JPG, PNG, or WebP; maximum 5 MB.</small>
            {modal.kind === 'edit' && modal.row.image && <button className="text-action subtle-danger" type="button" onClick={() => { setImageFile(null); setImagePreview(''); setRemoveImage((current) => !current); setFileError(''); }}>{removeImage ? 'Keep current image' : 'Remove image'}</button>}
            {fileError && <small className="profile-photo-message error" role="alert">{fileError}</small>}
          </div>
        </Modal>
      )}
    </section>
  );
}

function GenericDataPage({slug,user,onUserChange}) {
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
  const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [query,setQuery]=useState(''); const [search,setSearch]=useState(''); const [status,setStatus]=useState(''); const [inquiryType,setInquiryType]=useState(''); const [archived,setArchived]=useState('active'); const [modal,setModal]=useState(null); const [busy,setBusy]=useState(false); const [form,setForm]=useState({}); const [roleRows,setRoleRows]=useState([]);
  const [profilePhotoFile,setProfilePhotoFile]=useState(null); const [profilePhotoPreview,setProfilePhotoPreview]=useState(''); const [profilePhotoError,setProfilePhotoError]=useState(''); const [profilePhotoRemoved,setProfilePhotoRemoved]=useState(false); const profilePhotoInputRef=useRef(null);
  useEffect(()=>()=>{if(profilePhotoPreview)URL.revokeObjectURL(profilePhotoPreview);},[profilePhotoPreview]);
  const statuses={users:['active','suspended','pending'],roles:['active','inactive'],categories:['active','inactive'],vendors:['pending','verified','rejected'],events:['draft','active','booked','in_progress','completed','cancelled'],bookings:['requested','quoted','accepted','rejected','cancelled','completed','under_review'],'package-requests':['new','reviewed','replied','closed'],reviews:['published','hidden','flagged'],complaints:['open','investigating','resolved','dismissed'],messages:['new','reviewed','in_progress','replied','resolved','closed'],notifications:['queued','sent','failed','read']}[slug]||[];
  const statusLabel=(value)=>slug==='messages'?({new:'New',reviewed:'Read',in_progress:'In Progress',replied:'Replied',resolved:'Resolved',closed:'Closed'}[value]||value):translateText(value,language);
  const load=useCallback(async(page=1)=>{setLoading(true);setError('');try{const params=new URLSearchParams({page:String(page),pageSize:String(pagination.pageSize)});if(search)params.set('q',search);if(status)params.set('status',slug==='roles'||slug==='categories'?(status==='active'?'1':'0'):status);if(inquiryType)params.set('inquiry_type',inquiryType);if(slug==='messages')params.set('archived',archived);const result=await api(`/admin/${config.endpoint}?${params}`);setData(result.data);setPagination(result.pagination);}catch(issue){setError(issue.message);}finally{setLoading(false);}},[archived,config.endpoint,inquiryType,pagination.pageSize,search,status,slug]);
  useEffect(()=>{if(slug==='profile'){setLoading(false);return;}if(slug==='messages'&&DEMO_AUTH_ENABLED){setLoading(false);setError('Contact message management requires a connected administrator API and is unavailable in demo mode.');return;}load(1);},[load,slug]);
  useEffect(()=>{if(slug==='users')api('/admin/roles?pageSize=100').then((r)=>setRoleRows(r.data.filter((x)=>x.is_active&&!x.is_admin))).catch(()=>{});},[slug]);
  function startCreate(){setForm({});setModal({kind:'create'});}
  function startEdit(row){setForm(Object.fromEntries(config.fields.map(([key])=>[key,row[key] ?? ''])));setModal({kind:'edit',row});}
  function startAction(kind,row){setForm(kind==='status'&&slug==='messages'?{status:row.status==='new'?'reviewed':row.status,admin_reply:row.admin_reply||''}:{});setModal({kind,row});}
  function changeField(name,value){setForm((old)=>({...old,[name]:value}));}
  function chooseProfilePhoto(event){
    const file=event.target.files?.[0];event.target.value='';
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setProfilePhotoFile(null);setProfilePhotoPreview('');setProfilePhotoError(t('photoInvalidType'));return;}
    if(file.size>5*1024*1024){setProfilePhotoFile(null);setProfilePhotoPreview('');setProfilePhotoError(t('photoTooLarge'));return;}
    setProfilePhotoFile(file);setProfilePhotoPreview(URL.createObjectURL(file));setProfilePhotoError('');setProfilePhotoRemoved(false);
  }
  function removeProfilePhotoFromEdit(){
    setProfilePhotoFile(null);setProfilePhotoPreview('');setProfilePhotoError('');setProfilePhotoRemoved(true);
  }
  function closeModal(){setModal(null);setProfilePhotoFile(null);setProfilePhotoPreview('');setProfilePhotoError('');setProfilePhotoRemoved(false);}
  async function submit(event){event.preventDefault();setBusy(true);setError('');setNotice('');setProfilePhotoError('');try{
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
      if(!window.confirm(translateText('Deactivate this record? This action is recorded in the audit log.'))){setBusy(false);return;}
      result=await api(`/admin/${config.endpoint}/${row.id}`,{method:'DELETE'});
    } else if(modal.kind==='verify'||modal.kind==='reject'){
      result=await api(`/admin/vendors/${row.id}/verification`,{method:'PATCH',body:JSON.stringify({decision:modal.kind==='verify'?'verified':'rejected',reason:form.reason})});
    } else if(modal.kind==='moderate'){
      result=await api(`/admin/bookings/${row.id}/moderation`,{method:'PATCH',body:JSON.stringify({status:form.status,reason:form.reason})});
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
    if(modal.kind==='profile'){
      result=await api('/admin/profile',{method:'PATCH',body:JSON.stringify(form)});
      let updatedUser={...user,...result.user,name:result.user.full_name || result.user.name || user.name};
      onUserChange(updatedUser);
      if(profilePhotoFile){
        await api('/admin/profile/photo',{method:'PUT',body:profilePhotoFile,headers:{'Content-Type':profilePhotoFile.type}});
        updatedUser={...updatedUser,profilePhotoVersion:Date.now()};
      } else if(profilePhotoRemoved){
        await api('/admin/profile/photo',{method:'DELETE'});
        updatedUser={...updatedUser,profilePhotoUrl:'',profilePhotoVersion:Date.now()};
      }
      onUserChange(updatedUser);
      setProfilePhotoFile(null);setProfilePhotoPreview('');setProfilePhotoRemoved(false);
    }
    if(modal.kind==='setting'){result=await api(`/admin/settings/${encodeURIComponent(form.setting_key)}`,{method:'PUT',body:JSON.stringify({value:form.setting_value})});}
    const replyEmailStatus = slug === 'messages' && modal.kind === 'status' ? result?.data?.email : null;
    setNotice(modal.kind==='profile'?(DEMO_AUTH_ENABLED?t('demoProfileUpdated'):t('profileUpdatedSuccessfully'))
      : replyEmailStatus === 'sent' ? 'Contact message updated and reply email sent.'
        : replyEmailStatus === 'not_configured' ? 'Contact message updated. The reply was saved, but email is not configured.'
          : replyEmailStatus === 'failed' ? 'Contact message updated. The reply was saved, but email delivery failed.'
            : 'Changes saved.');
    setModal(null);if(slug!=='profile')await load(pagination.page);
  }catch(issue){setError(issue.message);if(modal.kind==='profile'&&(profilePhotoFile||profilePhotoRemoved))setProfilePhotoError(issue.message);}finally{setBusy(false);}}
  async function deleteContactMessage(row){
    if(!window.confirm(translateText(`Permanently delete contact message #${row.id}? This action is recorded in the audit log.`)))return;
    setBusy(true);setError('');setNotice('');
    try{
      await api(`/admin/contact/${row.id}`,{method:'DELETE'});
      setNotice('Contact message deleted.');
      const lastPage=Math.max(1,Math.ceil((pagination.total-1)/pagination.pageSize));
      await load(Math.min(pagination.page,lastPage));
    }catch(issue){setError(issue.message);}finally{setBusy(false);}
  }
  async function toggleContactArchive(row){
    setBusy(true);setError('');setNotice('');
    try{
      const archive = !row.archived_at;
      await api(`/admin/contact/${row.id}/archive`,{method:'PATCH',body:JSON.stringify({archived:archive})});
      setNotice(archive ? 'Contact message archived.' : 'Contact message restored.');
      const lastPage=Math.max(1,Math.ceil((pagination.total-1)/pagination.pageSize));
      await load(Math.min(pagination.page,lastPage));
    }catch(issue){setError(issue.message);}finally{setBusy(false);}
  }
  async function toggleContactRead(row){
    setBusy(true);setError('');setNotice('');
    try{
      const read=row.read_status==='unread';
      await api(`/admin/contact/${row.id}/read`,{method:'PATCH',body:JSON.stringify({read})});
      setNotice(read?'Contact message marked as read.':'Contact message marked as unread.');
      await load(pagination.page);
    }catch(issue){setError(issue.message);}finally{setBusy(false);}
  }
  const actions=(row)=>{const names=config.actions||[];return names.map((action)=>{
    if(action==='delete')return <button key={action} className="text-action subtle-danger" type="button" disabled={busy} onClick={()=>deleteContactMessage(row)}>Delete</button>;
    if(action==='archive')return <button key={action} className="text-action" type="button" disabled={busy} onClick={()=>toggleContactArchive(row)}>{row.archived_at?'Restore':'Archive'}</button>;
    if(action==='read')return <button key={action} className="text-action" type="button" disabled={busy} onClick={()=>toggleContactRead(row)}>{row.read_status==='unread'?'Mark read':'Mark unread'}</button>;
    const label={edit:'Edit',deactivate:'Deactivate',verify:'Verify',reject:'Reject',moderate:'Moderate',role:'Change role',status:slug==='messages'?'Update status':row.status==='suspended'?'Activate':'Suspend','package-status':'Update status',permissions:'Permissions',review:'Moderate review',complaint:'Update complaint',view:'View message'}[action];
    const danger=['deactivate','reject'].includes(action)||(action==='status'&&slug!=='messages');
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
      role: 'Change user role',
      status: slug === 'messages' ? 'Update contact message' : 'Update account status',
      'package-status': 'Update package request status',
      permissions: 'Role permissions',
      review: 'Moderate review',
      complaint: 'Update complaint',
      setting: 'Save system setting',
      profile: t('updateProfile'),
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

    if (modal.kind === 'verify' || modal.kind === 'reject' || modal.kind === 'status' || modal.kind === 'package-status') {
      if (slug === 'package-requests') {
        return <label className="field"><span>Request status</span><select value={form.status || modal.row.status} onChange={(event) => changeField('status', event.target.value)}>{['new', 'reviewed', 'replied', 'closed'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>;
      }
      if (slug === 'messages') {
        return (
          <>
            <p className="muted">Update the message status or reply to the customer. Email delivery is reported after saving.</p>
            <label className="field">
              <span>Message status</span>
              <select value={form.status || modal.row.status || 'new'} onChange={(event) => changeField('status', event.target.value)}>
                {['new', 'reviewed', 'in_progress', 'replied', 'resolved', 'closed'].map((value) => <option key={value} value={value}>{value === 'reviewed' ? 'Read' : value}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Reply to customer (emailed when SMTP is configured)</span>
              <textarea rows="4" maxLength="2000" value={form.admin_reply || ''} onChange={(event) => changeField('admin_reply', event.target.value)} />
            </label>
          </>
        );
      }

      return (
        <>
          <p className="muted">This sensitive action is written to the audit log.</p>
          <label className="field">
            <span>Decision reason</span>
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
          <div className="field">
            <span>{t('profilePhoto')}</span>
            <div className="profile-photo-field">
              <div className="profile-photo-field-preview">
                {profilePhotoPreview || (!profilePhotoRemoved && user.profilePhotoUrl)
                  ? <img src={profilePhotoPreview || user.profilePhotoUrl} alt="" />
                  : <UserRound size={28} aria-hidden="true" />}
              </div>
              <div className="profile-photo-field-controls">
                <input ref={profilePhotoInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseProfilePhoto} aria-label={t('choosePhoto')} />
                <button className="button secondary small" type="button" onClick={() => profilePhotoInputRef.current?.click()} disabled={busy}>{t(profilePhotoFile || (!profilePhotoRemoved && user.profilePhotoUrl) ? 'changePhoto' : 'choosePhoto')}</button>
                {(profilePhotoFile || (!profilePhotoRemoved && user.profilePhotoUrl)) && <button className="text-action subtle-danger" type="button" onClick={removeProfilePhotoFromEdit} disabled={busy}>{t('removePhoto')}</button>}
                <small className="profile-photo-field-hint">{t('photoFormatHint')}</small>
                {DEMO_AUTH_ENABLED && <small className="profile-photo-field-hint">{t('demoProfileStorageHint')}</small>}
                {profilePhotoError && <small className="profile-photo-message error" role="alert">{profilePhotoError}</small>}
              </div>
            </div>
          </div>
          <label className="field">
            <span>{t('fullName')}</span>
            <input required maxLength={160} value={form.full_name || ''} onChange={(event) => changeField('full_name', event.target.value)} />
          </label>
          <label className="field">
            <span>{t('phone')}</span>
            <input maxLength={40} value={form.phone || ''} onChange={(event) => changeField('phone', event.target.value)} />
          </label>
          <div className="field">
            <span>{t('email')}</span>
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
      {notice && <div className="alert success">{translateText(notice, language)}</div>}
      {error && <div className="alert error">{translateText(error, language)}<button className="dismiss" onClick={() => setError('')}>{t('dismiss')}</button></div>}
      {slug === 'profile' && (
        <div className="panel profile-panel">
          <ProfilePhotoDisplay user={user} isAdmin={!user.role || user.role === 'admin' || /admin/i.test(String(user.roles || ''))}/>
          <div>
            <h3>{user.full_name}</h3>
            <p className="muted">{user.email}</p>
            <p>{user.phone || 'No phone on profile'}</p>
          </div>
          <button className="button secondary" onClick={() => { setForm({ full_name: user.full_name || user.name || '', phone: user.phone || '' }); setProfilePhotoFile(null); setProfilePhotoPreview(''); setProfilePhotoError(''); setProfilePhotoRemoved(false); setModal({ kind: 'profile' }); }}>{`${t('edit')} ${t('profile')}`}</button>
        </div>
      )}
      {slug === 'reports' ? <Reports /> : slug === 'settings' ? <SettingsPage /> : (
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
            {slug === 'messages' && (
              <select className="filter-select" aria-label="Filter archived contact messages" value={archived} onChange={(event) => setArchived(event.target.value)}>
                <option value="active">Active messages</option>
                <option value="archived">Archived messages</option>
                <option value="all">All messages</option>
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
      {modal?.kind === 'view' ? <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="contact-message-title"><div className="modal-head"><h2 id="contact-message-title">Contact message {modal.row.reference_id}</h2><button className="icon-button" type="button" onClick={closeModal} aria-label="Close"><X size={18}/></button></div><div className="modal-body"><p><strong>From:</strong> {modal.row.full_name} ({modal.row.email})</p>{modal.row.phone && <p><strong>Phone:</strong> {modal.row.phone}</p>}<p><strong>Subject:</strong> {modal.row.subject}</p><p><strong>Inquiry:</strong> {modal.row.inquiry_type}</p><p><strong>Status:</strong> {modal.row.status}</p><p><strong>Received:</strong> {modal.row.created_at}</p><div className="panel" style={{ padding: '14px', whiteSpace: 'pre-wrap' }}>{modal.row.message}</div>{modal.row.admin_reply && <div><strong>Admin reply</strong><p>{modal.row.admin_reply}</p></div>}</div><div className="modal-foot"><button className="button secondary" type="button" onClick={closeModal}>Close</button><button className="button" type="button" onClick={() => startAction('status', modal.row)}>Update status</button></div></section></div> : modal && <Modal title={modalTitle()} onClose={closeModal} onSubmit={submit} busy={busy} submitLabel={modal.kind === 'deactivate' ? 'Deactivate' : t('save')} cancelLabel={modal.kind === 'profile' ? t('cancel') : 'Cancel'} closeLabel={modal.kind === 'profile' ? t('close') : 'Close'} danger={['deactivate', 'reject', 'status'].includes(modal.kind)}>{renderModalFields()}</Modal>}
    </section>
  );
}

function DataPage(props) {
  return props.slug === 'categories'
    ? <AdminServiceCategories />
    : props.slug === 'payments'
      ? <AdminPaymentManagement />
      : props.slug === 'reviews'
        ? <AdminReviewsComplaints kind="reviews" />
        : props.slug === 'complaints'
          ? <AdminReviewsComplaints kind="complaints" />
          : <GenericDataPage {...props} />;
}

const ADMIN_REPORTS = [
  ['users', 'User registrations'],
  ['vendors', 'Vendor registrations and verification'],
  ['events', 'Event creation and publication'],
  ['bookings', 'Bookings'],
  ['payments', 'Payments'],
  ['refunds', 'Refunds'],
  ['revenue', 'Revenue trend'],
  ['categories', 'Service category performance'],
  ['reviews', 'Customer reviews'],
  ['complaints', 'Customer complaints'],
  ['vendor-performance', 'Vendor performance'],
  ['booking-outcomes', 'Cancellations and completions'],
];

const REPORT_PERIODS = [
  ['today', 'Today'],
  ['last7', 'Last 7 days'],
  ['last30', 'Last 30 days'],
  ['monthly', 'This month'],
  ['yearly', 'This year'],
  ['custom', 'Custom range'],
];

const REPORT_SORT_OPTIONS = {
  users: [['created_at', 'Created'], ['name', 'Name'], ['status', 'Status']],
  vendors: [['created_at', 'Created'], ['name', 'Business'], ['status', 'Verification status']],
  events: [['created_at', 'Created'], ['published_at', 'Published'], ['title', 'Title'], ['status', 'Status']],
  bookings: [['created_at', 'Created'], ['status', 'Status'], ['vendor', 'Vendor'], ['customer', 'Customer'], ['amount', 'Amount']],
  payments: [['created_at', 'Created'], ['status', 'Status'], ['amount', 'Amount'], ['currency', 'Currency']],
  refunds: [['created_at', 'Created'], ['status', 'Status'], ['amount', 'Amount'], ['currency', 'Currency']],
  revenue: [['period', 'Date'], ['currency', 'Currency'], ['gross', 'Gross payments'], ['refunds', 'Refunds'], ['net', 'Net revenue']],
  categories: [['category', 'Category'], ['bookings', 'Bookings'], ['completed', 'Completed']],
  reviews: [['created_at', 'Created'], ['rating', 'Rating'], ['vendor', 'Vendor'], ['customer', 'Customer']],
  complaints: [['created_at', 'Created'], ['status', 'Status'], ['customer', 'Customer']],
  'vendor-performance': [['vendor', 'Vendor'], ['bookings', 'Bookings'], ['completed', 'Completed'], ['rating', 'Rating']],
  'booking-outcomes': [['outcome_at', 'Outcome date'], ['status', 'Status'], ['vendor', 'Vendor'], ['customer', 'Customer']],
};

const REPORT_STATUS_OPTIONS = {
  users: ['active', 'pending', 'suspended'],
  vendors: ['pending', 'verified', 'rejected'],
  events: ['draft', 'pending_approval', 'active', 'published', 'booked', 'in_progress', 'completed', 'rejected', 'cancelled'],
  bookings: ['requested', 'quoted', 'accepted', 'rejected', 'under_review', 'completed', 'cancelled'],
  payments: ['pending', 'authorized', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'refund_pending'],
  refunds: ['pending', 'processing', 'succeeded', 'failed', 'rejected'],
  reviews: ['published', 'hidden', 'flagged'],
  complaints: ['open', 'under_review', 'resolved', 'closed'],
  'booking-outcomes': ['completed', 'cancelled'],
};

function Reports() {
  const [report, setReport] = useState('users');
  const [period, setPeriod] = useState('last30');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [currency, setCurrency] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [sortDirection, setSortDirection] = useState('desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const parameters = new URLSearchParams({ report, period, page: String(page), pageSize: '20' });
  if (period === 'custom' && startDate && endDate) {
    parameters.set('startDate', startDate);
    parameters.set('endDate', endDate);
  }
  if (status) parameters.set('status', status);
  if (q.trim()) parameters.set('q', q.trim());
  if (currency.trim()) parameters.set('currency', currency.trim().toUpperCase());
  if (categoryId) parameters.set('categoryId', categoryId);
  if (vendorId) parameters.set('vendorId', vendorId);
  if (customerId) parameters.set('customerId', customerId);
  if (sortBy) parameters.set('sortBy', sortBy);
  parameters.set('sortDirection', sortDirection);

  useEffect(() => {
    if (DEMO_AUTH_ENABLED) {
      setError('Reports require a connected administrator database and are unavailable in demo mode.');
      return undefined;
    }
    if (period === 'custom' && (!startDate || !endDate)) {
      setData(null);
      setError('');
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api(`/admin/reports?${parameters.toString()}`, { signal: controller.signal })
      .then((response) => {
        setData(response);
        if (!currency && ['payments', 'refunds', 'revenue'].includes(report) && response.configuredCurrency) {
          setCurrency(response.configuredCurrency);
        }
      })
      .catch((issue) => {
        if (issue.name !== 'AbortError') setError(issue.message || 'The report could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [report, period, startDate, endDate, status, q, currency, categoryId, vendorId, customerId, sortBy, sortDirection, page]);

  async function exportReport() {
    setExporting(true);
    setError('');
    try {
      const response = await apiClient.request({
        url: `/admin/reports/export?${new URLSearchParams([...parameters.entries()].filter(([key]) => key !== 'page' && key !== 'pageSize')).toString()}`,
        method: 'GET',
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${report}-report.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (issue) {
      setError(issue.message || 'The report could not be exported.');
    } finally {
      setExporting(false);
    }
  }

  const rows = data?.data || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const chartData = data?.chartData || [];
  const maxChartValue = Math.max(1, ...chartData.map((item) => Number(item.value || 0)));
  const formattedValue = (value) => typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
    : value ?? '—';

  return (
    <section className="admin-reports">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administrator analytics</p>
          <h2>Reports</h2>
          <p className="muted">Database-backed reports, filtered by the configured reporting timezone.</p>
        </div>
        <button className="button" type="button" disabled={!data || exporting || loading} onClick={exportReport}>
          {exporting ? 'Preparing CSV…' : 'Export CSV'}
        </button>
      </div>
      <div className="panel report-filters">
        <label className="field"><span>Report</span><select value={report} onChange={(event) => {
          setReport(event.target.value);
          setStatus('');
          setCurrency('');
          setCategoryId('');
          setVendorId('');
          setCustomerId('');
          setSortBy('');
          setPage(1);
        }}>
          {ADMIN_REPORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="field"><span>Date range</span><select value={period} onChange={(event) => { setPeriod(event.target.value); setPage(1); }}>
          {REPORT_PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {period === 'custom' && <>
          <label className="field"><span>Start date</span><input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setPage(1); }} /></label>
          <label className="field"><span>End date</span><input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setPage(1); }} /></label>
        </>}
        <label className="field"><span>Search</span><input type="search" maxLength={120} value={q} placeholder="Search report records" onChange={(event) => { setQ(event.target.value); setPage(1); }} /></label>
        <label className="field"><span>Status</span>
          {REPORT_STATUS_OPTIONS[report]
            ? <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">Any status</option>
              {REPORT_STATUS_OPTIONS[report].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </select>
            : <input maxLength={40} value={status} placeholder="Any status" onChange={(event) => { setStatus(event.target.value); setPage(1); }} />}
        </label>
        {['payments', 'refunds', 'revenue'].includes(report) && <label className="field"><span>Currency</span><input maxLength={3} pattern="[A-Za-z]{3}" value={currency} onChange={(event) => { setCurrency(event.target.value.toUpperCase()); setPage(1); }} /></label>}
        {['bookings', 'categories', 'reviews', 'complaints', 'vendor-performance', 'booking-outcomes'].includes(report) && <>
          <label className="field"><span>Category ID</span><input type="number" min="1" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }} /></label>
          <label className="field"><span>Vendor ID</span><input type="number" min="1" value={vendorId} onChange={(event) => { setVendorId(event.target.value); setPage(1); }} /></label>
          <label className="field"><span>Customer ID</span><input type="number" min="1" value={customerId} onChange={(event) => { setCustomerId(event.target.value); setPage(1); }} /></label>
        </>}
        <label className="field"><span>Sort by</span><select value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1); }}>
          <option value="">Default</option>
          {(REPORT_SORT_OPTIONS[report] || []).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="field"><span>Direction</span><select value={sortDirection} onChange={(event) => { setSortDirection(event.target.value); setPage(1); }}>
          <option value="desc">Descending</option><option value="asc">Ascending</option>
        </select></label>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {data && <>
        <div className="report-summary">
          {(Array.isArray(data.summary) ? data.summary : []).map((item) => (
            <article className="panel report-summary-card" key={item.label}>
              <span>{String(item.label).replaceAll('_', ' ')}</span>
              <strong>{formattedValue(item.value)}{item.currency ? ` ${item.currency}` : ''}</strong>
              {item.grossPayments !== undefined && <small>Gross {formattedValue(item.grossPayments)} · Refunds {formattedValue(item.refunds)} · Net {formattedValue(item.netRevenue)}</small>}
            </article>
          ))}
        </div>
        {!!chartData.length && <section className="panel report-chart">
          <h3>{ADMIN_REPORTS.find(([value]) => value === report)?.[1]} overview</h3>
          <div className="report-bars" role="img" aria-label="Report totals by category">
            {chartData.slice(0, 20).map((item, index) => (
              <div className="report-bar-row" key={`${item.label}-${item.currency || ''}-${index}`}>
                <span title={item.label}>{item.label}{item.currency ? ` · ${item.currency}` : ''}</span>
                <div className="report-bar-track"><div style={{ width: `${Math.min(100, Math.max(1, Number(item.value || 0) / maxChartValue * 100))}%` }} /></div>
                <strong>{formattedValue(Number(item.value || 0))}</strong>
              </div>
            ))}
          </div>
        </section>}
        <section className="panel report-table-panel">
          <div className="report-table-heading">
            <h3>Detailed records</h3>
            <span className="muted">{data.pagination?.total || 0} records · Generated {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—'}</span>
          </div>
          <div className="report-table-scroll">
            <table className="data-table">
              <thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead>
              <tbody>
                {rows.map((row, index) => <tr key={row.id ?? row.booking_reference ?? `${index}`}>
                  {columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : formattedValue(row[column])}</td>)}
                </tr>)}
                {!rows.length && <tr><td className="empty" colSpan={Math.max(1, columns.length)}>{loading ? 'Loading report…' : 'No records match these filters.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="report-pagination">
            <span className="muted">Page {data.pagination?.page || 1} of {Math.max(1, data.pagination?.totalPages || 1)}</span>
            <div><button className="button secondary" type="button" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <button className="button secondary" type="button" disabled={loading || page >= (data.pagination?.totalPages || 1)} onClick={() => setPage((value) => value + 1)}>Next</button></div>
          </div>
          <details className="report-metadata"><summary>Applied filters</summary><pre>{JSON.stringify(data.appliedFilters, null, 2)}</pre></details>
        </section>
      </>}
      {!data && !error && <div className="panel report-empty">{loading ? 'Loading report…' : period === 'custom' ? 'Choose both dates to generate a custom report.' : 'No report data available.'}</div>}
    </section>
  );
}

function ApiSettingsPage() {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [settings, setSettings] = useState(null);
  const [savedSettings, setSavedSettings] = useState(null);
  const [configuration, setConfiguration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const dirty = settings && JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const consequentialKeys = [
    'public_registration_enabled',
    'default_registration_role',
    'platform_status',
    'maintenance_mode',
    'booking_cancellation_cutoff_hours',
    'booking_rescheduling_enabled',
    'booking_reschedule_cutoff_hours',
    'booking_confirmation_workflow',
    'vendor_require_category',
    'vendor_require_city',
    'vendor_require_description',
    'refund_request_window_days',
  ];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    if (DEMO_AUTH_ENABLED) {
      setError('System settings require a connected server and are unavailable in demo mode.');
      setLoading(false);
      return () => controller.abort();
    }

    api('/admin/settings', { signal: controller.signal }).then((response) => {
      if (!response.settings || typeof response.settings !== 'object') {
        throw new Error('The settings response was invalid.');
      }
      setSettings(response.settings);
      setSavedSettings(response.settings);
      setConfiguration(response.configuration || {});
      setError('');
    }).catch((issue) => {
      if (issue.name !== 'AbortError') setError(issue.message || 'The settings could not be loaded.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [reloadToken]);

  function changeSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
    setNotice('');
    setError('');
  }

  function changePlatformStatus(status) {
    setSettings((current) => ({ ...current, platform_status: status, maintenance_mode: status === 'maintenance' }));
    setNotice('');
    setError('');
  }

  function changeMaintenanceMode(enabled) {
    setSettings((current) => ({
      ...current,
      maintenance_mode: enabled,
      platform_status: enabled ? 'maintenance' : current.platform_status === 'maintenance' ? 'open' : current.platform_status,
    }));
    setNotice('');
    setError('');
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!dirty || saving) return;
    const changedConsequential = consequentialKeys.filter((key) => JSON.stringify(settings[key]) !== JSON.stringify(savedSettings?.[key]));
    const confirmConsequential = changedConsequential.length > 0;
    if (confirmConsequential && !window.confirm(`Apply consequential settings changes (${changedConsequential.join(', ')})?`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await api('/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ ...settings, confirmConsequential }),
      });
      if (!response.data || typeof response.data !== 'object') {
        throw new Error('The settings response was invalid.');
      }
      setSettings(response.data);
      setSavedSettings(response.data);
      setNotice(t('settingsSavedSuccessfully'));
      window.dispatchEvent(new CustomEvent('eventflow-settings-updated', { detail: response.data }));
    } catch (issue) {
      setError(issue.message || 'The settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function resetSettings() {
    if (saving || !window.confirm(t('confirmResetSettings'))) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await api('/admin/settings/reset', { method: 'POST', body: JSON.stringify({ confirm: true }) });
      if (!response.data || typeof response.data !== 'object') {
        throw new Error('The reset response was invalid.');
      }
      setSettings(response.data);
      setSavedSettings(response.data);
      setNotice(t('settingsSavedSuccessfully'));
      window.dispatchEvent(new CustomEvent('eventflow-settings-updated', { detail: response.data }));
    } catch (issue) {
      setError(issue.message || 'The settings could not be reset.');
    } finally {
      setSaving(false);
    }
  }

  const textField = (key, label, options = {}) => (
    <label className="field" key={key}>
      <span>{t(label)}</span>
      {options.multiline
        ? <textarea rows={options.rows || 3} maxLength={options.maxLength} value={settings[key] ?? ''} disabled={saving} onChange={(event) => changeSetting(key, event.target.value)} />
        : <input type={options.type || 'text'} maxLength={options.maxLength} value={settings[key] ?? ''} disabled={saving} onChange={(event) => changeSetting(key, event.target.value)} />}
    </label>
  );

  if (loading) return <div className="loading"><span className="spinner" />{t('loading')}</div>;

  return (
    <form className="system-settings-page" onSubmit={saveSettings}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('systemControl')}</p>
          <h2>{t('systemSettings')}</h2>
          <p className="muted">{t('systemSettingsDescription')}</p>
        </div>
      </div>
      {notice && <div className="alert success" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert"><strong>{t('failedToSaveSettings')}</strong> {error}
        {!settings && !DEMO_AUTH_ENABLED && <button className="text-link" type="button" onClick={() => setReloadToken((value) => value + 1)}>Retry</button>}
      </div>}
      {settings && (
        <>
          <section className="system-settings-grid" aria-label={t('systemSettings')}>
            <article className="panel system-settings-card">
              <h3>{t('generalSettings')}</h3>
              <div className="system-settings-fields">
                {textField('platform_name', 'platformName', { maxLength: 100 })}
                {textField('platform_description', 'platformDescription', { multiline: true, maxLength: 500 })}
                <label className="field">
                  <span>{t('brandingLogoUrl')}</span>
                  <input type="url" pattern="https://.*" maxLength={500} placeholder="https://example.com/logo.png" value={settings.branding_logo_url || ''} disabled={saving} onChange={(event) => changeSetting('branding_logo_url', event.target.value)} />
                </label>
                {textField('support_email', 'supportEmail', { type: 'email', maxLength: 254 })}
                {textField('support_phone', 'supportPhone', { type: 'tel', maxLength: 40 })}
                {textField('support_address', 'supportAddress', { maxLength: 255 })}
                {textField('support_hours', 'supportHours', { maxLength: 255 })}
                {textField('social_links', 'socialLinks', { multiline: true, maxLength: 5000 })}
                <label className="field">
                  <span>{t('platformLocale')}</span>
                  <select value={settings.platform_locale} disabled={saving} onChange={(event) => changeSetting('platform_locale', event.target.value)}>
                    <option value="en">English</option><option value="am">አማርኛ</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t('platformCurrency')}</span>
                  <input required pattern="[A-Z]{3}" maxLength={3} value={settings.platform_currency || 'ETB'} disabled={saving} onChange={(event) => changeSetting('platform_currency', event.target.value.toUpperCase())} />
                </label>
                <label className="field">
                  <span>{t('reportTimezone')}</span>
                  <input required maxLength={64} value={settings.report_timezone || 'Africa/Addis_Ababa'} disabled={saving} onChange={(event) => changeSetting('report_timezone', event.target.value)} />
                </label>
              </div>
            </article>
            <article className="panel system-settings-card">
              <h3>{t('bookingSettings')}</h3>
              <div className="system-settings-fields">
                <label className="field">
                  <span>{t('bookingConfirmationWorkflow')}</span>
                  <select value={settings.booking_confirmation_workflow} disabled={saving} onChange={(event) => changeSetting('booking_confirmation_workflow', event.target.value)}>
                    <option value="vendor_acceptance">{t('vendorAcceptance')}</option>
                    <option value="administrator_approval">{t('administratorApproval')}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t('cancellationCutoffHours')}</span>
                  <input type="number" min="0" max="8760" step="1" value={settings.booking_cancellation_cutoff_hours} disabled={saving} onChange={(event) => changeSetting('booking_cancellation_cutoff_hours', Number(event.target.value))} />
                </label>
                <label className="settings-toggle">
                  <span><strong>{t('bookingReschedulingEnabled')}</strong><small>{t('bookingRulesHelp')}</small></span>
                  <input type="checkbox" checked={settings.booking_rescheduling_enabled} disabled={saving} onChange={(event) => changeSetting('booking_rescheduling_enabled', event.target.checked)} />
                </label>
                <label className="field">
                  <span>{t('rescheduleCutoffHours')}</span>
                  <input type="number" min="0" max="8760" step="1" value={settings.booking_reschedule_cutoff_hours} disabled={saving || !settings.booking_rescheduling_enabled} onChange={(event) => changeSetting('booking_reschedule_cutoff_hours', Number(event.target.value))} />
                </label>
                <p className="settings-readonly-note">{t('bookingTimeLimitNote')}</p>
              </div>
            </article>
            <article className="panel system-settings-card">
              <h3>{t('vendorSettings')}</h3>
              <div className="system-settings-fields">
                <label className="settings-toggle">
                  <span><strong>{t('requireVendorCategory')}</strong><small>{t('vendorInformationHelp')}</small></span>
                  <input type="checkbox" checked={settings.vendor_require_category} disabled={saving} onChange={(event) => changeSetting('vendor_require_category', event.target.checked)} />
                </label>
                <label className="settings-toggle">
                  <span><strong>{t('requireVendorCity')}</strong></span>
                  <input type="checkbox" checked={settings.vendor_require_city} disabled={saving} onChange={(event) => changeSetting('vendor_require_city', event.target.checked)} />
                </label>
                <label className="settings-toggle">
                  <span><strong>{t('requireVendorDescription')}</strong></span>
                  <input type="checkbox" checked={settings.vendor_require_description} disabled={saving} onChange={(event) => changeSetting('vendor_require_description', event.target.checked)} />
                </label>
                <div className="settings-status-row"><span>{t('vendorVerificationStatus')}</span><strong>{t('alwaysRequired')}</strong></div>
                <p className="settings-readonly-note">{t('servicePublicationRuleNote')}</p>
              </div>
            </article>
            <article className="panel system-settings-card">
              <h3>{t('notificationSettings')}</h3>
              <div className="system-settings-fields">
                <label className="settings-toggle">
                  <span><strong>{t('notifyUserRegistrations')}</strong></span>
                  <input type="checkbox" checked={settings.notify_admin_user_registrations} disabled={saving} onChange={(event) => changeSetting('notify_admin_user_registrations', event.target.checked)} />
                </label>
                <label className="settings-toggle">
                  <span><strong>{t('notifyVendorApplications')}</strong></span>
                  <input type="checkbox" checked={settings.notify_admin_vendor_applications} disabled={saving} onChange={(event) => changeSetting('notify_admin_vendor_applications', event.target.checked)} />
                </label>
                <label className="settings-toggle">
                  <span><strong>{t('notifyComplaints')}</strong></span>
                  <input type="checkbox" checked={settings.notify_admin_complaints} disabled={saving} onChange={(event) => changeSetting('notify_admin_complaints', event.target.checked)} />
                </label>
                {['inApp', 'email', 'sms'].map((channel) => (
                  <div className="settings-status-row" key={channel}>
                    <span>{t(`notificationChannel_${channel}`)}</span>
                    <strong>{configuration?.notifications?.[channel]?.configured ? t('configured') : t('notConfigured')}</strong>
                  </div>
                ))}
                <p className="settings-readonly-note">{t('emailSecretsNote')}</p>
              </div>
            </article>
            <article className="panel system-settings-card">
              <h3>{t('paymentSettings')}</h3>
              <div className="system-settings-fields">
                <label className="field">
                  <span>{t('refundRequestWindowDays')}</span>
                  <input type="number" min="0" max="365" step="1" value={settings.refund_request_window_days} disabled={saving} onChange={(event) => changeSetting('refund_request_window_days', Number(event.target.value))} />
                </label>
                <div className="settings-status-row">
                  <span>{t('paymentProviderStatus')}</span>
                  <strong>{configuration?.payments?.configured ? `${t('configured')} (${configuration.payments.provider})` : t('pendingIntegration')}</strong>
                </div>
                <div className="settings-status-row">
                  <span>{t('supportedCurrencies')}</span>
                  <strong>{configuration?.payments?.supportedCurrencies?.join(', ') || settings.platform_currency}</strong>
                </div>
                <p className="settings-readonly-note">{t('paymentSecretsNote')}</p>
              </div>
            </article>
            <article className="panel system-settings-card">
              <h3>{t('securitySettings')}</h3>
              <div className="system-settings-fields">
                <div className="settings-status-row"><span>{t('administratorSession')}</span><strong>{configuration?.security?.administratorSessionHours || 8} {t('hours')}</strong></div>
                <div className="settings-status-row"><span>{t('userSession')}</span><strong>{configuration?.security?.userSessionHours || 8} {t('hours')}</strong></div>
                <div className="settings-status-row"><span>{t('passwordPolicy')}</span><strong>{configuration?.security?.passwordMinimumLength || 12}–{configuration?.security?.passwordMaximumLength || 16} {t('charactersStrongPassword')}</strong></div>
                <p className="settings-readonly-note">{t('securityPolicyReadonlyNote')}</p>
                <div className="settings-status-row"><span>{t('defaultRegistrationRole')}</span><strong>{t('customerRole')}</strong></div>
                <label className="settings-toggle">
                  <span><strong>{t('publicRegistration')}</strong><small>{t('publicRegistrationHelp')}</small></span>
                  <input type="checkbox" checked={settings.public_registration_enabled} disabled={saving} onChange={(event) => changeSetting('public_registration_enabled', event.target.checked)} />
                </label>
              </div>
            </article>
            <article className="panel system-settings-card">
              <h3>{t('maintenanceSettings')}</h3>
              <div className="system-settings-fields">
                <label className="field">
                  <span>{t('platformStatus')}</span>
                  <select value={settings.platform_status} disabled={saving} onChange={(event) => changePlatformStatus(event.target.value)}>
                    <option value="open">{t('platformOpen')}</option>
                    <option value="locked">{t('platformLocked')}</option>
                    <option value="maintenance">{t('maintenance')}</option>
                  </select>
                </label>
                <label className="settings-toggle">
                  <span><strong>{t('maintenanceMode')}</strong><small>{t('maintenanceModeHelp')}</small></span>
                  <input type="checkbox" checked={settings.maintenance_mode} disabled={saving} onChange={(event) => changeMaintenanceMode(event.target.checked)} />
                </label>
                {textField('maintenance_message', 'maintenanceMessage', { multiline: true, maxLength: 1000 })}
              </div>
            </article>
          </section>
          <div className="system-settings-actions">
            {dirty && <span className="muted" role="status">{t('unsavedSettings')}</span>}
            <button type="button" className="button secondary" disabled={saving || !dirty} onClick={() => { setSettings(savedSettings); setError(''); setNotice(''); }}>{t('cancel')}</button>
            <button type="button" className="button secondary" disabled={saving} onClick={resetSettings}>{t('resetToDefaults')}</button>
            <button type="submit" className="button" disabled={saving || !dirty}>{saving ? t('saving') : t('saveChanges')}</button>
          </div>
        </>
      )}
    </form>
  );
}

function MaintenancePage({ platformName, message, onAdminSignIn }) {
  const language = useLanguage();
  return (
    <main className="maintenance-screen">
      <section className="panel maintenance-card">
        <AuthBrand />
        <p className="eyebrow">{platformName}</p>
        <h1>{translate('maintenancePageTitle', language)}</h1>
        <p>{message}</p>
        <button className="button" type="button" onClick={onAdminSignIn}>{translate('administratorSignIn', language)}</button>
      </section>
    </main>
  );
}

function SettingsPage() {
  return DEMO_AUTH_ENABLED ? <AdminSystemSettings /> : <ApiSettingsPage />;
}

export default function App(){
  const language = useLanguage();
  const authSessionState = useAuthSessionSnapshot();
  const [user,setUser]=useState(null);const [checking,setChecking]=useState(true);const [slug,setSlug]=useState('overview');const [sidebarOpen,setSidebarOpen]=useState(false);const [sidebarCollapsed,setSidebarCollapsed]=useState(false);const [globalError,setGlobalError]=useState('');const [showLogin,setShowLogin]=useState(false);const [portal,setPortal]=useState('admin');const [currentPath,setCurrentPath]=useState(() => `${window.location.pathname || '/'}${window.location.search || ''}`);const [platformAvailability,setPlatformAvailability]=useState(null);
  const [passwordResetEmail, setPasswordResetEmail] = useState('');

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

  useEffect(() => {
    if (DEMO_AUTH_ENABLED) {
      setPlatformAvailability({ platformName: 'EventHub', maintenanceMode: false, publicRegistrationEnabled: true, defaultRegistrationRole: 'customer' });
      return undefined;
    }

    const controller = new AbortController();
    const updateAvailability = (settings) => {
      if (settings.platform_locale) setPlatformDefaultLanguage(settings.platform_locale);
      setPlatformAvailability((current) => ({
        ...current,
        platformName: settings.platform_name ?? current?.platformName ?? 'EventHub',
        platformDescription: settings.platform_description ?? current?.platformDescription ?? '',
        brandingLogoUrl: settings.branding_logo_url ?? current?.brandingLogoUrl ?? '',
        platformLocale: settings.platform_locale ?? current?.platformLocale ?? 'en',
        maintenanceMode: Boolean(settings.maintenance_mode) || settings.platform_status === 'maintenance' || settings.platform_status === 'locked' || current?.maintenanceMode === true && settings.maintenance_mode === undefined && settings.platform_status === undefined,
        maintenanceMessage: settings.maintenance_message ?? current?.maintenanceMessage ?? '',
        publicRegistrationEnabled: settings.public_registration_enabled ?? current?.publicRegistrationEnabled ?? true,
        defaultRegistrationRole: settings.default_registration_role ?? current?.defaultRegistrationRole ?? 'customer',
        supportEmail: settings.support_email ?? current?.supportEmail ?? '',
        supportPhone: settings.support_phone ?? current?.supportPhone ?? '',
      }));
    };

    api('/platform/availability', { signal: controller.signal }).then((response) => {
      if (!response.data || typeof response.data !== 'object') throw new Error('Platform availability could not be loaded.');
      setPlatformAvailability(response.data);
      if (response.data.platformLocale) setPlatformDefaultLanguage(response.data.platformLocale);
    }).catch((issue) => {
      if (issue.name !== 'AbortError') setGlobalError(issue.message || 'Platform availability could not be loaded.');
    });

    const settingsListener = (event) => updateAvailability(event.detail || {});
    window.addEventListener('eventflow-settings-updated', settingsListener);
    return () => {
      controller.abort();
      window.removeEventListener('eventflow-settings-updated', settingsListener);
    };
  }, []);

  useEffect(() => {
    if (!platformAvailability) return;
    document.documentElement.dataset.platformName = platformAvailability.platformName || 'EventHub';
    document.documentElement.dataset.platformDescription = platformAvailability.platformDescription || '';
    document.documentElement.dataset.brandingLogoUrl = platformAvailability.brandingLogoUrl || '';
    document.documentElement.dataset.supportEmail = platformAvailability.supportEmail || '';
    document.documentElement.dataset.supportPhone = platformAvailability.supportPhone || '';
    if (platformAvailability.platformName) document.title = `${platformAvailability.platformName} | Plan · Book · Celebrate`;
  }, [platformAvailability]);

  const navigatePublic = useCallback((path) => {
    const next = normalizePath(path);
    window.history.pushState({}, '', next);
    setCurrentPath(next);
  }, [normalizePath]);

  const resolve = useCallback(() => {
    const nextPath = normalizePath(`${window.location.pathname}${window.location.search}`);
    setCurrentPath(nextPath);
    const nextSlug = adminSlugFromPath(nextPath);
    if (nextSlug !== null) setSlug(nextSlug);
  }, [normalizePath]);

  useEffect(() => {
    if (currentPath.split('?')[0] !== '/about') return;
    const destination = '/about/mission-vision';
    window.history.replaceState({}, '', destination);
    setCurrentPath(destination);
  }, [currentPath]);

  useEffect(()=>{
    resolve();
    const listener=()=>resolve();
    window.addEventListener('popstate',listener);
    if (DEMO_AUTH_ENABLED) {
      try {
        const demoProfile = readDemoSession();
        if (demoProfile) {
          setUser(toDemoUser(demoProfile));
          setPortal(demoProfile.role);
          authSessionLoader.setAuthenticated(toDemoUser(demoProfile), demoProfile.role);
        } else {
          authSessionLoader.setUnauthenticated();
        }
      } catch (issue) {
        setGlobalError(issue.message);
        authSessionLoader.setUnauthenticated();
      } finally {
        setChecking(false);
      }
    } else {
      void authSessionLoader.load();
    }
    return()=>window.removeEventListener('popstate',listener);
  },[resolve]);

  useEffect(() => {
    if (DEMO_AUTH_ENABLED || authSessionState.status === 'loading') return;
    setChecking(false);
    if (authSessionState.status === 'authenticated') {
      setUser(authSessionState.user);
      setPortal(authSessionState.role);
      setGlobalError('');
    } else if (authSessionState.status === 'unauthenticated') {
      setUser(null);
      setPortal('admin');
    } else {
      setUser(null);
      setPortal('admin');
    }
  }, [authSessionState]);

  useEffect(() => {
    if (!checking && !user && currentPath.split('?')[0].startsWith('/admin')) {
      window.history.replaceState({}, '', '/login');
      setCurrentPath('/login');
    }
  }, [checking, currentPath, user]);

  useEffect(() => {
    function handleAuthInvalidated() {
      authSessionLoader.setUnauthenticated();
      setUser(null);
      setPortal('admin');
    }
    window.addEventListener('eventhub:auth-invalidated', handleAuthInvalidated);
    return () => window.removeEventListener('eventhub:auth-invalidated', handleAuthInvalidated);
  }, []);

  useEffect(() => {
    if (!user || DEMO_AUTH_ENABLED) return;
    const preferredLanguage = user.preferred_language;
    if (preferredLanguage === 'en' || preferredLanguage === 'am') setLanguage(preferredLanguage);
  }, [portal, user?.id, user?.preferred_language, user?.role, user?.roles]);

  async function login(email,password){
    if (DEMO_AUTH_ENABLED) {
      const credential = findDemoLogin(email, password);
      if (!credential) throw new Error('Demo sign-in failed. Choose one of the predefined demo accounts and enter its mock password.');
      const profile = saveDemoSession(credential);
      authSessionLoader.setAuthenticated(toDemoUser(profile), profile.role);
      setUser(toDemoUser(profile));setPortal(profile.role);setGlobalError('');setShowLogin(false);
      navigatePublic(dashboardPathForRole(profile.role));
      return;
    }
    const adminResponse = await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
    authSessionLoader.setAuthenticated(adminResponse.user, 'admin');
    setUser(adminResponse.user);setPortal('admin');setGlobalError('');setShowLogin(false);navigatePublic('/admin');
  }
  async function loginPublic(email,password){
    if (DEMO_AUTH_ENABLED) {
      await login(email, password);
      const continuation = sessionStorage.getItem('eventhub_after_login');
      const demoProfile = readDemoSession();
      if (continuation && (continuation === '/' && ['customer', 'organizer'].includes(demoProfile?.role) || /^\/events\/\d+$/.test(continuation) || continuation === '/vendor-application' && ['customer', 'organizer'].includes(demoProfile?.role))) {
        sessionStorage.removeItem('eventhub_after_login');
        navigatePublic(continuation);
      }
      return;
    }
    let adminResponse;
    try {
      adminResponse = await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
    } catch (error) {
      if (error.status !== 401) throw error;
    }
    if (adminResponse?.user) {
      authSessionLoader.setAuthenticated(adminResponse.user, 'admin');
      setUser(adminResponse.user);setPortal('admin');setGlobalError('');setShowLogin(false);
      navigatePublic('/admin');
      return;
    }
    const platformResponse = await api('/platform/login',{method:'POST',body:JSON.stringify({email,password})});
    const role = platformResponse?.data?.user?.role || 'customer';
    authSessionLoader.setAuthenticated(platformResponse.data.user, role);
    setUser(platformResponse.data.user);setPortal(role);setGlobalError('');setShowLogin(false);
    const rolePath = role === 'admin' ? '/admin' : role === 'organizer' ? '/organizer/dashboard' : role === 'vendor' ? '/vendor/dashboard' : '/customer/dashboard';
    const continuation = sessionStorage.getItem('eventhub_after_login');
    const canContinue = continuation && (
      ['customer', 'organizer'].includes(role) && continuation === '/'
      || role === 'customer' && (/^\/events\/\d+$/.test(continuation) || continuation === '/my-bookings' || continuation === '/vendor-application')
      || role === 'organizer' && continuation === '/vendor-application'
    );
    if (canContinue) sessionStorage.removeItem('eventhub_after_login');
    navigatePublic(canContinue ? continuation : rolePath);
  }
  function completeRegistration(result) {
    const registeredUser = result?.demo ? toDemoUser(result.profile) : result?.data?.user;
    if (!registeredUser || registeredUser.role !== 'customer') {
      setGlobalError('Registration completed, but customer sign-in could not be confirmed. Please sign in.');
      navigatePublic('/login');
      return;
    }
    authSessionLoader.setAuthenticated(registeredUser, 'customer');
    setUser(registeredUser);setPortal('customer');setGlobalError('');setShowLogin(false);
    navigatePublic('/customer/dashboard');
  }
  async function registerPublic(name,email,password){
    if (DEMO_AUTH_ENABLED) {
      if (!name || name.trim().length < 2) throw new Error('Enter your full name (at least 2 characters).');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter a valid email address.');
      if (!isValidDemoPassword(password)) throw new Error('Password must contain 12–16 characters, uppercase, lowercase, and a number.');
      const profile = saveDemoAccount({ name, email, role: 'customer' });
      saveDemoSession(profile);
      return { demo: true, profile, message: 'Demo registration successful', dashboardPath: dashboardPathForRole('customer') };
    }
    const response = await api('/platform/register',{method:'POST',body:JSON.stringify({name,email,password})});
    const registeredUser = response?.data?.user;
    if (!registeredUser || registeredUser.role !== 'customer') throw new Error('The server did not confirm a customer account.');
    return response.data;
  }
  async function requestPasswordResetOtp(email){ if(DEMO_AUTH_ENABLED)throw Object.assign(new Error('Browser-only demo mode cannot send reset emails.'),{status:503,code:'DEMO_AUTH'}); const response=await api('/auth/forgot-password/otp',{method:'POST',body:JSON.stringify({email})}); setPasswordResetEmail(email); return response; }
  async function resendPasswordResetOtp(email){ if(DEMO_AUTH_ENABLED)throw Object.assign(new Error('Browser-only demo mode cannot send reset emails.'),{status:503,code:'DEMO_AUTH'}); return api('/auth/resend-reset-otp',{method:'POST',body:JSON.stringify({email})}); }
  async function verifyPasswordResetOtp(email,otp){ if(DEMO_AUTH_ENABLED)throw Object.assign(new Error('Browser-only demo mode cannot send reset emails.'),{status:503,code:'DEMO_AUTH'}); return api('/auth/verify-reset-otp',{method:'POST',body:JSON.stringify({email,otp})}); }
  async function resetPassword(newPassword){ if(DEMO_AUTH_ENABLED)throw Object.assign(new Error('Browser-only demo mode cannot send reset emails.'),{status:503,code:'DEMO_AUTH'}); return api('/auth/reset-password',{method:'POST',body:JSON.stringify({newPassword})}); }
  async function verifyEmail(token){ const response = await api('/platform/verify-email',{method:'POST',body:JSON.stringify({token})}); return response; }
  async function loginCustomer(email,password){const r=await api('/platform/login',{method:'POST',body:JSON.stringify({email,password})});if (!r?.data?.user || r.data.user.role !== 'customer') throw new Error('Customer access is required.');authSessionLoader.setAuthenticated(r.data.user, 'customer');setUser(r.data.user);setPortal('customer');setGlobalError('');setShowLogin(false);navigatePublic('/customer/dashboard');}
  async function loginOrganizer(email,password){const r=await api('/platform/login',{method:'POST',body:JSON.stringify({email,password})});if (!r?.data?.user || r.data.user.role !== 'organizer') throw new Error('Organizer access is required.');authSessionLoader.setAuthenticated(r.data.user, 'organizer');setUser(r.data.user);setPortal('organizer');setGlobalError('');setShowLogin(false);navigatePublic('/organizer/dashboard');}
  async function loginVendor(email,password){const r=await api('/platform/login',{method:'POST',body:JSON.stringify({email,password})});if (!r?.data?.user || r.data.user.role !== 'vendor') throw new Error('Vendor access is required.');authSessionLoader.setAuthenticated(r.data.user, 'vendor');setUser(r.data.user);setPortal('vendor');setGlobalError('');setShowLogin(false);navigatePublic('/vendor/dashboard');}
  function navigate(next){const destination=DEMO_AUTH_ENABLED&&next==='account-settings'?'settings':next;const path=adminPathForSlug(destination);history.pushState({},'',path);setSlug(adminSlugFromPath(path)||'overview');setSidebarOpen(false);setGlobalError('');}
  function toggleAdminSidebar(){if(window.matchMedia('(max-width: 760px)').matches)setSidebarOpen((current)=>!current);else setSidebarCollapsed((current)=>!current);}
  async function logout(){
    if (!window.confirm(translate('confirmLogout', language))) return;
    try {
      if (DEMO_AUTH_ENABLED) clearDemoSession();
      else if (portal === 'admin') await api('/auth/logout',{method:'POST'});
      else if (user) await api('/platform/logout',{method:'POST'});
    } catch (issue) {
      setGlobalError(translate('logoutFailed', language));
      if (issue.status === 401) {
        authSessionLoader.setUnauthenticated();
        setUser(null);
        setPortal('admin');
        window.history.replaceState({}, '', '/login');
        setCurrentPath('/login');
      }
      return;
    }
    authSessionLoader.setUnauthenticated();
    setUser(null);
    setShowLogin(false);
    setPortal('admin');
    setGlobalError('');
    try {
      window.sessionStorage.removeItem('eventhub_after_login');
    } catch (issue) {
      console.error('Post-login navigation state could not be cleared:', issue);
    }
    window.history.replaceState({}, '', '/login');
    setCurrentPath('/login');
  }

  const publicRoutes = {
    '/': <PublicOverview user={user} currentPath={currentPath} onNavigate={navigatePublic} onLogout={logout} />,
    '/events': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><EventsPage onNavigate={navigatePublic} user={user} currentPath={currentPath} /></PublicPageLayout>,
    '/vendors': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><VendorsPage user={user} onNavigate={navigatePublic} currentPath={currentPath} /></PublicPageLayout>,
    '/services': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ServicesPage onNavigate={navigatePublic} user={user} currentPath={currentPath} /></PublicPageLayout>,
    '/service-categories': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ServiceCategoriesPage api={api} onNavigate={navigatePublic} /></PublicPageLayout>,
    '/categories': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><CategoriesPage onNavigate={navigatePublic} /></PublicPageLayout>,
    '/login': <LoginPage onLogin={loginPublic} demoMode={DEMO_AUTH_ENABLED} showForgotPassword />,
    '/register': <RegisterPage onRegister={registerPublic} onRegistrationComplete={completeRegistration} registrationEnabled={platformAvailability?.publicRegistrationEnabled ?? true} />,
    '/forgot-password': <ForgotPasswordPage onSubmit={requestPasswordResetOtp} />,
    '/verify-reset-otp': <VerifyResetOtpPage email={passwordResetEmail} onEmailChange={setPasswordResetEmail} onVerify={verifyPasswordResetOtp} onResend={resendPasswordResetOtp} />,
    '/reset-password': <ResetPasswordPage onSubmit={resetPassword} />,
    '/privacy': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><PrivacyPage /></PublicPageLayout>,
    '/terms': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><TermsPage /></PublicPageLayout>,
    '/help': <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><HelpPage /></PublicPageLayout>,
  };

  const routePath = currentPath.split('?')[0];
  const eventRoute = routePath.match(/^\/events\/(\d+)$/);
  const serviceRoute = routePath.match(/^\/services\/(\d+)$/);
  const vendorRoute = routePath.match(/^\/vendors\/(\d+)$/);
  const customerBookingRoute = routePath.match(/^\/customer\/bookings\/(\d+)$/);
  const roleDashboardRoute = /^\/(customer|organizer|vendor)\/dashboard(?:\/|$)/.test(routePath);
  const requiresSession = routePath.startsWith('/admin') || routePath === '/my-bookings' || roleDashboardRoute || Boolean(customerBookingRoute);
  if (checking && requiresSession) return <div className="loading full-screen"><img className="loading-brand-symbol" src="/eventhub-symbol.png" alt="EventHub"/><span className="spinner"/>Checking your session…</div>;
  if (requiresSession && !user && ['error', 'rate-limited'].includes(authSessionState.status)) {
    return <SessionRecoveryPage sessionState={authSessionState}/>;
  }
  if (platformAvailability?.maintenanceMode && !(user && portal === 'admin') && routePath !== '/login' && !routePath.startsWith('/admin')) {
    return <MaintenancePage platformName={platformAvailability.platformName} message={platformAvailability.maintenanceMessage} onAdminSignIn={() => navigatePublic('/login')} />;
  }
  if (customerBookingRoute) {
    if (!user) return <LoginPage onLogin={loginPublic} demoMode={DEMO_AUTH_ENABLED} />;
    if (user.role !== 'customer') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><main className="page-shell"><div className="alert error">Booking details are available to customer accounts.</div></main></PublicPageLayout>;
    return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><CustomerBookingDetailsPage bookingId={customerBookingRoute[1]} api={api} onNavigate={navigatePublic} /></PublicPageLayout>;
  }
  if (routePath === '/search') {
    const params = new URLSearchParams(currentPath.split('?')[1] || '');
    const query = params.get('q') || '';
    return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><SearchResultsPage initialQuery={query} initialCategory={params.get('category') || ''} initialLocation={params.get('location') || ''} onNavigate={navigatePublic}/></PublicPageLayout>;
  }
  if (routePath === '/vendor-application') {
    return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><VendorApplicationPage user={user} onNavigate={navigatePublic}/></PublicPageLayout>;
  }
  if (eventRoute) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><EventDetailsPage eventId={eventRoute[1]} user={user} api={api} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/events' || routePath === '/events/upcoming') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><EventsPage onNavigate={navigatePublic} user={user} currentPath={currentPath} /></PublicPageLayout>;
  if (routePath === '/vendors' || routePath.startsWith('/vendors?')) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><VendorsPage user={user} onNavigate={navigatePublic} currentPath={currentPath} /></PublicPageLayout>;
  if (vendorRoute) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><VendorDetailPage vendorId={vendorRoute[1]} user={user} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/services') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ServicesPage user={user} onNavigate={navigatePublic} currentPath={currentPath} /></PublicPageLayout>;
  if (serviceRoute) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ServiceDetailPage serviceId={serviceRoute[1]} user={user} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/service-categories') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ServiceCategoriesPage api={api} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/categories' || routePath.startsWith('/categories?')) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><CategoriesPage onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath.startsWith('/categories/')) {
    const slug = routePath.replace(/^\/categories\//, '');
    return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><CategoryDetailPage slug={slug} onNavigate={navigatePublic} /></PublicPageLayout>;
  }
  if (routePath === '/about') return null;
  if ([
    '/about/mission-vision',
    '/about/how-it-works',
    '/about/why-choose',
    '/about/team',
    '/about/partners',
    '/about/success-stories',
    '/about/faqs',
  ].includes(routePath)) return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><AboutPage onNavigate={navigatePublic} currentPath={currentPath} /></PublicPageLayout>;
  if (routePath === '/contact') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><ContactPage /></PublicPageLayout>;
  if (routePath === '/') return publicRoutes['/'];
  if (routePath === '/calendar') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><EventCalendarPage api={api} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/venues') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><PopularVenuesPage api={api} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/compare') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><CompareVendorsPage api={api} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/recently-viewed') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><RecentlyViewedPage api={api} onNavigate={navigatePublic} /></PublicPageLayout>;
  if (routePath === '/my-favorites' || routePath === '/recommendations') {
    if (routePath === '/my-favorites' && !user) return <LoginPage onLogin={loginPublic} demoMode={DEMO_AUTH_ENABLED} />;
    if (routePath === '/my-favorites' && user?.role !== 'customer') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><main className="page-shell"><div className="info-card wide" role="alert">{translate('navigationCustomerOnly', language)}</div></main></PublicPageLayout>;
    const page = routePath === '/my-favorites'
      ? <MyFavoritesPage api={api} onNavigate={navigatePublic} />
      : <RecommendationsPage api={api} onNavigate={navigatePublic} user={user} />;
    return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}>{page}</PublicPageLayout>;
  }
  if (routePath === '/my-bookings') {
    if (!user) return <LoginPage onLogin={loginPublic} demoMode={DEMO_AUTH_ENABLED} />;
    if (user.role !== 'customer') return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><main className="page-shell"><div className="alert error">My Event Bookings is available to customer accounts.</div></main></PublicPageLayout>;
    return <PublicPageLayout currentPath={currentPath} user={user} onNavigate={navigatePublic} onLogout={logout}><MyEventBookingsPage api={api} onNavigate={navigatePublic} /></PublicPageLayout>;
  }
  if(!user){
    if (currentPath.startsWith('/admin')) return DEMO_AUTH_ENABLED ? <LoginPage onLogin={login} demoMode /> : <Login onLogin={login}/>;
    if (roleDashboardRoute) return <LoginPage onLogin={loginPublic} demoMode={DEMO_AUTH_ENABLED}/>;
    if (routePath === '/login') return <LoginPage onLogin={loginPublic} demoMode={DEMO_AUTH_ENABLED} showForgotPassword/>;
    if (routePath === '/register') return <RegisterPage onRegister={registerPublic} onRegistrationComplete={completeRegistration} registrationEnabled={platformAvailability?.publicRegistrationEnabled ?? true}/>;
    if (DEMO_AUTH_ENABLED && /^\/(customer|organizer|vendor)\/dashboard$/.test(currentPath)) return <LoginPage onLogin={loginPublic} demoMode />;
    if (routePath === '/forgot-password') return <ForgotPasswordPage onSubmit={requestPasswordResetOtp} />;
    if (routePath === '/verify-reset-otp') return <VerifyResetOtpPage email={passwordResetEmail} onEmailChange={setPasswordResetEmail} onVerify={verifyPasswordResetOtp} onResend={resendPasswordResetOtp} />;
    if (routePath === '/reset-password') return <ResetPasswordPage onSubmit={resetPassword} />;
    if (currentPath === '/privacy') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><PrivacyPage /></PublicPageLayout>;
    if (currentPath === '/terms') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><TermsPage /></PublicPageLayout>;
    if (currentPath === '/help') return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><HelpPage /></PublicPageLayout>;
    if (['/events', '/events/upcoming'].includes(currentPath.split('?')[0])) return <PublicPageLayout currentPath={currentPath} user={null} onNavigate={navigatePublic} onLogout={logout}><EventsPage onNavigate={navigatePublic} user={null} currentPath={currentPath} /></PublicPageLayout>;
    if (publicRoutes[routePath]) return publicRoutes[routePath];
    return <NotFoundPage onNavigate={navigatePublic}/>;
  }

  if (portal === 'customer') return <><CustomerDashboard user={user} onLogout={logout} onUserChange={setUser} onNavigatePublic={navigatePublic}/></>;
  if (portal === 'organizer') return <><OrganizerDashboard user={user} onLogout={logout} onUserChange={setUser}/></>;
  if (portal === 'vendor') return <><VendorDashboard user={user} onLogout={logout} onUserChange={setUser}/></>;
  return <><div className={`app-shell dashboard-admin-shell ${sidebarCollapsed?'sidebar-collapsed':''}`}><DashboardSidebar roleTitle={translate('adminDashboard',language).toUpperCase()} groups={menuGroups.map((group) => ({ ...group, flyoutWhenCollapsed: true }))} activePage={slug} onNavigate={(target)=>navigate(target==='settings'?'account-settings':target)} onToggle={toggleAdminSidebar} collapsed={sidebarCollapsed} mobileOpen={sidebarOpen} onCloseMobile={()=>setSidebarOpen(false)} language={language} className="admin-dashboard-sidebar"/><div className={`mobile-scrim ${sidebarOpen?'visible':''}`} onClick={()=>setSidebarOpen(false)}/><main className="main-area"><DashboardHeader user={user} onNavigate={(target)=>navigate(target==='settings'?'account-settings':target)} onLogout={logout} onToggleSidebar={toggleAdminSidebar} onUserChange={setUser} isAdmin={!user.role || user.role === 'admin'} sidebarExpanded={window.matchMedia('(max-width: 760px)').matches ? sidebarOpen : !sidebarCollapsed}/><div className="content">{globalError&&<div className="alert error">{globalError}<button className="dismiss" onClick={()=>setGlobalError('')}>{translate('dismiss',language)}</button></div>}{slug==='account-settings'?<DashboardSettings user={user}/>:slug==='overview'?<Overview onNavigate={navigate}/>:slug==='users'?<AdminUserManagement/>:slug==='roles'?<AdminRoleManagement/>:slug==='vendors'?<AdminVendorVerification/>:slug==='events'?<AdminEventManagement/>:slug==='hero-images'?<AdminHeroImages/>:slug==='bookings'?<AdminBookingManagement/>:slug==='payments'?<AdminPaymentManagement/>:slug==='notifications'?<AdminNotifications/>:slug==='audit-logs'?<AdminAuditLogs/>:slug==='profile'?(DEMO_AUTH_ENABLED?<DataPage slug="profile" user={user} onUserChange={setUser}/>:<AdminProfile user={user} onUserChange={setUser}/>):slug==='reports'?<Reports/>:slug==='settings'?<SettingsPage/>:<DataPage slug={slug} user={user} onUserChange={setUser}/>}</div><footer className="footer">{translate('adminDashboard',language)} <span>•</span> {translateText('Operational data is server-backed',language)}</footer></main></div></>;
  return <><div className={`app-shell dashboard-admin-shell ${sidebarCollapsed?'sidebar-collapsed':''}`}><DashboardSidebar roleTitle={translate('adminDashboard',language).toUpperCase()} groups={menuGroups.map((group) => ({ ...group, flyoutWhenCollapsed: true }))} activePage={slug} onNavigate={navigate} onToggle={toggleAdminSidebar} collapsed={sidebarCollapsed} mobileOpen={sidebarOpen} onCloseMobile={()=>setSidebarOpen(false)} language={language} className="admin-dashboard-sidebar"/><div className={`mobile-scrim ${sidebarOpen?'visible':''}`} onClick={()=>setSidebarOpen(false)}/><main className="main-area"><DashboardHeader user={user} onNavigate={navigate} onLogout={logout} onToggleSidebar={toggleAdminSidebar} onUserChange={setUser} isAdmin={!user.role || user.role === 'admin'} sidebarExpanded={window.matchMedia('(max-width: 760px)').matches ? sidebarOpen : !sidebarCollapsed}/><div className="content">{globalError&&<div className="alert error">{globalError}<button className="dismiss" onClick={()=>setGlobalError('')}>{translate('dismiss',language)}</button></div>}{slug==='account-settings'?<DashboardSettings user={user}/>:slug==='overview'?<Overview onNavigate={navigate}/>:slug==='users'?<AdminUserManagement/>:slug==='roles'?<AdminRoleManagement/>:slug==='vendors'?<AdminVendorVerification/>:slug==='events'?<AdminEventManagement/>:slug==='hero-images'?<AdminHeroImages/>:slug==='bookings'?<AdminBookingManagement/>:slug==='payments'?<AdminPaymentManagement/>:slug==='notifications'?<AdminNotifications/>:slug==='audit-logs'?<AdminAuditLogs/>:slug==='profile'?(DEMO_AUTH_ENABLED?<DataPage slug="profile" user={user} onUserChange={setUser}/>:<AdminProfile user={user} onUserChange={setUser}/>):slug==='reports'?<Reports/>:slug==='settings'?<SettingsPage/>:<DataPage slug={slug} user={user} onUserChange={setUser}/>}</div><footer className="footer">{translate('adminDashboard',language)} <span>•</span> {translate('securePlatform',language)}</footer></main></div></>;
}
