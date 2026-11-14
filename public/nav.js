// Header behaviour shared by every page: platform menus (desktop), the slide-in
// menu (phones) and the light/dark switch. Loaded by app.js and by the legal
// pages. Works without JavaScript too: the menus are <details> elements.

const root = document.documentElement;

// --------------------------------------------------------------- menus ----
// Only one menu open at a time; close on outside click and Escape.
const menus = [...document.querySelectorAll('.menu details')];
for (const d of menus) {
  d.addEventListener('toggle', () => {
    if (d.open) for (const other of menus) if (other !== d) other.open = false;
  });
}
document.addEventListener('click', (e) => {
  for (const d of menus) if (d.open && !d.contains(e.target)) d.open = false;
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = menus.find((d) => d.open);
  if (open) {
    open.open = false;
    open.querySelector('summary').focus();
  }
});

// -------------------------------------------------------------- drawer ----
const drawer = document.getElementById('drawer');
const menuBtn = document.getElementById('menuBtn');
let lastFocus = null;

function openDrawer() {
  lastFocus = document.activeElement;
  drawer.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  document.body.classList.add('no-scroll');
  (drawer.querySelector('[aria-current="page"]') || drawer.querySelector('a')).focus();
}

function closeDrawer() {
  drawer.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('no-scroll');
  (lastFocus || menuBtn).focus();
}

if (drawer && menuBtn) {
  menuBtn.addEventListener('click', openDrawer);
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeDrawer();
  });
  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return closeDrawer();
    if (e.key !== 'Tab') return;
    // Keep keyboard focus inside the open menu.
    const items = [...drawer.querySelectorAll('a, button')];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

// --------------------------------------------------------------- theme ----
// Yellow by default; the moon button switches to dark (remembered).
const themeBtn = document.getElementById('themeBtn');
const themeIcon = document.getElementById('themeIcon');

function paintThemeButton() {
  const dark = root.dataset.theme === 'dark';
  themeIcon?.setAttribute('href', `/icons.svg#${dark ? 'i-sun' : 'i-moon'}`);
  themeBtn?.setAttribute('aria-label', dark ? 'Switch to yellow mode' : 'Switch to dark mode');
  themeBtn?.setAttribute('aria-pressed', String(dark));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1C1B18' : '#FFD43B');
}

themeBtn?.addEventListener('click', () => {
  const dark = root.dataset.theme !== 'dark';
  if (dark) root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  try {
    if (dark) localStorage.setItem('ytpocket.theme', 'dark');
    else localStorage.removeItem('ytpocket.theme');
  } catch {
    /* not remembered, still switched */
  }
  paintThemeButton();
});
paintThemeButton();
