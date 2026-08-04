import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Workflow SDK reaches xdg-app-paths through Vercel OIDC. Keeping that
  // Node-only helper external avoids Next bundling it with an empty argv while
  // collecting generated workflow routes on Windows.
  serverExternalPackages: ["xdg-app-paths"]
};

export default withWorkflow(nextConfig);
