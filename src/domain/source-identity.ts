export function sourcePublisherKey(homepageUrl: string, fallback: string): string {
  try {
    return new URL(homepageUrl).hostname.toLowerCase().replace(/^www\./, "") || fallback;
  } catch {
    return fallback;
  }
}
