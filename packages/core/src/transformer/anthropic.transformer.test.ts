import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicTransformer } from "./anthropic.transformer";

test("anthropic transformer maps large thinking budgets to xhigh reasoning effort", async () => {
  const transformer = new AnthropicTransformer();
  const logs: Array<{ payload: Record<string, unknown>; message: string }> = [];
  transformer.logger = {
    info(payload: Record<string, unknown>, message: string) {
      logs.push({ payload, message });
    },
  };

  const transformed = await transformer.transformRequestOut!({
    model: "claude-sonnet",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: "Reply with OK",
      },
    ],
    thinking: {
      type: "enabled",
      budget_tokens: 32769,
    },
  } as any);

  assert.deepEqual((transformed as any).reasoning, {
    effort: "xhigh",
    enabled: true,
  });
  assert.deepEqual(logs, [
    {
      payload: {
        model: "claude-sonnet",
        thinking_budget_tokens: 32769,
        reasoning_effort: "xhigh",
      },
      message: "Mapped Anthropic thinking budget to reasoning effort",
    },
  ]);
});

test("anthropic transformer does not crash when output_config is set without thinking", async () => {
  const transformer = new AnthropicTransformer();

  const transformed = await transformer.transformRequestOut!({
    model: "claude-sonnet",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: "Reply with OK",
      },
    ],
    output_config: {
      effort: "medium",
    },
  } as any);

  assert.deepEqual((transformed as any).reasoning, {
    effort: "medium",
    enabled: false,
  });
});
