/**
 * Server-side Cloudflare types, declared narrowly. @cloudflare/workers-types
 * is not loaded globally here: it redefines DOM types (Element.append for
 * HTMLRewriter) and breaks the browser scripts in src/scripts.
 */
interface KVNamespace {
  get<T = unknown>(key: string, options: { type: 'json'; cacheTtl?: number }): Promise<T | null>;
}

declare module 'cloudflare:workers' {
  export const env: {
    KV?: KVNamespace;
    ADSENSE_CLIENT?: string;
    CF_BEACON_TOKEN?: string;
    GOOGLE_SITE_VERIFICATION?: string;
    [key: string]: unknown;
  };
}

declare module '*.svg?raw' {
  const content: string;
  export default content;
}
