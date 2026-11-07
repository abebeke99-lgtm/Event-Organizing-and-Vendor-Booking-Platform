import { useState } from 'react';
import authBackground from '../assets/auth-bg.jpg';

export default function AuthLayout({ children }) {
  const [imageUnavailable, setImageUnavailable] = useState(false);

  return (
    <main className={`auth-layout${imageUnavailable ? ' auth-layout-image-unavailable' : ''}`}>
      <section className="auth-layout-panel" aria-hidden="true">
        {!imageUnavailable && (
          <img
            className="auth-layout-photo"
            src={authBackground}
            alt=""
            onError={() => setImageUnavailable(true)}
          />
        )}
        <div className="auth-panel-logo">
          <img src="/eventhub-logo.png" alt="" />
        </div>
        <div className="auth-panel-copy">
          <h2>Plan. Book. Celebrate.</h2>
          <p>Bring every detail of your next celebration together in one place.</p>
        </div>
      </section>
      <div className="auth-layout-content">{children}</div>
    </main>
  );
}
