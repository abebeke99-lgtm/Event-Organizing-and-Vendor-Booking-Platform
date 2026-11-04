import React from 'react';
import { ChevronDown, Store, Tags } from 'lucide-react';
import { translate, translateText, useLanguage } from './language.js';
import { navigateAndCloseMenu, routeIsActive } from './publicNavigationUtils.js';

function focusMenuItem(menu, direction = 1) {
  const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') || []);
  if (!items.length) return;
  const activeIndex = items.indexOf(document.activeElement);
  const nextIndex = activeIndex < 0
    ? 0
    : (activeIndex + direction + items.length) % items.length;
  items[nextIndex]?.focus();
}

export default function ServicesMenu({
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
  const itemKey = `0:${item.key}`;
  const isOpen = openPath.includes(itemKey);
  const currentQuery = new URLSearchParams(String(routePath).split('?')[1] || '');
  const isServicesPage = String(routePath).split('?')[0].replace(/\/+$/, '') === '/services';
  const active = isServicesPage;
  const browseActive = isServicesPage && !currentQuery.has('category');
  const serviceItems = item.children.filter((child) => child.database);

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
    <button type="button" title={translateText(item.label, language)}
      className={`public-nav-menu-trigger public-nav-top-item level-0 ${active ? 'active' : ''}`}
      aria-haspopup="menu" aria-expanded={isOpen} aria-current={active ? 'page' : undefined}
      aria-controls="public-menu-services"
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
      <span className="public-nav-label">{translateText(item.label, language)}</span>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    <ul id="public-menu-services" role="menu" ref={(node) => registerMenu(itemKey, node)}
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
        }
      }}>
      {item.children.filter((child) => !child.database).map((child) => {
        const ChildIcon = child.icon || Store;
        return <li role="none" key={child.key}>
          <a role="menuitem" href={child.path} title={child.title || child.label}
            className={browseActive ? 'active' : ''}
            aria-current={browseActive ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigateAndCloseMenu(child.path, close, onNavigate);
            }}>
            <ChildIcon className="public-nav-category-icon" aria-hidden="true" />
            <span className="public-nav-label">{translateText(child.label, language)}</span>
          </a>
        </li>;
      })}
      {item.loading && <li className="public-nav-state" role="none">
        <span className="public-nav-skeleton" aria-label={translate('publicNavLoadingCategories', language)} />
      </li>}
      {item.error && <li className="public-nav-state" role="none">
        <span role="alert">{item.error}</span>
        <button type="button" role="menuitem" onClick={item.retry}>{translate('publicNavRetry', language)}</button>
      </li>}
      {serviceItems.map((child) => {
        const ChildIcon = child.icon || Tags;
        const selected = routeIsActive(child.path, routePath);
        return <li role="none" key={child.key}>
          <a role="menuitem" href={child.path} title={child.title || child.label}
            className={selected ? 'active' : ''}
            aria-current={selected ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigateAndCloseMenu(child.path, close, onNavigate);
            }}>
            <ChildIcon className="public-nav-category-icon" aria-hidden="true" />
            <span className="public-nav-label">{translateText(child.label, language)}</span>
            {Number.isFinite(child.count) && <span className="public-nav-category-count">
              {child.count.toLocaleString(language === 'am' ? 'am-ET' : 'en-US')}
            </span>}
          </a>
        </li>;
      })}
      {!item.loading && !item.error && serviceItems.length === 0 && <li className="public-nav-state" role="none">
        {translate('publicNavNoServiceCategories', language)}
      </li>}
    </ul>
  </li>;
}
