import Logo from './Logo.js';

export default function SplashScreen({ label = 'Loading…' }) {
  return (
    <main className="splash-screen flex min-h-screen flex-col items-center justify-center gap-5 bg-surface-page px-4 text-center" role="status" aria-live="polite">
      <Logo size="xl" variant="full" />
      <span>{label}</span>
    </main>
  );
}
