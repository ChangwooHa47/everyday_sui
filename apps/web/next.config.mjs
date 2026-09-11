import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
export default {
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  ...(process.env.EVERYDAY_STATIC_EXPORT === '1' ? {
    output: 'export',
    images: { unoptimized: true },
  } : {}),
};
