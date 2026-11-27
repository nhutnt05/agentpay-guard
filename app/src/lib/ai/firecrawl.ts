import "server-only";
import Firecrawl from "@mendable/firecrawl-js";

// Firecrawl scraping (docs/08 §2.1). Markdown only, bounded time. Firecrawl fetches from
// its own servers, so it cannot reach localhost — the demo page must be publicly deployed,
// or the demo uses the bundled fixture (labeled as such).

export class ScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScrapeError";
  }
}

export type Scraper = (url: string) => Promise<string>;

const SCRAPE_TIMEOUT_MS = 20_000;

let client: Firecrawl | undefined;

/** Production scraper. Throws ScrapeError (never leaks the API key or raw SDK errors). */
export const firecrawlScrape: Scraper = async (url) => {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new ScrapeError("FIRECRAWL_API_KEY is not configured");
  client ??= new Firecrawl({ apiKey });
  let markdown: string | undefined;
  try {
    const doc = await client.scrape(url, { formats: ["markdown"], timeout: SCRAPE_TIMEOUT_MS });
    markdown = doc.markdown;
  } catch {
    throw new ScrapeError("Firecrawl could not scrape the URL");
  }
  if (!markdown) throw new ScrapeError("Firecrawl returned no markdown for the URL");
  return markdown;
};
