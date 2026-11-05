'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SyncButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function sync() {
    setLoading(true);
    const res = await fetch('/api/domains/sync', { method: 'POST' });
    const data = await res.json();
    setLoading(false);
    alert(res.ok ? `Synced ${data.synced} domains` : `Error: ${data.error}`);
    router.refresh();
  }

  return (
    <button onClick={sync} disabled={loading}
      className="rounded-lg bg-[#315CFD] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
      {loading ? 'Syncing…' : 'Sync from Spaceship'}
    </button>
  );
}