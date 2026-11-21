import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import apiClient from './api/axios.js';

const presets = [
  ['today', 'Today'],
  ['7days', 'Last 7 Days'],
  ['30days', 'Last 30 Days'],
  ['90days', 'Last 90 Days'],
  ['monthly', 'Monthly'],
  ['yearly', 'Yearly'],
  ['custom', 'Custom Range'],
];

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function dashboardQuery(range) {
  const params = new URLSearchParams({ range: range.range });
  if (range.range === 'custom') {
    params.set('from', range.from);
    params.set('to', range.to);
  }
  return params.toString();
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString();
}

function formatMoney(value, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatPeriod(value) {
  return value.slice(5);
}

function LoadingDashboard() {
  return <section className="dashboard-skeleton" aria-label="Loading dashboard data" aria-busy="true">
    <div className="dashboard-skeleton-heading"/>
    <div className="dashboard-skeleton-controls"/>
    <div className="dashboard-skeleton-metrics">
      {Array.from({ length: 7 }, (_, index) => <div className="dashboard-skeleton-card" key={index}/>)}
    </div>
    <div className="dashboard-skeleton-charts">
      <div className="dashboard-skeleton-chart"/>
      <div className="dashboard-skeleton-chart"/>
      <div className="dashboard-skeleton-chart"/>
    </div>
  </section>;
}

function MetricCard({ title, total, values, onClick }) {
  return <button type="button" className="metric-card dashboard-metric dashboard-metric-link" onClick={onClick}>
    <span className="dashboard-metric-title">{title}</span>
    <strong>{formatNumber(total)}</strong>
    {values.length > 0 && <span className="dashboard-metric-details">
      {values.map(([label, value]) => <span key={label}><span>{label}</span><b>{formatNumber(value)}</b></span>)}
    </span>}
  </button>;
}

export default function AdminDashboardOverview({ onNavigate }) {
  const [selectedPreset, setSelectedPreset] = useState('30days');
  const [customRange, setCustomRange] = useState(() => {
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 29);
    return { from: isoDate(from), to: isoDate(to) };
  });
  const [customError, setCustomError] = useState('');
  const [appliedRange, setAppliedRange] = useState({ range: '30days' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const requestId = useRef(0);
  const query = useMemo(() => dashboardQuery(appliedRange), [appliedRange]);
  const today = isoDate(new Date());
  const revenueCurrencies = useMemo(
    () => [...new Set((data?.charts?.revenue || []).map((row) => row.currency))],
    [data],
  );
  const revenueChartData = useMemo(() => {
    const rowsByPeriod = new Map();
    for (const row of data?.charts?.revenue || []) {
      if (!rowsByPeriod.has(row.period)) rowsByPeriod.set(row.period, { period: row.period });
      rowsByPeriod.get(row.period)[row.currency] = Number(row.total);
    }
    return [...rowsByPeriod.values()];
  }, [data]);

  useEffect(() => {
    const controller = new AbortController();
    const id = requestId.current + 1;
    requestId.current = id;
    let timedOut = false;
    setLoading(true);
    setError('');
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);

    apiClient.get(`/admin/dashboard/overview?${query}`, { signal: controller.signal })
      .then((response) => {
        if (!response.data?.data || typeof response.data.data !== 'object') {
          throw new Error('The dashboard returned an invalid response.');
        }
        setData(response.data.data);
        setLastUpdated(new Date());
      })
      .catch((issue) => {
        if (controller.signal.aborted && !timedOut) return;
        if (issue.status === 401) {
          setError('Your administrator session has expired. Redirecting to sign in.');
          window.dispatchEvent(new Event('eventhub:auth-invalidated'));
          return;
        }
        setError(timedOut
          ? 'The dashboard request timed out after 10 seconds. Please retry.'
          : issue.message || 'Dashboard data could not be loaded.');
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (requestId.current === id) setLoading(false);
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, refreshKey]);

  useEffect(() => {
    const interval = window.setInterval(() => setRefreshKey((current) => current + 1), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  function choosePreset(value) {
    setSelectedPreset(value);
    setCustomError('');
    if (value !== 'custom') setAppliedRange({ range: value });
  }

  function applyCustomRange(event) {
    event.preventDefault();
    if (!customRange.from || !customRange.to) {
      setCustomError('Choose both a start and end date.');
      return;
    }
    if (customRange.from > customRange.to) {
      setCustomError('The start date must be on or before the end date.');
      return;
    }
    if (customRange.from > today || customRange.to > today) {
      setCustomError('Dates cannot be in the future.');
      return;
    }
    setCustomError('');
    setSelectedPreset('custom');
    setAppliedRange({ range: 'custom', ...customRange });
  }

  if (!data && loading) return <LoadingDashboard/>;
  if (!data && error) return <section className="dashboard-error-card" role="alert">
    <strong>Dashboard data is unavailable</strong>
    <p>{error}</p>
    <button className="button" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Retry</button>
  </section>;
  if (!data) return null;

  const numberOfRecords = (rows, key = 'total') => rows.some((row) => Number(row[key]) > 0);
  const metrics = [
    { title: 'Registered users', total: data.users.total, values: [
      ['Administrators', data.users.administrators],
      ['Customers', data.users.customers],
      ['Organizers', data.users.organizers],
      ['Vendors', data.users.vendors],
    ], target: 'users' },
    { title: 'Vendors', total: data.vendors.total, values: [
      ['Verified', data.vendors.verified], ['Pending applications', data.vendors.pending],
    ], target: 'vendors' },
    { title: 'Events', total: data.events.total, values: [
      ['Published', data.events.published], ['Upcoming', data.events.upcoming],
    ], target: 'events' },
    { title: 'Bookings', total: data.bookings.total, values: [
      ['Pending', data.bookings.pending], ['Confirmed', data.bookings.confirmed],
      ['Completed', data.bookings.completed], ['Cancelled', data.bookings.cancelled],
    ], target: 'bookings' },
    { title: 'Payments', total: data.payments.total, values: [
      ['Successful', data.payments.successful],
      ['Pending / authorized', data.payments.pendingAuthorized],
      ['Refund requests', data.payments.refundRequests],
    ], target: 'payments' },
    { title: 'Open complaints', total: data.complaints.open, values: [
      ['All complaints', data.complaints.total],
    ], target: 'messages' },
    { title: 'Reviews', total: data.reviews.total, values: [], target: 'reviews' },
  ];

  return <div className="admin-live-dashboard">
    <header className="welcome dashboard-live-heading">
      <div>
        <p className="eyebrow">ADMIN CONSOLE</p>
        <h2>Dashboard Overview</h2>
        <p className="muted">Live database metrics for {data.period.from} through {data.period.to}</p>
      </div>
      <div className="dashboard-header-actions">
        <span className="live-dot" title={lastUpdated ? `Last updated ${lastUpdated.toLocaleString()}` : 'Live database data'}>
          Live data{lastUpdated ? ` · ${lastUpdated.toLocaleTimeString()}` : ''}
        </span>
        <button type="button" className="button secondary" disabled={loading} onClick={() => setRefreshKey((current) => current + 1)}>Refresh</button>
      </div>
    </header>
    {error && <div className="dashboard-error-card dashboard-inline-error" role="alert">
      <div><strong>Dashboard refresh failed</strong><p>{error}</p></div>
      <button className="button secondary" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Retry</button>
    </div>}
    <section className="panel dashboard-filter" aria-label="Dashboard date filters">
      <div className="dashboard-filter-heading">
        <div><strong>Dashboard date range</strong><span>Updates counts, charts, and recent activity</span></div>
        {loading && <span className="dashboard-refreshing" role="status">Refreshing…</span>}
      </div>
      <div className="dashboard-presets" role="group" aria-label="Date range presets">
        {presets.map(([value, label]) => <button
          type="button"
          key={value}
          className={`button secondary dashboard-preset ${selectedPreset === value ? 'selected' : ''}`}
          aria-pressed={selectedPreset === value}
          onClick={() => choosePreset(value)}
        >{label}</button>)}
      </div>
      {selectedPreset === 'custom' && <form className="dashboard-custom-range" onSubmit={applyCustomRange}>
        <label className="field"><span>From</span><input
          type="date"
          required
          max={today}
          value={customRange.from}
          onChange={(event) => setCustomRange((current) => ({ ...current, from: event.target.value }))}
        /></label>
        <label className="field"><span>To</span><input
          type="date"
          required
          min={customRange.from}
          max={today}
          value={customRange.to}
          onChange={(event) => setCustomRange((current) => ({ ...current, to: event.target.value }))}
        /></label>
        <button type="submit" className="button" disabled={loading}>Apply</button>
        {customError && <p className="dashboard-validation-error" role="alert">{customError}</p>}
      </form>}
    </section>
    <section className="dashboard-metrics" aria-label="Overview statistics">
      {metrics.map((metric) => <MetricCard
        key={metric.title}
        {...metric}
        onClick={() => onNavigate(metric.target)}
      />)}
    </section>
    <section className="panel dashboard-sales">
      <div className="dashboard-section-heading"><div><h3>Revenue</h3><p className="muted">Successful paid payments grouped by currency</p></div></div>
      {data.revenue.length === 0
        ? <div className="empty"><strong>No revenue in this period</strong></div>
        : <div className="currency-totals">{data.revenue.map((row) => <div className="report-row" key={row.currency}>
          <span>{row.currency}</span><strong>{formatMoney(row.total, row.currency)}</strong>
        </div>)}</div>}
    </section>
    <div className="dashboard-chart-grid dashboard-live-charts">
      <section className="panel dashboard-chart-card">
        <div className="dashboard-section-heading"><div><h3>Registrations over time</h3><p className="muted">New user registrations</p></div></div>
        {!numberOfRecords(data.charts.registrations) ? <div className="empty"><strong>No registrations in this period</strong></div>
          : <div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.charts.registrations} margin={{ top: 12, right: 12, left: -14, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e1e5ed)"/>
              <XAxis dataKey="period" tickFormatter={formatPeriod} minTickGap={20} tick={{ fill: 'var(--muted)', fontSize: 10 }}/>
              <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 10 }}/>
              <Tooltip labelFormatter={(value) => value} contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)' }}/>
              <Line type="monotone" dataKey="total" name="Registrations" stroke="#3478bd" strokeWidth={2.5} dot={false}/>
            </LineChart>
          </ResponsiveContainer></div>}
      </section>
      <section className="panel dashboard-chart-card">
        <div className="dashboard-section-heading"><div><h3>Bookings over time</h3><p className="muted">Bookings created in the selected period</p></div></div>
        {!numberOfRecords(data.charts.bookings) ? <div className="empty"><strong>No bookings in this period</strong></div>
          : <div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.charts.bookings} margin={{ top: 12, right: 12, left: -14, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e1e5ed)"/>
              <XAxis dataKey="period" tickFormatter={formatPeriod} minTickGap={20} tick={{ fill: 'var(--muted)', fontSize: 10 }}/>
              <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 10 }}/>
              <Tooltip labelFormatter={(value) => value} contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)' }}/>
              <Bar dataKey="total" name="Bookings" fill="#35a68a" radius={[4, 4, 0, 0]}/>
            </BarChart>
          </ResponsiveContainer></div>}
      </section>
      <section className="panel dashboard-chart-card dashboard-revenue-chart">
        <div className="dashboard-section-heading"><div><h3>Revenue over time</h3><p className="muted">Paid payment totals remain separate by currency</p></div></div>
        {revenueCurrencies.length === 0 || !numberOfRecords(data.charts.revenue) ? <div className="empty"><strong>No revenue in this period</strong></div>
          : <div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={revenueChartData} margin={{ top: 12, right: 16, left: 2, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e1e5ed)"/>
              <XAxis dataKey="period" tickFormatter={formatPeriod} minTickGap={20} tick={{ fill: 'var(--muted)', fontSize: 10 }}/>
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }}/>
              <Tooltip
                labelFormatter={(value) => value}
                formatter={(value, name) => [formatMoney(value, name), `${name} revenue`]}
                contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                labelStyle={{ color: 'var(--ink)' }}
              />
              <Legend/>
              {revenueCurrencies.map((currency, index) => <Line
                key={currency}
                type="monotone"
                dataKey={currency}
                name={currency}
                stroke={['#e3a343', '#8e6bd8', '#3478bd', '#35a68a'][index % 4]}
                strokeWidth={2.5}
                dot={false}
                connectNulls
              />)}
            </LineChart>
          </ResponsiveContainer></div>}
      </section>
    </div>
    <section className="panel dashboard-recent dashboard-live-activity">
      <div className="dashboard-section-heading"><div><h3>Recent activity</h3><p className="muted">Latest users, bookings, payments, and vendor applications</p></div></div>
      {data.recentActivity.length === 0 ? <div className="empty"><strong>No recent activity in this period</strong></div>
        : <div className="dashboard-list">{data.recentActivity.map((item) => <article className="dashboard-list-row" key={`${item.type}-${item.id}`}>
          <div><strong>{item.title}</strong><span>{item.type.replaceAll('_', ' ')}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></div>
          <span className={`pill ${item.status}`}>{item.status}</span>
        </article>)}</div>}
    </section>
  </div>;
}
