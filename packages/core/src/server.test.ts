import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMessagesRequestBody } from "./utils/request-normalization";

test("normalizeMessagesRequestBody preserves omitted stream flag", () => {
  const normalized = normalizeMessagesRequestBody({
    model: "codex-auth,gpt-5.4",
    messages: [
      {
        role: "user",
        content: "Reply with OK",
      },
    ],
  } as any);

  assert.equal("stream" in normalized, false);
});

test("normalizeMessagesRequestBody preserves explicit stream values", () => {
  const streamTrue = normalizeMessagesRequestBody({
    model: "codex-auth,gpt-5.4",
    stream: true,
    messages: [],
  } as any);
  assert.equal(streamTrue.stream, true);

  const streamFalse = normalizeMessagesRequestBody({
    model: "codex-auth,gpt-5.4",
    stream: false,
    messages: [],
  } as any);
  assert.equal(streamFalse.stream, false);
});
