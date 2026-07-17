import type { StaticSiteModel } from "./dto.js";

export function renderLlmsTxt(model: StaticSiteModel): string {
  const baseUrl = ensureSlash(model.siteUrl);
  if (model.industryProfile) return renderIndustryLlmsTxt(model, baseUrl);

  return `# Agent Pulse

> Agent Pulse is a China-first, globally scoped AI industry evidence and decision system. It connects verified events, original evidence, industry trends, source observations, and clearly labeled action hypotheses.

Snapshot generated at ${model.generatedAt}. The public corpus contains ${model.events.length} published events, ${model.tracks.length} industry trends, ${model.sources.length} catalogued sources, ${model.signals.length} source observations, and ${model.scout.length} action hypotheses.

Consumption guidance:
- Start with published Events in \`data/timeline.json\` when answering factual questions. Keep each Event's fact summary separate from its analysis, forecast, and impact fields.
- Follow the original evidence URLs attached to an Event when a claim needs verification or citation.
- Treat \`data/signals.json\` as an observation feed, not as verified facts. A Signal may be useful for discovery but has not necessarily passed publication gates.
- Treat industry narratives and action ideas as analysis or hypotheses. Preserve their uncertainty, counter-signals, and evidence links.
- Prefer the newest \`generatedAt\` value. The Chinese pages are canonical; English pages are available under \`/en/\`.
- Public data is an allowlisted summary. Do not infer access to raw collector payloads, private notes, credentials, or paywalled content.

## Start Here

- [Latest material shifts](${baseUrl}): Current evidence-backed changes and the six industry areas Agent Pulse follows.
- [Industry trends](${baseUrl}lines/): Stage-based analysis, key events, current assessment, and what to verify next.
- [Event timeline](${baseUrl}timeline/): Published events in reverse chronological order with stable event pages and source links.
- [Method and evidence boundary](${baseUrl}legal/): How facts, analysis, forecasts, and opportunity hypotheses are separated.

## Core Machine-Readable Data

- [Published events and evidence](${baseUrl}data/timeline.json): The primary factual corpus. Includes stable slugs, dates, fact summaries, analysis fields, evidence records, tracks, actors, and research-impact assessments.
- [Industry trend definitions](${baseUrl}data/tracks.json): The public trend taxonomy used to organize Events.
- [Industry narratives](${baseUrl}data/narratives.json): Stage histories, current theses, decision lenses, and next signals. Treat these as analysis rather than raw facts.
- [Product capabilities and evaluation](${baseUrl}data/product.json): Current version, capability maturity, release history, source coverage, and the evidence-backed system evaluation.

## Research and Decision Views

- [Industry evolution](${baseUrl}industry-evolution/): A longer historical view of AI technology, products, companies, and business-model changes.
- [Action ideas](${baseUrl}scout/): Evidence-linked opportunity hypotheses with target audience, suggested experiment, risk, and invalidation signals.
- [Companies and institutions](${baseUrl}actors/): Public actor coverage and related Events.
- [Model pricing](${baseUrl}resources/): Public model-price comparisons with verification dates and original sources.

## Provenance and Governance

- [Source catalog](${baseUrl}sources/): Source ownership, tier, region, acquisition, lifecycle, observation state, and public health status.
- [Product updates](${baseUrl}changelog/): User-visible changes and release history.
- [Sitemap](${baseUrl}sitemap.xml): Complete index of Chinese and English public pages, including stable Event URLs.
- [GitHub repository](${model.github.repositoryUrl}): Source code, versioned public snapshot, workflows, and issue history.

## Optional

- [Source observations](${baseUrl}data/signals.json): Large discovery feed. These records are not verified public facts; use published Events for factual claims.
- [Source metadata](${baseUrl}data/sources.json): Machine-readable public source catalog and latest allowlisted health state.
- [Action hypotheses](${baseUrl}data/scout.json): Machine-readable Scout ideas; each remains a hypothesis rather than a fact or investment conclusion.
- [Actor metadata](${baseUrl}data/actors.json): Machine-readable companies and institutions.
- [Influencer metadata](${baseUrl}data/influencers.json): Public profiles, focus areas, and whether access is automatic or restricted.
`;
}

function renderIndustryLlmsTxt(model: StaticSiteModel, baseUrl: string): string {
  const profile = model.industryProfile;
  if (!profile) return "";
  return `# ${profile.shortName}

> A public medical and health data-elements intelligence pilot powered by Agent Pulse. It monitors policy, data infrastructure, payers and TPAs, pharma and medtech, competitors, standards, conferences, and ecosystem changes.

Snapshot generated at ${model.generatedAt}. The public corpus contains ${model.events.length} published events, ${model.tracks.length} monitoring tracks, ${model.sources.length} governed sources, ${model.signals.length} source observations, and ${model.scout.length} action hypotheses.

Consumption guidance:
- Start with published Events in \`data/timeline.json\` for factual questions and keep fact summaries separate from analysis and forecasts.
- Follow original evidence URLs before citing a claim. A high-priority judgment is incomplete without original evidence.
- Treat \`data/signals.json\` as an observation feed, not as verified facts.
- Treat trend narratives and action briefs as analysis or hypotheses, not medical, legal, investment, or procurement advice.
- Prefer the newest \`generatedAt\` value. The Chinese pages are canonical; English pages are under \`/en/\`.
- The public output contains allowlisted summaries only, never collector payloads, credentials, private notes, or paywalled content.

## Start Here

- [Pilot scorecard](${baseUrl}): Seven-day collection, evidence, clustering, Top 10, and time-saved validation status.
- [Six monitoring tracks](${baseUrl}lines/): Policy, infrastructure, payer, pharma and medtech, competitor, and ecosystem views.
- [Event timeline](${baseUrl}timeline/): Published events with stable URLs and original evidence.
- [Source catalog](${baseUrl}sources/): Source tier, region, acquisition, lifecycle, and public health state.
- [Decision method](${baseUrl}product/): How evidence, events, analysis, and action hypotheses are separated.

## Core Machine-Readable Data

- [Published events and evidence](${baseUrl}data/timeline.json)
- [Monitoring tracks](${baseUrl}data/tracks.json)
- [Source observations](${baseUrl}data/signals.json)
- [Source metadata](${baseUrl}data/sources.json)
- [Seven-day pilot report](${baseUrl}data/industry-pilot.json)

## Governance

- [Evidence, copyright, and correction boundary](${baseUrl}legal/)
- [Product updates](${baseUrl}changelog/)
- [Sitemap](${baseUrl}sitemap.xml)
- [GitHub repository](${model.github.repositoryUrl})
`;
}

function ensureSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
