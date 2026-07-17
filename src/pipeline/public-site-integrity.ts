import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface IntegrityIssue {
  code: string;
  path: string;
  message: string;
}

export interface PublicSiteIntegrityReport {
  ok: boolean;
  checkedAt: string;
  generatedAt: string | null;
  counts: {
    events: number;
    signals: number;
    scout: number;
    actors: number;
    sources: number;
    sitemapUrls: number;
    timelineCards: number;
  };
  issues: IntegrityIssue[];
}

const MAIN_ROUTES = [
  "",
  "lines/",
  "industry-evolution/",
  "timeline/",
  "signals/",
  "scout/",
  "actors/",
  "resources/",
  "product/",
  "changelog/",
  "sources/",
  "legal/",
] as const;

const STRATEGIC_TRACKS = [
  "tech-evolution",
  "agi-progress",
  "commercialization",
  "investing",
  "global-innovation",
  "model-economics",
] as const;

const INDUSTRY_ROUTES = [
  "",
  "lines/",
  "timeline/",
  "signals/",
  "scout/",
  "product/",
  "changelog/",
  "sources/",
  "legal/",
] as const;

export async function validatePublicSite(
  distDir: string,
  checkedAt = new Date().toISOString(),
): Promise<PublicSiteIntegrityReport> {
  const industryReport = await readFile(join(distDir, "data/industry-pilot.json"), "utf8").catch(
    () => null,
  );
  if (industryReport !== null) {
    return validateIndustryPublicSite(distDir, industryReport, checkedAt);
  }
  const issues: IntegrityIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const read = async (path: string) => {
    try {
      return await readFile(join(distDir, path), "utf8");
    } catch (error) {
      add("missing_file", path, error instanceof Error ? error.message : "File is missing");
      return "";
    }
  };
  const parse = <T>(path: string, text: string, fallback: T): T => {
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      add("invalid_json", path, error instanceof Error ? error.message : "Invalid JSON");
      return fallback;
    }
  };

  const dataPaths = {
    timeline: "data/timeline.json",
    signals: "data/signals.json",
    scout: "data/scout.json",
    product: "data/product.json",
    narratives: "data/narratives.json",
    actors: "data/actors.json",
    sources: "data/sources.json",
  } as const;
  const dataText = Object.fromEntries(
    await Promise.all(
      Object.entries(dataPaths).map(async ([key, path]) => [key, await read(path)] as const),
    ),
  ) as Record<keyof typeof dataPaths, string>;
  const timeline = parse<{
    generatedAt?: string;
    siteUrl?: string;
    events?: Array<{ slug?: string }>;
  }>(dataPaths.timeline, dataText.timeline, {});
  const signals = parse<{ generatedAt?: string; signals?: unknown[] }>(
    dataPaths.signals,
    dataText.signals,
    {},
  );
  const scout = parse<{ generatedAt?: string; insights?: unknown[] }>(
    dataPaths.scout,
    dataText.scout,
    {},
  );
  const product = parse<{ generatedAt?: string }>(dataPaths.product, dataText.product, {});
  const narratives = parse<{ generatedAt?: string }>(dataPaths.narratives, dataText.narratives, {});
  const actors = parse<unknown[]>(dataPaths.actors, dataText.actors, []);
  const sources = parse<unknown[]>(dataPaths.sources, dataText.sources, []);
  const events = Array.isArray(timeline.events) ? timeline.events : [];
  const publicSignals = Array.isArray(signals.signals) ? signals.signals : [];
  const publicScout = Array.isArray(scout.insights) ? scout.insights : [];
  const generatedAt = typeof timeline.generatedAt === "string" ? timeline.generatedAt : null;
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) {
    add("invalid_generated_at", dataPaths.timeline, "Timeline generatedAt is missing or invalid");
  }
  for (const [name, value] of Object.entries({
    signals: signals.generatedAt,
    scout: scout.generatedAt,
    product: product.generatedAt,
    narratives: narratives.generatedAt,
  })) {
    if (value !== generatedAt) {
      add(
        "generation_mismatch",
        `data/${name}.json`,
        `Expected generatedAt ${generatedAt ?? "missing"}, received ${value ?? "missing"}`,
      );
    }
  }

  const sensitivePattern =
    /"(?:token|secret|password|cookie|authorization|api[_-]?key)"\s*:|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\/Users\/[^/]+\/|\/home\/runner\//i;
  for (const [name, text] of Object.entries(dataText)) {
    if (sensitivePattern.test(text)) {
      add("private_material", `data/${name}.json`, "Public JSON contains a private field or path");
    }
  }

  const pageHtml = new Map<string, string>();
  for (const localePrefix of ["", "en/"] as const) {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const route of MAIN_ROUTES) {
      const path = `${localePrefix}${route}${route ? "index.html" : "index.html"}`;
      const html = await read(path);
      pageHtml.set(path, html);
      validatePageHead(path, html, add);
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
      const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
      if (title) {
        if (titles.has(title)) add("duplicate_title", path, `Duplicate main-page title: ${title}`);
        titles.add(title);
      }
      if (description) {
        if (descriptions.has(description)) {
          add("duplicate_description", path, "Duplicate main-page meta description");
        }
        descriptions.add(description);
      }
    }
  }

  const timelineZh = pageHtml.get("timeline/index.html") ?? "";
  const timelineCards = [
    ...timelineZh.matchAll(/<a class="timeline-card[^>]*href="([^"]+)"[^>]*data-event="([^"]+)"/g),
  ];
  if (!timelineCards.length)
    add("empty_timeline", "timeline/index.html", "No timeline cards found");
  for (const card of timelineCards) {
    if (!card[1]?.endsWith(`/events/${card[2]}/`)) {
      add(
        "event_link_mismatch",
        "timeline/index.html",
        `Timeline card ${card[2]} has no stable URL`,
      );
    }
  }
  assertCount(
    "signals/index.html",
    pageHtml.get("signals/index.html") ?? "",
    /class="signal-observation-card/g,
    Math.min(48, publicSignals.length),
    add,
  );
  assertCount(
    "scout/index.html",
    pageHtml.get("scout/index.html") ?? "",
    /class="scout-card"/g,
    publicScout.length,
    add,
  );
  assertCount(
    "actors/index.html",
    pageHtml.get("actors/index.html") ?? "",
    /class="actor-card"/g,
    actors.length,
    add,
  );
  assertCount(
    "sources/index.html",
    pageHtml.get("sources/index.html") ?? "",
    /data-source-value=/g,
    sources.length,
    add,
  );
  for (const path of ["index.html", "lines/index.html", "resources/index.html"] as const) {
    if (!(pageHtml.get(path) ?? "").includes("<article")) {
      add("empty_main_tab", path, "Main page has no rendered content cards");
    }
  }

  const siteUrl = ensureSlash(typeof timeline.siteUrl === "string" ? timeline.siteUrl : "");
  if (!/^https:\/\//.test(siteUrl)) {
    add("invalid_site_url", dataPaths.timeline, "siteUrl must use HTTPS");
  } else {
    const llmsText = await read("llms.txt");
    validateLlmsTxt(llmsText, siteUrl, add);
  }
  const sitemapText = await read("sitemap.xml");
  const sitemapUrls = new Set(
    [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeXml(match[1] ?? "")),
  );
  const expectedRoutes = [
    ...MAIN_ROUTES,
    ...STRATEGIC_TRACKS.map((track) => `lines/${track}/`),
    ...events.map((event) => `events/${String(event.slug ?? "")}/`),
  ];
  for (const route of expectedRoutes) {
    for (const localePrefix of ["", "en/"] as const) {
      const url = new URL(`${localePrefix}${route}`, siteUrl).toString();
      if (!sitemapUrls.has(url)) add("sitemap_missing_url", "sitemap.xml", url);
      const path = `${localePrefix}${route}${route ? "index.html" : "index.html"}`;
      const html = await read(path);
      if (!html) continue;
      if (html.includes("<<<<<<<") || html.includes("__PREFIX__") || html.includes("/Users/")) {
        add(
          "unsafe_page_output",
          path,
          "Page contains a conflict marker, template token, or local path",
        );
      }
      validateJsonLd(path, html, add);
    }
  }
  if (sitemapUrls.has(new URL("404.html", siteUrl).toString())) {
    add("sitemap_404", "sitemap.xml", "404 must not be indexed");
  }

  return {
    ok: issues.length === 0,
    checkedAt,
    generatedAt,
    counts: {
      events: events.length,
      signals: publicSignals.length,
      scout: publicScout.length,
      actors: actors.length,
      sources: sources.length,
      sitemapUrls: sitemapUrls.size,
      timelineCards: timelineCards.length,
    },
    issues,
  };
}

async function validateIndustryPublicSite(
  distDir: string,
  industryText: string,
  checkedAt: string,
): Promise<PublicSiteIntegrityReport> {
  const issues: IntegrityIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const read = async (path: string) => {
    try {
      return await readFile(join(distDir, path), "utf8");
    } catch (error) {
      add("missing_file", path, error instanceof Error ? error.message : "File is missing");
      return "";
    }
  };
  const parse = <T>(path: string, text: string, fallback: T): T => {
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      add("invalid_json", path, error instanceof Error ? error.message : "Invalid JSON");
      return fallback;
    }
  };
  const dataPaths = {
    timeline: "data/timeline.json",
    signals: "data/signals.json",
    scout: "data/scout.json",
    sources: "data/sources.json",
    tracks: "data/tracks.json",
    industry: "data/industry-pilot.json",
  } as const;
  const dataText = {
    timeline: await read(dataPaths.timeline),
    signals: await read(dataPaths.signals),
    scout: await read(dataPaths.scout),
    sources: await read(dataPaths.sources),
    tracks: await read(dataPaths.tracks),
    industry: industryText,
  };
  const timeline = parse<{
    generatedAt?: string;
    siteUrl?: string;
    events?: Array<{ slug?: string }>;
  }>(dataPaths.timeline, dataText.timeline, {});
  const signals = parse<{ generatedAt?: string; signals?: unknown[] }>(
    dataPaths.signals,
    dataText.signals,
    {},
  );
  const scout = parse<{ generatedAt?: string; insights?: unknown[] }>(
    dataPaths.scout,
    dataText.scout,
    {},
  );
  const sources = parse<unknown[]>(dataPaths.sources, dataText.sources, []);
  const tracks = parse<Array<{ slug?: string }>>(dataPaths.tracks, dataText.tracks, []);
  const industry = parse<{
    profileSlug?: string;
    generatedAt?: string;
    sources?: { configured?: number };
    intelligence?: { signals?: number; publishedEvents?: number };
  }>(dataPaths.industry, dataText.industry, {});
  const events = Array.isArray(timeline.events) ? timeline.events : [];
  const publicSignals = Array.isArray(signals.signals) ? signals.signals : [];
  const publicScout = Array.isArray(scout.insights) ? scout.insights : [];
  const generatedAt = typeof timeline.generatedAt === "string" ? timeline.generatedAt : null;
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) {
    add("invalid_generated_at", dataPaths.timeline, "Timeline generatedAt is missing or invalid");
  }
  for (const [path, value] of [
    [dataPaths.signals, signals.generatedAt],
    [dataPaths.scout, scout.generatedAt],
    [dataPaths.industry, industry.generatedAt],
  ] as const) {
    if (value !== generatedAt) {
      add(
        "generation_mismatch",
        path,
        `Expected generatedAt ${generatedAt ?? "missing"}, received ${value ?? "missing"}`,
      );
    }
  }
  if (!industry.profileSlug) {
    add("invalid_industry_report", dataPaths.industry, "profileSlug is required");
  }
  if (
    typeof industry.sources?.configured !== "number" ||
    industry.sources.configured < 20 ||
    industry.sources.configured > 30
  ) {
    add("invalid_industry_report", dataPaths.industry, "Expected 20-30 configured sources");
  }
  if (industry.intelligence?.signals !== publicSignals.length) {
    add(
      "industry_count_mismatch",
      dataPaths.industry,
      `Expected ${publicSignals.length} signals, received ${industry.intelligence?.signals ?? "missing"}`,
    );
  }
  if (industry.intelligence?.publishedEvents !== events.length) {
    add(
      "industry_count_mismatch",
      dataPaths.industry,
      `Expected ${events.length} published Events, received ${industry.intelligence?.publishedEvents ?? "missing"}`,
    );
  }

  const sensitivePattern =
    /"(?:token|secret|password|cookie|authorization|api[_-]?key)"\s*:|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\/Users\/[^/]+\/|\/home\/runner\//i;
  for (const [name, text] of Object.entries(dataText)) {
    if (sensitivePattern.test(text)) {
      add("private_material", `data/${name}.json`, "Public JSON contains a private field or path");
    }
  }

  const pageHtml = new Map<string, string>();
  for (const localePrefix of ["", "en/"] as const) {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const route of INDUSTRY_ROUTES) {
      const path = `${localePrefix}${route}index.html`;
      const html = await read(path);
      pageHtml.set(path, html);
      validatePageHead(path, html, add);
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
      const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
      if (title) {
        if (titles.has(title)) add("duplicate_title", path, `Duplicate main-page title: ${title}`);
        titles.add(title);
      }
      if (description) {
        if (descriptions.has(description)) {
          add("duplicate_description", path, "Duplicate main-page meta description");
        }
        descriptions.add(description);
      }
    }
  }
  if (!(pageHtml.get("index.html") ?? "").includes("industry-pilot-hero")) {
    add("missing_industry_home", "index.html", "Industry pilot scorecard is missing");
  }
  assertCount(
    "signals/index.html",
    pageHtml.get("signals/index.html") ?? "",
    /class="signal-observation-card/g,
    Math.min(48, publicSignals.length),
    add,
  );
  assertCount(
    "scout/index.html",
    pageHtml.get("scout/index.html") ?? "",
    /class="scout-card"/g,
    publicScout.length,
    add,
  );
  assertCount(
    "sources/index.html",
    pageHtml.get("sources/index.html") ?? "",
    /data-source-value=/g,
    sources.length,
    add,
  );

  const siteUrl = ensureSlash(typeof timeline.siteUrl === "string" ? timeline.siteUrl : "");
  if (!/^https:\/\//.test(siteUrl)) {
    add("invalid_site_url", dataPaths.timeline, "siteUrl must use HTTPS");
  } else {
    validateIndustryLlmsTxt(await read("llms.txt"), siteUrl, add);
  }
  const sitemapText = await read("sitemap.xml");
  const sitemapUrls = new Set(
    [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeXml(match[1] ?? "")),
  );
  const bilingualRoutes = [
    ...INDUSTRY_ROUTES,
    ...events.map((event) => `events/${String(event.slug ?? "")}/`),
  ];
  for (const route of bilingualRoutes) {
    for (const localePrefix of ["", "en/"] as const) {
      await validateIndexedRoute(distDir, route, localePrefix, siteUrl, sitemapUrls, add);
    }
  }
  for (const track of tracks) {
    if (!track.slug) continue;
    await validateIndexedRoute(distDir, `lines/${track.slug}/`, "", siteUrl, sitemapUrls, add);
  }
  if (sitemapUrls.has(new URL("404.html", siteUrl).toString())) {
    add("sitemap_404", "sitemap.xml", "404 must not be indexed");
  }

  const timelineCards = [
    ...(pageHtml.get("timeline/index.html") ?? "").matchAll(
      /<a class="timeline-card[^>]*href="([^"]+)"[^>]*data-event="([^"]+)"/g,
    ),
  ];
  return {
    ok: issues.length === 0,
    checkedAt,
    generatedAt,
    counts: {
      events: events.length,
      signals: publicSignals.length,
      scout: publicScout.length,
      actors: 0,
      sources: sources.length,
      sitemapUrls: sitemapUrls.size,
      timelineCards: timelineCards.length,
    },
    issues,
  };
}

export async function writePublicSiteIntegrityReport(
  path: string,
  report: PublicSiteIntegrityReport,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function validatePageHead(
  path: string,
  html: string,
  add: (code: string, path: string, message: string) => void,
): void {
  const requirements: Array<[string, RegExp]> = [
    ["title", /<title>[^<]+<\/title>/g],
    ["description", /<meta name="description" content="[^"]+">/g],
    ["canonical", /<link rel="canonical" href="[^"]+">/g],
    ["zh-CN hreflang", /hreflang="zh-CN"/g],
    ["en hreflang", /hreflang="en"/g],
    ["x-default hreflang", /hreflang="x-default"/g],
    ["llms.txt discovery link", /<link rel="alternate" type="text\/plain" href="[^"]*llms\.txt"/g],
  ];
  for (const [label, pattern] of requirements) {
    const count = html.match(pattern)?.length ?? 0;
    if (count !== 1) add("invalid_page_head", path, `Expected one ${label}, found ${count}`);
  }
}

function validateLlmsTxt(
  text: string,
  siteUrl: string,
  add: (code: string, path: string, message: string) => void,
): void {
  const path = "llms.txt";
  if (!text.startsWith("# Agent Pulse\n\n> ")) {
    add("invalid_llms_txt", path, "Expected an H1 followed by a blockquote summary");
  }
  if ((text.match(/^# /gm) ?? []).length !== 1) {
    add("invalid_llms_txt", path, "Expected exactly one H1 heading");
  }
  for (const section of [
    "## Start Here",
    "## Core Machine-Readable Data",
    "## Provenance and Governance",
    "## Optional",
  ]) {
    if (!text.includes(section)) add("invalid_llms_txt", path, `Missing ${section}`);
  }
  for (const boundary of [
    "published Events",
    "not as verified facts",
    "analysis or hypotheses",
    "original evidence URLs",
  ]) {
    if (!text.includes(boundary)) add("invalid_llms_txt", path, `Missing boundary: ${boundary}`);
  }
  for (const resource of [
    "data/timeline.json",
    "data/tracks.json",
    "data/narratives.json",
    "data/product.json",
    "data/signals.json",
    "data/sources.json",
    "sitemap.xml",
  ]) {
    const expected = new URL(resource, siteUrl).toString();
    if (!text.includes(`](${expected})`)) {
      add("invalid_llms_txt", path, `Missing public resource ${expected}`);
    }
  }
  const links = [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1] ?? "");
  if (links.length < 12) add("invalid_llms_txt", path, "Expected at least 12 curated links");
  for (const link of links) {
    try {
      if (new URL(link).protocol !== "https:") {
        add("invalid_llms_txt", path, `Non-HTTPS link: ${link}`);
      }
    } catch {
      add("invalid_llms_txt", path, `Invalid link: ${link}`);
    }
  }
  if (/\/Users\/|\/home\/runner\/|<<<<<<<|__PREFIX__/.test(text)) {
    add("private_material", path, "llms.txt contains a local path or template marker");
  }
}

function validateIndustryLlmsTxt(
  text: string,
  siteUrl: string,
  add: (code: string, path: string, message: string) => void,
): void {
  const path = "llms.txt";
  if (!/^# [^\n]+\n\n> /.test(text)) {
    add("invalid_llms_txt", path, "Expected an H1 followed by a blockquote summary");
  }
  if ((text.match(/^# /gm) ?? []).length !== 1) {
    add("invalid_llms_txt", path, "Expected exactly one H1 heading");
  }
  for (const section of ["## Start Here", "## Core Machine-Readable Data", "## Governance"]) {
    if (!text.includes(section)) add("invalid_llms_txt", path, `Missing ${section}`);
  }
  for (const boundary of [
    "published Events",
    "not as verified facts",
    "analysis or hypotheses",
    "original evidence URLs",
  ]) {
    if (!text.includes(boundary)) add("invalid_llms_txt", path, `Missing boundary: ${boundary}`);
  }
  for (const resource of [
    "data/timeline.json",
    "data/tracks.json",
    "data/signals.json",
    "data/sources.json",
    "data/industry-pilot.json",
    "sitemap.xml",
  ]) {
    const expected = new URL(resource, siteUrl).toString();
    if (!text.includes(`](${expected})`)) {
      add("invalid_llms_txt", path, `Missing public resource ${expected}`);
    }
  }
  const links = [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1] ?? "");
  if (links.length < 12) add("invalid_llms_txt", path, "Expected at least 12 curated links");
  for (const link of links) {
    try {
      if (new URL(link).protocol !== "https:") {
        add("invalid_llms_txt", path, `Non-HTTPS link: ${link}`);
      }
    } catch {
      add("invalid_llms_txt", path, `Invalid link: ${link}`);
    }
  }
  if (/\/Users\/|\/home\/runner\/|<<<<<<<|__PREFIX__/.test(text)) {
    add("private_material", path, "llms.txt contains a local path or template marker");
  }
}

async function validateIndexedRoute(
  distDir: string,
  route: string,
  localePrefix: "" | "en/",
  siteUrl: string,
  sitemapUrls: Set<string>,
  add: (code: string, path: string, message: string) => void,
): Promise<void> {
  const url = new URL(`${localePrefix}${route}`, siteUrl).toString();
  if (!sitemapUrls.has(url)) add("sitemap_missing_url", "sitemap.xml", url);
  const path = `${localePrefix}${route}index.html`;
  let html: string;
  try {
    html = await readFile(join(distDir, path), "utf8");
  } catch (error) {
    add("missing_file", path, error instanceof Error ? error.message : "File is missing");
    return;
  }
  if (html.includes("<<<<<<<") || html.includes("__PREFIX__") || html.includes("/Users/")) {
    add(
      "unsafe_page_output",
      path,
      "Page contains a conflict marker, template token, or local path",
    );
  }
  validateJsonLd(path, html, add);
}

function validateJsonLd(
  path: string,
  html: string,
  add: (code: string, path: string, message: string) => void,
): void {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) add("missing_json_ld", path, "No JSON-LD block found");
  for (const block of blocks) {
    try {
      JSON.parse(block[1] ?? "");
    } catch (error) {
      add("invalid_json_ld", path, error instanceof Error ? error.message : "Invalid JSON-LD");
    }
  }
}

function assertCount(
  path: string,
  html: string,
  pattern: RegExp,
  expected: number,
  add: (code: string, path: string, message: string) => void,
): void {
  const actual = html.match(pattern)?.length ?? 0;
  if (actual !== expected)
    add("content_count_mismatch", path, `Expected ${expected}, found ${actual}`);
}

function ensureSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}
