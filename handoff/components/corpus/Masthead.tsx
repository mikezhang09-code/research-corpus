import { History, Settings, User } from "lucide-react";

export function Masthead() {
  return (
    <header className="px-14 pt-8 pb-5 border-b border-rule relative">
      <div className="flex items-end justify-between gap-8">
        <div className="flex items-baseline gap-5">
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-ink-mute leading-none pb-1">
            Vol. XII · MMXXVI
          </div>
          <h1 className="font-serif-display text-[44px] leading-[0.95] tracking-tight">
            Research <span className="italic">Corpus</span>
          </h1>
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-ink-mute pb-1">
            № 0042
          </div>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <UtilityPill icon={<History size={13} />} label="History" />
          <UtilityPill icon={<Settings size={13} />} label="Settings" />
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase px-2.5 py-1 border border-terracotta text-terracotta rounded-[1px]">
            PRO
          </span>
          <button className="w-8 h-8 rounded-full border border-ink bg-vellum flex items-center justify-center text-ink-soft hover:bg-paper-deep transition-colors">
            <User size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}

function UtilityPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-rule rounded-[1px] font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink hover:border-ink transition-colors">
      {icon}
      {label}
    </button>
  );
}
