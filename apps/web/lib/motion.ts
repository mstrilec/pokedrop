/** For timers and frames: the CSS reduced-motion rule cannot reach them. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
