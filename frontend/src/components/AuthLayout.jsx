import { useState } from 'react';
import authBackground from '../assets/auth-bg.jpg';
import { translate, useLanguage } from '../language.js';
import BrandLogo from './common/BrandLogo.jsx';

export default function AuthLayout({ children, languageSelector }) {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const [imageUnavailable, setImageUnavailable] = useState(false);

  return (
    <main className={`auth-layout min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-surface-page${imageUnavailable ? ' auth-layout-image-unavailable' : ''}`}>
      {languageSelector && <div className="auth-layout-language absolute right-4 top-4 z-20 sm:right-6 sm:top-6">{languageSelector}</div>}
      <section className="auth-layout-panel relative hidden min-h-[320px] overflow-hidden p-8 text-white lg:flex lg:flex-col lg:justify-between" aria-label={t('authBranding')}>
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
          <BrandLogo size="clamp(48px, 8vw, 112px)" />
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
      <div className="auth-layout-content flex items-center justify-center p-4 sm:p-6 md:p-10">{children}</div>
    </main>
  );
}
