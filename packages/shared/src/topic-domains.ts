/**
 * Global, grammar-agnostic vocabulary of neutral everyday topic domains.
 * Domains (not scenarios) so any grammar point can be expressed in any domain.
 * Used to steer per-draft topic diversity during generation (deficit water-fill)
 * and to constrain the model's `topicHint` label so the deficit is measurable.
 */
export const TOPIC_DOMAINS = [
  "travel",
  "food",
  "home",
  "work",
  "health",
  "shopping",
  "weather",
  "education",
  "family",
  "money",
  "transport",
  "technology",
  "nature",
  "media",
  "sport",
  "holidays",
] as const;

export type TopicDomain = (typeof TOPIC_DOMAINS)[number];

/** Legal `content_json.topicHint` values: the domains plus an escape hatch. */
export const TOPIC_HINT_VALUES = [...TOPIC_DOMAINS, "other"] as const;

export function isTopicDomain(x: string): x is TopicDomain {
  return (TOPIC_DOMAINS as readonly string[]).includes(x);
}
