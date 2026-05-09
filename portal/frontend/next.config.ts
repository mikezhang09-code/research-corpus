import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy all /api/* requests to the FastAPI backend.
  // This keeps everything on the same origin so the browser never needs to
  // reach localhost:8000 directly — works whether running locally or on a
  // remote VM accessed via its public IP or SSH tunnel.
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
