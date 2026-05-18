import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

const FETCH_EVENT_TYPE = "pi-ext-web-fetch-event";
const SEARCH_EVENT_TYPE = "pi-ext-web-search-event";

function truncateUrl(url: string, maxLen = 50): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    const shortPath = path.length > maxLen ? path.slice(0, maxLen - 1) + "…" : path;
    return parsed.hostname + shortPath;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen - 1) + "…" : url;
  }
}

export function registerMessageRenderers(pi: ExtensionAPI): void {
  // ext_web_fetch message renderer
  pi.registerMessageRenderer(FETCH_EVENT_TYPE, (message, { expanded }, theme) => {
    const details = message.details as {
      source?: string;
      status?: number;
      errorType?: string;
      title?: string;
      url?: string;
      elapsed?: number;
    } | undefined;

    const source = details?.source || "unknown";
    const url = details?.url || "";
    const elapsed = details?.elapsed ? `${(details.elapsed / 1000).toFixed(1)}s` : "";
    const isSuccess = source !== "error";

    const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
    box.addChild(new Text(theme.fg("customMessageLabel", theme.bold("ext_web_fetch")), 0, 0));

    if (!expanded) {
      if (isSuccess) {
        const statusText = details?.status ? `${details.status} OK` : "OK";
        const meta = [statusText, truncateUrl(url), elapsed, source].filter(Boolean).join(" - ");
        box.addChild(new Text(` ${theme.fg("customMessageText", meta)}`, 0, 0));
      } else {
        const errorType = details?.errorType || "unknown";
        const statusText = details?.status ? `HTTP ${details.status}` : "";
        const meta = [statusText, truncateUrl(url), elapsed, errorType].filter(Boolean).join(" - ");
        box.addChild(new Text(` ${theme.fg("error", `⚠ ${meta}`)}`, 0, 0));
      }
      return box;
    }

    // Expanded view
    const lines: string[] = [];
    lines.push(`${theme.fg("dim", "URL: ")}${theme.fg("customMessageText", url)}`);
    if (isSuccess) {
      lines.push(`${theme.fg("dim", "Source: ")}${theme.fg("customMessageText", source)}`);
      if (details?.status) lines.push(`${theme.fg("dim", "Status: ")}${theme.fg("customMessageText", String(details.status))}`);
      if (details?.title) lines.push(`${theme.fg("dim", "Title: ")}${theme.fg("customMessageText", details.title)}`);
    } else {
      lines.push(`${theme.fg("dim", "Error: ")}${theme.fg("error", details?.errorType || "unknown")}`);
    }
    lines.push(`${theme.fg("dim", "Elapsed: ")}${theme.fg("customMessageText", elapsed)}`);
    box.addChild(new Text(lines.join("\n"), 0, 0));
    return box;
  });

  // ext_web_search message renderer
  pi.registerMessageRenderer(SEARCH_EVENT_TYPE, (message, { expanded }, theme) => {
    const details = message.details as {
      source?: string;
      resultCount?: number;
      query?: string;
      elapsed?: number;
    } | undefined;

    const query = details?.query || "";
    const count = details?.resultCount || 0;
    const elapsed = details?.elapsed ? `${(details.elapsed / 1000).toFixed(1)}s` : "";

    const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
    box.addChild(new Text(theme.fg("customMessageLabel", theme.bold("ext_web_search")), 0, 0));

    if (!expanded) {
      const meta = [`${count} results`, query, elapsed].filter(Boolean).join(" - ");
      box.addChild(new Text(` ${theme.fg("customMessageText", meta)}`, 0, 0));
      return box;
    }

    const lines: string[] = [];
    lines.push(`${theme.fg("dim", "Query: ")}${theme.fg("customMessageText", query)}`);
    lines.push(`${theme.fg("dim", "Results: ")}${theme.fg("customMessageText", String(count))}`);
    lines.push(`${theme.fg("dim", "Elapsed: ")}${theme.fg("customMessageText", elapsed)}`);
    lines.push(`${theme.fg("dim", "Source: ")}${theme.fg("customMessageText", "searxng")}`);
    box.addChild(new Text(lines.join("\n"), 0, 0));
    return box;
  });
}
