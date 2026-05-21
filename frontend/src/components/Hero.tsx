export default function Hero() {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start mb-8">
      <div>
        <h2 className="text-3xl font-bold">Encryption & Hashing — fast and offline</h2>
        <p className="mt-2 text-gray-600 dark:text-gray-300 max-w-xl">
          Use simple tools to encrypt, decrypt, hash, and encode. Results are local to your browser.
        </p>
        <div className="mt-4 flex gap-3">
          <a href="#tools" className="px-4 py-2 bg-primary text-white rounded-md">Try Tools</a>
          <a href="#notes" className="px-4 py-2 border rounded-md text-sm">Read Notes</a>
        </div>
      </div>

      <div className="bg-white dark:bg-[#071221] border dark:border-gray-800 rounded-xl p-4 shadow-sm">
        <label className="text-sm">Sample input</label>
        <textarea className="mt-2 w-full min-h-[100px] p-3 rounded-md bg-gray-50 dark:bg-[#06111A]" placeholder="Type sample text..." />
        <div className="mt-3 flex items-center justify-between">
          <div className="text-sm text-gray-500">Algorithm: <strong>AES-GCM</strong></div>
          <div className="flex gap-2">
            <button className="px-3 py-2 bg-primary text-white rounded-md">Encrypt</button>
            <button className="px-3 py-2 border rounded-md text-sm">Clear</button>
          </div>
        </div>
      </div>
    </section>
  );
}

