// Gemeinsame Schriftliste und Darstellungs-Optionen für Verwaltung und Screens.
// Schriften mit `google` werden bei Bedarf von Google Fonts geladen (braucht Internet,
// sonst greift die Ersatzschrift aus `family`).

window.SCREEN_FONTS = [
  { id: 'system', label: 'Standard', family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'serif', label: 'Serif (Georgia)', family: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Schreibmaschine', family: '"Courier New", Consolas, monospace' },
  { id: 'impact', label: 'Plakativ (Impact)', family: 'Impact, "Arial Black", Haettenschweiler, sans-serif' },
  { id: 'comic', label: 'Locker (Comic)', family: '"Comic Sans MS", "Segoe Print", cursive' },
  { id: 'bebas', label: 'Bebas Neue', family: '"Bebas Neue", Impact, sans-serif', google: 'Bebas+Neue' },
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat, system-ui, sans-serif', google: 'Montserrat:wght@400;700' },
  { id: 'playfair', label: 'Playfair Display', family: '"Playfair Display", Georgia, serif', google: 'Playfair+Display:wght@400;700' },
  { id: 'pacifico', label: 'Pacifico (Schreibschrift)', family: 'Pacifico, "Segoe Script", cursive', google: 'Pacifico' },
  { id: 'specialelite', label: 'Special Elite (alt)', family: '"Special Elite", "Courier New", monospace', google: 'Special+Elite' },
  { id: 'creepster', label: 'Creepster (Halloween)', family: 'Creepster, Impact, cursive', google: 'Creepster' },
  { id: 'nosifer', label: 'Nosifer (Halloween)', family: 'Nosifer, Impact, cursive', google: 'Nosifer' },
  { id: 'butcherman', label: 'Butcherman (Halloween)', family: 'Butcherman, Impact, cursive', google: 'Butcherman' },
];

// Weiche Ecken: abgerundet und zum Rand hin ausgeblendet
window.SCREEN_EDGES = [
  { id: 'none', label: 'Eckig' },
  { id: 'soft', label: 'Weich' },
  { id: 'strong', label: 'Stark weich' },
];

/** CSS-Schriftfamilie zur ID; lädt Web-Schriften bei Bedarf nach */
window.fontFamily = function (id) {
  const font = SCREEN_FONTS.find((f) => f.id === id) ?? SCREEN_FONTS[0];
  if (font.google && !document.querySelector(`link[data-font="${font.id}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
    link.dataset.font = font.id;
    document.head.appendChild(link);
  }
  return font.family;
};
