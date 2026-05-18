import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SearchWebResult } from "../types.js";

const execFileAsync = promisify(execFile);

const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/";

/**
 * Fetch search results from DuckDuckGo Lite (text-only, w3m-friendly).
 * @param query - Search query string
 * @param proxy - HTTP proxy URL (e.g., http://192.168.0.8:17890)
 * @param timeout - Timeout in ms (default 15000)
 */
export async function ddgSearch(
  query: string,
  proxy: string,
  timeout = 15000,
  maxResults = 10,
): Promise<SearchWebResult[]> {
  const searchUrl = `${DDG_LITE_URL}?q=${encodeURIComponent(query)}`;

  try {
    const { stdout } = await execFileAsync(
      "w3m",
      [
        "-dump",
        "-no-cookie",
        "-o", `http_proxy=${proxy}`,
        searchUrl,
      ],
      { encoding: "utf-8", timeout, env: process.env },
    );

    return parseDDGLite(stdout, maxResults);
  } catch {
    // w3m failed, try curl as fallback
    const { stdout } = await execFileAsync(
      "curl",
      [
        "--silent",
        "--show-error",
        "--max-time", String(Math.floor(timeout / 1000)),
        "--connect-timeout", "5",
        "--proxy", proxy,
        "-A", "Mozilla/5.0 (compatible; w3m/0.5.3)",
        searchUrl,
      ],
      { encoding: "utf-8", timeout },
    );

    return parseDDGLiteHtml(stdout, maxResults);
  }
}

/**
 * Parse DuckDuckGo Lite text output from w3m.
 *
 * Format from w3m dump:
 *   1.   Title
 *        Snippet...
 *        url
 */
function parseDDGLite(text: string, maxResults: number): SearchWebResult[] {
  const results: SearchWebResult[] = [];
  const lines = text.split("\n");

  let i = 0;
  while (i < lines.length && results.length < maxResults) {
    const line = lines[i].trim();

    // Match numbered results: "1.   Title"
    const numMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numMatch) {
      let title = numMatch[1].trim();
      // Remove navigation artifacts from title
      title = title.replace(/\[Next Page >\].*/, "").trim();

      // Collect all content lines until next numbered result
      const collectedLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        if (/^\d+\./.test(nextLine)) break;
        if (nextLine === "" || nextLine.startsWith("[") || nextLine.startsWith("DuckDuckGo")) {
          j++;
          continue;
        }
        collectedLines.push(nextLine);
        j++;
      }

      // Extract URL and snippet from collected lines
      // URLs may span 1-2 lines (e.g. "www.example.com/path/" + "specific-page/")
      let url = "";
      const snippetLines: string[] = [];
      const urlLines: string[] = [];

      // First pass: find the domain line (last line with domain + path)
      let domainIdx = -1;
      for (let k = collectedLines.length - 1; k >= 0; k--) {
        const l = collectedLines[k].trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(l)) continue;
        // Check if it starts with a domain pattern
        const domainMatch = l.match(/^(https?:\/\/)?([\w-]+\.)+[\w-]+\//);
        if (domainMatch) {
          // Extract just the URL part (before any date/timestamp)
          const urlPart = l.split(/\s{2,}/)[0].trim();
          if (urlPart && !/^\d/.test(urlPart)) {
            domainIdx = k;
            break;
          }
        }
      }

      // Everything before domainIdx = snippet, everything from domainIdx onward = URL
      for (let k = 0; k < collectedLines.length; k++) {
        const l = collectedLines[k].trim();
        // Skip date lines
        if (/^\d{4}-\d{2}-\d{2}/.test(l)) continue;

        if (k < domainIdx) {
          snippetLines.push(l);
        } else if (domainIdx >= 0) {
          // URL lines (skip empty)
          if (l) urlLines.push(l);
        }
      }

      // Join multi-line URLs and clean (remove trailing dates/timestamps)
      if (urlLines.length > 0) {
        url = urlLines.join("");
        // Remove trailing date/timestamp
        url = url.replace(/\s+\d{4}-\d{2}-\d{2}T.*$/, "").trim();
        url = url.startsWith("http") ? url : `https://${url}`;
      }

      // Reverse snippet lines back to correct order
      snippetLines.reverse();
      const snippet = snippetLines.join(" ").replace(/\s+/g, " ").trim();

      if (title) {
        results.push({
          title,
          url,
          snippet,
          engine: "duckduckgo_lite",
        });
      }

      i = j;
    } else {
      i++;
    }
  }

  return results;
}

/**
 * Parse DuckDuckGo Lite HTML output (curl fallback).
 */
function parseDDGLiteHtml(html: string, maxResults: number): SearchWebResult[] {
  const results: SearchWebResult[] = [];

  // DDG Lite uses <a class="result-link"> for URLs
  // and <a class="result-header"> or <a class="result-title"> for titles
  // and <td class="result-snippet"> for snippets
  const linkRegex = /class="result-link"[^>]*href="([^"]+)"/g;
  const titleRegex = /class="result-(?:link|header|title)"[^>]*>(.*?)<\/a>/g;
  const snippetRegex = /class="result-snippet"[^>]*>(.*?)<\/td>/g;

  const links: string[] = [];
  const titles: string[] = [];
  const snippets: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    links.push(m[1]);
  }
  // Remove &uddg= prefix from DDG redirect URLs
  const cleanLinks = links.map((u) => {
    const match = u.match(/[?&]uddg=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : u;
  });

  while ((m = titleRegex.exec(html)) !== null) {
    titles.push(m[1].replace(/<[^>]*>/g, "").trim());
  }
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]*>/g, "").trim());
  }

  const count = Math.min(maxResults, Math.max(links.length, titles.length));
  for (let i = 0; i < count; i++) {
    results.push({
      title: titles[i] || "Untitled",
      url: cleanLinks[i] || "",
      snippet: snippets[i] || "",
      engine: "duckduckgo_lite",
    });
  }

  return results;
}
