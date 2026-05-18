import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { registerFetchWebTool } from "./tools/fetch-web.js";
import { registerSearchWebTool } from "./tools/search-web.js";
import { registerMessageRenderers } from "./ui.js";
import { checkW3mAvailable } from "./fetcher/w3m.js";

export default async function piExtWebFetch(pi: ExtensionAPI): Promise<void> {
  const config = loadConfig();

  // Check system dependencies on load
  const w3mAvailable = await checkW3mAvailable();

  // Register message renderers
  registerMessageRenderers(pi);

  // Register tools
  registerFetchWebTool(pi, config);
  registerSearchWebTool(pi, config);

  // Notify user on session start (ctx is only available via events)
  pi.on("session_start", async (_event, ctx) => {
    if (!w3mAvailable) {
      ctx.ui.notify(
        "pi-ext-web-fetch: w3m not found. Web fetch will work for basic pages, but fallback rendering is unavailable.",
        "warning",
      );
    }
    ctx.ui.notify(
      `pi-ext-web-fetch loaded. Proxy: ${config.httpProxy}, SearXNG: ${config.searxngUrl}`,
      "info",
    );
  });
}
