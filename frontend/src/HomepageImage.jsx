import React, { useEffect, useState } from 'react';
import apiClient from './api/axios.js';

function resolveHomepageAssetUrl(path) {
  if (!path || !path.startsWith('/api/')) return path;
  const baseUrl = apiClient.defaults.baseURL;
  if (!baseUrl || baseUrl.startsWith('/')) return path;
  return new URL(path, baseUrl).toString();
}

export default function HomepageImage({ src, alt, fallbackLabel, className = '', loading = 'lazy', width = '800', height = '500' }) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = typeof src === 'string' ? resolveHomepageAssetUrl(src) : '';

  useEffect(() => setFailed(false), [resolvedSrc]);

  if (!resolvedSrc || failed) {
    return <div className={`homepage-image-fallback ${className}`} role="img" aria-label={fallbackLabel || alt} />;
  }

  return <img className={className} src={resolvedSrc} alt={alt} loading={loading} width={width} height={height} onError={() => setFailed(true)} />;
}
