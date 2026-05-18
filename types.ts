export type FetchErrorType =
  | "invalid_url"
  | "ssrf_blocked"
  | "content_too_large"
  | "dns_failure"
  | "connection_refused"
  | "proxy_error"
  | "timeout"
  | "http_error"
  | "parse_failure"
  | "w3m_not_installed"
  | "unknown";

export interface FetchWebResult {
  success: boolean;
  status?: number;
  contentType?: string;
  content: string;
  source: "curl" | "w3m" | "readability" | "raw" | "error";
  url: string;
  elapsed: number;
  truncated?: boolean;
}

export interface FetchWebError {
  success: false;
  errorType: FetchErrorType;
  content: string;
  source: "error";
  url: string;
  elapsed: number;
  status?: number;
}

export interface SearchWebResult {
  success: boolean;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    engine: string;
  }>;
  query: string;
  elapsed: number;
}

export interface AppConfig {
  httpProxy: string;
  httpsProxy: string;
  searxngUrl: string;
  noProxy: string;
}
