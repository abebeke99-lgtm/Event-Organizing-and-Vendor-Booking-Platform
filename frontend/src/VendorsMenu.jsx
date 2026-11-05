import React, { useRef } from 'react';
import { ChevronDown, ChevronRight, Star, Store, Tags } from 'lucide-react';
import { translate, translateNavigationLabel, useLanguage } from './language.js';
import { navigateAndCloseMenu, routeIsActive } from './publicNavigationUtils.js';

function focusMenuItem(menu, direction = 1) {
  const items = Array.from(menu?.querySelectorAll(':scope > li > [role="menuitem"]') || []);
  if (!items.length) return;
  const activeIndex = items.indexOf(document.activeElement);
  const nextIndex = activeIndex < 0 ? 0 : (activeIndex + direction + items.length) % items.length;
  items[nextIndex]?.focus();
}

export default function VendorsMenu({
  item,
  routePath,
  onNavigate,
  close,
  openPath,
  setOpenPath,
  registerMenu,
  closeTimer,
}) {
  const language = useLanguage();
  const menuRefs = useRef(new Map());
  const itemKey = `0:${item.key}`;
  const categoryKey = '1:vendor-categories';
  const isOpen = openPath.includes(itemKey);
  const categoriesOpen = openPath.includes(categoryKey);
  const categoryGroup = item.children.find((child) => child.key === 'vendor-categories');
  const categories = categoryGroup?.children || [];
  const query = new URLSearchParams(String(routePath).split('?')[1] || '');
  const active = routeIsActive(item.path, routePath)
    || categories.some((child) => routeIsActive(child.path, routePath));
  const browseActive = routeIsActive('/vendors', routePath)
    && !query.has('category')
    && !query.has('filter')
    && !query.has('verified')
    && !['popular', 'recently-added', 'most-reviewed'].includes(query.get('sort'));

  const navigate = (path) => navigateAndCloseMenu(path, close, onNavigate);

  return <li className={`public-nav-item has-children ${isOpen ? 'is-open' : ''}`}
    onMouseEnter={(event) => {
      window.clearTimeout(closeTimer.current);
      if (window.matchMedia('(min-width: 1121px)').matches) {
        setOpenPath(itemKey, event.currentTarget.getBoundingClientRect());
      }
    }}
    onMouseLeave={() => {
      if (window.matchMedia('(min-width: 1121px)').matches) {
        closeTimer.current = window.setTimeout(() => setOpenPath(''), 150);
      }
    }}>
    <button type="button" title={translateNavigationLabel(item, language)}
      className={`public-nav-menu-trigger public-nav-top-item level-0 ${active ? 'active' : ''}`}
      aria-haspopup="menu" aria-expanded={isOpen} aria-current={active ? 'page' : undefined}
      aria-controls="public-menu-vendors"
      onClick={(event) => {
        const shouldOpen = window.matchMedia('(min-width: 1121px)').matches || !isOpen;
        setOpenPath(shouldOpen ? itemKey : '', event.currentTarget.getBoundingClientRect());
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          const trigger = event.currentTarget;
          setOpenPath(itemKey, trigger.getBoundingClientRect());
          requestAnimationFrame(() => focusMenuItem(trigger.parentElement?.querySelector('[role="menu"]')));
        }
      }}>
      <span className="public-nav-label">{translateNavigationLabel(item, language)}</span>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    <ul id="public-menu-vendors" role="menu" ref={(node) => registerMenu(itemKey, node)}
      className={`public-nav-dropdown level-1 ${isOpen ? 'is-open' : ''}`}
      onKeyDown={(event) => {
        if (event.target.closest('ul') !== event.currentTarget) return;
        if (event.key === 'Escape' || event.key === 'ArrowLeft') {
          event.preventDefault();
          setOpenPath('');
          event.currentTarget.parentElement?.querySelector(':scope > button')?.focus();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          focusMenuItem(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'ArrowRight' && document.activeElement === event.currentTarget.querySelector('[data-vendor-category-trigger]')) {
          event.preventDefault();
          setOpenPath(categoryKey);
          requestAnimationFrame(() => focusMenuItem(menuRefs.current.get(categoryKey)));
        }
      }}>
      {item.loading
        ? <li className="public-nav-state" role="none"><span className="public-nav-skeleton" aria-label={translate('publicNavLoadingCategories', language)} /></li>
        : item.error
          ? <li className="public-nav-state" role="none"><span role="alert">{item.error}</span><button type="button" role="menuitem" onClick={item.retry}>{translate('publicNavRetry', language)}</button></li>
          : null}
      {item.children.filter((child) => child.key !== 'vendor-categories').map((child) => {
        const Icon = child.icon || (child.key === 'popular-vendors' ? Star : Store);
        const selected = routeIsActive(child.path, routePath);
        return <li role="none" key={child.key}>
          <a role="menuitem" href={child.path} title={translateNavigationLabel(child, language)}
            className={selected || (child.key === 'browse-vendors' && browseActive) ? 'active' : ''}
            aria-current={selected || (child.key === 'browse-vendors' && browseActive) ? 'page' : undefined}
            onClick={(event) => { event.preventDefault(); navigate(child.path); }}>
            <Icon className="public-nav-category-icon" aria-hidden="true" />
            <span className="public-nav-label">{translateNavigationLabel(child, language)}</span>
          </a>
        </li>;
      })}
      {!item.loading && !item.error && categoryGroup && <li role="none"
        className={`public-nav-item has-children ${categoriesOpen ? 'is-open' : ''}`}
        onMouseEnter={(event) => {
          window.clearTimeout(closeTimer.current);
          if (window.matchMedia('(min-width: 1121px)').matches) {
            setOpenPath(categoryKey, event.currentTarget.getBoundingClientRect());
          }
        }}
        onMouseLeave={() => {
          if (window.matchMedia('(min-width: 1121px)').matches) {
            closeTimer.current = window.setTimeout(() => setOpenPath('parent'), 150);
          }
        }}>
        <button type="button" role="menuitem" data-vendor-category-trigger
          className={`public-nav-menu-trigger ${categories.some((child) => routeIsActive(child.path, routePath)) ? 'active' : ''}`}
          aria-haspopup="menu" aria-expanded={categoriesOpen} aria-controls="public-menu-vendor-categories"
          onClick={(event) => setOpenPath(categoriesOpen ? 'parent' : categoryKey, event.currentTarget.getBoundingClientRect())}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              setOpenPath(categoryKey, event.currentTarget.getBoundingClientRect());
              requestAnimationFrame(() => focusMenuItem(menuRefs.current.get(categoryKey)));
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              focusMenuItem(event.currentTarget.parentElement?.parentElement, event.key === 'ArrowDown' ? 1 : -1);
            }
          }}>
          <Tags className="public-nav-category-icon" aria-hidden="true" />
          <span className="public-nav-label">{translateNavigationLabel(categoryGroup, language)}</span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        <ul id="public-menu-vendor-categories" role="menu"
          ref={(node) => {
            if (node) menuRefs.current.set(categoryKey, node);
            else menuRefs.current.delete(categoryKey);
            registerMenu(categoryKey, node);
          }}
          className={`public-nav-dropdown level-2 ${categoriesOpen ? 'is-open' : ''}`}
          onKeyDown={(event) => {
            if (event.target.closest('ul') !== event.currentTarget) return;
            if (event.key === 'Escape' || event.key === 'ArrowLeft') {
              event.preventDefault();
              setOpenPath('parent');
              event.currentTarget.parentElement?.querySelector(':scope > button')?.focus();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              focusMenuItem(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
            }
          }}>
          {categories.map((child) => {
            const Icon = child.icon || Tags;
            const selected = routeIsActive(child.path, routePath);
            return <li role="none" key={child.key}>
              <a role="menuitem" href={child.path} title={translateNavigationLabel(child, language)}
                className={selected ? 'active' : ''}
                aria-current={selected ? 'page' : undefined}
                onClick={(event) => { event.preventDefault(); navigate(child.path); }}>
                <Icon className="public-nav-category-icon" aria-hidden="true" />
                <span className="public-nav-label">{translateNavigationLabel(child, language)}</span>
                {Number.isFinite(child.count) && <span className="public-nav-category-count">
                  {child.count.toLocaleString(language === 'am' ? 'am-ET' : 'en-US')}
                </span>}
              </a>
            </li>;
          })}
          {!categories.length && <li className="public-nav-state" role="none">
            {translate('publicNavNoVendorCategories', language)}
          </li>}
        </ul>
      </li>}
    </ul>
  </li>;
}
