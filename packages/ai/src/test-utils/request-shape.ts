/**
 * Projection of a Messages API request used to prove that request shaping
 * changes nothing for today's models. Prompt TEXT is excluded (it varies by
 * fixture); structure, model, sampling, thinking, tools and schemas are kept.
 */
export type RequestShape = {
  model: unknown;
  max_tokens: unknown;
  system: Array<{ type: unknown; cache_control: unknown }> | unknown;
  tools: Array<{ name: unknown; strict: unknown; input_schema: unknown }>;
  tool_choice: unknown;
  temperature: unknown;
  thinking: unknown;
  output_config: unknown;
};

export function requestShape(request: unknown): RequestShape {
  const r = request as Record<string, unknown>;
  const tools = (r.tools as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    model: r.model,
    max_tokens: r.max_tokens,
    system: Array.isArray(r.system)
      ? (r.system as Array<Record<string, unknown>>).map((b) => ({
          type: b.type,
          cache_control: b.cache_control ?? null,
        }))
      : typeof r.system,
    tools: tools.map((t) => ({
      name: t.name,
      strict: t.strict ?? null,
      input_schema: t.input_schema,
    })),
    tool_choice: r.tool_choice ?? null,
    temperature: r.temperature ?? null,
    thinking: r.thinking ?? null,
    output_config: r.output_config ?? null,
  };
}
