import BrandLogo from './common/BrandLogo.jsx';

export default function AuthCard({ children, className = '' }) {
  return (
    <section className={`login-card ${className}`.trim()}>
      <div className="auth-card-logo">
        <BrandLogo size="132px" />
      </div>
      {children}
    </section>
  );
}
