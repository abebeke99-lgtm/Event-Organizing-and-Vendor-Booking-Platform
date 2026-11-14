import Logo from './Logo.js';

export default function AuthCard({ children, className = '' }) {
  return (
    <section className={`login-card ${className}`.trim()}>
      <div className="auth-card-logo">
        <Logo size="lg" variant="full" />
      </div>
      {children}
    </section>
  );
}
