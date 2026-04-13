import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@cef-ai/client-sdk", "unpdf"],
};

export default nextConfig;
