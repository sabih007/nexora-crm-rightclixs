import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
};

/**
 * Split-screen auth layout: form on the left, product framing on the right.
 * The right panel collapses away below `lg` so the form owns a small screen.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <div className="flex w-full flex-col justify-center px-5 py-10 sm:px-10 lg:w-[46%] lg:px-14">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <span
              className="flex size-9 items-center justify-center rounded-xl bg-ink text-base font-bold text-accent"
              aria-hidden
            >
              N
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight text-ink">Nexora OS</p>
              <p className="text-[11px] leading-tight text-ink-subtle">Office CRM</p>
            </div>
          </div>
          {children}
        </div>
      </div>

      <div className="relative hidden flex-1 overflow-hidden border-l border-line bg-[#0B1220] lg:block">
        <div
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              'radial-gradient(60rem 40rem at 70% 20%, rgba(49,92,253,0.35), transparent 60%), radial-gradient(45rem 30rem at 20% 80%, rgba(56,189,248,0.22), transparent 60%)',
          }}
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
          aria-hidden
        />

        <div className="relative flex h-full flex-col justify-end p-12 xl:p-16">
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-white">
            Clients, invoices, subscriptions and projects in one place.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">
            Nexora OS keeps the office&rsquo;s financial and delivery records together, with
            role-based access, a complete audit trail, and figures computed from source records
            rather than estimates.
          </p>

          <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-white/10 pt-7">
            {[
              { k: 'Multi-currency', v: 'PKR, USD, EUR, GBP and more' },
              { k: 'Card footprint', v: 'Know where every card is saved' },
              { k: 'Audit trail', v: 'Every financial change recorded' },
            ].map((item) => (
              <div key={item.k}>
                <dt className="text-xs font-semibold text-accent">{item.k}</dt>
                <dd className="mt-1 text-[11px] leading-relaxed text-white/50">{item.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
