import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Rezo — Haiti’s national trade network',
  description: 'The digital infrastructure that lets Haiti’s trade modernization reach its full potential.',
};

// Dark "Rezo night" palette (design brief §2.2) — used only on this premium
// vision/landing route and the login/gov-presentation surfaces.
const LAYERS = [
  { name: 'National Port Community System', outcome: 'One shared record every trade party reads — entered once.' },
  { name: 'Payment orchestration', outcome: 'Fees routed directly payer → payee. Rezo never holds funds.' },
  { name: 'National Single Window', outcome: 'One submission moves port, customs, and release forward.' },
  { name: 'Revenue assurance', outcome: 'Every charge and settlement traceable to a source document.' },
  { name: 'E-Government', outcome: 'The backbone other public services can build on.' },
];

const SECTORS = [
  { name: 'Trade & Customs', outcome: 'Move containers from arrival to delivery, faster.', live: true },
  { name: 'Agriculture', outcome: 'Import permits and inspections in one flow.', live: false },
  { name: 'Health', outcome: 'Pharmaceutical and medical clearance.', live: false },
  { name: 'Environment', outcome: 'Controlled-goods and compliance tracking.', live: false },
  { name: 'E-Government', outcome: 'Shared identity and payments across public services.', live: false },
  { name: 'Revenue assurance', outcome: 'Modern, fully auditable collections.', live: false },
];

export default function VisionPage() {
  return (
    <div className="min-h-screen bg-[#0B2523] text-[#EBF2F1]">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
            <line x1="6" y1="7" x2="17" y2="6" stroke="#3AB9B0" strokeWidth="1.5" />
            <line x1="6" y1="7" x2="9" y2="18" stroke="#3AB9B0" strokeWidth="1.5" />
            <line x1="9" y1="18" x2="17" y2="6" stroke="#3AB9B0" strokeWidth="1.5" />
            <circle cx="6" cy="7" r="2.5" fill="#3AB9B0" />
            <circle cx="17" cy="6" r="2.5" fill="#3AB9B0" />
            <circle cx="9" cy="18" r="2.5" fill="#58C6C5" />
          </svg>
          <span className="text-lg font-bold tracking-tight">Rezo</span>
        </div>
        <Link href="/login" className="rounded-lg border border-[#21504D] px-4 py-1.5 text-sm font-medium text-[#EBF2F1] hover:bg-[#143B37]">
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-16 text-center">
        <p className="animate-rise text-sm font-medium uppercase tracking-widest text-[#3AB9B0]">Haiti’s national trade network</p>
        <h1 className="animate-rise mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl" style={{ animationDelay: '60ms' }}>
          The digital infrastructure that lets Haiti’s trade modernization reach its full potential.
        </h1>
        <p className="animate-rise mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[#9AC3C0]" style={{ animationDelay: '120ms' }}>
          One calm screen shows an importer their container, everything they owe, exactly who to pay, and the deadline —
          then routes payment straight to each party. Rezo never holds the money.
        </p>
        <div className="animate-rise mt-8 flex justify-center gap-3" style={{ animationDelay: '180ms' }}>
          <Link href="/login" className="rounded-lg bg-[#3AB9B0] px-5 py-2.5 text-sm font-semibold text-[#0B2523] hover:bg-[#58C6C5]">Explore the platform</Link>
        </div>
      </section>

      {/* Five-layer stack */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="mb-6 text-center text-xs font-semibold uppercase tracking-widest text-[#9AC3C0]">One backbone, five layers</h2>
        <div className="space-y-2">
          {LAYERS.map((l, i) => (
            <div
              key={l.name}
              className="animate-rise flex items-center gap-4 rounded-xl border border-[#21504D] bg-[#0F2A2D] px-5 py-4"
              style={{ animationDelay: `${i * 70}ms`, marginLeft: `${i * 8}px`, marginRight: `${(LAYERS.length - 1 - i) * 8}px` }}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#143B37] text-xs font-bold text-[#3AB9B0]">{i + 1}</span>
              <div>
                <p className="font-semibold">{l.name}</p>
                <p className="text-sm text-[#9AC3C0]">{l.outcome}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Sector grid */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="mb-2 text-center text-2xl font-bold">A national platform, sector by sector</h2>
        <p className="mb-8 text-center text-sm text-[#9AC3C0]">Trade &amp; Customs is live today. The same backbone extends across government.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECTORS.map((s) => (
            <div key={s.name} className="rounded-xl border border-[#21504D] bg-[#0F2A2D] p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{s.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.live ? 'bg-[#3AB9B0] text-[#0B2523]' : 'border border-[#21504D] text-[#9AC3C0]'}`}>
                  {s.live ? 'Live' : 'Roadmap'}
                </span>
              </div>
              <p className="mt-2 text-sm text-[#9AC3C0]">{s.outcome}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Close */}
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-xl font-semibold leading-relaxed">
          Faster clearance. Fewer avoidable charges. Modern, auditable collections — built for Haiti, owned by Haiti.
        </p>
        <Link href="/login" className="mt-6 inline-block rounded-lg bg-[#3AB9B0] px-5 py-2.5 text-sm font-semibold text-[#0B2523] hover:bg-[#58C6C5]">Sign in</Link>
      </section>

      <footer className="border-t border-[#21504D] py-8 text-center text-xs text-[#5C7C79]">
        Rezo — Haiti’s national trade network
      </footer>
    </div>
  );
}
