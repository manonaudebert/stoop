import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.stoopnyc.org" }],
        destination: "https://stoopnyc.org/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
