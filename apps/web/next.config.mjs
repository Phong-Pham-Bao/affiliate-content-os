import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolveWebApiBaseUrl } from '@affiliate-content-os/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In local monorepo development, load root .env if not already present
const rootEnv = path.resolve(__dirname, '../../.env');
if (!process.env.WEB_API_BASE_URL && fs.existsSync(rootEnv)) {
  try {
    process.loadEnvFile(rootEnv);
  } catch {
    // Ignore if unparseable or already loaded
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname, '../../'),
  transpilePackages: ['@affiliate-content-os/config'],
  async rewrites() {
    const apiTarget = resolveWebApiBaseUrl(process.env);
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget}/api/:path*`,
      },
      {
        source: '/auth/:path*',
        destination: `${apiTarget}/auth/:path*`,
      },
    ];
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
