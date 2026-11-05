import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2, Cake, CalendarDays, Camera, Car, Church, ChevronDown, ChevronRight, Clock3, Compass,
  Flower, GraduationCap, HeartHandshake, Image, Lightbulb, Music, Palette, PartyPopper,
  Presentation, ShieldCheck, Sparkles, Star, Store, Tags, Tent, Ticket, TrendingUp, Trophy, Utensils, BookOpen,
} from 'lucide-react';
import { translate, translateNavigationLabel, useLanguage } from './language.js';
import { buildPublicNavigationMenu, navigateAndCloseMenu, routeIsActive, updateOpenMenuPath } from './publicNavigationUtils.js';
import { recordRecentlyViewed } from './navigationFeatureUtils.js';
import VendorsMenu from './VendorsMenu.jsx';
import ServicesMenu from './ServicesMenu.jsx';

const menuCache = new Map();
const CACHE_DURATION = 30 * 1000;
const EVENT_CATEGORY_CACHE_DURATION = 30 * 1000;

function clearPointerNavigationFocus() {
  const activeElement = document.activeElement;
  if (activeElement?.closest('.public-nav-list')) activeElement.blur();
}

function focusFirstMenuItem(trigger) {
  const menuId = trigger.getAttribute('aria-controls');
  window.setTimeout(() => document.getElementById(menuId)?.querySelector('[role="menuitem"]')?.focus(), 0);
}

async function loadCached(api, endpoint, cacheDuration = CACHE_DURATION) {
  const cached = menuCache.get(endpoint);
  if (cached?.data && cached.expiresAt > Date.now()) return cached.data;
  if (cached?.promise) return cached.promise;

  const promise = api(endpoint)
    .then((response) => {
      const data = Array.isArray(response) ? response
        : Array.isArray(response?.categories) ? response.categories
          : response?.data;
      if (!Array.isArray(data)) throw new Error('The menu data response was invalid.');
      menuCache.set(endpoint, { data, expiresAt: Date.now() + cacheDuration });
      return data;
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
    const ChildIcon = child.icon && (typeof child.icon === 'function' || typeof child.icon === 'object')
      ? child.icon
      : null;
    if (child.children?.length || child.expandable) {
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
        {ChildIcon ? <ChildIcon className="public-nav-category-icon" aria-hidden="true" /> :
          typeof child.icon === 'string' && <img className="public-nav-category-icon" src={child.icon} alt="" aria-hidden="true" loading="lazy" />}
        <span className="public-nav-label">{translateNavigationLabel(child, language)}</span>
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
    const hasChildren = Boolean(item.children?.length || item.expandable);
    const itemKey = `${level}:${item.key || item.path}`;
    const isOpen = openPath.includes(itemKey);
    const active = routeIsActive(item.path || '', routePath) || Boolean(item.children?.some((child) => routeIsActive(child.path, routePath)));
    const ItemIcon = item.icon && (typeof item.icon === 'function' || typeof item.icon === 'object')
      ? item.icon
      : null;
    return <li className={`public-nav-item ${hasChildren ? 'has-children' : ''} ${isOpen ? 'is-open' : ''}`} key={itemKey}
      onMouseEnter={(event) => {
        window.clearTimeout(closeTimer.current);
        if (hasChildren && window.matchMedia('(min-width: 1121px)').matches) {
          if (level === 0) clearPointerNavigationFocus();
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
          <a title={translateNavigationLabel(item, language)} className="public-nav-top-item public-nav-top-link-label" href={item.path}
            aria-current={active ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              if (event.detail > 0) clearPointerNavigationFocus();
              navigateAndCloseMenu(item.path, close, onNavigate);
            }}>{translateNavigationLabel(item, language)}</a>
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
                focusFirstMenuItem(trigger);
              }
            }}>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div> :         <button type="button" role={level > 0 ? 'menuitem' : undefined} title={translateNavigationLabel(item, language)} className={`public-nav-menu-trigger public-nav-top-item level-${level} ${active ? 'active' : ''}`}
          aria-haspopup="menu" aria-expanded={isOpen} aria-current={active ? 'page' : undefined} aria-controls={`public-menu-${itemKey.replace(/[^a-z0-9_-]/gi, '-')}`}
          onClick={(event) => {
            if (event.detail > 0 && level === 0) clearPointerNavigationFocus();
            const shouldOpen = (level === 0 && window.matchMedia('(min-width: 1121px)').matches) || !isOpen;
            setOpenPath(shouldOpen ? itemKey : level > 0 ? 'parent' : '', event.currentTarget.getBoundingClientRect());
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              const trigger = event.currentTarget;
              setOpenPath(itemKey, event.currentTarget.getBoundingClientRect());
              focusFirstMenuItem(trigger);
            }
          }}>
          {ItemIcon && <ItemIcon className="public-nav-category-icon" aria-hidden="true" />}
          <span className="public-nav-label">{translateNavigationLabel(item, language)}</span>{level === 0 ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        </button>}
        <ul id={`public-menu-${itemKey.replace(/[^a-z0-9_-]/gi, '-')}`} role="menu" ref={(node) => registerMenu(itemKey, node)}
          className={`public-nav-dropdown level-${level + 1} ${isOpen ? 'is-open' : ''} ${item.submenuSide === 'left' ? 'opens-left' : ''}`}
          onKeyDown={(event) => {
            if (event.target.closest('ul') !== event.currentTarget) return;
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
                if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
                focusFirstMenuItem(trigger);
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
      </> : <a title={translateNavigationLabel(item, language)} className={`nav-link public-nav-top-item ${active ? 'active' : ''}`} href={item.path}
        aria-current={active ? 'page' : undefined}
        onClick={(event) => {
          event.preventDefault();
          if (event.detail > 0) clearPointerNavigationFocus();
          navigateAndCloseMenu(item.path, close, onNavigate);
        }}><span className="public-nav-label">{translateNavigationLabel(item, language)}</span></a>}
    </li>;
  });
}

export default function PublicNavigation({ currentPath, mobileOpen, onCloseMobile, onNavigate, api, user }) {
  const language = useLanguage();
  const [categories, setCategories] = useState([]);
  const [serviceCategories, setServiceCategories] = useState([]);
  const [eventCategories, setEventCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [serviceCategoriesLoading, setServiceCategoriesLoading] = useState(true);
  const [eventCategoriesLoading, setEventCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState('');
  const [serviceCategoriesError, setServiceCategoriesError] = useState('');
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
    if (path === '0:vendors') {
      loadCached(api, '/platform/categories')
        .then((values) => {
          setCategories(values);
          setCategoriesError('');
        })
        .catch((issue) => setCategoriesError(issue.message || 'Menu categories could not be loaded.'));
    }
    if (path === '0:services') {
      loadCached(api, '/platform/categories?scope=services')
        .then((values) => {
          setServiceCategories(values);
          setServiceCategoriesError('');
        })
        .catch((issue) => setServiceCategoriesError(issue.message || 'Service categories could not be loaded.'));
    }
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
    setServiceCategoriesLoading(true);
    setEventCategoriesLoading(true);
    setCategoriesError('');
    setServiceCategoriesError('');
    setEventCategoriesError('');
    Promise.allSettled([
      loadCached(api, '/platform/categories'),
      loadCached(api, '/platform/categories?scope=services'),
      loadCached(api, '/platform/events/categories', EVENT_CATEGORY_CACHE_DURATION),
    ])
      .then(([categoryResult, serviceCategoryResult, eventResult]) => {
        if (!active) return;
        if (categoryResult.status === 'fulfilled') setCategories(categoryResult.value);
        else setCategoriesError(categoryResult.reason?.message || 'Menu categories could not be loaded.');
        if (serviceCategoryResult.status === 'fulfilled') setServiceCategories(serviceCategoryResult.value);
        else setServiceCategoriesError(serviceCategoryResult.reason?.message || 'Service categories could not be loaded.');
        if (eventResult.status === 'fulfilled') setEventCategories(eventResult.value);
        else setEventCategoriesError(eventResult.reason?.message || 'Menu categories could not be loaded.');
      })
      .finally(() => {
        if (active) {
          setCategoriesLoading(false);
          setServiceCategoriesLoading(false);
          setEventCategoriesLoading(false);
        }
      });
    return () => { active = false; };
  }, [api, retry]);

  useEffect(() => {
    let active = true;
    async function refreshCategories() {
      try {
        const values = await loadCached(api, '/platform/categories');
        if (active) {
          setCategories(values);
          setCategoriesError('');
        }
      } catch (issue) {
        if (active) setCategoriesError(issue.message || 'Menu categories could not be loaded.');
      }
    }
    async function refreshServiceCategories() {
      try {
        const values = await loadCached(api, '/platform/categories?scope=services');
        if (active) {
          setServiceCategories(values);
          setServiceCategoriesError('');
        }
      } catch (issue) {
        if (active) setServiceCategoriesError(issue.message || 'Service categories could not be loaded.');
      }
    }
    window.addEventListener('focus', refreshCategories);
    document.addEventListener('visibilitychange', refreshCategories);
    window.addEventListener('focus', refreshServiceCategories);
    document.addEventListener('visibilitychange', refreshServiceCategories);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshCategories);
      document.removeEventListener('visibilitychange', refreshCategories);
      window.removeEventListener('focus', refreshServiceCategories);
      document.removeEventListener('visibilitychange', refreshServiceCategories);
    };
  }, [api]);

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
        if (event.defaultPrevented) return;
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
      const serviceMenu = endpoint === '/platform/categories?scope=services';
      const itemLoading = eventMenu ? eventCategoriesLoading : serviceMenu ? serviceCategoriesLoading : categoriesLoading;
      const itemError = eventMenu ? eventCategoriesError : serviceMenu ? serviceCategoriesError : categoriesError;
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
    const items = buildPublicNavigationMenu(categories, eventCategories, user, serviceCategories);
    return items.map((item) => {
    if (item.key === 'events') {
      const eventIcons = {
        'browse-events': CalendarDays,
        'upcoming-events': Clock3,
        'free-events': Ticket,
        'featured-events': Star,
        'popular-events': TrendingUp,
        'recent-events': Clock3,
      };
      return {
        ...item,
        children: item.children.map((child) => ({ ...child, icon: eventIcons[child.key] })),
      };
    }
    if (item.key === 'discover') {
      const discoverIcons = {
        'discover-popular-events': TrendingUp,
        'discover-featured-events': Star,
        'discover-popular-vendors': Store,
        'discover-featured-vendors': Star,
        'discover-popular-services': TrendingUp,
        'discover-popular-venues': Building2,
        'discover-event-calendar': CalendarDays,
        'discover-recent-events': Clock3,
        'discover-recommended-events': Sparkles,
        'discover-explore-all': Compass,
      };
        return {
          ...item,
          children: item.children.map((child) => ({ ...child, icon: discoverIcons[child.key] || Compass })),
        };
      }
      if (item.key === 'vendors') {
        return {
          ...item,
          ...dynamic(item.children, '/platform/categories', item.key),
          children: item.children.map((child) => ({
            ...child,
            icon: child.key === 'vendor-categories'
              ? Tags
              : child.key === 'popular-vendors' ? TrendingUp
                : child.key === 'verified-vendors' ? ShieldCheck
                  : child.key === 'featured-vendors' ? Star
                    : child.key === 'recent-vendors' ? Clock3 : child.icon || Store,
            children: child.key === 'vendor-categories'
              ? child.children.map((category) => ({
                ...category,
                icon: category.icon || Store,
              }))
              : child.children,
          })),
        };
      }
      if (item.key === 'services') {
        const serviceIcons = {
          'all-services': Store,
          'catering-services': Utensils,
          'photography-videography': Camera,
          'decoration-florists': Flower,
          'wedding-planning': CalendarDays,
          'venue-event-spaces': Building2,
          'music-entertainment': Music,
          'sound-lighting': Lightbulb,
          transportation: Car,
          'makeup-beauty': Sparkles,
          'rental-equipment': Tent,
          'cakes-bakery': Cake,
          'printing-invitations': Image,
          'security-services': ShieldCheck,
          'other-services': Tags,
        };
        return {
          ...item,
          ...dynamic(item.children, '/platform/categories?scope=services', item.key),
          children: item.children.map((child) => ({ ...child, icon: serviceIcons[child.slug] || serviceIcons[child.key] || Tags })),
        };
      }
      if (item.key === 'categories') {
        const eventCategoryIcons = {
          wedding: HeartHandshake,
          birthday: Cake,
          graduation: GraduationCap,
          conference: Presentation,
          'corporate events': Building2,
          'concerts & music': Music,
          festivals: PartyPopper,
          'religious events': Church,
          'cultural events': Palette,
          'workshops & training': BookOpen,
          'sports events': Trophy,
          exhibitions: Image,
        };
        return {
          ...item,
          ...dynamic(item.children, '/platform/events/categories', item.key),
          children: item.children.map((child) => ({
            ...child,
            icon: eventCategoryIcons[String(child.label).toLowerCase()] || CalendarDays,
          })),
        };
      }
      return item;
    });
  }, [categories, categoriesError, categoriesLoading, eventCategories, eventCategoriesError, eventCategoriesLoading, serviceCategories, serviceCategoriesError, serviceCategoriesLoading, user]);

  return <nav ref={rootRef} className={`site-nav ${mobileOpen ? 'open' : ''}`} aria-label={translate('mainNavigation', language)}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpenPathState([]); }}>
    {historyError && <p className="public-nav-history-error" role="status">{historyError}</p>}
    <ul className={`public-nav-list ${mobileOpen ? 'mobile-open' : ''}`}>
      {menu.map((item) => item.key === 'vendors'
        ? <VendorsMenu key={item.key} item={item} routePath={routePath} onNavigate={onNavigate} close={close}
          openPath={openPath} setOpenPath={setOpenPath} registerMenu={(key, node) => {
            if (node) menuRefs.current.set(key, node); else menuRefs.current.delete(key);
          }} closeTimer={closeTimer} />
        : item.key === 'services'
          ? <ServicesMenu key={item.key} item={item} routePath={routePath} onNavigate={onNavigate} close={close}
            openPath={openPath} setOpenPath={setOpenPath} registerMenu={(key, node) => {
              if (node) menuRefs.current.set(key, node); else menuRefs.current.delete(key);
            }} closeTimer={closeTimer} />
        : <MenuItems key={item.key} items={[item]} level={0} routePath={routePath} onNavigate={onNavigate} close={close}
          openPath={openPath} setOpenPath={setOpenPath} registerMenu={(key, node) => {
            if (node) menuRefs.current.set(key, node); else menuRefs.current.delete(key);
          }} closeTimer={closeTimer} />)}
    </ul>
  </nav>;
}
