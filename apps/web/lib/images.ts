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
