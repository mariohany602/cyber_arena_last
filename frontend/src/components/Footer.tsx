export default function Footer() {
  return (
    <footer className="mt-12 py-6 text-sm text-gray-600 dark:text-gray-400">
      <div className="max-w-6xl mx-auto px-4">© {new Date().getFullYear()} Security Portal — Local-only tools</div>
    </footer>
  );
}
