import { useEffect, useState } from 'react';
import { Building2, ChevronLeft, ChevronRight, Search, Tags } from 'lucide-react';
import apiClient from './api/axios.js';
import { translate, useLanguage } from './language.js';
import './serviceCategories.css';

const PAGE_SIZE = 12;

function categoryImageUrl(path) {
  const baseUrl = apiClient.defaults.baseURL;
  return path?.startsWith('/api/') && baseUrl && !baseUrl.startsWith('/')
    ? new URL(path, baseUrl).toString()
    : path;
}

function CategoryImage({ category }) {
  const [failed, setFailed] = useState(false);
  const src = categoryImageUrl(category.image);

  useEffect(() => setFailed(false), [src]);

  return src && !failed
    ? <img className="service-category-image" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <div className="service-category-image service-category-image-placeholder" aria-hidden="true"><Building2 size={32} /></div>;
}

function categorySlug(category) {
  return category.slug || String(category.name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function ServiceCategoriesPage({ api, onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadCategories() {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (searchQuery) params.set('search', searchQuery);
      try {
        const response = await api(`/platform/categories?${params}`, { signal: controller.signal });
        const rows = response?.categories ?? response?.data;
        if (!Array.isArray(rows) || !response?.pagination) {
          throw new Error('The service categories response was incomplete.');
        }
        if (controller.signal.aborted) return;
        setCategories(rows.filter(Boolean));
        setPagination({
          page: Number(response.pagination.page) || 1,
          total: Number(response.pagination.total) || 0,
          totalPages: Number(response.pagination.totalPages) || 1,
        });
      } catch (issue) {
        if (issue.name !== 'AbortError' && !controller.signal.aborted) {
          setCategories([]);
          setError(issue.message || t('publicServiceCategoriesLoadError'));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadCategories();
    return () => controller.abort();
  }, [api, page, reloadKey, searchQuery, language]);

  const browse = (path) => onNavigate?.(path);

  return <main className="page-shell service-categories-page">
    <div className="content-stack">
      <header className="section-header service-categories-heading">
        <div>
          <p className="eyebrow">{t('serviceCategories')}</p>
          <h2>{t('publicExploreEventServices')}</h2>
          <p className="muted">{t('publicServiceCategoriesDescription')}</p>
        </div>
        {!loading && !error && <span className="service-categories-total" role="status">{t('publicServiceCategoriesCount').replace('{count}', String(pagination.total))}</span>}
      </header>

      <form className="panel service-category-search" role="search" onSubmit={(event) => {
        event.preventDefault();
        setSearchQuery(search.trim());
        setPage(1);
      }}>
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">{t('publicServiceCategoriesSearch')}</span>
          <input type="search" maxLength="120" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('publicServiceCategoriesSearch')} />
        </label>
        {search && <button className="button secondary small" type="button" onClick={() => setSearch('')}>{t('clear')}</button>}
      </form>

      {error && <div className="alert error" role="alert">
        <span>{error}</span>
        <button className="button secondary small" type="button" onClick={() => setReloadKey((value) => value + 1)}>{t('retry')}</button>
      </div>}

      {loading ? <div className="service-category-grid" role="status" aria-label={t('publicServiceCategoriesLoading')}>
        {Array.from({ length: 6 }, (_, index) => <article className="panel service-category-card service-category-skeleton" key={index} aria-hidden="true">
          <div className="service-category-image vendor-skeleton-shimmer" />
          <div className="vendor-skeleton-line short vendor-skeleton-shimmer" />
          <div className="vendor-skeleton-line vendor-skeleton-shimmer" />
          <div className="vendor-skeleton-line long vendor-skeleton-shimmer" />
        </article>)}
      </div> : !error && categories.length > 0 ? <>
        <div className="service-category-grid">
          {categories.map((category) => {
            const slug = categorySlug(category);
            const serviceCount = Number(category.serviceCount ?? category.service_count ?? 0);
            const vendorCount = Number(category.vendorCount ?? category.vendor_count ?? 0);
            return <article className="panel service-category-card" key={category.id}>
              <CategoryImage category={category} />
              <div className="service-category-copy">
                <h3>{category.name}</h3>
                <p>{category.description || t('publicServiceCategoriesFallbackDescription')}</p>
                <div className="service-category-counts">
                  <span><Tags size={14} />{t('publicPublishedServicesCount').replace('{count}', String(serviceCount))}</span>
                  <span>{t('publicEligibleVendorsCount').replace('{count}', String(vendorCount))}</span>
                </div>
              </div>
              <div className="service-category-actions">
                <button className="button" type="button" onClick={() => browse(`/services?category=${encodeURIComponent(slug)}`)}>{t('publicBrowseServices')}</button>
                <button className="button secondary" type="button" onClick={() => browse(`/vendors?category=${encodeURIComponent(slug)}`)}>{t('publicBrowseVendors')}</button>
              </div>
            </article>;
          })}
        </div>
        <nav className="pagination-row service-category-pagination" aria-label="Service category pages">
          <span>{t('publicServiceCategoriesCount').replace('{count}', String(pagination.total))}</span>
          <button className="button secondary small" type="button" disabled={pagination.page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} />{t('previous')}</button>
          <span>{t('page')} {pagination.page} {t('of')} {pagination.totalPages}</span>
          <button className="button secondary small" type="button" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}>{t('next')}<ChevronRight size={16} /></button>
        </nav>
      </> : !error ? <div className="empty panel service-category-empty">
        <strong>{t(searchQuery ? 'publicServiceCategoriesEmptySearchTitle' : 'publicServiceCategoriesEmptyTitle')}</strong>
        <span>{t(searchQuery ? 'publicServiceCategoriesEmptySearchDescription' : 'publicServiceCategoriesEmptyDescription')}</span>
      </div> : null}
    </div>
  </main>;
}
