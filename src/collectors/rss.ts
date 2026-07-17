import { XMLParser } from "fast-xml-parser";
import type { CollectedSignal } from "../domain/types.js";
import type { FetchResult, SourceAdapter } from "./types.js";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export const rssAdapter: SourceAdapter = {
  kind: "rss",
  async collect(source, context) {
    let response: FetchResult;
    try {
      response = await context.fetchText(source.config.url);
    } catch (error) {
      if (source.homepageUrl === source.config.url) throw error;
      const homepage = await context.fetchText(source.homepageUrl);
      const discoveredFeed = discoverFeedUrl(homepage.body, source.homepageUrl);
      if (!discoveredFeed || discoveredFeed === source.config.url) throw error;
      response = await context.fetchText(discoveredFeed);
    }
    const { body, status } = response;
    if (status === 304) return [];
    const document = parser.parse(body) as Record<string, unknown>;
    const items = extractItems(document);
    return items
      .slice(0, source.config.take ?? 50)
      .flatMap((item) =>
        normalizeItem(item, source.language, source.config.category, response.finalUrl),
      );
  },
};

function extractItems(document: Record<string, unknown>): Record<string, unknown>[] {
  const rss = document.rss as { channel?: { item?: unknown } } | undefined;
  const feed = document.feed as { entry?: unknown } | undefined;
  const rdf = document["rdf:RDF"] as { item?: unknown } | undefined;
  const value = rss?.channel?.item ?? feed?.entry ?? rdf?.item ?? [];
  return (Array.isArray(value) ? value : [value]).filter(isRecord);
}

function normalizeItem(
  item: Record<string, unknown>,
  language: string,
  fallbackCategory?: string,
  baseUrl?: string,
): CollectedSignal[] {
  const title = textValue(item.title);
  const link = resolvePublicUrl(linkValue(item.link), baseUrl);
  if (!title || !link) return [];
  const summary = stripHtml(
    textValue(item.description) || textValue(item.summary) || textValue(item.content) || title,
  );
  const published =
    textValue(item.pubDate) ||
    textValue(item.published) ||
    textValue(item.updated) ||
    textValue(item["dc:date"]) ||
    textValue(item["prism:publicationDate"]) ||
    textValue(item["prism:coverDate"]);
  const date = normalizeDate(published);
  return [
    {
      externalId:
        textValue(item.guid) || textValue(item.id) || textValue(item["dc:identifier"]) || link,
      url: link,
      title: stripHtml(title),
      summary: summary.slice(0, 8_000),
      language,
      publishedAt: date.value,
      category: fallbackCategory ?? "industry",
      tags: [],
      metrics: { platforms: ["rss"] },
      rawMeta: { dateInferred: date.inferred },
    },
  ];
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value.map(textValue).find(Boolean) ?? "";
  }
  if (isRecord(value)) {
    const direct = textValue(value["#text"] ?? value.__cdata ?? "");
    if (direct) return direct;
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("@_")) continue;
      const nested = textValue(child);
      if (nested) return nested;
    }
  }
  return "";
}

function linkValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const alternate = value.find(
      (item) => isRecord(item) && (!item["@_rel"] || item["@_rel"] === "alternate"),
    );
    return linkValue(alternate ?? value[0]);
  }
  if (isRecord(value)) return textValue(value["@_href"] ?? value["#text"]);
  return "";
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value: string): { value: string; inferred: boolean } {
  const publisherDate = value.replace(/(\d)(am|pm)$/i, "$1 $2");
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT))$/i.test(
    publisherDate,
  );
  const date = new Date(
    !hasTimeZone &&
      /^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:am|pm)$/i.test(publisherDate)
      ? `${publisherDate} UTC`
      : publisherDate,
  );
  return Number.isNaN(date.getTime())
    ? { value: new Date().toISOString(), inferred: true }
    : { value: date.toISOString(), inferred: false };
}

function discoverFeedUrl(html: string, baseUrl: string): string | null {
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const value = tag[0];
    if (!/rel=["']alternate["']/i.test(value)) continue;
    if (!/type=["']application\/(?:rss|atom)\+xml["']/i.test(value)) continue;
    const href = value.match(/href=["']([^"']+)["']/i)?.[1];
    const resolved = resolvePublicUrl(href ?? "", baseUrl);
    if (resolved) return resolved;
  }
  return null;
}

function resolvePublicUrl(value: string, baseUrl?: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
