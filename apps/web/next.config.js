/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow importing the shared-types workspace package (TS source).
  transpilePackages: ['@rezo/shared-types'],
};

module.exports = nextConfig;
