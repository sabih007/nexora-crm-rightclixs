import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-subtle">404</p>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        The page you are looking for does not exist, or you do not have access to it.
      </p>
      <Button asChild>
        <Link href="/dashboard">Back to overview</Link>
      </Button>
    </div>
  );
}
