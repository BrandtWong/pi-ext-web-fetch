import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AppConfig, FetchWebResult, FetchWebError, FetchErrorType } from "../types.js";
import { curlFetch, isInternalIP } from "../fetcher/curl.js";
import { w3mFetch, checkW3mAvailable } from "../fetcher/w3m.js";
import { extractWithReadability } from "../fetcher/readability.js";

// Concurrency control: max 3 parallel Readability operations
let readabilityActive = 0;
const readabilityQueue: Array<() => void> = [];

async function acquireReadabilitySlot(): Promise<void> {
  if (readabilityActive < 3) {
    readabilityActive++;
    return;
  }
  return new Promise<void>((resolve) => {
    readabilityQueue.push(resolve);
  });
}

function releaseReadabilitySlot(): void {
  readabilityActive--;
  if (readabilityQueue.length > 0) {
    const next = readabilityQueue.shift();
    if (next) {
      readabilityActive++;
      next();
    }
  }
}

function makeError(
  url: string,
  elapsed: number,
  errorType: FetchErrorType,
  message: string,
  status?: number,
): FetchWebError {
  return {
    success: false,
    errorType,
    content: message,
    source: "error",
    url,
    elapsed,
    status,
  };
}

export function registerFetchWebTool(pi: ExtensionAPI, config: AppConfig): void {
  pi.registerTool({
    name: "ext_web_fetch",
    label: "Fetch Web Content",
    description:
      "Fetch and extract content from a web URL. Uses curl with Readability extraction for HTML, falls back to w3m for difficult pages. Returns clean text or markdown.",
    promptSnippet:
      "Fetch the content of a web page using ext_web_fetch, with automatic format detection and extraction.",
    promptGuidelines: [
      "Use ext_web_fetch to retrieve article content, documentation, or web page text.",
      "The tool automatically extracts readable text from HTML pages using Readability.",
      "Use format='raw' to get unprocessed HTML or API JSON responses.",
      "Use format='markdown' to preserve links, headings, and list structure.",
      "If the URL is blocked or times out, try format='raw' or suggest searching via ext_web_search.",
      "Do not use for local files — only http:// and https:// URLs are supported.",
    ],
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch (http:// or https:// only)",
        },
        format: {
          type: "string",
          enum: ["text", "markdown", "raw"],
          description:
            "Output format: 'text' for clean extracted text (default), 'markdown' for structured content with links, 'raw' for unprocessed output",
        },
        maxContentSize: {
          type: "number",
          description: "Maximum download size in bytes (default 5242880 = 5MB)",
        },
        timeout: {
          type: "number",
          description: "Request timeout in milliseconds (default 15000)",
        },
      },
      required: ["url"],
      additionalProperties: false,
    } as any,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const startTime = Date.now();
      const url = (params as any).url as string;
      const format = ((params as any).format as string) || "text";
      const maxContentSize = ((params as any).maxContentSize as number) || 5 * 1024 * 1024;
      const timeout = ((params as any).timeout as number) || 15000;

      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                makeError(url, Date.now() - startTime, "invalid_url", `Invalid URL: ${url}`),
                null,
                2,
              ),
            },
          ],
          details: { errorType: "invalid_url" },
          isError: true,
        };
      }

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                makeError(
                  url,
                  Date.now() - startTime,
                  "invalid_url",
                  `Protocol ${parsedUrl.protocol} not allowed. Use http:// or https:// only.`,
                ),
                null,
                2,
              ),
            },
          ],
          details: { errorType: "invalid_url" },
          isError: true,
        };
      }

      const hostname = parsedUrl.hostname.toLowerCase();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && isInternalIP(hostname)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                makeError(
                  url,
                  Date.now() - startTime,
                  "ssrf_blocked",
                  `SSRF blocked: Internal IP ${hostname} not allowed`,
                ),
                null,
                2,
              ),
            },
          ],
          details: { errorType: "ssrf_blocked" },
          isError: true,
        };
      }

      // Try curl first
      let curlResult;
      try {
        curlResult = await curlFetch(url, config, timeout);
      } catch (curlError: any) {
        const errorType = curlError.errorType || "unknown";
        const elapsed = Date.now() - startTime;

        // For 4xx/5xx errors, try w3m as fallback
        if (errorType === "http_error" && curlError.body) {
          // If content type is HTML, try Readability on the curl response body
          const ct = curlError.body.includes("<html") || curlError.body.includes("<!DOCTYPE");
          if (ct) {
            try {
              await acquireReadabilitySlot();
              const article = extractWithReadability(curlError.body);
              if (article) {
                releaseReadabilitySlot();
                const result: FetchWebResult = {
                  success: true,
                  status: curlError.status,
                  contentType: "text/html",
                  content: format === "markdown" ? article.markdownContent : article.textContent,
                  source: "readability",
                  url,
                  elapsed: Date.now() - startTime,
                  truncated: article.length > maxContentSize,
                };
                return {
                  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                  details: { source: "readability", status: result.status },
                };
              }
              releaseReadabilitySlot();
            } catch {
              releaseReadabilitySlot();
            }
          }
        }

        // Try w3m fallback for curl failures
        const w3mAvailable = await checkW3mAvailable();
        if (w3mAvailable) {
          try {
            const w3mText = await w3mFetch(url, config.httpProxy, timeout);
            if (w3mText && w3mText.length >= 50) {
              const result: FetchWebResult = {
                success: true,
                contentType: "text/plain",
                content: w3mText,
                source: "w3m",
                url,
                elapsed: Date.now() - startTime,
              };
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                details: { source: "w3m" },
              };
            }
          } catch {
            // w3m also failed, return original curl error
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                makeError(url, elapsed, errorType, curlError.message || "Request failed", curlError.status),
                null,
                2,
              ),
            },
          ],
          details: { errorType, status: curlError.status },
          isError: true,
        };
      }

      // Curl succeeded
      const { status, contentType, body } = curlResult;
      const elapsed = Date.now() - startTime;

      // Handle HTTP 4xx/5xx errors
      if (status >= 400) {
        // Try w3m as fallback for HTML error pages
        if (contentType.includes("text/html")) {
          const w3mAvailable = await checkW3mAvailable();
          if (w3mAvailable) {
            try {
              const w3mText = await w3mFetch(url, config.httpProxy, timeout);
              if (w3mText && w3mText.length >= 50) {
                const result: FetchWebResult = {
                  success: true,
                  status,
                  contentType,
                  content: w3mText,
                  source: "w3m",
                  url,
                  elapsed: Date.now() - startTime,
                };
                return {
                  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                  details: { source: "w3m", status },
                };
              }
            } catch {
              // w3m also failed
            }
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                makeError(url, elapsed, "http_error", `HTTP ${status} - Server returned error`, status),
                null, 2,
              ),
            },
          ],
          details: { errorType: "http_error", status },
          isError: true,
        };
      }

      // Check content size
      if (body.length > maxContentSize) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                makeError(
                  url,
                  elapsed,
                  "content_too_large",
                  `Response size ${body.length} bytes exceeds limit ${maxContentSize} bytes. Try a smaller page or increase maxContentSize.`,
                ),
                null,
                2,
              ),
            },
          ],
          details: { errorType: "content_too_large", status },
          isError: true,
        };
      }

      // Raw format: return unprocessed content
      if (format === "raw") {
        const result: FetchWebResult = {
          success: true,
          status,
          contentType,
          content: body,
          source: "raw",
          url,
          elapsed,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { source: "raw", status },
        };
      }

      // For non-HTML content types (JSON, XML, plain text), return raw
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        const result: FetchWebResult = {
          success: true,
          status,
          contentType,
          content: body,
          source: "raw",
          url,
          elapsed,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { source: "raw", status },
        };
      }

      // HTML content: try Readability extraction
      try {
        await acquireReadabilitySlot();
        const article = extractWithReadability(body);
        releaseReadabilitySlot();

        if (article) {
          const result: FetchWebResult = {
            success: true,
            status,
            contentType,
            content: format === "markdown" ? article.markdownContent : article.textContent,
            source: "readability",
            url,
            elapsed,
          };
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            details: { source: "readability", status, title: article.title },
          };
        }
      } catch {
        releaseReadabilitySlot();
      }

      // Readability failed or content too short: try w3m
      const w3mAvailable = await checkW3mAvailable();
      if (w3mAvailable) {
        try {
          const w3mText = await w3mFetch(url, config.httpProxy, timeout);
          if (w3mText && w3mText.length >= 50) {
            const result: FetchWebResult = {
              success: true,
              status,
              contentType,
              content: w3mText,
              source: "w3m",
              url,
              elapsed: Date.now() - startTime,
            };
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { source: "w3m", status },
            };
          }
        } catch {
          // w3m also failed
        }
      }

      // All methods failed
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              makeError(
                url,
                Date.now() - startTime,
                "parse_failure",
                "Failed to extract content: Readability returned null and w3m fallback also failed",
              ),
              null,
              2,
            ),
          },
        ],
        details: { errorType: "parse_failure", status },
        isError: true,
      };
    },
  });
}
