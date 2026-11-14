import Logo from './Logo.js';

export default function SplashScreen({ label = 'Loading…' }) {
  return (
    <main className="splash-screen" role="status" aria-live="polite">
      <Logo size="xl" variant="full" />
      <span>{label}</span>
    </main>
  );
}
