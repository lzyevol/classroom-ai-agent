import type { NextConfig } from 'next';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: [],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  async rewrites() {
    return [
      { source: '/backend/:path*', destination: `${BACKEND_URL}/:path*` },
    ];
  },
};

export default nextConfig;
