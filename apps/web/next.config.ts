import type { NextConfig } from 'next';
import { env } from './lib/env';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${env.API_INTERNAL_URL}/api/:path*` }];
  },
};

export default nextConfig;
