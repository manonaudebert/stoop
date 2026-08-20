import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* www → apex canonicalization is handled at the hosting platform level
     (apex stoopcity.org set as the primary domain), not here — doing it in
     both places caused an ERR_TOO_MANY_REDIRECTS loop. */
};

export default nextConfig;
