'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/empty-state';

/**
 * Route-level error boundary. The raw error is never shown to the user —
 * only the digest, which can be correlated with the server log.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
      console.error('Route error', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="p-6">
      <ErrorState
        description={
          <>
            An unexpected error occurred.
            {error.digest ? (
              <>
                {' '}
                Reference <code className="font-mono text-xs">{error.digest}</code>.
              </>
            ) : null}
          </>
        }
        action={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
