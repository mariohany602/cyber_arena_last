import ThemeToggle from "./ThemeToggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 bg-white/70 dark:bg-[#04101a]/70 backdrop-blur border-b dark:border-gray-800">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-cyan-600 flex items-center justify-center text-white font-bold">SP</div>
          <div className="hidden sm:block">
            <h1 className="text-lg font-semibold">Security Portal</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Encrypt • Hash • Analyze</p>
          </div>
        </a>

        <nav className="flex items-center gap-3">
          <a href="/tools" className="text-sm text-gray-700 hover:text-primary">Tools</a>
          <a href="/soc" className="text-sm text-gray-700 hover:text-primary">SOC</a>
          <a href="/history" className="text-sm text-gray-700 hover:text-primary">History</a>
          <a href="#notes" className="hidden sm:inline text-sm px-3 py-2 rounded-md bg-primary/10 text-primary">Security</a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
