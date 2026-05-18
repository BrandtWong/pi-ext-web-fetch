---
name: ext-web-fetch
description: Fetch web pages and search the web. Use ext_web_fetch tool for reading specific URLs, ext_web_search tool for finding information across the web. Includes DuckDuckGo fallback when SearXNG engines are blocked.
---

# Web Fetch & Search

Tools provided by the `pi-ext-web-fetch` extension.

## Tools

### ext_web_fetch
Fetch and extract content from a specific URL.

```json
{
  "tool": "ext_web_fetch",
  "arguments": {
    "url": "https://example.com",
    "format": "markdown"
  }
}
```

**Parameters:**
- `url` (required): URL to fetch
- `format`: `markdown` (default) or `text`
- `maxContentSize`: Max content size in bytes (default 50000)

**Returns:**
- `content`: Extracted text/markdown
- `source`: How content was obtained (`readability`, `w3m`, `curl`)
- `status`: HTTP status code
- `success`: true/false

### ext_web_search
Search the web using SearXNG (with DuckDuckGo Lite fallback).

```json
{
  "tool": "ext_web_search",
  "arguments": {
    "query": "pi coding agent",
    "maxResults": 10
  }
}
```

**Parameters:**
- `query` (required): Search keywords
- `categories`: `general`, `news`, `videos`, `music`, `files`, `it`, `science`, `social-media`
- `language`: Language code (default: `auto`)
- `engines`: Specific engines to use (`google`, `duckduckgo`, `bing`, etc.)
- `maxResults`: Max results (default 10, max 50)

**Returns:**
- `results`: Array of `{ title, url, snippet, engine }`
- `source`: `searxng` or `duckduckgo_lite`
- `success`: true/false

## When to Use Each Tool

| Scenario | Tool | Reason |
|----------|------|--------|
| User gives a specific URL | `ext_web_fetch` | Direct page content extraction |
| "Find information about X" | `ext_web_search` | Need to discover relevant pages first |
| "What's the latest news on X" | `ext_web_search` with categories=["news"] | News-specific search |
| Read a page found via search | `ext_web_fetch` on search result URL | Deep reading of a specific page |
| Current events / real-time info | `ext_web_search` | Up-to-date web results |
| Technical documentation | `ext_web_fetch` on specific doc URL | Precise extraction |

## Search Fallback Chain

```
ext_web_search
    ↓
① SearXNG (localhost:8080)
   - Aggregates Google, DuckDuckGo, Brave, Wikipedia, etc.
    ↓ If no results + all engines blocked (CAPTCHA)
② DuckDuckGo Lite (w3m via proxy)
   - Text-only search, bypasses CAPTCHA
    ↓ If w3m fails
③ DuckDuckGo Lite (curl fallback)
```

## Configuration

Tools auto-detect proxy settings from environment variables:
- `HTTP_PROXY` / `http_proxy`
- `HTTPS_PROXY` / `https_proxy`
- `SEARXNG_URL` (default: `http://localhost:8080`)
- `NO_PROXY` / `no_proxy`

## Security

- Internal IPs (192.168.x, 10.x, 127.x, 169.254.x) are blocked
- Only `http://` and `https://` protocols allowed
- DNS rebinding prevention via `curl --resolve`

## Helper Scripts

For complex web scraping tasks not covered by the tools:

```bash
# Fetch via w3m (raw HTML fallback)
node scripts/web-fetch.js <url> <proxy>

# Search via DDG Lite directly
node scripts/ddg-search.js "<query>" <proxy> <maxResults>
