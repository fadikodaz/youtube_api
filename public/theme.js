// Applies the saved theme before the first paint (no yellow flash for people
// who chose dark). Loaded as a normal, render-blocking script on purpose.
// Yellow is the default; dark only when the user picked it with the moon button.
(function () {
  try {
    if (localStorage.getItem('ytpocket.theme') === 'dark') {
      document.documentElement.dataset.theme = 'dark';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1C1B18');
    }
  } catch {
    /* storage blocked: stay on the default */
  }
})();
