import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIResponsesTransformer } from "./openai.responses.transformer";

test("openai-responses transformer preserves xhigh reasoning effort", async () => {
  const transformer = new OpenAIResponsesTransformer();

  const transformed = await transformer.transformRequestIn!({
    model: "gpt-5.4",
    stream: true,
    messages: [
      {
        role: "user",
        content: "Reply with OK",
      },
    ],
    reasoning: {
      effort: "xhigh" as any,
    },
  } as any);

  assert.deepEqual((transformed as any).reasoning, {
    effort: "xhigh",
    summary: "detailed",
  });
});
