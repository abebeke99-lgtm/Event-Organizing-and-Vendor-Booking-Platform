import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BadgeCheck, Bell, Building2, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, Clock3, ExternalLink, FileClock, MessageSquare, Search, Sparkles, Star, Trash2, X } from 'lucide-react';
import apiClient from './api/axios.js';
import { translate as translateKey, translateText as translatePhrase } from './language.js';
import { formatCustomerMoney as money } from './customerMoney.js';
import { clearComparedServices, getComparedServiceIds, getComparedVendorIds, toggleComparedService, toggleComparedVendor } from './navigationFeatureUtils.js';
import ServiceCategoriesPage from './ServiceCategoriesPage.jsx';
import { CustomerBookingsList } from './CustomerBookings.jsx';
import CustomerBookingHistory from './CustomerBookingHistory.jsx';
import './customerWorkspace.css';

const formatDate = (value) => {
  if (!value) return 'Date not set';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const statusClass = (value) => String(value || '').toLowerCase().replaceAll('_', '-');
const EMPTY_OBJECT = Object.freeze({});
const SERVICE_SORTS = new Set(['relevance', 'popular', 'newest', 'highest-rated', 'most-reviewed', 'price-low', 'price-high', 'alphabetical']);
const VENDOR_SEARCH_HISTORY_KEY = 'eventhub:customer-vendor-searches:v1';
const SERVICE_SEARCH_HISTORY_KEY = 'eventhub:customer-service-searches:v1';
const translateText = (value) => typeof value === 'string' && value.startsWith('customer')
  ? translateKey(value)
  : translatePhrase(value);

function getCustomerCatalogUrlState() {
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get('page'));
  return {
    filters: {
      search: params.get('q') || params.get('search') || '',
      category: params.get('category') || '',
      location: params.get('location') || '',
      minPrice: params.get('minPrice') || '',
      maxPrice: params.get('maxPrice') || '',
      minRating: params.get('minRating') || '',
      minReviews: params.get('minReviews') || '',
      maxReviews: params.get('maxReviews') || '',
      feature: params.get('feature') || '',
      availableOnly: params.get('availableOnly') === 'true' ? 'true' : '',
      availableDate: params.get('availableDate') || '',
      verified: params.get('verified') === 'true' ? 'true' : '',
      sort: params.get('sort') || (params.get('view') === 'services' ? 'relevance' : 'recommended'),
    },
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

function updateCustomerCatalogUrl(filters, page) {
  const params = new URLSearchParams(window.location.search);
  params.set('view', 'services');
  const queryValues = {
    q: filters.search.trim(),
    category: filters.category,
    location: filters.location.trim(),
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    minRating: filters.minRating,
    minReviews: filters.minReviews,
    maxReviews: filters.maxReviews,
    feature: filters.feature,
    availableOnly: filters.availableOnly,
    availableDate: filters.availableDate,
    sort: filters.sort,
  };
  for (const [key, value] of Object.entries(queryValues)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  params.delete('search');
  params.delete('verified');
  if (page > 1) params.set('page', String(page));
  else params.delete('page');
  const query = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

function VendorDirectoryImage({ vendor }) {
  const [failed, setFailed] = useState(false);
  const path = vendor.logoUrl || vendor.coverImageUrl;
  const baseUrl = apiClient.defaults.baseURL;
  const src = path?.startsWith('/api/') && baseUrl && !baseUrl.startsWith('/')
    ? new URL(path, baseUrl).toString()
    : path;

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) return <div className="customer-vendor-image-empty" aria-label="Vendor image unavailable"><Building2 size={26}/><span>Image unavailable</span></div>;
  return <img className="customer-vendor-image" src={src} alt={`${vendor.business_name || vendor.name} profile`} loading="lazy" onError={() => setFailed(true)} />;
}

function ServiceCatalogImage({ service }) {
  const [failed, setFailed] = useState(false);
  const path = service.images?.[0]?.url;
  const baseUrl = apiClient.defaults.baseURL;
  const src = path?.startsWith('/api/') && baseUrl && !baseUrl.startsWith('/')
    ? new URL(path, baseUrl).toString()
    : path;

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) return <div className="customer-vendor-image-empty" role="img" aria-label="Service image unavailable"><Building2 size={26}/><span>Service image unavailable</span></div>;
  return <img className="customer-vendor-image" src={src} alt={service.title} loading="lazy" onError={() => setFailed(true)} />;
}

function PageHeading({ eyebrow, title, description, action, className = '' }) {
  return <div className={`page-heading customer-workspace-heading ${className}`}><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="muted">{description}</p></div>{action}</div>;
}

function EmptyState({ children }) {
  return <div className="empty panel"><strong>{children}</strong></div>;
}

function CustomerRequestModal({ item, events, user, api, mutate, busy, onClose }) {
  const [form, setForm] = useState({
    eventId: '',
    eventName: '',
    eventDate: '',
    eventLocation: '',
    eventType: '',
    contactPhone: user.phone || '',
    guestCount: '',
    budget: '',
    notes: '',
  });
  const isBooking = item.kind === 'booking';
  const availableEvents = events.filter((event) => (
    ['active', 'published', 'upcoming', 'open'].includes(String(event.status).toLowerCase())
    && new Date(String(event.startDate || event.date || '').replace(' ', 'T')).getTime() > Date.now()
  ));
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={(event) => {
    event.preventDefault();
    const body = isBooking
      ? { eventId: Number(form.eventId), serviceId: Number(item.service.id), notes: form.notes }
      : {
        ...(form.eventId ? { eventId: Number(form.eventId) } : {}),
        serviceId: Number(item.service.id),
        eventName: form.eventName,
        eventDate: form.eventDate,
        eventLocation: form.eventLocation,
        eventType: form.eventType,
        contactPhone: form.contactPhone,
        guestCount: form.guestCount ? Number(form.guestCount) : undefined,
        budget: form.budget ? Number(form.budget) : undefined,
        requiredServices: item.service.title,
        additionalRequirements: form.notes,
        message: form.notes,
      };
    mutate(async () => {
      const result = await api(isBooking ? '/platform/bookings' : '/platform/service-quote-requests', { method: 'POST', body: JSON.stringify(body) });
      onClose();
      return result;
    }, (result) => isBooking
      ? `Booking request submitted. Current status: ${result?.data?.status || 'requested'}.`
      : `Quotation request submitted. Current status: ${result?.data?.status || 'pending vendor response'}.`);
  }}>
    <div className="modal-head"><h2>{isBooking ? 'Request a booking' : 'Request a quotation'}</h2><button className="icon-button" type="button" aria-label="Close" onClick={onClose}>×</button></div>
    <div className="modal-body"><p>{item.service.title} · {item.service.vendorName}{item.service.price != null ? ` · ${money(item.service.price, item.service.currency)}` : ''}</p>
      <label className="field"><span>Event</span><select required={isBooking} value={form.eventId} onChange={(event) => {
        const selected = availableEvents.find((entry) => Number(entry.id) === Number(event.target.value));
        setForm((current) => ({
          ...current,
          eventId: event.target.value,
          eventName: selected?.title || '',
          eventDate: String(selected?.startDate || selected?.date || '').replace(' ', 'T').slice(0, 16),
          eventLocation: selected?.location || selected?.city || '',
          eventType: selected?.type || selected?.eventType || '',
          guestCount: selected?.guestCount ?? current.guestCount,
          budget: selected?.budget ?? current.budget,
        }));
      }}><option value="">Choose an event</option>{availableEvents.map((event) => <option value={event.id} key={event.id}>{event.title} · {new Date(String(event.startDate || event.date).replace(' ', 'T')).toLocaleDateString()}</option>)}</select></label>
      {!isBooking && <>
        <label className="field"><span>Event name (optional)</span><input maxLength="180" value={form.eventName} onChange={(event) => setForm((current) => ({ ...current, eventName: event.target.value }))} /></label>
        <label className="field"><span>Event date and time</span><input required type="datetime-local" min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} value={form.eventDate} onChange={(event) => setForm((current) => ({ ...current, eventDate: event.target.value }))} /></label>
        <label className="field"><span>Event location</span><input required maxLength="120" value={form.eventLocation} onChange={(event) => setForm((current) => ({ ...current, eventLocation: event.target.value }))} /></label>
        <label className="field"><span>Event type</span><input required minLength="2" maxLength="80" value={form.eventType} onChange={(event) => setForm((current) => ({ ...current, eventType: event.target.value }))} /></label>
        <label className="field"><span>Contact phone</span><input required minLength="7" maxLength="30" pattern="\\+?[0-9][0-9 ()-]{5,28}" value={form.contactPhone} onChange={(event) => setForm((current) => ({ ...current, contactPhone: event.target.value }))} /></label>
        <label className="field"><span>Expected guests</span><input type="number" min="1" max="100000" value={form.guestCount} onChange={(event) => setForm((current) => ({ ...current, guestCount: event.target.value }))} /></label>
        <label className="field"><span>Budget (ETB)</span><input type="number" min="0" max="100000000" step="0.01" value={form.budget} onChange={(event) => setForm((current) => ({ ...current, budget: event.target.value }))} /></label>
      </>}
      <label className="field"><span>Requirements</span><textarea maxLength={isBooking ? 500 : 2000} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
      {isBooking && form.eventId && <p className="muted">Event date: {formatDate(availableEvents.find((entry) => Number(entry.id) === Number(form.eventId))?.startDate || availableEvents.find((entry) => Number(entry.id) === Number(form.eventId))?.date)}. Availability and current service pricing are verified by the booking API.</p>}
    </div>
    <div className="modal-foot"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button" type="submit" disabled={busy || (isBooking && !form.eventId) || (!isBooking && (!form.eventDate || !form.eventLocation.trim() || !form.eventType.trim() || !form.contactPhone.trim()))}>{busy ? translateText('customerSendingRequest') : isBooking ? translateText('customerBookService') : translateText('customerRequestQuotation')}</button></div>
  </form></div>;
}

function CustomerServiceDiscovery({
  feedback,
  user,
  api,
  mutate,
  busy,
  events,
  requestService,
  onCloseRequest,
  categories,
  filters,
  onChangeFilter,
  serviceSearchInput,
  onSearchInput,
  onSubmitSearch,
  onClearSearch,
  onClearFilters,
  serviceSearchHistory,
  onRememberSearch,
  catalogRows,
  catalogPage,
  catalogLoading,
  onRetry,
  serviceDisplay,
  setServiceDisplay,
  savedServiceIds,
  onToggleFavorite,
  comparedServiceIds,
  onToggleCompare,
  comparedServices,
  comparisonLoading,
  onClearCompare,
  onChangePage,
  onOpenService,
  onRequestService,
}) {
  const suggestions = [...new Set([
    ...categories.map((category) => category.name),
    ...catalogRows.flatMap((service) => [service.title, service.vendorName, service.category]),
    ...serviceSearchHistory,
  ].filter(Boolean))].filter((value) => !serviceSearchInput.trim()
    || value.toLowerCase().includes(serviceSearchInput.trim().toLowerCase())).slice(0, 10);
  const popularSearches = [...categories]
    .filter((category) => Number(category.serviceCount) > 0)
    .sort((first, second) => Number(second.serviceCount) - Number(first.serviceCount))
    .slice(0, 6);
  const activeFilters = [
    filters.search && { label: `Search: ${filters.search}`, clear: onClearSearch },
    filters.category && { label: `Category: ${filters.category}`, clear: () => onChangeFilter('category', '') },
    filters.location && { label: `Location: ${filters.location}`, clear: () => onChangeFilter('location', '') },
    filters.minPrice && { label: `Min ETB ${filters.minPrice}`, clear: () => onChangeFilter('minPrice', '') },
    filters.maxPrice && { label: `Max ETB ${filters.maxPrice}`, clear: () => onChangeFilter('maxPrice', '') },
    filters.minRating && { label: `${filters.minRating}+ stars`, clear: () => onChangeFilter('minRating', '') },
    filters.minReviews && { label: `${filters.minReviews}+ reviews`, clear: () => onChangeFilter('minReviews', '') },
    filters.maxReviews && { label: `Up to ${filters.maxReviews} reviews`, clear: () => onChangeFilter('maxReviews', '') },
    filters.feature && { label: `Feature: ${filters.feature}`, clear: () => onChangeFilter('feature', '') },
    filters.availableDate && { label: `Available ${filters.availableDate}`, clear: () => onChangeFilter('availableDate', '') },
    filters.availableOnly && !filters.availableDate && { label: translateText('customerAvailableOnly'), clear: () => onChangeFilter('availableOnly', '') },
  ].filter(Boolean);

  return <section className="customer-workspace">
    {feedback}
    <PageHeading eyebrow="DISCOVERY" title="Search services" description="Find verified services by name, features, category, provider, or location." />
    <form className="panel customer-service-search-panel" role="search" onSubmit={onSubmitSearch}>
      <label className="field"><span>{translateText('customerSearchServices')}</span><div className="customer-search"><Search size={16}/><input type="search" maxLength="120" list="customer-service-search-suggestions" value={serviceSearchInput} onChange={(event) => onSearchInput(event.target.value)} placeholder={translateText('customerSearchServicesPlaceholder')} aria-label={translateText('customerSearchServices')} /></div></label>
      <datalist id="customer-service-search-suggestions">{suggestions.map((value) => <option value={value} key={value} />)}</datalist>
      <div className="customer-service-search-actions"><button className="button" type="submit" disabled={catalogLoading}>{translateText('customerSearchButton')}</button>{serviceSearchInput && <button className="button secondary" type="button" onClick={onClearSearch} aria-label="Clear search"><X size={16}/>{translateText('customerClearSearch')}</button>}</div>
    </form>
    <div className="panel customer-catalog-filters customer-service-filters">
      <label className="field"><span>{translateText('customerCategory')}</span><select value={filters.category} onChange={(event) => onChangeFilter('category', event.target.value)}><option value="">{translateText('customerAllCategories')}</option>{categories.map((category) => <option value={category.name} key={category.id}>{category.name}</option>)}</select></label>
      <label className="field"><span>{translateText('customerLocation')}</span><input value={filters.location} maxLength="120" onChange={(event) => onChangeFilter('location', event.target.value)} placeholder={translateText('customerAnyCity')} /></label>
      <label className="field"><span>{translateText('customerMinimumPrice')} (ETB)</span><input type="number" min="0" step="0.01" value={filters.minPrice} onChange={(event) => onChangeFilter('minPrice', event.target.value)} /></label>
      <label className="field"><span>{translateText('customerMaximumPrice')} (ETB)</span><input type="number" min="0" step="0.01" value={filters.maxPrice} onChange={(event) => onChangeFilter('maxPrice', event.target.value)} /></label>
      <label className="field"><span>{translateText('customerMinimumRating')}</span><select value={filters.minRating} onChange={(event) => onChangeFilter('minRating', event.target.value)}><option value="">{translateText('customerAnyRating')}</option><option value="3">3+</option><option value="4">4+</option><option value="4.5">4.5+</option></select></label>
      <label className="field"><span>{translateText('customerMinimumReviews')}</span><input type="number" min="0" value={filters.minReviews} onChange={(event) => onChangeFilter('minReviews', event.target.value)} placeholder="0" /></label>
      <label className="field"><span>{translateText('customerMaximumReviews')}</span><input type="number" min="0" value={filters.maxReviews} onChange={(event) => onChangeFilter('maxReviews', event.target.value)} placeholder={translateText('customerNoMaximum')} /></label>
      <label className="field"><span>{translateText('customerServiceFeature')}</span><input value={filters.feature} maxLength="120" onChange={(event) => onChangeFilter('feature', event.target.value)} placeholder={translateText('customerSearchFeatures')} /></label>
      <label className="field"><span>{translateText('customerAvailableOn')}</span><input type="date" min={new Date().toISOString().slice(0, 10)} value={filters.availableDate} onChange={(event) => onChangeFilter('availableDate', event.target.value)} /></label>
      <label className="field"><span>{translateText('customerAvailability')}</span><select value={filters.availableOnly} onChange={(event) => onChangeFilter('availableOnly', event.target.value)}><option value="">{translateText('customerAnyAvailability')}</option><option value="true">{translateText('customerAvailableOnly')}</option></select></label>
      <label className="field"><span>{translateText('customerSortBy')}</span><select value={filters.sort} onChange={(event) => onChangeFilter('sort', event.target.value)}><option value="relevance">{translateText('customerSortRelevant')}</option><option value="highest-rated">{translateText('customerSortHighestRated')}</option><option value="most-reviewed">{translateText('customerSortMostReviewed')}</option><option value="price-low">{translateText('customerSortPriceLow')}</option><option value="price-high">{translateText('customerSortPriceHigh')}</option><option value="newest">{translateText('customerSortNewest')}</option><option value="popular">{translateText('customerSortPopular')}</option></select></label>
      <div className="customer-service-filter-actions"><span className="customer-directory-scope"><BadgeCheck size={15}/>{translateText('customerVerifiedServicesOnly')}</span><button className="button small" type="button" onClick={onRetry}>{translateText('customerApplyFilters')}</button><button className="button secondary small" type="button" onClick={onClearFilters} disabled={!activeFilters.length && filters.sort === 'relevance'}>{translateText('customerClearFilters')}</button></div>
    </div>
    <div className="customer-service-discovery-bar">
      {popularSearches.length > 0 && <div className="customer-service-keywords"><strong>{translateText('customerPopularSearches')}</strong>{popularSearches.map((category) => <button className="customer-category-chip" type="button" key={category.id} onClick={() => onChangeFilter('category', category.name)}>{category.name}</button>)}</div>}
      {serviceSearchHistory.length > 0 && <div className="customer-service-keywords"><strong>{translateText('customerRecentSearches')}</strong>{serviceSearchHistory.slice(0, 5).map((term) => <button className="customer-category-chip" type="button" key={term} onClick={() => { onSearchInput(term); onRememberSearch(term); }}>{term}</button>)}</div>}
    </div>
    {activeFilters.length > 0 && <div className="customer-active-filters" aria-label={translateText('customerActiveFilters')}><strong>{translateText('customerActiveFilters')}</strong>{activeFilters.map((filter) => <button type="button" className="customer-active-filter" key={filter.label} onClick={filter.clear}>{filter.label}<X size={13}/></button>)}</div>}
    <div className="customer-vendor-results-bar"><span>{catalogPage.total} {translateText('customerServiceResults')}</span><div className="customer-vendor-results-actions"><button className="button secondary small" type="button" disabled={comparedServiceIds.length === 0} onClick={() => document.getElementById('customer-service-comparison')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{translateText('customerCompareServices')} ({comparedServiceIds.length}/4)</button><button className={`button secondary small ${serviceDisplay === 'grid' ? 'active' : ''}`} type="button" aria-pressed={serviceDisplay === 'grid'} onClick={() => setServiceDisplay('grid')}>{translateText('customerGridView')}</button><button className={`button secondary small ${serviceDisplay === 'list' ? 'active' : ''}`} type="button" aria-pressed={serviceDisplay === 'list'} onClick={() => setServiceDisplay('list')}>{translateText('customerListView')}</button></div></div>
    {catalogLoading
      ? <div className="customer-service-skeletons" role="status" aria-label={translateText('customerLoadingServices')}>{[1, 2, 3].map((item) => <div className="panel customer-service-skeleton" key={item}><span/><span/><span/></div>)}</div>
      : catalogRows.length
        ? <div className={`customer-catalog-grid${serviceDisplay === 'list' ? ' customer-catalog-list' : ''}`}>{catalogRows.map((service) => {
          const features = [...new Set((service.packages || []).flatMap((item) => item.includedFeatures || []))].filter((feature) => typeof feature === 'string').slice(0, 3);
          const isSaved = savedServiceIds.includes(Number(service.id));
          const isCompared = comparedServiceIds.includes(Number(service.id));
          return <article className="panel customer-catalog-card customer-service-card" key={service.id}>
            <ServiceCatalogImage service={service}/>
            <div className="customer-catalog-card-content">
              <div className="customer-vendor-card-badges"><span className="pill">{service.category || translateText('customerUncategorizedService')}</span>{service.verified && <span className="customer-verified-badge"><BadgeCheck size={13}/>{translateText('customerVerified')}</span>}</div>
              <h3>{service.title}</h3>
              <p className="customer-vendor-category">{service.vendorName}</p>
              <p className="customer-vendor-location">{service.city || translateText('customerLocationNotListed')}</p>
              <p className="customer-vendor-description">{service.description || translateText('customerNoServiceDescription')}</p>
              {service.reviewCount > 0
                ? <p className="customer-vendor-rating"><Star size={13} fill="currentColor"/>{Number(service.rating).toFixed(1)} / 5 · {service.reviewCount} {translateText('customerReviews')}</p>
                : <p className="customer-no-reviews">{translateText('customerNoReviews')}</p>}
              <div className="customer-vendor-card-price"><small>{translateText('customerServicePrice')}</small><strong>{service.price === null || service.price === undefined ? translateText('customerPriceOnRequest') : money(service.price, service.currency)}</strong></div>
              {service.available && <span className="customer-availability-badge"><Check size={13}/>{filters.availableDate ? `${translateText('customerAvailablePrefix')} ${filters.availableDate}` : translateText('customerAvailabilityListed')}</span>}
              {features.length > 0 && <div className="customer-service-features">{features.map((feature) => <span key={feature}>{feature}</span>)}</div>}
            </div>
            <div className="customer-catalog-actions">
              <button className="button secondary small" type="button" onClick={() => onOpenService(service.id)}>{translateText('customerViewDetails')}</button>
              <button className="button secondary small" type="button" aria-pressed={isSaved} disabled={busy} onClick={() => onToggleFavorite(service)}>{isSaved ? translateText('customerSaved') : translateText('customerSaveService')}</button>
              <button className="button secondary small" type="button" aria-pressed={isCompared} onClick={() => onToggleCompare(service.id)}>{isCompared ? translateText('customerRemoveCompare') : translateText('customerCompareServices')}</button>
              <button className="button secondary small" type="button" onClick={() => onRequestService({ kind: 'quote', service })}>{translateText('customerRequestQuotation')}</button>
              <button className="button small" type="button" onClick={() => onRequestService({ kind: 'booking', service })}>{translateText('customerBookService')}</button>
            </div>
          </article>;
        })}</div>
        : <div className="customer-vendor-empty"><EmptyState>{catalogPage.total ? translateText('customerNoServicesPage') : translateText('customerNoMatchingServices')}</EmptyState>{activeFilters.length > 0 && <button className="button secondary small" type="button" onClick={onClearFilters}>{translateText('customerClearFilters')}</button>}</div>}
    {!catalogLoading && catalogRows.length > 0 && <div className="pagination-row"><span>{catalogPage.total} {translateText('customerServiceResults')}</span><button className="button secondary small" type="button" disabled={catalogPage.page <= 1} onClick={() => onChangePage(catalogPage.page - 1)}><ChevronLeft size={16}/>{translateText('customerPrevious')}</button><span>{translateText('customerPage')} {catalogPage.page} {translateText('customerOf')} {catalogPage.totalPages}</span><button className="button secondary small" type="button" disabled={catalogPage.page >= catalogPage.totalPages} onClick={() => onChangePage(catalogPage.page + 1)}>{translateText('customerNext')} <ChevronRight size={16}/></button></div>}
    <section className="panel customer-service-comparison" id="customer-service-comparison"><div className="panel-header"><h3>{translateText('customerServiceComparison')}</h3><button className="button secondary small" type="button" disabled={!comparedServiceIds.length} onClick={onClearCompare}>{translateText('customerClearComparison')}</button></div>
      {comparisonLoading ? <div className="loading" role="status"><span className="spinner"/>{translateText('customerLoadingComparison')}</div>
        : comparedServices.length > 0 ? <div className="customer-comparison-scroll"><table className="customer-comparison-table"><thead><tr><th>{translateText('customerCompareAttribute')}</th>{comparedServices.map((service) => <th key={service.id}><button className="text-action" type="button" onClick={() => onOpenService(service.id)}>{service.title}</button><button className="customer-comparison-remove" type="button" aria-label={`${translateText('customerRemove')} ${service.title}`} onClick={() => onToggleCompare(service.id)}><X size={14}/></button></th>)}</tr></thead><tbody>
        {[
          [translateText('customerVendor'), (service) => service.vendorName || '—'],
          [translateText('customerCategory'), (service) => service.category || '—'],
          [translateText('customerServicePrice'), (service) => service.price == null ? translateText('customerPriceOnRequest') : money(service.price, service.currency)],
          [translateText('customerRating'), (service) => service.reviewCount > 0 ? `${Number(service.rating).toFixed(1)} / 5` : translateText('customerNoReviews')],
          [translateText('customerReviewCount'), (service) => String(service.reviewCount || 0)],
          [translateText('customerLocation'), (service) => service.city || '—'],
          [translateText('customerAvailability'), (service) => service.available ? translateText('customerAvailabilityListed') : translateText('customerAvailabilityNotListed')],
          [translateText('customerFeatures'), (service) => [...new Set((service.packages || []).flatMap((item) => item.includedFeatures || []))].join(', ') || '—'],
          [translateText('customerPackages'), (service) => (service.packages || []).map((item) => `${item.name}: ${money(item.price, item.currency)}`).join('; ') || '—'],
        ].map(([label, valueFor]) => <tr key={label}><th scope="row">{label}</th>{comparedServices.map((service) => <td key={service.id}>{valueFor(service)}</td>)}</tr>)}
      </tbody></table></div>
        : <p className="muted">{translateText('customerNoServicesCompared')}</p>}
    </section>
    {requestService && <CustomerRequestModal item={requestService} events={events} user={user} api={api} mutate={mutate} busy={busy} onClose={onCloseRequest} />}
  </section>;
}

export default function CustomerWorkspace({ view, data = {}, api, user = {}, onNavigate, onNavigatePublic, onRefresh, onUserChange }) {
  const categories = Array.isArray(data?.categories) ? data.categories.filter(Boolean) : [];
  const services = Array.isArray(data?.services) ? data.services.filter(Boolean) : [];
  const bookings = Array.isArray(data?.bookings) ? data.bookings.filter(Boolean) : [];
  const events = Array.isArray(data?.events) ? data.events.filter(Boolean) : [];
  const favorites = Array.isArray(data?.favorites) ? data.favorites.filter(Boolean) : [];
  const savedServices = Array.isArray(data?.['saved-services']) ? data['saved-services'].filter(Boolean) : [];
  const quotations = Array.isArray(data?.quotations) ? data.quotations.filter(Boolean) : [];
  const payments = Array.isArray(data?.payments) ? data.payments.filter(Boolean) : [];
  const refunds = Array.isArray(data?.refunds) ? data.refunds.filter(Boolean) : [];
  const messages = Array.isArray(data?.messages) ? data.messages.filter(Boolean) : [];
  const reviews = Array.isArray(data?.reviews) ? data.reviews.filter(Boolean) : [];
  const notifications = Array.isArray(data?.notifications) ? data.notifications.filter(Boolean) : [];
  const profile = data?.profile ?? EMPTY_OBJECT;
  const overview = data?.overview ?? EMPTY_OBJECT;
  const [busy, setBusy] = useState(false);
  const [comparisonSelection] = useState(() => {
    try { return { ids: getComparedVendorIds(), error: '' }; }
    catch (issue) { return { ids: [], error: issue.message || 'Saved comparison data could not be read.' }; }
  });
  const [serviceComparisonSelection] = useState(() => {
    try { return { ids: getComparedServiceIds(), error: '' }; }
    catch (issue) { return { ids: [], error: issue.message || 'Saved service comparison data could not be read.' }; }
  });
  const [comparedVendorIds, setComparedVendorIds] = useState(comparisonSelection.ids);
  const [comparedServiceIds, setComparedServiceIds] = useState(serviceComparisonSelection.ids);
  const [comparedServices, setComparedServices] = useState([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [error, setError] = useState(comparisonSelection.error || serviceComparisonSelection.error);
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(() => getCustomerCatalogUrlState().filters);
  const [catalogRows, setCatalogRows] = useState([]);
  const [catalogPage, setCatalogPage] = useState(() => ({ ...getCustomerCatalogUrlState(), total: 0, totalPages: 1, limit: 12 }));
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [serviceSearchInput, setServiceSearchInput] = useState(() => getCustomerCatalogUrlState().filters.search);
  const [vendorSearchInput, setVendorSearchInput] = useState(() => getCustomerCatalogUrlState().filters.search);
  const [vendorSearchHistory, setVendorSearchHistory] = useState([]);
  const [serviceSearchHistory, setServiceSearchHistory] = useState([]);
  const [vendorDisplay, setVendorDisplay] = useState('grid');
  const [serviceDisplay, setServiceDisplay] = useState('grid');
  const [catalogReload, setCatalogReload] = useState(0);
  const [eventForm, setEventForm] = useState({ title: '', type: '', description: '', city: '', venue: '', startDate: '', endDate: '', guestCount: '', budget: '', capacity: '', notes: '', coverImageUrl: '' });
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [requestService, setRequestService] = useState(null);
  const [savedServiceIds, setSavedServiceIds] = useState(() => savedServices.map((service) => Number(service.id)));
  const [requestForm, setRequestForm] = useState({ eventId: '', guestCount: '', budget: '', notes: '' });
  const [quoteReasons, setQuoteReasons] = useState({});
  const [messageForm, setMessageForm] = useState({ bookingId: '', body: '' });
  const [reviewForm, setReviewForm] = useState(() => ({
    bookingId: new URLSearchParams(window.location.search).get('view') === 'reviews'
      ? new URLSearchParams(window.location.search).get('bookingId') || ''
      : '',
    rating: '5',
    comment: '',
  }));
  const [refundForm, setRefundForm] = useState(null);
  const [profileForm, setProfileForm] = useState({ fullName: profile.fullName || user.full_name || user.name || '', phone: profile.phone || user.phone || '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });

  useEffect(() => {
    setProfileForm({ fullName: profile.fullName || user.full_name || user.name || '', phone: profile.phone || user.phone || '' });
  }, [profile, user.full_name, user.name, user.phone]);

  useEffect(() => {
    setSavedServiceIds(savedServices.map((service) => Number(service.id)));
  }, [data?.['saved-services']]);

  useEffect(() => {
    if (view !== 'services') return undefined;
    const syncServiceSearch = () => {
      if (new URLSearchParams(window.location.search).get('view') !== 'services') return;
      const state = getCustomerCatalogUrlState();
      setFilters((current) => Object.keys(state.filters).every((key) => current[key] === state.filters[key])
        ? current
        : { ...current, ...state.filters });
      setServiceSearchInput((current) => current === state.filters.search ? current : state.filters.search);
      setCatalogPage((current) => current.page === state.page ? current : { ...current, page: state.page });
    };
    if (new URLSearchParams(window.location.search).get('view') === 'services') syncServiceSearch();
    else updateCustomerCatalogUrl(filters, catalogPage.page);
    window.addEventListener('popstate', syncServiceSearch);
    return () => window.removeEventListener('popstate', syncServiceSearch);
  }, [view]);

  useEffect(() => {
    if (view !== 'vendors') return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      setFilters((current) => current.search === vendorSearchInput
        ? current
        : { ...current, search: vendorSearchInput });
      setCatalogPage((current) => current.page === 1 ? current : { ...current, page: 1 });
    }, 300);
    try {
      const saved = window.localStorage.getItem(VENDOR_SEARCH_HISTORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
          throw new Error('Saved vendor search history is invalid.');
        }
        if (active) setVendorSearchHistory(parsed.slice(0, 6));
      }
    } catch (issue) {
      if (active) setError(issue.message || 'Vendor search history could not be loaded.');
    }
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [view, vendorSearchInput]);

  useEffect(() => {
    if (view !== 'services') return undefined;
    try {
      const saved = window.localStorage.getItem(SERVICE_SEARCH_HISTORY_KEY);
      if (!saved) {
        setServiceSearchHistory([]);
        return undefined;
      }
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new Error('Saved service search history is invalid.');
      }
      setServiceSearchHistory(parsed.slice(0, 6));
    } catch (issue) {
      setError(issue.message || 'Service search history could not be loaded.');
    }
    return undefined;
  }, [view]);

  useEffect(() => {
    if (view !== 'services' || serviceSearchInput.trim() === filters.search) return undefined;
    const timer = window.setTimeout(() => {
      const search = serviceSearchInput.trim();
      const nextFilters = { ...filters, search };
      setFilters(nextFilters);
      setCatalogPage((current) => ({ ...current, page: 1 }));
      updateCustomerCatalogUrl(nextFilters, 1);
      if (search) {
        try {
          const history = [search, ...serviceSearchHistory.filter((item) => item.toLowerCase() !== search.toLowerCase())].slice(0, 6);
          window.localStorage.setItem(SERVICE_SEARCH_HISTORY_KEY, JSON.stringify(history));
          setServiceSearchHistory(history);
        } catch (issue) {
          setError(issue.message || 'Service search history could not be saved.');
        }
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [filters, serviceSearchHistory, serviceSearchInput, view]);

  useEffect(() => {
    if (view !== 'services' || comparedServiceIds.length === 0) {
      setComparedServices([]);
      return undefined;
    }
    let active = true;
    setComparisonLoading(true);
    api(`/platform/services?ids=${comparedServiceIds.join(',')}&limit=4`)
      .then((response) => {
        if (active) setComparedServices(response?.data || []);
      })
      .catch((issue) => {
        if (active) setError(issue.response?.data?.error || issue.message || 'Compared services could not be loaded.');
      })
      .finally(() => {
        if (active) setComparisonLoading(false);
      });
    return () => { active = false; };
  }, [api, comparedServiceIds, view]);

  useEffect(() => {
    if (!['vendors', 'services'].includes(view)) return undefined;
    let active = true;
    async function loadCatalog() {
      setCatalogLoading(true);
      setError('');
      try {
        const sort = view === 'services' && !SERVICE_SORTS.has(filters.sort)
          ? 'relevance'
          : view === 'vendors' && !['recommended', 'popular', 'highest-rated', 'most-reviewed', 'price-low', 'price-high', 'name-az', 'recently-added'].includes(filters.sort)
            ? 'recommended'
            : filters.sort;
        const params = new URLSearchParams({ page: String(catalogPage.page || 1), limit: '12', sort });
        if (filters.search.trim()) params.set('search', filters.search.trim());
        if (filters.category) params.set('category', filters.category);
        if (filters.location.trim()) params.set('location', filters.location.trim());
        if (filters.minPrice !== '') params.set('minPrice', filters.minPrice);
        if (filters.maxPrice !== '') params.set('maxPrice', filters.maxPrice);
        if (filters.minRating !== '') params.set('minRating', filters.minRating);
        if (view === 'services' && filters.minReviews !== '') params.set('minReviews', filters.minReviews);
        if (view === 'services' && filters.maxReviews !== '') params.set('maxReviews', filters.maxReviews);
        if (view === 'services' && filters.feature.trim()) params.set('feature', filters.feature.trim());
        if (view === 'vendors' && filters.verified) params.set('verified', filters.verified);
        if (filters.availableOnly) params.set('availableOnly', filters.availableOnly);
        if (filters.availableDate) params.set('availableDate', filters.availableDate);
        if (view === 'vendors' && filters.featured) params.set('filter', 'featured');
        const response = await api(`/customer/${view}?${params}`);
        if (!active) return;
        setCatalogRows(Array.isArray(response?.data) ? response.data.filter(Boolean) : []);
        const pageInfo = response?.pagination && typeof response.pagination === 'object' ? response.pagination : {};
        const resultPage = Number(pageInfo.page ?? 1) || 1;
        setCatalogPage({
          page: resultPage,
          total: Number(pageInfo.total ?? 0) || 0,
          totalPages: Number(pageInfo.totalPages ?? 1) || 1,
          limit: Number(pageInfo.limit ?? 12) || 12,
        });
        if (view === 'services' && resultPage !== catalogPage.page) updateCustomerCatalogUrl(filters, resultPage);
      } catch (issue) {
        if (active) setError(issue.response?.data?.error || issue.message || 'The catalog could not be loaded.');
      } finally {
        if (active) setCatalogLoading(false);
      }
    }
    loadCatalog();
    return () => { active = false; };
  }, [api, catalogPage.page, catalogReload, filters, view]);

  async function mutate(action, message) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      setNotice(typeof message === 'function' ? message(result) : message);
      onRefresh();
      return result;
    } catch (issue) {
      setError(issue.response?.data?.error || issue.message || 'The request could not be completed.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const feedback = <>{error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}</>;
  const changeFilter = (key, value) => {
    setCatalogPage((current) => ({ ...current, page: 1 }));
    const nextFilters = {
      ...filters,
      [key]: value,
      ...(key === 'availableDate' && view === 'services' ? { availableOnly: value ? 'true' : '' } : {}),
      ...(key === 'availableOnly' && view === 'services' && !value ? { availableDate: '' } : {}),
    };
    setFilters(nextFilters);
    if (view === 'services') updateCustomerCatalogUrl(nextFilters, 1);
  };

  function rememberServiceSearch(value) {
    const search = String(value || '').trim();
    if (!search) return;
    try {
      const history = [search, ...serviceSearchHistory.filter((item) => item.toLowerCase() !== search.toLowerCase())].slice(0, 6);
      window.localStorage.setItem(SERVICE_SEARCH_HISTORY_KEY, JSON.stringify(history));
      setServiceSearchHistory(history);
    } catch (issue) {
      setError(issue.message || 'Service search history could not be saved.');
    }
  }

  function submitServiceSearch(event) {
    event.preventDefault();
    const nextFilters = { ...filters, search: serviceSearchInput.trim() };
    setFilters(nextFilters);
    setCatalogPage((current) => ({ ...current, page: 1 }));
    updateCustomerCatalogUrl(nextFilters, 1);
    rememberServiceSearch(nextFilters.search);
  }

  function clearServiceSearch() {
    const nextFilters = { ...filters, search: '' };
    setServiceSearchInput('');
    setFilters(nextFilters);
    setCatalogPage((current) => ({ ...current, page: 1 }));
    updateCustomerCatalogUrl(nextFilters, 1);
  }

  function clearServiceFilters() {
    const cleared = {
      search: '',
      category: '',
      location: '',
      minPrice: '',
      maxPrice: '',
      minRating: '',
      minReviews: '',
      maxReviews: '',
      feature: '',
      availableOnly: '',
      availableDate: '',
      verified: '',
      sort: 'relevance',
    };
    setServiceSearchInput('');
    setFilters(cleared);
    setCatalogPage((current) => ({ ...current, page: 1 }));
    updateCustomerCatalogUrl(cleared, 1);
  }

  function toggleServiceComparison(serviceId) {
    try {
      const result = toggleComparedService(serviceId);
      setComparedServiceIds(result.ids);
      setError(result.limitReached ? 'You can compare up to four services at a time.' : '');
    } catch (issue) {
      setError(issue.message || 'Service comparison could not be updated.');
    }
  }

  function clearServiceComparison() {
    try {
      clearComparedServices();
      setComparedServiceIds([]);
      setComparedServices([]);
      setError('');
    } catch (issue) {
      setError(issue.message || 'Service comparison could not be cleared.');
    }
  }

  function toggleServiceFavorite(service) {
    const serviceId = Number(service.id);
    const isSaved = savedServiceIds.includes(serviceId);
    return mutate(async () => {
      const result = await api(isSaved ? `/customer/saved-services/${serviceId}` : '/customer/saved-services', {
        method: isSaved ? 'DELETE' : 'POST',
        ...(isSaved ? {} : { body: JSON.stringify({ serviceId }) }),
      });
      setSavedServiceIds((current) => isSaved
        ? current.filter((id) => id !== serviceId)
        : [...new Set([...current, serviceId])]);
      return result;
    }, isSaved ? 'Service removed from saved services.' : 'Service saved to your favorites.');
  }

  function changeCatalogPage(page) {
    setCatalogPage((current) => ({ ...current, page }));
    if (view === 'services') updateCustomerCatalogUrl(filters, page);
  }

  async function saveEvent(event) {
    event.preventDefault();
    const body = {
      ...eventForm,
      title: eventForm.title.trim(),
      type: eventForm.type.trim(),
      guestCount: eventForm.guestCount === '' ? null : Number(eventForm.guestCount),
      budget: eventForm.budget === '' ? null : Number(eventForm.budget),
      capacity: eventForm.capacity === '' ? null : Number(eventForm.capacity),
      endDate: eventForm.endDate || null,
    };
    await mutate(async () => {
      await api(editingEventId ? `/platform/events/${editingEventId}` : '/platform/events', {
        method: editingEventId ? 'PATCH' : 'POST', body: JSON.stringify(body),
      });
      setEventFormOpen(false);
      setEditingEventId(null);
      setEventForm({ title: '', type: '', description: '', city: '', venue: '', startDate: '', endDate: '', guestCount: '', budget: '', capacity: '', notes: '', coverImageUrl: '' });
    }, editingEventId ? 'Event updated.' : 'Event saved as a draft.');
  }

  function startEditEvent(event) {
    setEditingEventId(event.id);
    setEventForm({
      title: event.title || '', type: event.type || '', description: event.description || '', city: event.location || event.city || '',
      venue: event.venue || '', startDate: String(event.startDate || event.date || '').replace(' ', 'T').slice(0, 16),
      endDate: String(event.endDate || '').replace(' ', 'T').slice(0, 16), guestCount: event.guestCount ?? '',
      budget: event.budget ?? '', capacity: event.capacity ?? '', notes: event.notes || '', coverImageUrl: event.coverImage || '',
    });
    setEventFormOpen(true);
  }

  function requestVendorMutation(vendorId) {
    return mutate(() => api('/customer/favorites', { method: 'POST', body: JSON.stringify({ vendorId: Number(vendorId) }) }), 'Vendor added to wishlist.');
  }

  function toggleVendorFavorite(vendor) {
    const saved = favorites.some((favorite) => Number(favorite.id) === Number(vendor.id));
    if (saved) {
      return mutate(() => api(`/customer/favorites/${vendor.id}`, { method: 'DELETE' }), 'Vendor removed from wishlist.');
    }
    return requestVendorMutation(vendor.id);
  }

  function rememberVendorSearch(value) {
    const search = String(value || '').trim();
    if (!search) return;
    try {
      const history = [search, ...vendorSearchHistory.filter((item) => item.toLowerCase() !== search.toLowerCase())].slice(0, 6);
      window.localStorage.setItem(VENDOR_SEARCH_HISTORY_KEY, JSON.stringify(history));
      setVendorSearchHistory(history);
    } catch (issue) {
      setError(issue.message || 'Vendor search history could not be saved.');
    }
  }

  function toggleVendorComparison(vendorId) {
    try {
      const result = toggleComparedVendor(vendorId);
      setComparedVendorIds(result.ids);
      if (result.limitReached) setError('You can compare up to four vendors at a time.');
      else setError('');
    } catch (issue) {
      setError(issue.message || 'Vendor comparison could not be updated.');
    }
  }

  if (view === 'overview') {
    const upcomingEvents = events
      .filter((event) => String(event.status || '').toLowerCase() !== 'cancelled')
      .map((event) => ({ ...event, scheduledAt: new Date(String(event.startDate || event.date || '').replace(' ', 'T')) }))
      .filter((event) => !Number.isNaN(event.scheduledAt.getTime()) && event.scheduledAt.getTime() >= Date.now())
      .sort((first, second) => first.scheduledAt - second.scheduledAt)
      .slice(0, 4);
    const summaryCards = [
      ['Total bookings', overview.totalBookings, ClipboardList, 'View all requests', 'bookings'],
      ['Pending bookings', overview.pendingBookings, Clock3, 'Awaiting a decision', 'bookings'],
      ['Confirmed bookings', overview.confirmedBookings, BadgeCheck, 'Accepted or in progress', 'bookings'],
      ['Upcoming events', overview.upcomingEvents, CalendarDays, 'Your scheduled events', 'events'],
      ['Pending quotations', overview.pendingQuotations, FileClock, 'Review vendor quotes', 'quotations'],
    ];

    return <section className="customer-workspace">{feedback}
      <PageHeading className="customer-overview-heading" eyebrow="YOUR EVENT SPACE" title={`Welcome, ${user.full_name || user.name || 'Customer'}`} description="Everything you need to plan, book, and keep up with your events." action={<button className="button customer-overview-cta" type="button" onClick={() => onNavigate('services')}><Sparkles size={16}/>Discover services<ArrowUpRight size={15}/></button>} />
      <div className="metric-grid customer-overview-metrics">{summaryCards.map(([label, value, Icon, description, target]) => <button className="metric-card customer-overview-stat" key={label} type="button" onClick={() => onNavigate(target)} aria-label={`${label}: ${value ?? 0}. ${description}`}><span className="customer-overview-stat-icon"><Icon size={18}/></span><span className="customer-overview-stat-copy"><span className="customer-overview-stat-label">{label}</span><strong>{value ?? 0}</strong><span className="customer-overview-stat-detail">{description}</span></span><ArrowUpRight className="customer-overview-stat-arrow" size={16}/></button>)}</div>
      <div className="customer-overview-grid">
        <section className="panel customer-overview-panel">
          <div className="panel-header"><h3><CalendarDays size={17}/>Upcoming events</h3><button className="button secondary small" type="button" onClick={() => onNavigate('events')}>View events</button></div>
          {upcomingEvents.length ? <div className="customer-overview-list">{upcomingEvents.map((event) => <article className="customer-overview-item" key={event.id}><span className="customer-overview-item-icon"><CalendarDays size={17}/></span><div><strong>{event.title}</strong><small>{[event.type, event.city || event.location].filter(Boolean).join(' · ') || 'Event'} · {formatDate(event.startDate || event.date)}</small></div><span className={`pill ${statusClass(event.status)}`}>{event.status}</span></article>)}</div> : <EmptyState>No upcoming events.</EmptyState>}
        </section>
        <section className="panel customer-overview-panel">
          <div className="panel-header"><h3><ClipboardList size={17}/>Recent bookings</h3><button className="button secondary small" type="button" onClick={() => onNavigate('bookings')}>View bookings</button></div>
          {bookings.length ? <div className="customer-overview-list">{bookings.slice(0, 5).map((booking) => <article className="customer-overview-item" key={booking.id}><span className="customer-overview-item-icon"><ClipboardList size={17}/></span><div><strong>{booking.serviceTitle}</strong><small>{booking.reference} · {booking.eventTitle || 'Event'} · {formatDate(booking.eventDate)}</small></div><span className={`pill ${statusClass(booking.status)}`}>{booking.status}</span></article>)}</div> : <EmptyState>No bookings yet. Browse services to get started.</EmptyState>}
        </section>
        <section className="panel customer-overview-panel">
          <div className="panel-header"><h3><MessageSquare size={17}/>Recent messages</h3><button className="button secondary small" type="button" onClick={() => onNavigate('messages')}>View messages</button></div>
          {messages.length ? <div className="customer-overview-list">{messages.slice(0, 4).map((message) => <article className="customer-overview-item" key={message.id}><span className="customer-overview-item-icon"><MessageSquare size={17}/></span><div><strong>{message.vendor || message.sender || 'Message'}{message.event ? ` · ${message.event}` : ''}</strong><small>{message.subject || message.body}</small></div><span className={`pill ${message.read ? 'inactive' : 'active'}`}>{message.read ? 'Read' : 'Unread'}</span></article>)}</div> : <EmptyState>No recent messages.</EmptyState>}
        </section>
        <section className="panel customer-overview-panel">
          <div className="panel-header"><h3><Sparkles size={17}/>Recommended vendors</h3><button className="button secondary small" type="button" onClick={() => onNavigate('vendors')}>Browse vendors</button></div>
          {Array.isArray(data.vendors) && data.vendors.length ? <div className="customer-overview-list">{data.vendors.slice(0, 4).map((vendor) => <article className="customer-overview-item" key={vendor.id}><span className="customer-overview-item-icon customer-vendor-avatar">{String(vendor.business_name || vendor.name || 'V').trim().charAt(0).toUpperCase()}</span><div><strong>{vendor.business_name || vendor.name}</strong><small>{[vendor.category, vendor.city].filter(Boolean).join(' · ')}</small></div>{Number(vendor.rating) > 0 && <span className="customer-vendor-rating"><Star size={13} fill="currentColor"/>{Number(vendor.rating).toFixed(1)}</span>}</article>)}</div> : <EmptyState>No recommended vendors are available.</EmptyState>}
        </section>
        <section className="panel customer-overview-panel">
          <div className="panel-header"><h3><Bell size={17}/>Recent notifications</h3><button className="button secondary small" type="button" onClick={() => onNavigate('notifications')}>View all</button></div>
          {notifications.length ? <div className="customer-overview-list">{notifications.slice(0, 5).map((item) => <article className="customer-overview-item" key={item.id}><span className="customer-overview-item-icon"><Bell size={17}/></span><div><strong>{item.title}</strong><small>{item.message}</small></div><span className={`pill ${item.read ? 'inactive' : 'active'}`}>{item.read ? 'Read' : 'New'}</span></article>)}</div> : <EmptyState>No notifications.</EmptyState>}
        </section>
      </div>
      <section className="panel customer-overview-panel customer-discovery-panel"><div className="panel-header"><h3><Sparkles size={17}/>Quick discovery</h3><button className="button secondary small" type="button" onClick={() => onNavigate('categories')}>Service categories</button></div><div className="customer-quick-services">{services.slice(0, 4).map((service) => <article className="customer-service-card" key={service.id}><strong>{service.title}</strong><small>{service.vendorName} · {service.category}</small><span>{money(service.price, service.currency)}</span><button className="button secondary small" type="button" onClick={() => onNavigate('services')}>View services</button></article>)}</div>{!services.length && <EmptyState>No published services are available.</EmptyState>}</section>
    </section>;
  }

  if (view === 'categories') {
    return <ServiceCategoriesPage api={api} onNavigate={onNavigatePublic} />;
  }

  if (view === 'vendors' || view === 'services') {
    const isVendors = view === 'vendors';
    const categoryOptions = categories;
    if (!isVendors) {
      return <CustomerServiceDiscovery
        feedback={feedback}
        user={user}
        api={api}
        mutate={mutate}
        busy={busy}
        events={events}
        requestService={requestService}
        onCloseRequest={() => setRequestService(null)}
        categories={categoryOptions}
        filters={filters}
        onChangeFilter={changeFilter}
        serviceSearchInput={serviceSearchInput}
        onSearchInput={setServiceSearchInput}
        onSubmitSearch={submitServiceSearch}
        onClearSearch={clearServiceSearch}
        onClearFilters={clearServiceFilters}
        serviceSearchHistory={serviceSearchHistory}
        onRememberSearch={rememberServiceSearch}
        catalogRows={catalogRows}
        catalogPage={catalogPage}
        catalogLoading={catalogLoading}
        onRetry={() => setCatalogReload((current) => current + 1)}
        serviceDisplay={serviceDisplay}
        setServiceDisplay={setServiceDisplay}
        savedServiceIds={savedServiceIds}
        onToggleFavorite={toggleServiceFavorite}
        comparedServiceIds={comparedServiceIds}
        onToggleCompare={toggleServiceComparison}
        comparedServices={comparedServices}
        comparisonLoading={comparisonLoading}
        onClearCompare={clearServiceComparison}
        onChangePage={changeCatalogPage}
        onOpenService={(serviceId) => onNavigatePublic(`/services/${serviceId}`)}
        onRequestService={setRequestService}
      />;
    }
    return <section className="customer-workspace">{feedback}<PageHeading eyebrow="DISCOVERY" title={isVendors ? 'Browse vendors' : 'Search services'} description="Search, compare, save, and request a service for one of your events." />
      <div className="panel customer-catalog-filters">
        {isVendors
          ? <label className="field customer-vendor-search-field"><span>{translateText('customerSearchVendorsServices')}</span><div className="customer-search"><Search size={16}/><input type="search" list="customer-vendor-search-suggestions" value={vendorSearchInput} onChange={(event) => setVendorSearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') rememberVendorSearch(vendorSearchInput); }} placeholder={translateText('customerSearchVendorPlaceholder')} aria-label={translateText('customerSearchVendorsServices')} />{vendorSearchInput && <button className="customer-search-clear" type="button" aria-label="Clear search" onClick={() => { setVendorSearchInput(''); rememberVendorSearch(''); }}><X size={15}/></button>}</div><datalist id="customer-vendor-search-suggestions">{vendorSearchHistory.map((term) => <option value={term} key={`history-${term}`} />)}{categoryOptions.map((category) => <option value={category.name} key={`category-${category.id}`} />)}</datalist></label>
          : <form className="customer-service-search" role="search" onSubmit={submitServiceSearch}>
            <label className="field"><span>Search services</span><div className="customer-search"><Search size={16}/><input type="search" maxLength="120" value={serviceSearchInput} onChange={(event) => setServiceSearchInput(event.target.value)} placeholder="Name, category, vendor, description, or city" /></div></label>
            <div className="customer-service-search-actions"><button className="button" type="submit" disabled={catalogLoading}>Search</button>{serviceSearchInput && <button className="button secondary" type="button" onClick={clearServiceSearch} aria-label="Clear search" title="Clear search"><X size={16}/>Clear</button>}</div>
          </form>}
        <label className="field"><span>Category</span><select value={filters.category} onChange={(event) => changeFilter('category', event.target.value)}><option value="">All categories</option>{categoryOptions.map((item) => <option value={item.name} key={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>Location</span><input value={filters.location} onChange={(event) => changeFilter('location', event.target.value)} placeholder="Any city" /></label>
        <label className="field"><span>Minimum price</span><input type="number" min="0" value={filters.minPrice} onChange={(event) => changeFilter('minPrice', event.target.value)} /></label>
        <label className="field"><span>Maximum price</span><input type="number" min="0" value={filters.maxPrice} onChange={(event) => changeFilter('maxPrice', event.target.value)} /></label>
        <label className="field"><span>Minimum rating</span><select value={filters.minRating} onChange={(event) => changeFilter('minRating', event.target.value)}><option value="">Any rating</option><option value="3">3+ stars</option><option value="4">4+ stars</option><option value="4.5">4.5+ stars</option></select></label>
        {isVendors && <><label className="field"><span>Verification status</span><select value={filters.verified} onChange={(event) => changeFilter('verified', event.target.value)}><option value="">{translateText('customerAllApprovedVendors')}</option><option value="true">{translateText('customerVerifiedOnly')}</option></select></label><label className="field"><span>{translateText('customerAvailabilityDate')}</span><input type="date" min={new Date().toISOString().slice(0, 10)} value={filters.availableDate || ''} onChange={(event) => changeFilter('availableDate', event.target.value)} /></label><label className="field"><span>Availability</span><select value={filters.availableOnly} onChange={(event) => changeFilter('availableOnly', event.target.value)}><option value="">Any availability</option><option value="true">{translateText('customerAvailableOnly')}</option></select></label><label className="field"><span>Vendor type</span><select value={filters.featured ? 'featured' : ''} onChange={(event) => changeFilter('featured', event.target.value === 'featured')}><option value="">{translateText('customerAllApprovedVendors')}</option><option value="featured">{translateText('customerFeaturedOnly')}</option></select></label></>}
        {isVendors ? <label className="field"><span>Sort by</span><select value={filters.sort} onChange={(event) => changeFilter('sort', event.target.value)}><option value="recommended">{translateText('customerSortRecommended')}</option><option value="popular">{translateText('customerSortPopular')}</option><option value="highest-rated">{translateText('customerSortHighestRated')}</option><option value="most-reviewed">{translateText('customerSortMostReviewed')}</option><option value="price-low">{translateText('customerSortPriceLow')}</option><option value="price-high">{translateText('customerSortPriceHigh')}</option><option value="recently-added">{translateText('customerSortRecentlyAdded')}</option></select></label>
          : <><label className="field"><span>Availability</span><select value={filters.availableOnly} onChange={(event) => changeFilter('availableOnly', event.target.value)}><option value="">Any availability</option><option value="true">Available only</option></select></label><label className="field"><span>Sort by</span><select value={filters.sort} onChange={(event) => changeFilter('sort', event.target.value)}><option value="relevance">Relevance</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="highest-rated">Highest rated</option></select></label></>}
      </div>
      {isVendors && <><div className="customer-vendor-discovery-bar"><div className="customer-vendor-categories" aria-label="Vendor categories"><button type="button" className={`customer-category-chip ${!filters.category ? 'selected' : ''}`} onClick={() => changeFilter('category', '')}>All <span>{categoryOptions.reduce((sum, category) => sum + (Number(category.vendorCount) || 0), 0)}</span></button>{categoryOptions.map((category) => <button type="button" className={`customer-category-chip ${filters.category === category.name ? 'selected' : ''}`} key={category.id} onClick={() => changeFilter('category', filters.category === category.name ? '' : category.name)}>{category.name} <span>{Number(category.vendorCount) || 0}</span></button>)}</div><div className="customer-vendor-history">{vendorSearchHistory.length > 0 && <><span>{translateText('customerRecentVendorSearches')}</span>{vendorSearchHistory.slice(0, 4).map((term) => <button type="button" key={term} onClick={() => { setVendorSearchInput(term); rememberVendorSearch(term); }}>{term}</button>)}</>}</div></div><div className="customer-vendor-results-bar"><span>{catalogPage.total} {translateText(catalogPage.total === 1 ? 'customerVendor' : 'customerVendors')}{filters.category ? ` · ${filters.category}` : ''}</span><div className="customer-vendor-results-actions"><button className="button secondary small" type="button" onClick={() => { const cleared = { search: '', category: '', location: '', minPrice: '', maxPrice: '', minRating: '', availableOnly: '', availableDate: '', verified: '', featured: false, sort: 'recommended' }; setFilters(cleared); setVendorSearchInput(''); setCatalogPage((current) => ({ ...current, page: 1 })); }} disabled={!filters.search && !filters.category && !filters.location && !filters.minPrice && !filters.maxPrice && !filters.minRating && !filters.availableOnly && !filters.availableDate && !filters.verified && !filters.featured}>{translateText('customerClearFilters')}</button><button className="button secondary small" type="button" disabled={comparedVendorIds.length < 2} onClick={() => onNavigatePublic('/compare')}>{translateText('customerCompareVendors')}{comparedVendorIds.length ? ` (${comparedVendorIds.length})` : ''}</button><button className={`button secondary small ${vendorDisplay === 'grid' ? 'active' : ''}`} type="button" aria-pressed={vendorDisplay === 'grid'} onClick={() => setVendorDisplay('grid')}>{translateText('customerGridView')}</button><button className={`button secondary small ${vendorDisplay === 'list' ? 'active' : ''}`} type="button" aria-pressed={vendorDisplay === 'list'} onClick={() => setVendorDisplay('list')}>{translateText('customerListView')}</button></div></div><p className="customer-directory-scope"><BadgeCheck size={15}/>{translateText('customerOnlyApprovedVendors')} {translateText('customerRecommendationBasis')}</p></>}
      {catalogLoading ? <div className="loading"><span className="spinner"/>{translateText('Loading catalog...')}</div> : <div className={`customer-catalog-grid${isVendors && vendorDisplay === 'list' ? ' customer-catalog-list' : ''}`}>{catalogRows.map((item) => {
        const bookableService = isVendors ? item.services?.[0] : null;
        const quoteService = isVendors ? item.services?.[0] : null;
        const isSaved = isVendors && favorites.some((favorite) => Number(favorite.id) === Number(item.id));
        const isCompared = isVendors && comparedVendorIds.includes(Number(item.id));
        return <article className="panel customer-catalog-card" key={item.id}>
        {isVendors ? <VendorDirectoryImage vendor={item}/> : (item.coverImageUrl || item.logoUrl || item.images?.[0]?.url) && <img src={item.coverImageUrl || item.logoUrl || item.images?.[0]?.url} alt={item.name || item.title} loading="lazy"/>}
        <div className="customer-catalog-card-content"><div className="customer-vendor-card-badges"><span className={`pill ${item.verified ? 'verified' : 'active'}`}>{isVendors ? item.verified ? <><BadgeCheck size={12}/> Verified</> : 'Listing' : item.category}</span><span className="customer-vendor-card-labels">{isVendors && item.isFeatured && <span className="customer-featured-badge"><Sparkles size={12}/>{translateText('customerFeatured')}</span>}{isVendors && item.reviewCount > 0 && <span className="customer-vendor-rating"><Star size={13} fill="currentColor"/>{Number(item.rating).toFixed(1)} <small>({item.reviewCount})</small></span>}</span></div><h3>{isVendors ? item.business_name || item.name : item.title}</h3><p className="customer-vendor-category">{isVendors ? item.category || 'Category not listed' : `${item.vendorName} · ${item.category}`}</p><p className="customer-vendor-location">{isVendors ? item.city || 'Location not listed' : item.city}</p><p className="customer-vendor-description">{item.description || (isVendors ? 'No business description provided.' : 'No service description provided.')}</p>
        <div className="customer-vendor-card-price"><small>Starting price</small><strong>{(isVendors ? item.priceFrom : item.price) === null || (isVendors ? item.priceFrom : item.price) === undefined ? 'Price on request' : money(isVendors ? item.priceFrom : item.price, item.currency)}</strong></div>
          {isVendors && item.available && <span className="customer-availability-badge"><Check size={13}/>{filters.availableDate ? `${translateText('customerAvailablePrefix')} ${filters.availableDate}` : translateText('customerAvailabilityListed')}</span>}
          {isVendors && Array.isArray(item.portfolio) && item.portfolio.length > 0 && <small className="customer-portfolio-count">{item.portfolio.length} portfolio {item.portfolio.length === 1 ? 'item' : 'items'}</small>}
          {Array.isArray(item.packages) && item.packages.length > 0 && <div className="customer-package-preview">{item.packages.filter(Boolean).slice(0, 2).map((pkg) => <span key={pkg.id}>{pkg.name}: {money(pkg.price, pkg.currency)}</span>)}</div>}
        </div><div className="customer-catalog-actions">{isVendors ? <><button className="button secondary small" type="button" onClick={() => onNavigatePublic(`/vendors/${item.id}`)}>{translateText('customerViewProfile')}</button>{quoteService && <button className="button secondary small" type="button" onClick={() => setRequestService({ kind: 'quote', service: quoteService })}>{translateText('customerRequestQuotation')}</button>}{bookableService && <button className="button small" type="button" onClick={() => setRequestService({ kind: 'booking', service: bookableService })}>{translateText('customerBookNow')}</button>}<button className="button secondary small" type="button" disabled={busy} aria-pressed={isSaved} onClick={() => toggleVendorFavorite(item)}>{isSaved ? translateText('customerSaved') : translateText('customerSaveVendor')}</button><button className="button secondary small" type="button" aria-pressed={isCompared} onClick={() => toggleVendorComparison(item.id)}>{isCompared ? translateText('customerRemoveCompare') : translateText('customerCompareVendors')}</button></> : <><button className="button secondary small" type="button" onClick={() => setRequestService({ kind: 'quote', service: item })}>Request quote</button><button className="button secondary small" type="button" onClick={() => setRequestService({ kind: 'save-service', service: item })}>Save service</button><button className="button small" type="button" onClick={() => setRequestService({ kind: 'booking', service: item })}>Request booking</button></>}</div>
      </article>;
      })}{!catalogRows.length && <div className="customer-vendor-empty"><EmptyState>{catalogPage.total === 0 && !filters.search && !filters.category && !filters.location && !filters.minPrice && !filters.maxPrice && !filters.minRating && !filters.availableOnly && !filters.availableDate && !filters.featured ? translateText('customerNoApprovedVendors') : translateText('customerNoMatchingRecords')}</EmptyState>{catalogPage.total === 0 && !filters.search && !filters.category && !filters.location && !filters.minPrice && !filters.maxPrice && !filters.minRating && !filters.availableOnly && !filters.availableDate && !filters.featured && <button className="button secondary small" type="button" onClick={() => onNavigate('services')}>{translateText('customerExploreServices')}</button>}</div>}</div>}
      {!catalogLoading && catalogRows.length > 0 && <div className="pagination-row"><span>{catalogPage.total} results</span><button className="button secondary small" type="button" disabled={catalogPage.page <= 1} onClick={() => changeCatalogPage(catalogPage.page - 1)}><ChevronLeft size={16}/> Previous</button><span>Page {catalogPage.page} of {catalogPage.totalPages}</span><button className="button secondary small" type="button" disabled={catalogPage.page >= catalogPage.totalPages} onClick={() => changeCatalogPage(catalogPage.page + 1)}>Next <ChevronRight size={16}/></button></div>}
      {requestService && <CustomerRequestModal item={requestService} events={events} user={user} api={api} mutate={mutate} busy={busy} onClose={() => setRequestService(null)} />}
    </section>;
  }

  if (view === 'categories') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="SERVICE DIRECTORY" title="Service categories" description="Browse active categories and open matching services." />{categories.map((category) => <article className="panel customer-category-row" key={category.id}><div><strong>{category.name}</strong><p>{category.description}</p><small>{category.vendorCount ?? 0} vendors · {category.serviceCount ?? 0} services</small></div><button className="button secondary small" type="button" onClick={() => { const nextFilters = { ...filters, category: category.name }; setFilters(nextFilters); setCatalogPage((current) => ({ ...current, page: 1 })); updateCustomerCatalogUrl(nextFilters, 1); onNavigate('services'); }}>Browse services</button></article>)}{!categories.length && <EmptyState>No active categories available.</EmptyState>}</section>;

  if (view === 'bookings') return <CustomerBookingsList api={api} onNavigate={onNavigatePublic} />;

  if (view === 'history') return <CustomerBookingHistory api={api} onNavigate={onNavigatePublic} />;

  if (view === 'events') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="EVENT PLANNING" title="My events" description="Create events, track linked bookings, and update your own event details." action={<button className="button" type="button" onClick={() => { setEditingEventId(null); setEventForm({ title: '', type: '', description: '', city: '', venue: '', startDate: '', endDate: '', guestCount: '', budget: '', capacity: '', notes: '', coverImageUrl: '' }); setEventFormOpen((current) => !current); }}>New event</button>} />
    {eventFormOpen && <form className="panel customer-workspace-form" onSubmit={saveEvent}><h3>{editingEventId ? 'Edit event' : 'Create event'}</h3><div className="customer-form-grid"><label className="field"><span>Event name</span><input required minLength="2" maxLength="180" value={eventForm.title} onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))} /></label><label className="field"><span>Event type</span><input required minLength="2" maxLength="80" value={eventForm.type} onChange={(event) => setEventForm((current) => ({ ...current, type: event.target.value }))} /></label><label className="field"><span>Start date and time</span><input type="datetime-local" required value={eventForm.startDate} onChange={(event) => setEventForm((current) => ({ ...current, startDate: event.target.value }))} /></label><label className="field"><span>End date and time</span><input type="datetime-local" value={eventForm.endDate} onChange={(event) => setEventForm((current) => ({ ...current, endDate: event.target.value }))} /></label><label className="field"><span>Location / city</span><input maxLength="120" value={eventForm.city} onChange={(event) => setEventForm((current) => ({ ...current, city: event.target.value }))} /></label><label className="field"><span>Venue</span><input maxLength="180" value={eventForm.venue} onChange={(event) => setEventForm((current) => ({ ...current, venue: event.target.value }))} /></label><label className="field"><span>Expected guests</span><input type="number" min="1" max="100000" value={eventForm.guestCount} onChange={(event) => setEventForm((current) => ({ ...current, guestCount: event.target.value }))} /></label><label className="field"><span>Budget</span><input type="number" min="0" max="100000000" step="0.01" value={eventForm.budget} onChange={(event) => setEventForm((current) => ({ ...current, budget: event.target.value }))} /></label><label className="field customer-form-wide"><span>Description</span><textarea maxLength="10000" value={eventForm.description} onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))} /></label><label className="field customer-form-wide"><span>Planning notes</span><textarea maxLength="2000" value={eventForm.notes} onChange={(event) => setEventForm((current) => ({ ...current, notes: event.target.value }))} /></label></div><div className="customer-actions"><button className="button" disabled={busy}>{busy ? 'Saving...' : editingEventId ? 'Save changes' : 'Save draft'}</button><button className="button secondary" type="button" onClick={() => setEventFormOpen(false)}>Cancel</button></div></form>}
    {events.map((event) => <article className="panel customer-event-card" key={event.id}><div><span className={`pill ${statusClass(event.status)}`}>{event.status}</span><h3>{event.title}</h3><p>{event.type} · {formatDate(event.startDate || event.date)} · {event.location || event.city}</p><p>{event.guestCount ?? 0} guests · Budget {money(event.budget, event.currency)}</p><small>{event.description || event.notes}</small></div><div className="customer-actions"><button className="button secondary small" type="button" onClick={() => startEditEvent(event)}>Edit</button>{statusClass(event.status) === 'draft' && <button className="button small" type="button" disabled={busy} onClick={() => mutate(() => api(`/platform/events/${event.id}/publish`, { method: 'PATCH' }), 'Event published.')}>Publish</button>}{!['completed', 'cancelled'].includes(statusClass(event.status)) && <button className="button danger small" type="button" disabled={busy} onClick={() => window.confirm(translateText('Cancel this event? Active bookings must be resolved first.')) && mutate(() => api(`/platform/events/${event.id}/cancel`, { method: 'PATCH' }), 'Event cancelled.')}>Cancel</button>}<button className="button secondary small" type="button" onClick={() => onNavigate('bookings')}>View bookings</button></div></article>)}{!events.length && !eventFormOpen && <EmptyState>No events yet. Create your first event to start planning.</EmptyState>}
  </section>;

  if (view === 'favorites') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="WISHLIST" title="Saved vendors and services" description="Keep preferred providers and packages for later comparison." />
    <h3>Vendors</h3>{favorites.map((vendor) => <article className="panel customer-saved-card" key={`vendor-${vendor.id}`}><div><h3>{vendor.name}</h3><p>{vendor.category} · {vendor.city}</p><small>{vendor.description}</small></div><div className="customer-actions"><button className="button secondary small" type="button" onClick={() => onNavigate('vendors')}>Browse vendors</button><button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/favorites/${vendor.id}`, { method: 'DELETE' }), 'Vendor removed from wishlist.')}>Remove</button></div></article>)}{!favorites.length && <p className="muted">No saved vendors.</p>}
    <h3>Services</h3>{savedServices.map((service) => <article className="panel customer-saved-card" key={`service-${service.id}`}><div><h3>{service.title}</h3><p>{service.vendorName} · {service.category} · {service.city}</p><strong>{money(service.price, service.currency)}</strong></div><div className="customer-actions"><button className="button secondary small" type="button" onClick={() => { const nextFilters = { ...filters, search: service.title }; setServiceSearchInput(service.title); setFilters(nextFilters); setCatalogPage((current) => ({ ...current, page: 1 })); updateCustomerCatalogUrl(nextFilters, 1); onNavigate('services'); }}>Open service</button><button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/saved-services/${service.id}`, { method: 'DELETE' }), 'Service removed from wishlist.')}>Remove</button></div></article>)}{!savedServices.length && <p className="muted">No saved services.</p>}
  </section>;

  if (view === 'quotations') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="PRICE PROPOSALS" title="Quotations" description="Compare vendor offers and accept, decline, or request a revision." />
    {quotations.map((quote) => <article className="panel customer-quote-card" key={quote.id}>
      <div>
        <span className={`pill ${statusClass(quote.status)}`}>{quote.status === 'draft' ? 'pending vendor response' : String(quote.status ?? '').replaceAll('_', ' ')}</span>
        <h3>{quote.vendorName} · {quote.service}</h3>
        <p>{quote.event || 'No event linked'}{quote.eventType ? ` · ${quote.eventType}` : ''}{quote.eventDate ? ` · ${String(quote.eventDate).slice(0, 16)}` : ''}{quote.eventLocation ? ` · ${quote.eventLocation}` : ''}{quote.validUntil ? ` · Valid through ${quote.validUntil}` : ''}</p>
        {(quote.guestCount ?? 0) > 0 || quote.budget != null ? <p>{quote.guestCount ? `${quote.guestCount} guests` : ''}{quote.budget != null ? ` · Budget ${money(quote.budget, quote.currency)}` : ''}</p> : null}
        {quote.requiredServices && <p><strong>Requested scope:</strong> {quote.requiredServices}</p>}
        {quote.additionalRequirements && <p><strong>Requirements:</strong> {quote.additionalRequirements}</p>}
        {quote.requestMessage && <p><strong>Message:</strong> {quote.requestMessage}</p>}
        {quote.contactPhone && <p><strong>Contact phone:</strong> {quote.contactPhone}</p>}
        {quote.notes && <p>{quote.notes}</p>}
        <strong>{money(quote.amount, quote.currency)}</strong>
      </div>
      {quote.status === 'draft' && <button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }), 'Quotation request cancelled.')}>Cancel request</button>}
      {['sent', 'revision_requested'].includes(statusClass(quote.status)) && <div className="customer-actions"><button className="button" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) }), 'Quotation accepted.')}>Accept</button><button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'declined' }) }), 'Quotation declined.')}>Decline</button><label className="field"><span>Revision request</span><input maxLength="500" value={quoteReasons[quote.id] || ''} onChange={(event) => setQuoteReasons((current) => ({ ...current, [quote.id]: event.target.value }))} /></label><button className="button secondary small" type="button" disabled={busy || (quoteReasons[quote.id] || '').trim().length < 5} onClick={() => mutate(() => api(`/customer/quotations/${quote.id}/decision`, { method: 'PATCH', body: JSON.stringify({ status: 'revision_requested', reason: quoteReasons[quote.id].trim() }) }), 'Revision requested.')}>Request revision</button></div>}
    </article>)}{!quotations.length && <EmptyState>No quotations yet. Request a quote from a service listing.</EmptyState>}
  </section>;

  if (view === 'payments') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="FINANCIAL RECORDS" title="Payments and refunds" description="Statuses are read-only and reflect verified payment/refund records." />
    <div className="table-wrap"><table><thead><tr><th>Payment</th><th>Event</th><th>Service</th><th>Status</th><th>Amount</th><th>Date</th><th></th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{payment.reference}</td><td>{payment.event}</td><td>{payment.service}</td><td><span className={`pill ${statusClass(payment.status)}`}>{payment.status}</span></td><td>{money(payment.amount, payment.currency)}</td><td>{formatDate(payment.date)}</td><td>{['paid', 'partially_refunded'].includes(statusClass(payment.status)) && <button className="button secondary small" type="button" onClick={() => setRefundForm({ payment, amount: String(payment.amount ?? 0), reason: '' })}>Request refund</button>}</td></tr>)}</tbody></table></div>{!payments.length && <EmptyState>No payment records yet.</EmptyState>}
    <section className="panel"><h3>Refund history</h3>{refunds.map((refund) => <article className="list-card" key={refund.id}><div><strong>Payment #{refund.paymentId} · {money(refund.amount, refund.currency)}</strong><small>{refund.reason} · {formatDate(refund.createdAt)}</small></div><span className={`pill ${statusClass(refund.status)}`}>{refund.status}</span></article>)}{!refunds.length && <p className="muted">No refund requests.</p>}</section>
    {refundForm && <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && setRefundForm(null)}><form className="modal" onSubmit={(event) => { event.preventDefault(); mutate(async () => { await api(`/customer/payments/${refundForm.payment.id}/refunds`, { method: 'POST', body: JSON.stringify({ amount: Number(refundForm.amount), reason: refundForm.reason, idempotencyKey: globalThis.crypto.randomUUID() }) }); setRefundForm(null); }, 'Refund request submitted.'); }}><div className="modal-head"><h2>Request refund</h2><button className="icon-button" type="button" aria-label="Close" onClick={() => setRefundForm(null)}>×</button></div><div className="modal-body"><p>{refundForm.payment.reference} · {money(refundForm.payment.amount, refundForm.payment.currency)}</p><label className="field"><span>Amount</span><input type="number" min="0.01" max={refundForm.payment.amount} step="0.01" required value={refundForm.amount} onChange={(event) => setRefundForm((current) => ({ ...current, amount: event.target.value }))} /></label><label className="field"><span>Reason</span><textarea required minLength="5" maxLength="500" value={refundForm.reason} onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value }))} /></label></div><div className="modal-foot"><button className="button secondary" type="button" onClick={() => setRefundForm(null)}>Cancel</button><button className="button" disabled={busy}>{busy ? 'Submitting...' : 'Submit refund request'}</button></div></form></div>}
  </section>;

  if (view === 'messages') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="CONVERSATIONS" title="Messages" description="Message vendors in the context of your bookings." />
    <form className="panel customer-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(() => api('/customer/messages', { method: 'POST', body: JSON.stringify({ bookingId: Number(messageForm.bookingId), body: messageForm.body }) }), 'Message sent.'); setMessageForm({ bookingId: '', body: '' }); }}><label className="field"><span>Booking</span><select required value={messageForm.bookingId} onChange={(event) => setMessageForm((current) => ({ ...current, bookingId: event.target.value }))}><option value="">Choose booking</option>{bookings.filter((booking) => !['cancelled', 'rejected'].includes(statusClass(booking.status))).map((booking) => <option value={booking.id} key={booking.id}>{booking.eventTitle} · {booking.vendorName} · {booking.serviceTitle}</option>)}</select></label><label className="field"><span>Message</span><textarea required maxLength="4000" value={messageForm.body} onChange={(event) => setMessageForm((current) => ({ ...current, body: event.target.value }))} /></label><button className="button" disabled={busy || !messageForm.bookingId}>{busy ? 'Sending...' : 'Send message'}</button></form>
    {messages.map((message) => <article className={`panel customer-message ${message.read ? '' : 'unread'}`} key={message.id}><div><strong>{message.senderId === Number(user.id ?? 0) ? 'You' : message.sender} · {message.vendor}</strong><small>{message.event} · Booking #{message.bookingId} · {formatDate(message.createdAt)}</small><p>{message.body}</p></div>{!message.read && Number(message.recipientId ?? 0) === Number(user.id ?? 0) && <button className="button secondary small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/messages/${message.id}/read`, { method: 'POST' }), 'Message marked as read.')}>Mark read</button>}</article>)}{!messages.length && <EmptyState>No conversations yet.</EmptyState>}
  </section>;

  if (view === 'reviews') {
    const reviewedBookingIds = new Set(reviews.map((review) => Number(review.bookingId ?? 0)));
    const eligibleBookings = bookings.filter((booking) => statusClass(booking.status) === 'completed' && !reviewedBookingIds.has(Number(booking.id)));
    return <section className="customer-workspace">{feedback}<PageHeading eyebrow="FEEDBACK" title="Reviews and ratings" description="Reviews are allowed once per completed booking and cannot be changed after submission." />
      <form className="panel customer-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(() => api('/customer/reviews', { method: 'POST', body: JSON.stringify({ bookingId: Number(reviewForm.bookingId), rating: Number(reviewForm.rating), comment: reviewForm.comment }) }), 'Review submitted.'); setReviewForm({ bookingId: '', rating: '5', comment: '' }); }}><h3>Review a completed service</h3><label className="field"><span>Completed booking</span><select required value={reviewForm.bookingId} onChange={(event) => setReviewForm((current) => ({ ...current, bookingId: event.target.value }))}><option value="">Choose booking</option>{eligibleBookings.map((booking) => <option value={booking.id} key={booking.id}>{booking.vendorName} · {booking.serviceTitle} · {booking.eventTitle}</option>)}</select></label><label className="field"><span>Rating</span><select value={reviewForm.rating} onChange={(event) => setReviewForm((current) => ({ ...current, rating: event.target.value }))}>{[5, 4, 3, 2, 1].map((rating) => <option value={rating} key={rating}>{rating} stars</option>)}</select></label><label className="field"><span>Comment</span><textarea maxLength="2000" value={reviewForm.comment} onChange={(event) => setReviewForm((current) => ({ ...current, comment: event.target.value }))} /></label><button className="button" disabled={busy || !reviewForm.bookingId}>{busy ? 'Submitting...' : 'Submit review'}</button></form>
      {reviews.map((review) => <article className="panel customer-message" key={review.id}><div><strong>{review.vendorName} · {'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}</strong><p>{review.comment || 'Rating submitted'}</p><small>{formatDate(review.createdAt)} · {review.status}</small></div></article>)}{!reviews.length && !eligibleBookings.length && <EmptyState>No completed bookings are eligible for a review.</EmptyState>}
    </section>;
  }

  if (view === 'notifications') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="UPDATES" title="Notifications" description="Booking, quotation, payment, message, and event updates sent to your account." action={<button className="button secondary" type="button" disabled={busy || !notifications.some((item) => !item.read)} onClick={() => mutate(() => api('/customer/notifications/read-all', { method: 'POST' }), 'All notifications marked as read.')}><Check size={16}/> Mark all read</button>} />
    {notifications.map((item) => <article className={`panel customer-message ${item.read ? '' : 'unread'}`} key={item.id}><div><strong>{item.title}</strong><small>{item.type} · {formatDate(item.createdAt)}</small><p>{item.message}</p></div><div className="customer-actions">{item.relatedType === 'booking' && <button className="button secondary small" type="button" onClick={() => onNavigate('bookings')}>Open booking</button>}{item.relatedType === 'event' && <button className="button secondary small" type="button" onClick={() => onNavigate('events')}>Open event</button>}{!item.read && <button className="button secondary small" type="button" disabled={busy} onClick={() => mutate(() => api(`/customer/notifications/${item.id}/read`, { method: 'POST' }), 'Notification marked as read.')}><Bell size={14}/> Mark read</button>}</div></article>)}{!notifications.length && <EmptyState>No notifications yet.</EmptyState>}
  </section>;

  if (view === 'profile') return <section className="customer-workspace">{feedback}<PageHeading eyebrow="ACCOUNT" title="Profile management" description="Update your contact details and secure your account." />
    <div className="two-column-layout"><form className="panel customer-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(async () => { const response = await api('/customer/profile', { method: 'PATCH', body: JSON.stringify(profileForm) }); onUserChange?.((current) => current ? { ...current, full_name: profileForm.fullName, name: profileForm.fullName, phone: profileForm.phone } : current); return response; }, 'Profile updated.'); }}><h3>Personal information</h3><label className="field"><span>Full name</span><input required minLength="2" maxLength="160" value={profileForm.fullName} onChange={(event) => setProfileForm((current) => ({ ...current, fullName: event.target.value }))} /></label><label className="field"><span>Email</span><input value={profile.email || user.email || ''} disabled /></label><label className="field"><span>Phone</span><input maxLength="40" value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} /></label><p className="muted">Email changes require a separate verification flow and are not available here. Update your profile photo from the header.</p><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Save profile'}</button></form>
      <form className="panel customer-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(async () => { await api('/customer/profile/password', { method: 'POST', body: JSON.stringify(passwordForm) }); setPasswordForm({ currentPassword: '', newPassword: '' }); }, 'Password updated.'); }}><h3>Change password</h3><label className="field"><span>Current password</span><input type="password" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} /></label><label className="field"><span>New password</span><input type="password" autoComplete="new-password" required minLength="12" maxLength="16" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} /></label><small>Use 12-16 characters with uppercase, lowercase, and a number.</small><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button></form></div>
  </section>;

  return <section className="customer-workspace">{feedback}<EmptyState>This customer section is unavailable.</EmptyState></section>;
}