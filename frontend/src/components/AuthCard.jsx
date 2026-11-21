import BrandLogo from './common/BrandLogo.jsx';

export default function AuthCard({ children, className = '' }) {
  return (
    <section className={`login-card ui-card w-full max-w-[440px] p-5 sm:p-7 md:p-8 ${className}`.trim()}>
      <div className="auth-card-logo mb-4 sm:mb-6">
        <BrandLogo size="132px" />
      </div>
      {children}
    </section>
  );
}
