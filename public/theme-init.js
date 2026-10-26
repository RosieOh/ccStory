// Runs before the app bundle so a dark theme never flashes light first.
// (A separate file, not inline: the CSP allows scripts from the app only.)
try {
  var t = localStorage.getItem('vault-theme')
  var dark = t === 'dark' || (t === null && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
} catch {
  /* storage unavailable: light */
}
