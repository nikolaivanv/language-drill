import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@language-drill/api-client', '@language-drill/shared'],
};

export default nextConfig;
