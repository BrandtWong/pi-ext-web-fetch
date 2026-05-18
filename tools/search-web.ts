import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AppConfig, SearchWebResult } from "../types.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ddgSearch } from "../fetcher/ddg.js";

const execFileAsync = promisify(execFile);

export function registerSearchWebTool(pi: ExtensionAPI, config: AppConfig): void {
  pi.registerTool({
    name: "ext_web_search",
    label: "Web Search",
    description:
      "Search the web using the local SearXNG instance. Returns structured search results with titles, URLs, and snippets.",
    promptSnippet:
      "Search the web for information using ext_web_search with specific queries and optional filters.",
    promptGuidelines: [
      "Use ext_web_search when you need to find information across multiple sources.",
      "The tool queries the local SearXNG instance — no authentication needed.",
      "Use categories to narrow results: general, images, news, videos, music, files, it, science, social-media.",
      "Use engines to specify particular search engines (google, bing, duckduckgo, etc.).",
      "For fetching a specific page's content after searching, use ext_web_fetch on the result URLs.",
      "maxResults controls how many results to return (default 10, max 50).",
    ],
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query keywords",
        },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Search categories: general, images, news, videos, music, files, it, science, social-media (default: general)",
        },
        language: {
          type: "string",
          description: "Search language code (default: auto)",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (default 10, max 50)",
        },
        engines: {
          type: "array",
          items: { type: "string" },
          description: "Specific search engines to query (google, bing, duckduckgo, etc.)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    } as any,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const startTime = Date.now();
      const query = (params as any).query as string;
      const categories = ((params as any).categories as string[]) || ["general"];
      const language = ((params as any).language as string) || "auto";
      const maxResults = Math.min(((params as any).maxResults as number) || 10, 50);
      const engines = (params as any).engines as string[] | undefined;

      const searchUrl = new URL(config.searxngUrl);
      searchUrl.pathname = "/search";
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("format", "json");
      searchUrl.searchParams.set("categories", categories.join(","));
      searchUrl.searchParams.set("language", language);
      searchUrl.searchParams.set("pageno", "1");

      if (engines && engines.length > 0) {
        searchUrl.searchParams.set("engines", engines.join(","));
      }

      try {
        const { stdout } = await execFileAsync(
          "curl",
          [
            "--silent",
            "--show-error",
            "--noproxy", "localhost,127.0.0.1",
            "--max-time", "15",
            "--connect-timeout", "5",
            searchUrl.toString(),
          ],
          { encoding: "utf-8", timeout: 15000 },
        );

        const data = JSON.parse(stdout);
        const searxngResults = (data.results || []).slice(0, maxResults).map((r: any) => ({
          title: r.title || "",
          url: r.url || "",
          snippet: r.content || r.snippet || "",
          engine: r.engine || "",
        }));

        const unresponsive = data.unresponsive_engines || [];
        const allEnginesDown = unresponsive.length > 0 && searxngResults.length === 0;

        // If SearXNG has no results and all engines are down, try DuckDuckGo Lite fallback
        if (allEnginesDown) {
          try {
            const ddgResults = await ddgSearch(query, config.httpProxy, 15000, maxResults);
            if (ddgResults.length > 0) {
              const result: SearchWebResult = {
                success: true,
                results: ddgResults,
                query,
                elapsed: Date.now() - startTime,
              };
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                details: { source: "duckduckgo_lite", resultCount: ddgResults.length },
              };
            }
          } catch {
            // DDG also failed, return original SearXNG response with engine status
          }
        }

        const result: SearchWebResult = {
          success: true,
          results: searxngResults,
          query,
          elapsed: Date.now() - startTime,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: {
            source: "searxng",
            resultCount: searxngResults.length,
            unresponsiveEngines: unresponsive.map((e: any[]) => e[0] || "unknown"),
          },
        };
      } catch (error: any) {
        const elapsed = Date.now() - startTime;

        // If SearXNG is unreachable, try DuckDuckGo Lite directly
        if (config.httpProxy) {
          try {
            const ddgResults = await ddgSearch(query, config.httpProxy, 15000, maxResults);
            if (ddgResults.length > 0) {
              const result: SearchWebResult = {
                success: true,
                results: ddgResults,
                query,
                elapsed: Date.now() - startTime,
              };
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                details: { source: "duckduckgo_lite", resultCount: ddgResults.length },
              };
            }
          } catch {
            // DDG also failed, return original error
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: error.message || "Search failed",
                  query,
                  elapsed,
                },
                null,
                2,
              ),
            },
          ],
          details: { error: error.message },
          isError: true,
        };
      }
    },
  });
}
