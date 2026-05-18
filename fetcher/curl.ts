import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { promisify } from "node:util";
import type { AppConfig } from "../types.js";

const execFileAsync = promisify(execFile);

const INTERNAL_IP_PREFIXES = [
  // IPv4
  "10.",
  "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.",
  "172.28.", "172.29.", "172.30.", "172.31.",
  "192.168.",
  "127.",
  "169.254.",
  "0.",
  // IPv6
  "::1",
  "::",
  "fe80:",
  "fc00:",
  "fd00:",
  "[::1]",
];

const DEFAULT_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

export interface CurlResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  contentType: string;
  contentLength: number | null;
}

export function isInternalIP(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, ''); // Strip brackets from IPv6
  // Check for localhost variants
  if (normalized === "localhost" || normalized === "::1" || normalized === "0.0.0.0" || normalized === "[::1]") {
    return true;
  }
  return INTERNAL_IP_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export async function resolveAndValidateHost(
  url: string,
): Promise<{ hostname: string; ip: string; port: number }> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`invalid_url: Protocol ${parsed.protocol} not allowed`);
  }

  const hostname = parsed.hostname;
  const port = parsed.protocol === "https:" ? 443 : 80;

  // Check if hostname is already an IP
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isInternalIP(hostname)) {
      throw new Error(`ssrf_blocked: Internal IP ${hostname} not allowed`);
    }
    return { hostname, ip: hostname, port };
  }

  const { address: ip } = await lookup(hostname);
  if (isInternalIP(ip)) {
    throw new Error(`ssrf_blocked: Resolved IP ${ip} for ${hostname} is internal`);
  }

  return { hostname, ip, port };
}

export async function curlFetch(
  url: string,
  config: AppConfig,
  timeout: number,
): Promise<CurlResponse> {
  const { hostname, ip, port } = await resolveAndValidateHost(url);
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";

  const args = [
    "--silent",
    "--show-error",
    "--location",
    "--max-time", String(Math.ceil(timeout / 1000)),
    "--connect-timeout", "10",
    "--user-agent", DEFAULT_UA,
    "--resolve", `${hostname}:${port}:${ip}`,
    "--header", `Host: ${hostname}`,
  ];

  if (config.httpProxy) {
    args.push("--proxy", config.httpProxy);
  }

  if (config.noProxy) {
    args.push("--noproxy", config.noProxy);
  }

  // Write headers to a temp file so we can parse them separately
  const headerFile = `/tmp/pi-ext-web-fetch-headers-${Date.now()}.txt`;
  args.push("--dump-header", headerFile);

  args.push(url);

  try {
    const { stdout, stderr } = await execFileAsync("curl", args, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      encoding: "utf-8",
    });

    // Read headers from file
    let headersText = "";
    try {
      const { readFileSync } = await import("node:fs");
      headersText = readFileSync(headerFile, "utf-8");
    } catch {
      // Header file read failed, try to parse from stderr
    }

    // Clean up temp file
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(headerFile);
    } catch {}

    // Parse status line (use the LAST HTTP status line, as proxy CONNECT comes first)
    const allLines = headersText.split(/\r?\n/);
    let status = 0;
    for (const line of allLines) {
      const match = line.match(/^HTTP\/[\d.]+ (\d+)/);
      if (match) {
        status = parseInt(match[1], 10);
      }
    }

    // Parse headers
    const headers: Record<string, string> = {};
    const headerLines = headersText.split(/\r?\n/).slice(1); // skip status line
    for (const line of headerLines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim().toLowerCase();
        const value = line.slice(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    const contentType = headers["content-type"] || "";
    const contentLengthStr = headers["content-length"];
    const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : null;

    return { status, headers, body: stdout, contentType, contentLength };
  } catch (error: any) {
    // Handle curl errors
    const stderr = error.stderr || "";
    const stdout = error.stdout || "";
    const exitCode = error.code;

    // Try to parse status from partial output
    let status = 0;
    let body = stdout;

    const headerEndIndex = body.indexOf("\r\n\r\n");
    if (headerEndIndex >= 0) {
      const headersText = body.slice(0, headerEndIndex);
      body = body.slice(headerEndIndex + 4);

      const statusLine = headersText.split("\r\n")[0];
      const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
      if (statusMatch) {
        status = parseInt(statusMatch[1], 10);
      }
    }

    // Map curl errors to error types
    const errMsg = stderr.toLowerCase() + (error.message || "").toLowerCase();

    if (errMsg.includes("timed out") || exitCode === "ETIMEDOUT" || exitCode === "ECONNABORTED") {
      throw Object.assign(new Error("timeout"), { errorType: "timeout" as const });
    }
    if (errMsg.includes("could not resolve host") || errMsg.includes("name resolution")) {
      throw Object.assign(new Error("dns_failure"), { errorType: "dns_failure" as const });
    }
    if (errMsg.includes("connection refused") || errMsg.includes("econnrefused")) {
      throw Object.assign(new Error("connection_refused"), { errorType: "connection_refused" as const });
    }
    if (errMsg.includes("proxy") || errMsg.includes("connect") || errMsg.includes("econnreset")) {
      throw Object.assign(new Error("proxy_error"), { errorType: "proxy_error" as const });
    }
    if (errMsg.includes("ssl") || errMsg.includes("certificate")) {
      throw Object.assign(new Error("ssl_error"), { errorType: "http_error" as const, status });
    }
    if (errMsg.includes("no route to host") || errMsg.includes("network is unreachable")) {
      throw Object.assign(new Error("connection_refused"), { errorType: "connection_refused" as const });
    }

    // HTTP error (4xx/5xx)
    if (status >= 400) {
      throw Object.assign(new Error(`HTTP ${status}`), {
        errorType: "http_error" as const,
        status,
        body,
      });
    }

    throw Object.assign(new Error(error.message || "unknown"), {
      errorType: "unknown" as const,
    });
  }
}
