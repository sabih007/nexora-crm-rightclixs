'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SyncButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function sync() {
    setLoading(true);
    const res = await fetch('/api/domains/sync?force=1', { method: 'POST' });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) alert(`Error: ${data.error}`);
    else if (data.skipped) alert('Already synced in the last 5 minutes');
    else alert(`Synced ${data.synced} domains · ${data.priced} priced`);

    router.refresh();
  }

  return (
    <button onClick={sync} disabled={loading}
      className="rounded-lg bg-[#315CFD] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
      {loading ? 'Syncing…' : 'Sync from Spaceship'}
    </button>
  );
}