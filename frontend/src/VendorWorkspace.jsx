import { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, Check, Clock3, ImagePlus, Search, Trash2 } from 'lucide-react';
import './vendorWorkspace.css';

const money = (value, currency = 'ETB') => new Intl.NumberFormat('en-ET', {
  style: 'currency', currency, maximumFractionDigits: 0,
}).format(Number(value || 0));
const formatDate = (value) => {
  if (!value) return 'Date not set';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};
const statusKey = (value) => String(value || '').toLowerCase().replaceAll(' ', '_');
const initialService = { title: '', description: '', categoryId: '', price: '', currency: 'ETB', status: 'draft' };
const initialPackage = { name: '', description: '', price: '', currency: 'ETB', minimumBooking: '1', includedFeatures: '', extras: '', isActive: true };

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading vendor-workspace-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="muted">{description}</p></div>{action}</div>;
}

function EmptyState({ children }) {
  return <div className="empty panel"><strong>{children}</strong></div>;
}

function VendorMediaImage({ api, media, alt }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    api(`/vendor/media/${media.id}`, { responseType: 'blob' }).then((blob) => {
      if (!active || !blob?.size) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, media.id]);
  return url ? <img className="vendor-media-thumb" src={url} alt={alt} /> : <div className="vendor-media-placeholder"><ImagePlus size={20}/></div>;
}

function CalendarGrid({ availability, bookings, onSetDate, onRemoveDate, busy }) {
  const [mode, setMode] = useState('month');
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const startOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const gridStart = new Date(startOfMonth.getFullYear(), startOfMonth.getMonth(), startOfMonth.getDate() - ((startOfMonth.getDay() + 6) % 7));
  const start = mode === 'month' ? gridStart : mode === 'week'
    ? new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() - ((anchorDate.getDay() + 6) % 7))
    : new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  const count = mode === 'month' ? 42 : mode === 'week' ? 7 : 1;
  const days = Array.from({ length: count }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  const schedule = new Map((availability || []).map((entry) => [String(entry.date).slice(0, 10), entry]));
  const bookingDates = new Map((bookings || []).map((booking) => [String(booking.date || '').slice(0, 10), booking]));
  const heading = mode === 'day' ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(anchorDate)
    : new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(anchorDate);

  function move(direction) {
    setAnchorDate((current) => mode === 'month'
      ? new Date(current.getFullYear(), current.getMonth() + direction, current.getDate())
      : new Date(current.getFullYear(), current.getMonth(), current.getDate() + direction * (mode === 'week' ? 7 : 1)));
  }

  return <>
    <div className="vendor-calendar-toolbar">
      <div className="vendor-calendar-heading"><button className="icon-button" type="button" aria-label="Previous period" onClick={() => move(-1)}>‹</button><strong>{heading}</strong><button className="icon-button" type="button" aria-label="Next period" onClick={() => move(1)}>›</button></div>
      <label className="field"><span>Calendar view</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
      <button className="button secondary small" type="button" onClick={() => setAnchorDate(new Date())}>Today</button>
    </div>
    <div className={`vendor-calendar-grid ${mode}`}>
      {days.map((day) => {
        const key = day.toISOString().slice(0, 10);
        const record = schedule.get(key);
        const booking = bookingDates.get(key);
        const reserved = Boolean(booking) || statusKey(record?.status) === 'booked';
        return <article className={`vendor-calendar-day ${mode === 'month' && day.getMonth() !== anchorDate.getMonth() ? 'outside-month' : ''}`} key={key}>
          <strong>{mode === 'month' ? day.getDate() : new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' }).format(day)}</strong>
          {reserved ? <div className="vendor-calendar-reserved"><strong>Booked</strong><small>{booking?.service || record?.note || 'Confirmed booking'}</small></div>
            : record ? <div className={`vendor-calendar-state ${statusKey(record.status)}`}><strong>{record.status}</strong><small>{record.note}</small><button className="text-action" type="button" disabled={busy} onClick={() => onRemoveDate(key)}>Remove</button></div>
              : <div className="vendor-calendar-actions"><button className="text-action" type="button" disabled={busy || key < new Date().toISOString().slice(0, 10)} onClick={() => onSetDate(key, 'available')}>Available</button><button className="text-action subtle-danger" type="button" disabled={busy || key < new Date().toISOString().slice(0, 10)} onClick={() => onSetDate(key, 'blocked')}>Block</button></div>}
        </article>;
      })}
    </div>
  </>;
}

export default function VendorWorkspace({ view, data, api, user, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [serviceForm, setServiceForm] = useState(initialService);
  const [serviceImage, setServiceImage] = useState(null);
  const [serviceImageError, setServiceImageError] = useState('');
  const [packageServiceId, setPackageServiceId] = useState('');
  const [packageId, setPackageId] = useState(null);
  const [packageForm, setPackageForm] = useState(initialPackage);
  const [profileForm, setProfileForm] = useState({});
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [accountForm, setAccountForm] = useState({ fullName: data.account?.fullName || user.full_name || '', phone: data.account?.phone || user.phone || '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [serviceMedia, setServiceMedia] = useState(null);
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [quoteForm, setQuoteForm] = useState({ amount: '', notes: '', validUntil: '' });
  const [bookingReasons, setBookingReasons] = useState({});
  const [messageForm, setMessageForm] = useState({ bookingId: '', body: '' });
  const [reviewReport, setReviewReport] = useState(null);
  const [reviewReason, setReviewReason] = useState('');
  const [availabilityNote, setAvailabilityNote] = useState('');
  const [serviceSort, setServiceSort] = useState('name');
  const [servicePage, setServicePage] = useState(1);
  const [bookingPage, setBookingPage] = useState(1);
  const pageSize = 8;
  const [reportFilters, setReportFilters] = useState({ dateFrom: '', dateTo: '', serviceId: '', status: '' });
  const [reportData, setReportData] = useState(null);

  useEffect(() => {
    if (!data.profile) return;
    setProfileForm({
      businessName: data.profile.businessName || '',
      categoryId: data.profile.categoryId || '',
      city: data.profile.city || data.profile.serviceLocation || '',
      address: data.profile.address || '',
      description: data.profile.description || '',
      phone: data.profile.phone || '',
      website: data.profile.website || '',
      serviceAreas: (data.profile.serviceAreas || []).join(', '),
      operatingHours: data.profile.hours || {},
      notificationPreferences: data.profile.notificationPreferences || {},
      bookingPreferences: data.profile.bookingPreferences || {},
    });
    setProfileLoaded(true);
  }, [data.profile]);

  useEffect(() => {
    if (view === 'pricing' && packageServiceId) onNavigate('services');
  }, [onNavigate, packageServiceId, view]);

  async function mutate(action, message) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      if (view === 'account' && onUserChange) {
        const accountResponse = await api('/vendor/account');
        onUserChange((current) => current ? {
          ...current,
          full_name: accountResponse.data.fullName,
          name: accountResponse.data.fullName,
          phone: accountResponse.data.phone,
        } : current);
      }
      setNotice(message);
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
  const services = data.services || [];
  const categories = data.categories || [];
  const matchingServices = useMemo(() => services.filter((service) => {
    const text = `${service.name} ${service.title} ${service.category} ${service.description}`.toLowerCase();
    return (!query || text.includes(query.trim().toLowerCase()))
      && (!statusFilter || statusKey(service.status) === statusFilter)
      && (!categoryFilter || service.category === categoryFilter);
  }).sort((left, right) => serviceSort === 'price'
    ? Number(left.price || 0) - Number(right.price || 0)
    : serviceSort === 'status' ? String(left.status).localeCompare(String(right.status))
      : String(left.name || left.title).localeCompare(String(right.name || right.title))),
  [categoryFilter, query, serviceSort, services, statusFilter]);
  const servicePageCount = Math.max(1, Math.ceil(matchingServices.length / pageSize));
  const filteredServices = matchingServices.slice((servicePage - 1) * pageSize, servicePage * pageSize);

  useEffect(() => { setServicePage(1); }, [categoryFilter, query, serviceSort, statusFilter]);
  useEffect(() => { setServicePage((current) => Math.min(current, servicePageCount)); }, [servicePageCount]);
  useEffect(() => { setBookingPage(1); }, [query, statusFilter, view]);

  if (view === 'overview') return <section className="vendor-workspace">
    {feedback}<PageHeading eyebrow="BUSINESS OVERVIEW" title={`Welcome, ${user.full_name || user.name || 'Vendor'}`} description="Live service, booking, customer, and payment records for your vendor account." action={<button className="button secondary" type="button" onClick={onRefresh}>Refresh</button>} />
    <div className="metric-grid"><article className="metric-card"><p>Total services</p><strong>{data.overview?.totalServices || 0}</strong><span>{data.overview?.activeServices || 0} published</span></article><article className="metric-card"><p>Bookings</p><strong>{data.overview?.totalBookings || 0}</strong><span>{data.overview?.pendingBookings || 0} pending requests</span></article><article className="metric-card"><p>Customers</p><strong>{data.overview?.totalCustomers || 0}</strong><span>{data.overview?.completedBookings || 0} completed</span></article><article className="metric-card"><p>Confirmed bookings</p><strong>{data.overview?.confirmedBookings || 0}</strong><span>{data.overview?.upcomingBookings || 0} upcoming events</span></article><article className="metric-card"><p>Paid earnings</p><strong>{money(data.overview?.totalEarnings)}</strong><span>{money(data.overview?.pendingPayouts)} pending / authorized</span></article><article className="metric-card"><p>Unread updates</p><strong>{(data.overview?.unreadMessages || 0) + (data.overview?.notifications || 0)}</strong><span>{data.overview?.unreadMessages || 0} messages · {data.overview?.notifications || 0} notifications</span></article></div>
    <div className="two-column-layout"><section className="panel"><div className="panel-header"><h3>New booking requests</h3><button className="button secondary small" type="button" onClick={() => onNavigate('requests')}>Open requests</button></div>{(data['booking-requests'] || []).slice(0, 5).map((booking) => <article className="list-card" key={booking.id}><div><strong>{booking.customer}</strong><small>{booking.service} · {formatDate(booking.date)}</small></div><span className="pill pending">{booking.status}</span></article>)}{!data['booking-requests']?.length && <EmptyState>No new booking requests.</EmptyState>}</section><section className="panel"><div className="panel-header"><h3>Recent notifications</h3><button className="button secondary small" type="button" onClick={() => onNavigate('notifications')}>View all</button></div>{(data.notifications || []).slice(0, 5).map((item) => <article className="list-card" key={item.id}><div><strong>{item.title}</strong><small>{item.message}</small></div><span className={`pill ${item.read ? 'inactive' : 'active'}`}>{item.read ? 'Read' : 'New'}</span></article>)}{!data.notifications?.length && <EmptyState>No recent notifications.</EmptyState>}</section></div>
  </section>;

  async function saveService(event) {
    event.preventDefault();
    setServiceImageError('');
    const body = {
      ...serviceForm,
      title: serviceForm.title.trim(),
      categoryId: serviceForm.categoryId ? Number(serviceForm.categoryId) : null,
      price: serviceForm.price === '' ? null : Number(serviceForm.price),
    };
    const result = await mutate(async () => {
      const response = await api(editingServiceId ? `/vendor/services/${editingServiceId}` : '/vendor/services', {
        method: editingServiceId ? 'PATCH' : 'POST', body: JSON.stringify(body),
      });
      const serviceId = Number(response.data?.id || editingServiceId);
      if (serviceImage && serviceId) {
        await api(`/vendor/media?type=service&serviceId=${serviceId}&filename=${encodeURIComponent(serviceImage.name)}`, {
          method: 'POST', body: serviceImage, headers: { 'Content-Type': serviceImage.type },
        });
      }
      setServiceForm(initialService);
      setEditingServiceId(null);
      setServiceImage(null);
      return response;
    }, editingServiceId ? 'Service updated.' : 'Service created.');
    if (!result && serviceImage) setServiceImageError('The service was not saved with its selected image. Review the error above.');
  }

  function editService(service) {
    setEditingServiceId(service.id);
    const rawStatus = statusKey(service.status);
    setServiceForm({
      title: service.title || service.name || '',
      description: service.description || '',
      categoryId: service.categoryId || '',
      price: service.price ?? '',
      currency: service.currency || 'ETB',
      status: rawStatus === 'published' || rawStatus === 'active' ? 'active' : 'draft',
    });
    setServiceImage(null);
  }

  async function submitServicePackage(event) {
    event.preventDefault();
    const extras = packageForm.extras.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [name, price, description = ''] = line.split('|').map((value) => value.trim());
      return { name, price: Number(price), description };
    });
    if (extras.some((extra) => !extra.name || !Number.isFinite(extra.price) || extra.price < 0)) {
      setError('Enter extras as one per line: name | price | optional description.');
      return;
    }
    await mutate(() => api(packageId
      ? `/vendor/services/${packageServiceId}/packages/${packageId}`
      : `/vendor/services/${packageServiceId}/packages`, {
      method: packageId ? 'PATCH' : 'POST',
      body: JSON.stringify({
        name: packageForm.name.trim(),
        description: packageForm.description,
        price: Number(packageForm.price),
        currency: packageForm.currency,
        minimumBooking: Number(packageForm.minimumBooking),
        includedFeatures: packageForm.includedFeatures.split('\n').map((item) => item.trim()).filter(Boolean),
        extras,
        isActive: packageForm.isActive,
      }),
    }), packageId ? 'Package updated.' : 'Package created.');
    setPackageId(null);
    setPackageForm(initialPackage);
  }

  async function saveBusinessProfile(event) {
    event.preventDefault();
    const body = {
      businessName: profileForm.businessName.trim(),
      categoryId: profileForm.categoryId ? Number(profileForm.categoryId) : null,
      city: profileForm.city.trim(),
      address: profileForm.address.trim() || null,
      description: profileForm.description.trim(),
      phone: profileForm.phone.trim() || null,
      website: profileForm.website.trim() || null,
      serviceAreas: profileForm.serviceAreas.split(',').map((value) => value.trim()).filter(Boolean),
      operatingHours: profileForm.operatingHours,
      notificationPreferences: profileForm.notificationPreferences,
      bookingPreferences: profileForm.bookingPreferences,
    };
    await mutate(() => api('/vendor/profile', { method: 'PATCH', body: JSON.stringify(body) }), 'Business profile updated.');
  }

  async function uploadMedia(event, type, serviceId) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPG, PNG, or WebP image no larger than 5 MB.');
      return;
    }
    const queryParams = new URLSearchParams({ type, filename: file.name });
    if (serviceId) queryParams.set('serviceId', serviceId);
    await mutate(() => api(`/vendor/media?${queryParams}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type } }), 'Image uploaded.');
  }

  async function updateBooking(booking, status) {
    const reason = bookingReasons[booking.id] || '';
    if (status === 'rejected' && reason.trim().length < 5) {
      setError('Enter a rejection reason of at least five characters.');
      return;
    }
    await mutate(() => api(`/platform/bookings/${booking.id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status, reason }),
    }), `Booking ${status.replaceAll('_', ' ')}.`);
  }

  if (view === 'services' || view === 'add-edit-services') return <section className="vendor-workspace">
    {feedback}<PageHeading eyebrow="SERVICE CATALOG" title={view === 'services' ? 'My services' : 'Add and edit services'} description="Manage service listings, publication state, packages, extras, and images." action={<button className="button" type="button" onClick={() => { setEditingServiceId(null); setServiceForm(initialService); }}>New service</button>} />
    <div className="vendor-list-pagination"><span>{matchingServices.length} services · page {servicePage} of {servicePageCount}</span><div><button className="button secondary small" type="button" disabled={servicePage <= 1} onClick={() => setServicePage((current) => current - 1)}>Previous</button><button className="button secondary small" type="button" disabled={servicePage >= servicePageCount} onClick={() => setServicePage((current) => current + 1)}>Next</button></div></div>
    <div className="panel vendor-workspace-filters"><label className="field"><span>Search services</span><div className="vendor-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or description" /></div></label><label className="field"><span>Category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{categories.map((category) => <option value={category.name} key={category.id}>{category.name}</option>)}</select></label><label className="field"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="inactive">Inactive</option></select></label><label className="field"><span>Sort by</span><select value={serviceSort} onChange={(event) => setServiceSort(event.target.value)}><option value="name">Name</option><option value="price">Price</option><option value="status">Status</option></select></label></div>
    <form className="panel vendor-workspace-form" onSubmit={saveService}><h3>{editingServiceId ? 'Edit service' : 'New service'}</h3><div className="vendor-form-grid"><label className="field"><span>Service name</span><input required minLength="2" maxLength="180" value={serviceForm.title} onChange={(event) => setServiceForm((current) => ({ ...current, title: event.target.value }))} /></label><label className="field"><span>Category</span><select value={serviceForm.categoryId} onChange={(event) => setServiceForm((current) => ({ ...current, categoryId: event.target.value }))}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="field"><span>Price</span><input type="number" min="0" max="100000000" step="0.01" value={serviceForm.price} onChange={(event) => setServiceForm((current) => ({ ...current, price: event.target.value }))} /></label><label className="field"><span>Currency</span><input required maxLength="3" minLength="3" value={serviceForm.currency} onChange={(event) => setServiceForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></label><label className="field"><span>Publication</span><select value={serviceForm.status} onChange={(event) => setServiceForm((current) => ({ ...current, status: event.target.value }))}><option value="draft">Draft / unpublished</option><option value="active">Publish</option></select></label><label className="field"><span>Service images</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setServiceImage(event.target.files?.[0] || null)} />{serviceImage && <small>{serviceImage.name}</small>}</label><label className="field vendor-form-wide"><span>Description</span><textarea rows="4" maxLength="10000" value={serviceForm.description} onChange={(event) => setServiceForm((current) => ({ ...current, description: event.target.value }))} /></label></div>{serviceImageError && <p className="alert error">{serviceImageError}</p>}<button className="button" disabled={busy}>{busy ? 'Saving...' : editingServiceId ? 'Save service' : 'Create service'}</button></form>
    <div className="vendor-service-list">{filteredServices.map((service) => <article className="panel vendor-service-card" key={service.id}><div className="vendor-service-copy"><span className={`pill ${statusKey(service.status)}`}>{service.status}</span><h3>{service.title || service.name}</h3><p>{service.category} · {money(service.price, service.currency)} · {service.bookings || 0} bookings</p><p>{service.description}</p><div className="vendor-media-row">{(data.media || []).filter((media) => Number(media.serviceId) === Number(service.id)).map((media) => <VendorMediaImage api={api} media={media} alt={`${service.title} portfolio`} key={media.id}/>)}</div><label className="vendor-upload-inline"><span>Add service image</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => uploadMedia(event, 'service', service.id)} /></label></div><div className="vendor-actions"><button className="button secondary small" type="button" onClick={() => editService(service)}>Edit</button><button className="button secondary small" type="button" onClick={() => { setPackageServiceId(String(service.id)); setPackageId(null); setPackageForm({ ...initialPackage, currency: service.currency || 'ETB' }); }}>Manage packages</button><button className="button secondary small" type="button" disabled={busy} onClick={() => mutate(() => api(`/vendor/services/${service.id}`, { method: 'PATCH', body: JSON.stringify({ status: statusKey(service.status) === 'published' || statusKey(service.status) === 'active' ? 'draft' : 'active' }) }), statusKey(service.status) === 'published' ? 'Service unpublished.' : 'Service published.')}>{statusKey(service.status) === 'published' ? 'Unpublish' : 'Publish'}</button><button className="button danger small" type="button" disabled={busy} onClick={() => window.confirm(`Archive ${service.title || service.name}? Existing booking history will remain.`) && mutate(() => api(`/vendor/services/${service.id}`, { method: 'DELETE' }), 'Service archived.')}>Archive</button></div></article>)}{!filteredServices.length && <EmptyState>No services match the selected filters.</EmptyState>}</div>
    {packageServiceId && <form className="panel vendor-workspace-form" onSubmit={submitServicePackage}><h3>{packageId ? 'Edit service package' : 'New service package'}</h3><div className="vendor-form-grid"><label className="field"><span>Package name</span><input required minLength="2" maxLength="120" value={packageForm.name} onChange={(event) => setPackageForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="field"><span>Price</span><input type="number" min="0" max="100000000" step="0.01" required value={packageForm.price} onChange={(event) => setPackageForm((current) => ({ ...current, price: event.target.value }))} /></label><label className="field"><span>Minimum booking quantity</span><input type="number" min="1" max="100000" required value={packageForm.minimumBooking} onChange={(event) => setPackageForm((current) => ({ ...current, minimumBooking: event.target.value }))} /></label><label className="field"><span>Included features (one per line)</span><textarea value={packageForm.includedFeatures} onChange={(event) => setPackageForm((current) => ({ ...current, includedFeatures: event.target.value }))} /></label><label className="field"><span>Optional extras (name | price | description per line)</span><textarea value={packageForm.extras} onChange={(event) => setPackageForm((current) => ({ ...current, extras: event.target.value }))} /></label><label className="field vendor-form-wide"><span>Description</span><textarea maxLength="1000" value={packageForm.description} onChange={(event) => setPackageForm((current) => ({ ...current, description: event.target.value }))} /></label></div><div className="vendor-actions"><button className="button" disabled={busy}>{busy ? 'Saving...' : packageId ? 'Update package' : 'Create package'}</button><button className="button secondary" type="button" onClick={() => setPackageServiceId('')}>Close</button></div><div className="vendor-package-list">{(data.packages || []).filter((item) => Number(item.serviceId) === Number(packageServiceId)).map((item) => <article className="vendor-package-row" key={item.id}><div><strong>{item.name}</strong><small>{item.serviceTitle} · {money(item.price, item.currency)} · minimum {item.minimumBooking}</small><small>{item.includedFeatures.join(', ')}</small></div><div className="vendor-actions"><button className="button secondary small" type="button" onClick={() => { setPackageId(item.id); setPackageForm({ name: item.name, description: item.description || '', price: String(item.price), currency: item.currency, minimumBooking: String(item.minimumBooking), includedFeatures: item.includedFeatures.join('\n'), extras: item.extras.map((extra) => `${extra.name} | ${extra.price} | ${extra.description || ''}`).join('\n'), isActive: item.isActive }); }}>Edit</button><button className="button danger small" type="button" disabled={busy} onClick={() => mutate(() => api(`/vendor/services/${packageServiceId}/packages/${item.id}`, { method: 'DELETE' }), 'Package removed.')}>Remove</button></div></article>)}</div></form>}
  </section>;

  if (view === 'profile') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="BUSINESS PROFILE" title="Business profile" description="Update public business details, service coverage, and brand imagery." />
    <form className="panel vendor-workspace-form" onSubmit={saveBusinessProfile}><div className="vendor-form-grid"><label className="field"><span>Business name</span><input required minLength="2" maxLength="160" value={profileForm.businessName || ''} onChange={(event) => setProfileForm((current) => ({ ...current, businessName: event.target.value }))} /></label><label className="field"><span>Business category</span><select value={profileForm.categoryId || ''} onChange={(event) => setProfileForm((current) => ({ ...current, categoryId: event.target.value }))}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="field"><span>City</span><input maxLength="120" value={profileForm.city || ''} onChange={(event) => setProfileForm((current) => ({ ...current, city: event.target.value }))} /></label><label className="field"><span>Address</span><input maxLength="255" value={profileForm.address || ''} onChange={(event) => setProfileForm((current) => ({ ...current, address: event.target.value }))} /></label><label className="field"><span>Contact phone</span><input maxLength="40" value={profileForm.phone || ''} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} /></label><label className="field"><span>Website</span><input type="url" maxLength="255" value={profileForm.website || ''} onChange={(event) => setProfileForm((current) => ({ ...current, website: event.target.value }))} /></label><label className="field"><span>Service areas (comma separated)</span><input value={profileForm.serviceAreas || ''} onChange={(event) => setProfileForm((current) => ({ ...current, serviceAreas: event.target.value }))} /></label><label className="field vendor-form-wide"><span>Business description</span><textarea rows="4" maxLength="10000" value={profileForm.description || ''} onChange={(event) => setProfileForm((current) => ({ ...current, description: event.target.value }))} /></label></div><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Save business profile'}</button></form>
    <section className="panel vendor-media-management"><h3>Business images</h3><div className="vendor-media-upload-grid">{[['logo', 'Logo'], ['cover', 'Cover image'], ['portfolio', 'Portfolio photo']].map(([type, label]) => <label className="vendor-upload-inline" key={type}><span>{label} (JPG, PNG, WebP; up to 5 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => uploadMedia(event, type)} /></label>)}</div><div className="vendor-media-row">{(data.media || []).filter((media) => !media.serviceId).map((media) => <article className="vendor-media-item" key={media.id}><VendorMediaImage api={api} media={media} alt={media.type}/><span>{media.type}: {media.name}</span><button className="icon-button" type="button" aria-label={`Remove ${media.name}`} disabled={busy} onClick={() => mutate(() => api(`/vendor/media/${media.id}`, { method: 'DELETE' }), 'Image removed.')}><Trash2 size={16}/></button></article>)}</div></section>
  </section>;

  if (view === 'pricing') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="PRICING" title="Packages and extras" description="Manage itemized package prices and optional extras for each service." />
    {(data.packages || []).map((item) => <article className="panel vendor-package-row" key={item.id}><div><span className={`pill ${item.isActive ? 'active' : 'inactive'}`}>{item.isActive ? 'Published' : 'Inactive'}</span><h3>{item.name}</h3><p>{item.serviceTitle}</p><small>{item.description}</small><strong>{money(item.price, item.currency)}</strong><small>Includes: {item.includedFeatures.join(', ') || 'No features listed'}</small><small>Minimum booking: {item.minimumBooking}</small>{item.extras.map((extra) => <small key={extra.name}>Extra: {extra.name} · {money(extra.price, item.currency)}</small>)}</div><div className="vendor-actions"><button className="button secondary small" type="button" onClick={() => { setPackageServiceId(String(item.serviceId)); setPackageId(item.id); setPackageForm({ name: item.name, description: item.description || '', price: String(item.price), currency: item.currency, minimumBooking: String(item.minimumBooking), includedFeatures: item.includedFeatures.join('\n'), extras: item.extras.map((extra) => `${extra.name} | ${extra.price} | ${extra.description || ''}`).join('\n'), isActive: item.isActive }); setServiceForm(initialService); }}>Edit package</button><button className="button secondary small" type="button" onClick={() => setPackageServiceId(String(item.serviceId))}>Add another package</button></div></article>)}{!data.packages?.length && <EmptyState>No service packages created. Add one from My Services.</EmptyState>}
  </section>;

  if (view === 'categories') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="CATEGORIES" title="Service categories" description="Administrators manage the official category list. Select an active category on each service." />{categories.map((category) => <article className="list-card" key={category.id}><div><strong>{category.name}</strong><small>{category.description}</small></div><span className="pill active">Active</span></article>)}{!categories.length && <EmptyState>No active categories are available.</EmptyState>}</section>;

  if (view === 'availability') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="SCHEDULE" title="Availability calendar" description="Set available or blocked dates. Confirmed bookings are protected from schedule changes." action={<label className="field vendor-note-field"><span>Schedule note</span><input maxLength="255" value={availabilityNote} onChange={(event) => setAvailabilityNote(event.target.value)} placeholder="Optional reason" /></label>} />
    <CalendarGrid availability={data.availability?.schedule || []} bookings={data.bookings || []} busy={busy} onSetDate={(date, status) => mutate(() => api('/vendor/availability', { method: 'POST', body: JSON.stringify({ date, status, note: availabilityNote }) }), `Date marked ${status}.`)} onRemoveDate={(date) => mutate(() => api(`/vendor/availability/${date}`, { method: 'DELETE' }), 'Availability removed.')} />
  </section>;

  if (view === 'requests' || view === 'confirmed' || view === 'history') {
    const bookings = view === 'requests' ? data['booking-requests'] || [] : view === 'confirmed' ? data.bookings || [] : data.history || [];
    const matchingBookings = bookings.filter((booking) => `${booking.customer} ${booking.event} ${booking.service} ${booking.date} ${booking.status}`.toLowerCase().includes(query.trim().toLowerCase()))
      .filter((booking) => !statusFilter || statusKey(booking.status) === statusFilter);
    const bookingPageCount = Math.max(1, Math.ceil(matchingBookings.length / pageSize));
    const filtered = matchingBookings.slice((bookingPage - 1) * pageSize, bookingPage * pageSize);
    const title = view === 'requests' ? 'Booking requests' : view === 'confirmed' ? 'Confirmed bookings' : 'Booking history';
    return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="BOOKING MANAGEMENT" title={title} description="Review event context, customer requirements, status, and agreed pricing." />
      <div className="panel vendor-workspace-filters"><label className="field"><span>Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, event, service, date" /></label><label className="field"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{[...new Set(bookings.map((item) => statusKey(item.status)))].map((status) => <option value={status} key={status}>{status.replaceAll('_', ' ')}</option>)}</select></label></div>
      <div className="vendor-list-pagination"><span>{matchingBookings.length} bookings · page {bookingPage} of {bookingPageCount}</span><div><button className="button secondary small" type="button" disabled={bookingPage <= 1} onClick={() => setBookingPage((current) => current - 1)}>Previous</button><button className="button secondary small" type="button" disabled={bookingPage >= bookingPageCount} onClick={() => setBookingPage((current) => current + 1)}>Next</button></div></div>
      <div className="vendor-booking-list">{filtered.map((booking) => <article className="panel vendor-booking-card" key={booking.id}><div><span className={`pill ${statusKey(booking.status)}`}>{booking.status}</span><h3>{booking.event || booking.eventTitle || `Booking #${booking.id}`}</h3><p>{booking.customer} · {booking.service} · {formatDate(booking.date)}</p><p>{money(booking.amount, booking.currency)}</p>{booking.eventLocation && <small>{booking.eventLocation}</small>}</div>{view === 'requests' && <div className="vendor-actions"><button className="button secondary small" type="button" disabled={busy} onClick={() => updateBooking(booking, 'under_review')}>Request details</button><button className="button small" type="button" disabled={busy} onClick={() => updateBooking(booking, 'accepted')}>Accept</button><label className="field"><span>Rejection reason</span><input minLength="5" maxLength="500" required value={bookingReasons[booking.id] || ''} onChange={(event) => setBookingReasons((current) => ({ ...current, [booking.id]: event.target.value }))} /></label><button className="button danger small" type="button" disabled={busy || (bookingReasons[booking.id] || '').trim().length < 5} onClick={() => updateBooking(booking, 'rejected')}>Reject</button></div>}{view === 'confirmed' && statusKey(booking.status) === 'accepted' && <button className="button secondary small" type="button" disabled={busy} onClick={() => updateBooking(booking, 'completed')}>Mark completed</button>}</article>)}{!filtered.length && <EmptyState>No bookings match this view.</EmptyState>}</div>
    </section>;
  }

  if (view === 'quotations') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="QUOTATIONS" title="Quotation requests" description="Review organizer requirements, prepare a price, and submit or decline a proposal." />
    {(data.quotations || []).map((quote) => <article className="panel vendor-quote-card" key={quote.id}>
      <div>
        <span className={`pill ${statusKey(quote.status)}`}>{quote.status}</span>
        <h3>{quote.customer} · {quote.service}</h3>
        <p>{quote.event || 'Event details not linked'}{quote.eventType ? ` · ${quote.eventType}` : ''}{quote.eventDate ? ` · ${String(quote.eventDate).slice(0, 16)}` : ''}{quote.eventLocation ? ` · ${quote.eventLocation}` : ''}{quote.validUntil ? ` · Valid through ${quote.validUntil}` : ''}</p>
        {(quote.guestCount || quote.budget !== null) && <p>{quote.guestCount ? `${quote.guestCount} guests` : ''}{quote.budget !== null ? ` · Budget ${money(quote.budget, quote.currency)}` : ''}</p>}
        {quote.requiredServices && <p><strong>Requested scope:</strong> {quote.requiredServices}</p>}
        {quote.additionalRequirements && <p><strong>Requirements:</strong> {quote.additionalRequirements}</p>}
        {quote.requestMessage && <p><strong>Message:</strong> {quote.requestMessage}</p>}
        {quote.contactPhone && <p><strong>Customer phone:</strong> <a href={`tel:${quote.contactPhone}`}>{quote.contactPhone}</a></p>}
        {quote.notes && <p>{quote.notes}</p>}
        {quote.amount > 0 && <strong>{money(quote.amount, quote.currency)}</strong>}
      </div>
      {['Draft', 'revision_requested'].includes(quote.status) && <form className="vendor-quote-form" onSubmit={(event) => { event.preventDefault(); mutate(() => api(`/platform/quotations/${quote.id}/respond`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', amount: Number(quoteForm.amount), notes: quoteForm.notes, validUntil: quoteForm.validUntil }) }), 'Quotation submitted.'); setQuoteForm({ amount: '', notes: '', validUntil: '' }); }}><label className="field"><span>Quote amount ({quote.currency})</span><input type="number" min="0" max="100000000" step="0.01" required value={quoteForm.amount} onChange={(event) => setQuoteForm((current) => ({ ...current, amount: event.target.value }))} /></label><label className="field"><span>Terms / additional costs</span><textarea maxLength="2000" value={quoteForm.notes} onChange={(event) => setQuoteForm((current) => ({ ...current, notes: event.target.value }))} /></label><label className="field"><span>Valid until</span><input type="date" value={quoteForm.validUntil} onChange={(event) => setQuoteForm((current) => ({ ...current, validUntil: event.target.value }))} /></label><div className="vendor-actions"><button className="button" disabled={busy || !quoteForm.amount}>{busy ? 'Submitting...' : 'Send quotation'}</button><button className="button danger" type="button" disabled={busy} onClick={() => mutate(() => api(`/platform/quotations/${quote.id}/respond`, { method: 'PATCH', body: JSON.stringify({ status: 'declined' }) }), 'Quotation declined.')}>Decline</button></div></form>}
    </article>)}{!data.quotations?.length && <EmptyState>No quotation requests yet.</EmptyState>}
  </section>;

  if (view === 'payments') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="TRANSACTIONS" title="Payments and earnings" description="Transaction status is read-only and reflects recorded payment provider results." />
    <div className="metric-grid"><article className="metric-card"><p>Verified earnings</p><strong>{money(data.payments?.earnings)}</strong><span>Payments recorded as paid</span></article><article className="metric-card"><p>Pending payment records</p><strong>{money(data.payments?.pendingPayouts)}</strong><span>Pending or authorized records</span></article></div>
    <div className="table-wrap"><table><thead><tr><th>Date</th><th>Booking</th><th>Provider</th><th>Reference</th><th>Status</th><th>Amount</th></tr></thead><tbody>{(data.payments?.transactions || []).map((payment) => <tr key={payment.id}><td>{formatDate(payment.date)}</td><td>#{payment.bookingId}</td><td>{payment.provider || '—'}</td><td>{payment.reference || '—'}</td><td><span className={`pill ${statusKey(payment.status)}`}>{payment.status}</span></td><td>{money(payment.amount, payment.currency)}</td></tr>)}</tbody></table></div>{!data.payments?.transactions?.length && <EmptyState>No payment records yet.</EmptyState>}
    <section className="panel"><h3>Refund history</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Payment</th><th>Reason</th><th>Status</th><th>Decision</th><th>Amount</th></tr></thead><tbody>{(data.payments?.refunds || []).map((refund) => <tr key={refund.id}><td>{formatDate(refund.createdAt)}</td><td>#{refund.paymentId}</td><td>{refund.reason}</td><td><span className={`pill ${statusKey(refund.status)}`}>{refund.status}</span></td><td>{refund.decisionReason || '—'}</td><td>{money(refund.amount, refund.currency)}</td></tr>)}</tbody></table></div>{!data.payments?.refunds?.length && <p className="muted">No refund records for this vendor.</p>}</section>
  </section>;

  if (view === 'messages') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="CONVERSATIONS" title="Organizer messages" description="Reply inside the booking conversation so event context and delivery history stay together." />
    <form className="panel vendor-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(() => api('/vendor/messages', { method: 'POST', body: JSON.stringify({ bookingId: Number(messageForm.bookingId), body: messageForm.body }) }), 'Message sent.'); setMessageForm({ bookingId: '', body: '' }); }}><label className="field"><span>Booking</span><select required value={messageForm.bookingId} onChange={(event) => setMessageForm((current) => ({ ...current, bookingId: event.target.value }))}><option value="">Choose booking</option>{[...(data['booking-requests'] || []), ...(data.bookings || [])].map((booking) => <option value={booking.id} key={booking.id}>{booking.event || booking.eventTitle || `Booking #${booking.id}`} · {booking.customer}</option>)}</select></label><label className="field"><span>Message</span><textarea required maxLength="4000" value={messageForm.body} onChange={(event) => setMessageForm((current) => ({ ...current, body: event.target.value }))} /></label><button className="button" disabled={busy || !messageForm.bookingId}>{busy ? 'Sending...' : 'Send message'}</button></form>
    {(data.messages || []).map((message) => <article className={`panel vendor-message ${message.unread ? 'unread' : ''}`} key={message.id}><div><strong>{message.senderId === Number(user.id) ? 'You' : message.sender}</strong><small>{message.event} · Booking #{message.bookingId} · {formatDate(message.createdAt)}</small><p>{message.body}</p></div>{message.unread && Number(message.recipientId) === Number(user.id) && <button className="button secondary small" type="button" disabled={busy} onClick={() => mutate(() => api(`/vendor/messages/${message.id}/read`, { method: 'POST' }), 'Message marked as read.')}>Mark read</button>}</article>)}{!data.messages?.length && <EmptyState>No booking conversations yet.</EmptyState>}
  </section>;

  if (view === 'coordination') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="EVENT PREPARATION" title="Organizer coordination tasks" description="Track preparation requests assigned to your confirmed bookings." />
    {(data.tasks || []).map((task) => <article className="panel vendor-message" key={task.id}><div><span className={`pill ${task.status}`}>{task.status.replaceAll('_', ' ')}</span><h3>{task.title}</h3><p>{task.event_title} · {task.service_description} · {task.organizer_name}</p><small>{task.details}</small><small>Due {formatDate(task.due_at)}</small></div><label className="field"><span>Update progress</span><select value={task.status} onChange={(event) => mutate(() => api(`/vendor/tasks/${task.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }), 'Task progress updated.')}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="blocked">Blocked</option></select></label></article>)}{!data.tasks?.length && <EmptyState>No coordination tasks assigned.</EmptyState>}
  </section>;

  if (view === 'reviews') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="CUSTOMER FEEDBACK" title="Reviews and ratings" description="Read published feedback and report abusive or inappropriate reviews to the administrator." />
    <div className="vendor-review-summary"><strong>{data.overview?.averageRating ? `${Number(data.overview.averageRating).toFixed(2)} / 5` : 'No rating yet'}</strong><span>Average rating from published reviews</span></div>
    {(data.reviews || []).map((review) => <article className="panel vendor-review" key={review.id}><div><span className="vendor-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span><strong>{review.customer}</strong><p>{review.comment || 'No written comment.'}</p><small>{formatDate(review.createdAt)}</small></div><button className="button secondary small" type="button" onClick={() => { setReviewReport(review); setReviewReason(''); }}>Report review</button></article>)}{!data.reviews?.length && <EmptyState>No reviews yet.</EmptyState>}
    {reviewReport && <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && setReviewReport(null)}><form className="modal" onSubmit={(event) => { event.preventDefault(); mutate(() => api(`/vendor/reviews/${reviewReport.id}/report`, { method: 'POST', body: JSON.stringify({ reason: reviewReason }) }), 'Review sent to administrators for review.'); setReviewReport(null); }}><div className="modal-head"><h2>Report review</h2><button className="icon-button" type="button" aria-label="Close" onClick={() => setReviewReport(null)}>×</button></div><div className="modal-body"><p>{reviewReport.customer}: {reviewReport.comment}</p><label className="field"><span>Reason</span><textarea required minLength="5" maxLength="500" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label></div><div className="modal-foot"><button className="button secondary" type="button" onClick={() => setReviewReport(null)}>Cancel</button><button className="button" disabled={busy || reviewReason.trim().length < 5}>Submit report</button></div></form></div>}
  </section>;

  if (view === 'notifications') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="UPDATES" title="Notifications" description="Booking, quotation, message, review, payment, and verification updates sent to this account." action={<button className="button secondary" type="button" disabled={busy || !data.notifications?.some((item) => !item.read)} onClick={() => mutate(() => api('/vendor/notifications/read-all', { method: 'POST' }), 'All notifications marked as read.')}><Check size={16}/> Mark all read</button>} />
    {(data.notifications || []).map((item) => <article className={`panel vendor-message ${item.read ? '' : 'unread'}`} key={item.id}><div><strong>{item.title}</strong><small>{item.type} · {formatDate(item.createdAt)}</small><p>{item.message}</p></div>{!item.read && <button className="button secondary small" type="button" disabled={busy} onClick={() => mutate(() => api(`/vendor/notifications/${item.id}/read`, { method: 'POST' }), 'Notification marked as read.')}><Bell size={14}/> Mark read</button>}</article>)}{!data.notifications?.length && <EmptyState>No notifications yet.</EmptyState>}
  </section>;

  if (view === 'reports') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="ANALYTICS" title="Business reports" description="Review service demand, booking outcomes, and verified payment trends." />
    <div className="vendor-workspace-filters panel"><label className="field"><span>Date from</span><input type="date" value={reportFilters.dateFrom} onChange={(event) => setReportFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label><label className="field"><span>Date to</span><input type="date" value={reportFilters.dateTo} onChange={(event) => setReportFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label><label className="field"><span>Service</span><select value={reportFilters.serviceId} onChange={(event) => setReportFilters((current) => ({ ...current, serviceId: event.target.value }))}><option value="">All services</option>{services.map((service) => <option value={service.id} key={service.id}>{service.title}</option>)}</select></label><label className="field"><span>Status</span><select value={reportFilters.status} onChange={(event) => setReportFilters((current) => ({ ...current, status: event.target.value }))}><option value="">All statuses</option>{['requested', 'under_review', 'quoted', 'accepted', 'completed', 'rejected', 'cancelled'].map((status) => <option key={status}>{status}</option>)}</select></label><button className="button" type="button" onClick={() => mutate(async () => { const params = new URLSearchParams(Object.fromEntries(Object.entries(reportFilters).filter(([, value]) => value))); const response = await api(`/vendor/reports?${params}`); setReportData(response.data); }, 'Report filters applied.')}>Apply filters</button></div>
    {(reportData || data.reports) && <div className="vendor-report-grid"><article className="panel"><h3>Bookings by status</h3>{Object.entries((reportData || data.reports).bookingStatus || {}).map(([status, count]) => <div className="report-row" key={status}><span>{status.replaceAll('_', ' ')}</span><strong>{count}</strong></div>)}</article><article className="panel"><h3>Popular services</h3>{((reportData || data.reports).popularServices || []).map((service) => <div className="report-row" key={service}><span>{service}</span><strong>Bookings</strong></div>)}</article><article className="panel"><h3>Paid transactions by month</h3>{Object.entries((reportData || data.reports).earningsByDate || {}).map(([month, amount]) => <div className="report-row" key={month}><span>{month}</span><strong>{money(amount)}</strong></div>)}</article></div>}
  </section>;

  if (view === 'account') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="ACCOUNT SECURITY" title="Profile and account" description="Update personal contact details, profile photo from the header, and password." />
    <div className="two-column-layout"><form className="panel vendor-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(() => api('/vendor/account', { method: 'PATCH', body: JSON.stringify(accountForm) }), 'Personal information updated.'); }}><h3>Personal information</h3><label className="field"><span>Full name</span><input required minLength="2" maxLength="160" value={accountForm.fullName} onChange={(event) => setAccountForm((current) => ({ ...current, fullName: event.target.value }))} /></label><label className="field"><span>Email</span><input value={data.account?.email || user.email || ''} disabled /></label><label className="field"><span>Phone</span><input maxLength="40" value={accountForm.phone} onChange={(event) => setAccountForm((current) => ({ ...current, phone: event.target.value }))} /></label><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Save personal information'}</button></form>
      <form className="panel vendor-workspace-form" onSubmit={(event) => { event.preventDefault(); mutate(async () => { await api('/vendor/account/password', { method: 'POST', body: JSON.stringify(passwordForm) }); setPasswordForm({ currentPassword: '', newPassword: '' }); }, 'Password updated.'); }}><h3>Change password</h3><label className="field"><span>Current password</span><input type="password" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} /></label><label className="field"><span>New password</span><input type="password" autoComplete="new-password" required minLength="12" maxLength="16" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} /></label><small>Use 12-16 characters with uppercase, lowercase, and a number.</small><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button></form></div>
  </section>;

  if (view === 'settings') return <section className="vendor-workspace">{feedback}<PageHeading eyebrow="BUSINESS SETTINGS" title="Business and booking preferences" description="Configure operating hours, service areas, and notification preferences." />
    {profileLoaded && <form className="panel vendor-workspace-form" onSubmit={saveBusinessProfile}><h3>Operating hours</h3><div className="vendor-form-grid">{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => <label className="field" key={day}><span>{day}</span><input maxLength="80" placeholder="Closed or 09:00-17:00" value={profileForm.operatingHours?.[day.toLowerCase()] || ''} onChange={(event) => setProfileForm((current) => ({ ...current, operatingHours: { ...current.operatingHours, [day.toLowerCase()]: event.target.value } }))} /></label>)}</div><h3>Notification preferences</h3><div className="vendor-toggle-grid">{[['bookingRequests', 'Booking requests'], ['messages', 'Messages'], ['quotations', 'Quotations'], ['payments', 'Payments']].map(([key, label]) => <label key={key}><input type="checkbox" checked={profileForm.notificationPreferences?.[key] !== false} onChange={(event) => setProfileForm((current) => ({ ...current, notificationPreferences: { ...current.notificationPreferences, [key]: event.target.checked } }))} />{label}</label>)}</div><h3>Booking preferences</h3><div className="vendor-toggle-grid">{[['acceptsCustomQuotes', 'Accept custom quote requests'], ['allowSameDay', 'Allow same-day requests']].map(([key, label]) => <label key={key}><input type="checkbox" checked={profileForm.bookingPreferences?.[key] === true} onChange={(event) => setProfileForm((current) => ({ ...current, bookingPreferences: { ...current.bookingPreferences, [key]: event.target.checked } }))} />{label}</label>)}</div><p className="muted">Payment account details are not collected here; use the platform's configured secure provider flow.</p><button className="button" disabled={busy}>{busy ? 'Saving...' : 'Save business settings'}</button></form>}
  </section>;

  return <section className="vendor-workspace">{feedback}<EmptyState>This vendor section is not available.</EmptyState></section>;
}