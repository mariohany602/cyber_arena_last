import { Shield } from "lucide-react";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 bg-ui-bg/70 backdrop-blur-md border-b border-ui-border/30">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center text-white font-black shadow-glow-primary group-hover:shadow-glow-cyan transition-all">
            <Shield size={20} />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-lg font-black tracking-tighter text-white uppercase leading-none">
              CYBER <span className="text-brand-primary">ARENA</span>
            </h1>
            <p className="text-[10px] font-mono text-ui-muted uppercase tracking-widest mt-1">Operation Center // v2.4</p>
          </div>
        </a>

        <nav className="flex items-center gap-6">
          <a href="#docs" className="text-xs font-bold text-ui-muted hover:text-white transition-colors uppercase tracking-widest">Docs</a>
          <button className="text-xs font-bold px-4 py-2 rounded-lg bg-brand-primary/10 text-brand-primary border border-brand-primary/30 hover:bg-brand-primary/20 transition-all">
            System Status: Online
          </button>
        </nav>
      </div>
    </header>
  );
}
