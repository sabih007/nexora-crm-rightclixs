import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-ink-subtle text-[11px] font-semibold tracking-widest uppercase">404</p>
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-ink-muted max-w-sm text-sm">
        The page you are looking for does not exist, or you do not have access to it.
      </p>
      <Button asChild>
        <Link href="/dashboard">Back to overview</Link>
      </Button>
    </div>
  );
}
