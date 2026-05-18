import type { AppConfig } from "./types.js";

const DEFAULT_PROXY = "http://192.168.0.8:17890";
const DEFAULT_SEARXNG = "http://localhost:8080";
const DEFAULT_NO_PROXY = "localhost,127.0.0.1";

export function loadConfig(): AppConfig {
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy || DEFAULT_PROXY;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || httpProxy;
  const searxngUrl = process.env.SEARXNG_URL || DEFAULT_SEARXNG;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || DEFAULT_NO_PROXY;

  return { httpProxy, httpsProxy, searxngUrl, noProxy };
}
