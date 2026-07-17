const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "update",
  "with",
]);

export function titleTokens(title: string): Set<string> {
  const segments =
    title
      .normalize("NFKC")
      .toLowerCase()
      .match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? [];
  const tokens: string[] = [];
  for (const segment of segments) {
    if (/^[\u4e00-\u9fff]+$/.test(segment)) {
      if (segment.length <= 2) tokens.push(segment);
      else {
        for (let index = 0; index < segment.length - 1; index += 1) {
          tokens.push(segment.slice(index, index + 2));
        }
      }
    } else if (segment.length > 1 && !STOP_WORDS.has(segment)) {
      tokens.push(segment);
    }
  }

  return new Set(tokens);
}

export function titleSimilarity(left: string, right: string): number {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function belongsToEvent(
  candidate: { title: string; publishedAt: string },
  event: { title: string; happenedAt: string },
  threshold = 0.46,
): boolean {
  const hours =
    Math.abs(new Date(candidate.publishedAt).getTime() - new Date(event.happenedAt).getTime()) /
    3_600_000;
  if (hours > 21 * 24) return false;
  const candidateFingerprint = eventFingerprint(candidate.title);
  const eventKey = eventFingerprint(event.title);
  if (candidateFingerprint && candidateFingerprint === eventKey) {
    const candidateFacet = eventFacetBucket(eventFacet(candidate.title));
    const existingFacet = eventFacetBucket(eventFacet(event.title));
    if (candidateFingerprint.startsWith("document:")) {
      return candidateFacet !== "incident" && existingFacet !== "incident" && hours <= 21 * 24;
    }
    return (
      candidateFacet === existingFacet && hours <= (candidateFacet === "incident" ? 7 : 21) * 24
    );
  }
  return (
    hours <= 96 &&
    eventFacetBucket(eventFacet(candidate.title)) === eventFacetBucket(eventFacet(event.title)) &&
    titleSimilarity(candidate.title, event.title) >= threshold
  );
}

export function eventFingerprint(title: string): string | null {
  const normalized = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/通义/g, "qwen")
    .replace(/月之暗面/g, "kimi")
    .replace(/智谱/g, "zhipu")
    .replace(/阶跃星辰/g, "stepfun")
    .replace(/[–—_]/g, "-");
  const document = normalized.match(/《([^》]{6,100})》/u)?.[1];
  if (document) {
    const key = document.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "").slice(0, 100);
    if (key.length >= 6) return `document:${key}`;
  }
  const patterns: Array<[string, RegExp]> = [
    ["openai:gpt", /\bgpt[-\s]?(\d+(?:\.\d+)?(?:[-\s]?(?:mini|nano|pro))?)/],
    ["openai:o", /\bo(\d+(?:[-\s]?mini)?)/],
    ["google:gemini", /\bgemini[-\s]?(\d+(?:\.\d+)?(?:[-\s]?(?:flash|pro|ultra))?)/],
    ["anthropic:claude", /\bclaude[-\s]?(opus|sonnet|haiku)?[-\s]?(\d+(?:\.\d+)?)/],
    ["deepseek", /\bdeepseek[-\s]?(v\d+(?:\.\d+)?|r\d+)/],
    ["qwen", /\bqwen[-\s]?(\d+(?:\.\d+)?|coder|vl|max|plus)/],
    ["kimi", /\bkimi[-\s]?(k\d+(?:\.\d+)?|\d+(?:\.\d+)?)/],
    ["minimax", /\bminimax[-\s]?(m\d+|text[-\s]?\d+|video[-\s]?\d+)/],
    ["lingbot", /\blingbot[-\s]?(vla|world|video|vision)(?:[-\s]?(\d+(?:\.\d+)?))?/],
    ["longcat", /\blongcat[-\s]?(\d+(?:\.\d+)?)/],
    ["llama", /\bllama[-\s]?(\d+(?:\.\d+)?)/],
  ];
  for (const [family, pattern] of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    return `${family}:${match.slice(1).filter(Boolean).join(":").replace(/\s+/g, "-")}`;
  }
  return null;
}

export function eventFacet(title: string): string {
  const normalized = title.normalize("NFKC").toLowerCase();
  if (/outage|incident|breach|漏洞|宕机|故障|事故|诉讼|lawsuit/.test(normalized)) return "incident";
  if (/series [a-z]|funding|融资|估值|ipo|s-1|并购|acqui/.test(normalized)) return "capital";
  if (/price|pricing|降价|涨价|定价|subscription/.test(normalized)) return "pricing";
  if (/签约|战略合作|合作协议|达成合作|联合共建|成立联盟|中标/.test(normalized))
    return "partnership";
  if (/大会|论坛|峰会|研讨会|交流会|会议召开|会议举办|征集参会|开放报名/.test(normalized))
    return "conference";
  if (/政策|办法|条例|规范|通知|意见|指南|监管|合规|国家标准|行业标准/.test(normalized))
    return "policy";
  if (
    /available (?:in|for|on)|integration|integrat|microsoft 365|github copilot|进入.+copilot|接入|集成|分发/.test(
      normalized,
    )
  )
    return "distribution";
  if (/benchmark|eval|测评|评测|score|榜单/.test(normalized)) return "benchmark";
  if (
    /capabilit|reasoning level|performance|solv(?:e|es|ed|ing)|post-train|证明|推理等级|能力|自主训练/.test(
      normalized,
    )
  )
    return "capability";
  if (/release|launch|introduc|announce|发布|推出|开源|available/.test(normalized))
    return "release";
  return "update";
}

export function eventFacetBucket(facet: string): string {
  if (facet === "update") return "release";
  if (facet === "benchmark") return "capability";
  return facet;
}
