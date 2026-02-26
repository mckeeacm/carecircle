export function restartAllTours() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    keys
      .filter((k) => k.startsWith("cc_tour_done__"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}