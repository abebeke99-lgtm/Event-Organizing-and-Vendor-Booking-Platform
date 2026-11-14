import { useState } from 'react';
import authBackground from '../assets/auth-bg.jpg';
import { translate, useLanguage } from '../language.js';
import Logo from './Logo.js';

export default function AuthLayout({ children, languageSelector }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [imageUnavailable, setImageUnavailable] = useState(false);

  return (
    <main className={`auth-layout${imageUnavailable ? ' auth-layout-image-unavailable' : ''}`}>
      {languageSelector && <div className="auth-layout-language">{languageSelector}</div>}
      <section className="auth-layout-panel" aria-label={t('authBranding')}>
        {!imageUnavailable && (
          <img
            className="auth-layout-photo"
            src={authBackground}
            alt=""
            aria-hidden="true"
            onError={() => setImageUnavailable(true)}
          />
        )}
        <div className="auth-panel-logo">
          <Logo size="lg" variant="mono-white" />
        </div>
        <div className="auth-panel-copy">
          <h2>{t('authHeroTitle')}</h2>
          <p>{t('authHeroSubtitle')}</p>
          <ul className="auth-panel-features" aria-label={t('authFeaturesLabel')}>
            <li>{t('authFeatureVenues')}</li>
            <li>{t('authFeatureVendors')}</li>
            <li>{t('authFeatureGuests')}</li>
          </ul>
        </div>
        <div className="auth-trust-card">
          <span className="auth-trust-mark" aria-hidden="true">✓</span>
          <span>{t('authTrustText')}</span>
        </div>
      </section>
      <div className="auth-layout-content">{children}</div>
    </main>
  );
}
