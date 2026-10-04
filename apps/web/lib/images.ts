// Hosts the card mirror's image URLs point at, measured 2026-10-04: images.pokemontcg.io
// (19 818 cards), images.scrydex.com (852, newer sets via pokemontcg.io) and assets.tcgdex.net
// (the fallback provider). next.config.ts allows these for optimization.
export const CARD_IMAGE_HOSTS = ['images.pokemontcg.io', 'images.scrydex.com', 'assets.tcgdex.net'];

// next/image throws, and takes the page down, on a host the config does not allow; an image
// from anywhere else is served as it is instead.
export function isOptimizable(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && CARD_IMAGE_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}
