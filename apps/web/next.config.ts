import type { NextConfig } from 'next';
import { env } from './lib/env';
import { CARD_IMAGE_HOSTS } from './lib/images';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: CARD_IMAGE_HOSTS.map((host) => new URL(`https://${host}/**`)),
    // Card art never changes at a URL; keep the converted copies for a month, not four hours.
    minimumCacheTTL: 2_592_000,
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${env.API_INTERNAL_URL}/api/:path*` }];
  },
};

export default nextConfig;
