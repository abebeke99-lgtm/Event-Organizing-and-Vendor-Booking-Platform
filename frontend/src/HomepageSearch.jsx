import React, { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { translate, useLanguage } from './language.js';
import { buildHomepageSearchPath } from './homepageUtils.js';

function suggestionFor(type, item) {
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
    type,
    name,
    detail: item.city || item.location || item.category || item.type || '',
    path,
  };
}

export default function HomepageSearch({ api, onNavigate }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const listId = useId();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      setSuggestionsError(false);
      setActiveSuggestion(-1);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      setSuggestionsError(false);
      const search = encodeURIComponent(term);
      const responses = await Promise.allSettled([
        api(`/platform/events?search=${search}&page=1&limit=3`, { signal: controller.signal }),
        api(`/platform/vendors?search=${search}&page=1&limit=3`, { signal: controller.signal }),
        api(`/platform/services?search=${search}&page=1&limit=3`, { signal: controller.signal }),
        api(`/platform/categories?search=${search}`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;

      const suggestionsFrom = responses.flatMap((response, index) => {
        if (response.status !== 'fulfilled') return [];
        const type = ['events', 'vendors', 'services', 'categories'][index];
        const records = Array.isArray(response.value?.data) ? response.value.data : [];
        return records.map((item) => suggestionFor(type, item)).filter(Boolean);
      });
      setSuggestions(suggestionsFrom.slice(0, 8));
      setSuggestionsError(responses.every((response) => response.status === 'rejected'));
      setSuggestionsLoading(false);
      setActiveSuggestion(-1);
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, query, retryKey]);

  function submitSearch(event) {
    event.preventDefault();
    const searchPath = buildHomepageSearchPath(query);
    if (!searchPath) {
      setSearchError(t('publicHomeSearchError'));
      inputRef.current?.focus();
      return;
    }
    setSearchError('');
    onNavigate(searchPath);
  }

  function chooseSuggestion(suggestion) {
    setSuggestionsOpen(false);
    setQuery(suggestion.name);
    onNavigate(suggestion.path);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setSuggestionsOpen(false);
      setActiveSuggestion(-1);
    } else if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setSuggestionsOpen(true);
      setActiveSuggestion((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setSuggestionsOpen(true);
      setActiveSuggestion((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
      event.preventDefault();
      chooseSuggestion(suggestions[activeSuggestion]);
    }
  }

  return <div className="homepage-search-wrap">
    <form className="hero-search homepage-search" role="search" onSubmit={submitSearch}>
      <label className="homepage-search-query">
        <Search size={18} aria-hidden="true"/>
        <input
          ref={inputRef}
          type="search"
          maxLength="120"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSearchError(''); setSuggestionsOpen(true); }}
          onFocus={() => setSuggestionsOpen(true)}
          onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder={t('searchAll')}
          aria-label={t('searchAll')}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestionsOpen && (suggestionsLoading || suggestionsError || suggestions.length > 0)}
          aria-controls={listId}
          aria-activedescendant={activeSuggestion >= 0 ? `${listId}-option-${activeSuggestion}` : undefined}
        />
      </label>
      <button className="button homepage-search-submit" type="submit">{t('search')}</button>
      {suggestionsOpen && (suggestionsLoading || suggestionsError || suggestions.length > 0) && <div className="homepage-search-suggestions" id={listId} role="listbox" aria-label={t('publicHomeSearchSuggestions')}>
        {suggestionsLoading && <p role="status">{t('publicHomeSuggestionsLoading')}</p>}
        {!suggestionsLoading && suggestionsError && <p role="status">{t('publicHomeSuggestionsUnavailable')} <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setRetryKey((current) => current + 1)}>{t('publicHomeRetry')}</button></p>}
        {!suggestionsLoading && !suggestionsError && suggestions.map((suggestion, index) => <button
          type="button"
          role="option"
          id={`${listId}-option-${index}`}
          aria-selected={index === activeSuggestion}
          className={index === activeSuggestion ? 'is-active' : ''}
          key={suggestion.id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => chooseSuggestion(suggestion)}
        >
          <span>{suggestion.name}</span>
          <small>{t(`publicHomeSuggestionType_${suggestion.type}`)}{suggestion.detail ? ` · ${suggestion.detail}` : ''}</small>
        </button>)}
        {!suggestionsLoading && !suggestionsError && suggestions.length === 0 && <p>{t('publicHomeSuggestionsEmpty')}</p>}
      </div>}
    </form>
    {searchError && <p className="hero-search-error" role="alert">{searchError}</p>}
  </div>;
}
