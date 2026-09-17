import { readFileSync } from 'node:fs';

// Inline the shared CSS so exported review pages remain usable offline.
const tokens = readFileSync(new URL('./yasready-platform-tokens.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./yasready-platform.css', import.meta.url), 'utf8');
const themeScript = `<script data-yasready-platform-theme>
(() => {
  const key = 'yasready-theme';
  let saved;
  try { saved = localStorage.getItem(key); } catch {}
  const initial = saved === 'dark' || saved === 'light' ? saved : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const button = document.querySelector('[data-yr-platform-theme]');
    if (button) {
      button.textContent = theme === 'dark' ? '☾' : '☀';
      button.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
      button.title = button.getAttribute('aria-label');
    }
  }
  setTheme(initial);
  document.addEventListener('DOMContentLoaded', () => {
    setTheme(initial);
    document.querySelector('[data-yr-platform-theme]').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
      try { localStorage.setItem(key, next); } catch {}
    });
  }, { once: true });
  addEventListener('storage', event => {
    if (event.key === key && (event.newValue === 'dark' || event.newValue === 'light')) setTheme(event.newValue);
  });
})();
</script>`;
const header = `<a class="yrSkipLink" href="#yrAudiobookContent">Skip to review</a>
<header class="yrPlatformHeader"><div class="yrPlatformHeaderInner">
<a class="yrPlatformBrand" href="https://yasready.com" target="_blank" rel="noopener">YasReady<span>.</span></a>
<span class="yrPlatformModule">Audiobooks</span>
<nav aria-label="YasReady platform"><a href="https://yasready.com" target="_blank" rel="noopener">My business</a><a href="https://publishing.yasready.com" target="_blank" rel="noopener">Publishing</a><button class="yrThemeToggle" type="button" data-yr-platform-theme aria-label="Change color theme">◐</button></nav>
</div></header><div id="yrAudiobookContent" tabindex="-1"></div>`;

export function withYasReadyPlatformUI(html) {
  if (typeof html !== 'string' || !html.includes('</head>') || !html.includes('<body>')) throw new TypeError('Expected a complete review page');
  if (html.includes('data-yasready-platform="1"')) return html;
  return html
    .replace(/<html>/i, '<html lang="en">')
    .replace('</head>', () => `<style data-yasready-platform="1">${tokens}\n${styles}</style>${themeScript}</head>`)
    .replace('<body>', () => `<body>${header}`);
}
