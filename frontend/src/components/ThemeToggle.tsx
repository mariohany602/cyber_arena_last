import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState<boolean>(() =>
    typeof window !== "undefined" && (localStorage.theme === "dark" || (!("theme" in localStorage) && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches))
  );

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.theme = "dark";
    } else {
      root.classList.remove("dark");
      localStorage.theme = "light";
    }
  }, [dark]);

  return (
    <button onClick={() => setDark(!dark)} aria-label="Toggle theme" className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800">
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
