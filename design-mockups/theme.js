// Persist + apply theme across mockups
(function () {
  const KEY = 'cyber-arena-mockup-theme';
  const themes = ['midnight', 'neon', 'light'];
  const labels = { midnight: 'Midnight Ops', neon: 'HTB Neon', light: 'Light' };

  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(KEY, t);
    document.querySelectorAll('.theme-switch button').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === t);
    });
  }

  function mount() {
    const saved = localStorage.getItem(KEY) || 'midnight';
    const sw = document.createElement('div');
    sw.className = 'theme-switch';
    themes.forEach(t => {
      const b = document.createElement('button');
      b.dataset.theme = t;
      b.textContent = labels[t];
      b.onclick = () => apply(t);
      sw.appendChild(b);
    });
    document.body.appendChild(sw);
    apply(saved);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else { mount(); }
})();
