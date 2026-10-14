import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['10.81.16.79'],
  // Docker builds (client/Dockerfile) set NEXT_OUTPUT_STANDALONE to emit
  // .next/standalone: a minimal server.js plus only the files it needs.
  // Vercel builds leave it unset and use their own output format.
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
};

export default nextConfig;
