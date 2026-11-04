import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { translate, translateText, useLanguage } from './language.js';
import { buildPublicNavigationMenu, navigateAndCloseMenu, routeIsActive, updateOpenMenuPath } from './publicNavigationUtils.js';
import { recordRecentlyViewed } from './navigationFeatureUtils.js';

const menuCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

function clearPointerNavigationFocus() {
  const activeElement = document.activeElement;
  if (activeElement?.closest('.public-nav-list')) activeElement.blur();
}

async function loadCached(api, endpoint) {
  const cached = menuCache.get(endpoint);
  if (cached?.data && cached.expiresAt > Date.now()) return cached.data;
  if (cached?.promise) return cached.promise;

  const promise = api(endpoint)
    .then((response) => {
      if (!Array.isArray(response?.data)) throw new Error('The menu data response was invalid.');
      menuCache.set(endpoint, { data: response.data, expiresAt: Date.now() + CACHE_DURATION });
      return response.data;
    })
    .catch((error) => {
      menuCache.delete(endpoint);
      throw error;
    });
  menuCache.set(endpoint, { promise });
  return promise;
}

function MenuItems({ items, level, routePath, onNavigate, close, openPath, setOpenPath, registerMenu, closeTimer }) {
  const language = useLanguage();
  const renderMenuChild = (child) => {
    if (child.children?.length) {
      return <MenuItems key={child.key || child.path} items={[child]} level={level + 1} routePath={routePath}
        onNavigate={onNavigate} close={close} openPath={openPath} setOpenPath={setOpenPath}
        registerMenu={registerMenu} closeTimer={closeTimer} />;
    }
    return <li role="none" key={child.key || child.path}>
      <a role="menuitem" href={child.path} title={child.title || child.label}
        className={routeIsActive(child.path, routePath) ? 'active' : ''}
        aria-current={routeIsActive(child.path, routePath) ? 'page' : undefined}
        onClick={(event) => {
          event.preventDefault();
          if (event.detail > 0) clearPointerNavigationFocus();
          navigateAndCloseMenu(child.path, close, onNavigate);
        }}>
        {child.icon && <img className="public-nav-category-icon" src={child.icon} alt="" aria-hidden="true" loading="lazy" />}
        <span className="public-nav-label">{translateText(child.label, language)}</span>
        {Number.isFinite(child.count) && <span className="public-nav-category-count">{child.count.toLocaleString(language === 'am' ? 'am-ET' : 'en-US')}</span>}
      </a>
    </li>;
  };
  const renderAboutGroups = (children) => {
    const groups = [];
    for (let index = 0; index < children.length;) {
      const heading = children[index].groupHeading;
      if (!heading) {
        groups.push({ heading: null, items: [children[index]] });
        index += 1;
        continue;
      }
      const groupItems = [children[index]];
      index += 1;
      while (index < children.length && !children[index].groupHeading) {
        groupItems.push(children[index]);
        index += 1;
      }
      groups.push({ heading, items: groupItems });
    }
    return groups.flatMap((group, index) => {
      if (!group.heading) return group.items.map(renderMenuChild);
      const label = translate(group.heading, language);
      return [
        ...(index > 0 ? [<li className="public-nav-divider" role="separator" key={`about-divider-${group.heading}`} />] : []),
        <li role="none" key={`about-group-${group.heading}`}>
          <ul className="public-nav-group" role="group" aria-label={label}>
            <li className="public-nav-group-heading visually-hidden" role="none" aria-hidden="true">{label}</li>
            {group.items.map(renderMenuChild)}
          </ul>
        </li>,
      ];
    });
  };
  return items.map((item) => {
    const hasChildren = Boolean(item.children?.length);
    const itemKey = `${level}:${item.key || item.path}`;
    const isOpen = openPath.includes(itemKey);
    const active = routeIsActive(item.path || '', routePath) || Boolean(item.children?.some((child) => routeIsActive(child.path, routePath)));
    return <li className={`public-nav-item ${hasChildren ? 'has-children' : ''} ${isOpen ? 'is-open' : ''}`} key={itemKey}
      onMouseEnter={(event) => {
        window.clearTimeout(closeTimer.current);
        if (hasChildren && window.matchMedia('(min-width: 1121px)').matches) {
          clearPointerNavigationFocus();
          const trigger = event.currentTarget.querySelector(':scope > .public-nav-top-link-group > button, :scope > button');
          setOpenPath(itemKey, trigger?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect());
        }
      }}
      onMouseLeave={() => {
        if (window.matchMedia('(min-width: 1121px)').matches) {
          closeTimer.current = window.setTimeout(() => setOpenPath(level > 0 ? 'parent' : ''), 150);
        }
      }}>
      {hasChildren ? <>
        {item.labelLink ? <div className={`public-nav-top-link-group ${active ? 'active' : ''} ${isOpen ? 'is-open' : ''}`}>
          <a title={translateText(item.label, language)} className="public-nav-top-item public-nav-top-link-label" href={item.path}
            aria-current={active ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              if (event.detail > 0) clearPointerNavigationFocus();
              navigateAndCloseMenu(item.path, close, onNavigate);
            }}>{translateText(item.label, language)}</a>
          <button type="button" title={translate('aboutUsMenu', language)} aria-label={translate('aboutUsMenu', language)}
            className="public-nav-menu-trigger public-nav-top-item public-nav-top-link-chevron"
            aria-haspopup="menu" aria-expanded={isOpen} aria-current={active ? 'page' : undefined}
            aria-controls={`public-menu-${itemKey.replace(/[^a-z0-9_-]/gi, '-')}`}
            onClick={(event) => {
              if (event.detail > 0) clearPointerNavigationFocus();
              const shouldOpen = window.matchMedia('(min-width: 1121px)').matches || !isOpen;
              setOpenPath(shouldOpen ? itemKey : '', event.currentTarget.getBoundingClientRect());
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                const trigger = event.currentTarget;
                setOpenPath(itemKey, event.currentTarget.getBoundingClientRect());
                requestAnimationFrame(() => trigger.parentElement?.parentElement?.querySelector('[role="menuitem"]')?.focus());
              }
            }}>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div> :         <button type="button" title={translateText(item.label, language)} className={`public-nav-menu-trigger public-nav-top-item level-${level} ${active ? 'active' : ''}`}
          aria-haspopup="menu" aria-expanded={isOpen} aria-current={active ? 'page' : undefined} aria-controls={`public-menu-${itemKey.replace(/[^a-z0-9_-]/gi, '-')}`}
          onClick={(event) => {
            if (event.detail > 0) clearPointerNavigationFocus();
            const shouldOpen = window.matchMedia('(min-width: 1121px)').matches || !isOpen;
            setOpenPath(shouldOpen ? itemKey : '', event.currentTarget.getBoundingClientRect());
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              const trigger = event.currentTarget;
              setOpenPath(itemKey, event.currentTarget.getBoundingClientRect());
              requestAnimationFrame(() => trigger.parentElement?.querySelector('[role="menuitem"]')?.focus());
            }
          }}>
          <span className="public-nav-label">{translateText(item.label, language)}</span>{level === 0 ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        </button>}
        <ul id={`public-menu-${itemKey.replace(/[^a-z0-9_-]/gi, '-')}`} role="menu" ref={(node) => registerMenu(itemKey, node)}
          className={`public-nav-dropdown level-${level + 1} ${isOpen ? 'is-open' : ''} ${item.submenuSide === 'left' ? 'opens-left' : ''}`}
          onKeyDown={(event) => {
            const menuItems = Array.from(event.currentTarget.querySelectorAll('[role="menuitem"]'));
            const index = menuItems.indexOf(document.activeElement);
            if (event.key === 'Escape' || event.key === 'ArrowLeft') {
              event.preventDefault();
              setOpenPath(level > 0 ? 'parent' : '');
              event.currentTarget.parentElement?.querySelector('button')?.focus();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const next = event.key === 'ArrowDown' ? (index + 1) % menuItems.length : (index - 1 + menuItems.length) % menuItems.length;
              menuItems[next]?.focus();
            } else if (event.key === 'ArrowRight') {
              const trigger = document.activeElement?.closest('.public-nav-item')?.querySelector(':scope > button');
              if (trigger) {
                event.preventDefault();
                trigger.click();
              }
            }
          }}>
          {item.loading ? <li className="public-nav-state" role="none"><span className="public-nav-skeleton" aria-label={translate('publicNavLoadingCategories', language)} /></li>
            : item.error ? <li className="public-nav-state" role="none"><span>{item.error}</span><button type="button" role="menuitem" onClick={item.retry}>{translate('publicNavRetry', language)}</button></li>
              : item.key === 'about' ? renderAboutGroups(item.children)
                : <>{item.children.flatMap((child, index, children) => {
                const previous = children[index - 1];
                const divider = child.dividerBefore
                  || (child.database && previous && !previous.database)
                  || (child.footer && previous && !previous.footer);
                const separator = divider
                  ? [<li className="public-nav-divider" role="separator" key={`separator-${child.key}`} />]
                  : [];
                return [...separator, renderMenuChild(child)];
              })}
                {item.emptyMessage && !item.children.some((child) => child.database) && <li className="public-nav-state" role="none">{translate(item.emptyMessage, language)}</li>}
              </>}
        </ul>
      </> : <a title={translateText(item.label, language)} className={`nav-link public-nav-top-item ${active ? 'active' : ''}`} href={item.path}
        aria-current={active ? 'page' : undefined}
        onClick={(event) => {
          event.preventDefault();
          if (event.detail > 0) clearPointerNavigationFocus();
          navigateAndCloseMenu(item.path, close, onNavigate);
        }}><span className="public-nav-label">{translateText(item.label, language)}</span></a>}
    </li>;
  });
}

export default function PublicNavigation({ currentPath, mobileOpen, onCloseMobile, onNavigate, api, user }) {
  const language = useLanguage();
  const [categories, setCategories] = useState([]);
  const [eventCategories, setEventCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [eventCategoriesLoading, setEventCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState('');
  const [eventCategoriesError, setEventCategoriesError] = useState('');
  const [retry, setRetry] = useState(0);
  const [historyError, setHistoryError] = useState('');
  const [openPath, setOpenPathState] = useState([]);
  const rootRef = useRef(null);
  const menuRefs = useRef(new Map());
  const closeTimer = useRef(null);
  const routePath = currentPath;

  function setOpenPath(path, parentRect) {
    window.clearTimeout(closeTimer.current);
    if (path === 'parent') {
      setOpenPathState((current) => updateOpenMenuPath(current, path));
      return;
    }
    if (!path) {
      setOpenPathState([]);
      return;
    }
    setOpenPathState((current) => updateOpenMenuPath(current, path));
    if (parentRect) {
      requestAnimationFrame(() => {
        const menu = menuRefs.current.get(path) || document.getElementById(`public-menu-${path.replace(/[^a-z0-9_-]/gi, '-')}`);
        if (!menu) return;
        const bounds = menu.getBoundingClientRect();
        menu.classList.toggle('opens-left', bounds.right > window.innerWidth && bounds.left > bounds.width);
      });
    }
  }

  function close() {
    setOpenPathState([]);
    onCloseMobile();
  }

  useEffect(() => {
    let active = true;
    setCategoriesLoading(true);
    setEventCategoriesLoading(true);
    setCategoriesError('');
    setEventCategoriesError('');
    Promise.allSettled([loadCached(api, '/platform/categories'), loadCached(api, '/platform/events/categories')])
      .then(([serviceResult, eventResult]) => {
        if (!active) return;
        if (serviceResult.status === 'fulfilled') setCategories(serviceResult.value);
        else setCategoriesError(serviceResult.reason?.message || 'Menu categories could not be loaded.');
        if (eventResult.status === 'fulfilled') setEventCategories(eventResult.value);
        else setEventCategoriesError(eventResult.reason?.message || 'Menu categories could not be loaded.');
      })
      .finally(() => {
        if (active) {
          setCategoriesLoading(false);
          setEventCategoriesLoading(false);
        }
      });
    return () => { active = false; };
  }, [api, retry]);

  useEffect(() => {
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        if (event.target.closest?.('.mobile-nav-toggle')) return;
        setOpenPathState([]);
        if (mobileOpen) onCloseMobile();
      }
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setOpenPathState([]);
        onCloseMobile();
        if (mobileOpen) {
          requestAnimationFrame(() => document.querySelector('.mobile-nav-toggle')?.focus());
        }
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(closeTimer.current);
    };
  }, [mobileOpen, onCloseMobile]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileOpen]);

  useEffect(() => {
    setOpenPathState([]);
  }, [currentPath]);

  useEffect(() => {
    const match = currentPath.match(/^\/(events|vendors)\/([1-9]\d*)(?:\?|$)/);
    if (!match) return;
    try {
      recordRecentlyViewed(match[1] === 'events' ? 'event' : 'vendor', match[2]);
      setHistoryError('');
    } catch (issue) {
      setHistoryError(issue.message || translate('navigationRecentlyViewedSaveFailed', language));
    }
  }, [currentPath, language]);

  const menu = useMemo(() => {
    const dynamic = (children, endpoint, menuKey) => {
      const eventMenu = endpoint === '/platform/events/categories';
      const itemLoading = eventMenu ? eventCategoriesLoading : categoriesLoading;
      const itemError = eventMenu ? eventCategoriesError : categoriesError;
      return {
        children,
        loading: itemLoading,
        error: itemError,
        emptyMessage: eventMenu ? 'publicNavNoEventCategories' : menuKey === 'vendors' ? 'publicNavNoVendorCategories' : menuKey === 'services' ? 'publicNavNoServiceCategories' : 'publicNavNoCategories',
        retry: () => {
          menuCache.delete(endpoint);
          setRetry((value) => value + 1);
        },
      };
    };
    const items = buildPublicNavigationMenu(categories, eventCategories, user);
    return items.map((item) => {
      if (item.key === 'events') return { ...item, ...dynamic(item.children, '/platform/events/categories', item.key) };
      if (item.key === 'vendors' || item.key === 'services' || item.key === 'categories') return { ...item, ...dynamic(item.children, '/platform/categories', item.key) };
      return item;
    });
  }, [categories, categoriesError, categoriesLoading, eventCategories, eventCategoriesError, eventCategoriesLoading, user]);

  return <nav ref={rootRef} className={`site-nav ${mobileOpen ? 'open' : ''}`} aria-label={translateText('mainNavigation', language)}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpenPathState([]); }}>
    {historyError && <p className="public-nav-history-error" role="status">{historyError}</p>}
    <ul className={`public-nav-list ${mobileOpen ? 'mobile-open' : ''}`}>
      <MenuItems items={menu} level={0} routePath={routePath} onNavigate={onNavigate} close={close}
        openPath={openPath} setOpenPath={setOpenPath} registerMenu={(key, node) => {
          if (node) menuRefs.current.set(key, node); else menuRefs.current.delete(key);
        }} closeTimer={closeTimer} />
      {mobileOpen && <li className="public-nav-state menu-mobile-status">
        {(categoriesLoading || eventCategoriesLoading) ? <span className="public-nav-skeleton" aria-label={translate('publicNavLoadingCategories', language)} /> :
          (categoriesError || eventCategoriesError) ? <><span>{categoriesError || eventCategoriesError}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>{translate('publicNavRetry', language)}</button></> : null}
      </li>}
    </ul>
  </nav>;
}
