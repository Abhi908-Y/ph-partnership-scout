import { WINDOW_DAYS, topicSlugs } from "./config";
import type { RawPost } from "./types";

const ENDPOINT = "https://api.producthunt.com/v2/api/graphql";

// makerReplies = number of comments written by the post's makers (Product Hunt computes it,
// so it works even when maker identities are redacted). ~100 complexity points per topic.
const POSTS_QUERY = `
query RecentByTopic($topic: String, $after: DateTime) {
  posts(topic: $topic, postedAfter: $after, order: VOTES, first: 20) {
    edges {
      node {
        id name tagline description url website
        votesCount commentsCount makerReplies createdAt featuredAt
        thumbnail { url }
        topics(first: 5) { edges { node { name slug } } }
        makers { id name username headline }
      }
    }
  }
}`;

async function gql(query: string, variables: Record<string, unknown>) {
  const token = process.env.PRODUCTHUNT_TOKEN;
  if (!token) throw new Error("PRODUCTHUNT_TOKEN is not set.");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    throw new Error(`Product Hunt API ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
  }
  return json.data;
}

const isRedacted = (s?: string | null) => !s || /redacted/i.test(s);

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRaw(n: any): RawPost {
  const allMakers: any[] = n.makers ?? [];
  const makerProfiles = allMakers
    .filter((m) => !isRedacted(m?.name))
    .map((m) => ({
      name: String(m.name),
      headline: isRedacted(m.headline) ? undefined : m.headline ?? undefined,
      username: isRedacted(m.username) ? undefined : m.username ?? undefined,
    }));
  const makers = makerProfiles.map((m) => m.name);
  // Per the brief: when Product Hunt hides every maker name, score with total comments instead.
  const makerComments = makers.length && typeof n.makerReplies === "number" ? n.makerReplies : null;
  return {
    id: String(n.id),
    name: n.name,
    tagline: n.tagline ?? "",
    description: (n.description ?? "").slice(0, 600),
    url: n.url,
    website: n.website ?? n.url,
    thumbnail: n.thumbnail?.url ?? undefined,
    votes: n.votesCount ?? 0,
    commentsCount: n.commentsCount ?? 0,
    makerComments,
    makers,
    makerProfiles,
    makersHidden: allMakers.length - makerProfiles.length,
    topics: (n.topics?.edges ?? []).map((e: any) => e.node.name),
    launchedAt: n.featuredAt ?? n.createdAt,
  };
}

export async function fetchRecentLaunches(): Promise<{ posts: RawPost[]; errors: string[] }> {
  const after = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const byId = new Map<string, RawPost>();
  const errors: string[] = [];

  // Sequential on purpose: Product Hunt rate-limits by query complexity (6,250 points / 15 min).
  for (const topic of topicSlugs()) {
    try {
      const data = await gql(POSTS_QUERY, { topic, after });
      for (const edge of data?.posts?.edges ?? []) {
        const post = toRaw(edge.node);
        byId.set(post.id, post);
      }
    } catch (err) {
      errors.push(`${topic}: ${(err as Error).message}`);
    }
  }
  return { posts: [...byId.values()], errors };
}
