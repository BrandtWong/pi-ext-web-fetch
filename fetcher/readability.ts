import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
});

// Preserve <a> links and <img> alt text during conversion
turndown.addRule("link", {
  filter: "a",
  replacement: (content, node: any) => {
    const href = node.getAttribute("href");
    const title = node.getAttribute("title");
    const titlePart = title ? ` "${title}"` : "";
    const linkText = content.trim() || href;
    return href ? `[${linkText}](${href}${titlePart})` : content;
  },
});

export interface ReadabilityResult {
  title: string;
  textContent: string;
  markdownContent: string;
  byline?: string;
  length: number;
}

export function extractWithReadability(html: string): ReadabilityResult | null {
  const dom = new JSDOM(html, {
    // Do NOT set runScripts (default = no script execution)
    // Do NOT set resources (default = no external resource loading)
  });

  try {
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return null;
    }

    // Content length check
    const textLength = article.textContent?.trim().length || 0;
    if (textLength < 100) {
      return null; // Too short, likely not article content
    }

    let markdownContent = "";
    try {
      markdownContent = turndown.turndown(article.content || "");
    } catch {
      // If markdown conversion fails, fall back to text
      markdownContent = article.textContent || "";
    }

    return {
      title: article.title || "",
      textContent: article.textContent?.trim() || "",
      markdownContent,
      byline: article.byline || undefined,
      length: textLength,
    };
  } finally {
    // Always release resources
    dom.window.close();
  }
}
