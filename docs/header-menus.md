# EventHub header menus

This document records the Phase 1 audit and the confirmed Phase 2 menu
implementation. Menu structure is defined in
`frontend/src/publicNavigationUtils.js`; data loading and rendering are in
`frontend/src/PublicNavigation.jsx`.

## Final menu structure

Dynamic categories are loaded once and cached in memory for five minutes from
`/api/platform/events/categories` or `/api/platform/categories`. Empty category
sections are omitted. Menu loading and retryable error states remain available.
Dynamic category labels pass through `translateText`, which translates known
labels and otherwise displays the API-provided name.

The tables retain the Phase 1 audit fields and record the confirmed Phase 2
implementation.

### Events

| Menu item label | Route and query parameters | Static or loaded from the database (and API endpoint) | File and line where it is defined | Translation key(s) | Route exists? | Target applies URL filter? |
|---|---|---|---|---|---|---|
| Browse Events | `/events` | Static | `frontend/src/publicNavigationUtils.js:47` | `publicNavBrowseEvents` | Yes | Not applicable; no filter |
| Upcoming Events | `/events?status=upcoming` | Static | `frontend/src/publicNavigationUtils.js:48` | `publicNavUpcomingEvents` | Yes | Yes; Events page reads `status` and applies it through `/api/platform/events` |
| Free Events | `/events?status=free` | Static | `frontend/src/publicNavigationUtils.js:49` | `publicNavFreeEvents` | Yes | Yes; Events page reads `status` and applies it through `/api/platform/events` |
| Event category (up to 5) | `/events?category=<category-name>` | Database-backed via `/api/platform/events/categories`; empty section omitted | `frontend/src/publicNavigationUtils.js:30, 50`; path built by `categoryLink` at `:1-27` | API name passed through `translateText`; known category names resolve to existing keys | Yes | Yes; Events page reads the category and queries `/api/platform/events` |

### Find Vendors

| Menu item label | Route and query parameters | Static or loaded from the database (and API endpoint) | File and line where it is defined | Translation key(s) | Route exists? | Target applies URL filter? |
|---|---|---|---|---|---|---|
| Browse Vendors | `/vendors` | Static | `frontend/src/publicNavigationUtils.js:53` | `publicNavBrowseVendors` | Yes | Not applicable; no filter |
| Vendor category (up to 6 with vendors) | `/vendors?category=<category-name>` | Database-backed via `/api/platform/categories`; filters `vendorCount > 0`, count shown, empty categories omitted | `frontend/src/publicNavigationUtils.js:35-36, 54`; path built by `categoryLink` at `:1-27` | API name passed through `translateText`; known category names resolve to existing keys | Yes | Yes; Vendors page reads the category and queries `/api/platform/vendors` |

### Services

| Menu item label | Route and query parameters | Static or loaded from the database (and API endpoint) | File and line where it is defined | Translation key(s) | Route exists? | Target applies URL filter? |
|---|---|---|---|---|---|---|
| Browse Services | `/services` | Static | `frontend/src/publicNavigationUtils.js:57` | `publicNavBrowseServices` | Yes | Not applicable; no filter |
| Service category (up to 6 with services) | `/services?category=<category-name>` | Database-backed via `/api/platform/categories`; filters `serviceCount > 0`, count shown, empty categories omitted | `frontend/src/publicNavigationUtils.js:31-34, 58`; path built by `categoryLink` at `:1-27` | API name passed through `translateText`; known category names resolve to existing keys | Yes | Yes; Services page reads the category and queries `/api/platform/services` |

### Categories

| Menu item label | Route and query parameters | Static or loaded from the database (and API endpoint) | File and line where it is defined | Translation key(s) | Route exists? | Target applies URL filter? |
|---|---|---|---|---|---|---|
| Six highest-count categories | `/categories/<slug>` | Database-backed via `/api/platform/categories`; ordered by `vendorCount + serviceCount`, up to six; optional category image shown as an icon | `frontend/src/publicNavigationUtils.js:39-44, 61`; path built by `categoryLink` at `:1-27` | API name passed through `translateText`; known category names resolve to existing keys | Yes | Not applicable; opens the category detail page by slug |
| View All Categories | `/categories` | Static | `frontend/src/publicNavigationUtils.js:62` | `publicNavViewAllCategories` | Yes | Not applicable; no filter |

### About Us

| Menu item label | Route and query parameters | Static or loaded from the database (and API endpoint) | File and line where it is defined | Translation key(s) | Route exists? | Target applies URL filter? |
|---|---|---|---|---|---|---|
| About EventHub (About group) | `/about` | Static | `frontend/src/publicNavigationUtils.js:70` | `aboutEventHub`; heading `publicNavAboutGroup` | Yes | Not applicable; no filter |
| Help Center (Support group) | `/help` | Static | `frontend/src/publicNavigationUtils.js:71` | `helpCenter`; heading `publicNavSupportGroup` | Yes | Not applicable; no filter |
| Frequently Asked Questions | `/help` | Static | `frontend/src/publicNavigationUtils.js:72` | `frequentlyAskedQuestions` | Yes | Not applicable; shares the generic Help page |
| Booking Guide | `/help` | Static | `frontend/src/publicNavigationUtils.js:73` | `bookingGuide` | Yes | Not applicable; shares the generic Help page |
| Contact Support | `/contact` | Static | `frontend/src/publicNavigationUtils.js:74` | `contactSupport` | Yes | Not applicable; no filter |
| Privacy Policy (Legal group) | `/privacy` | Static | `frontend/src/publicNavigationUtils.js:75` | `privacyPolicy`; heading `publicNavLegalGroup` | Yes | Not applicable; no filter |
| Terms and Conditions | `/terms` | Static | `frontend/src/publicNavigationUtils.js:76` | `termsConditions` | Yes | Not applicable; no filter |

The group heading translations are in `frontend/src/language.js` (English
lines 32-34; Amharic lines 883-885).

About Us items are grouped under translated About, Support, and Legal headings.
The duplicate Contact Us entry is omitted because a top-level Contact Us link
already exists. There is no Browse/View All directory action in About Us; the
one-entry-point rule applies to the four directory menus, where a Browse or
View All link has a meaningful destination.

Events has at most eight links (three static plus five categories); Find Vendors
and Services have at most seven each; Categories has seven; About Us has seven.
Find Vendors and Services no longer repeat their top-level destination as a
second View All entry. Categories has only one full-list link; its other links
open individual category pages.

## Route and filter audit

| Menu destination | Router target | URL filter behavior |
|---|---|---|
| `/events` and `status`/`category` query links | Events listing | Existing page reads the supported query values and applies them through `/api/platform/events`. |
| `/vendors?category=...` | Vendor listing | Existing page reads the category and queries `/api/platform/vendors`. |
| `/services?category=...` | Service listing | Existing page reads the category and queries `/api/platform/services`. |
| `/categories` and `/categories/:slug` | Category list and detail pages | Both routes exist; category detail links use the API slug. |
| `/about`, `/help`, `/contact`, `/privacy`, `/terms` | Corresponding public pages | Routes exist. FAQ and Booking Guide still share the generic `/help` destination; they do not have distinct pages or anchors. |

No final menu item links to a missing route, and the Events, Vendors, and
Services filters used by the menus are applied by their target pages. The former
Events “No categories available” row was rendered by the frontend when the
event-category API returned an empty array; it is now omitted along with any
empty dynamic category section.

## Data limitations and chosen behavior

- There is no separate service-type taxonomy endpoint. As confirmed for Phase 2,
  Services uses the available service categories from `/api/platform/categories`.
- The categories API provides `vendorCount`, `serviceCount`, and an optional
  `image`, but no category icon field or behavioral usage metric. Therefore
  category popularity is ranked by combined vendor and service counts, and an
  available category image is used as the small icon.
- Event categories come from `/api/platform/events/categories`; if the endpoint
  returns no categories, the menu shows no category section rather than an
  empty-state sentence.

## Visual and interaction audit

The reported pixel-noise source could not be proven from source inspection
alone. The sticky header previously applied `backdrop-filter: blur(16px)` while
hero media could move behind it. The blur has been removed. Dropdown panels now
use an opaque theme-aware `var(--card)` background and `isolation: isolate`.
Runtime-specific GPU behavior may still vary across browsers and devices.

Desktop dropdown panels use `max-height: calc(100vh - header height)` with
vertical scrolling; mobile nested panels use the same viewport-relative limit.
This keeps long menus, including About Us, scrollable rather than clipped.
The existing five-minute menu cache, loading skeleton, retryable error state,
one-open-menu behavior, keyboard navigation, ARIA state, and click-to-close
navigation are retained.

## Implementation and tests

- Menu data, routes, and filtering: `frontend/src/publicNavigationUtils.js`
- Menu API cache, rendering, and interaction: `frontend/src/PublicNavigation.jsx`
- English and Amharic group headings: `frontend/src/language.js`
- Public menu translations: `frontend/src/i18n/modules/publicMarketplace.js`
- Responsive and theme-aware dropdown styles: `frontend/src/styles.css`
- Menu structure and interaction tests: `frontend/test/publicNavigationUtils.test.js`,
  `frontend/test/headerNavigation.test.js`
