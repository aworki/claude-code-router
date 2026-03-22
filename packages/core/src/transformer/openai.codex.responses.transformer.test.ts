import assert from "node:assert/strict";
import test from "node:test";
import { OpenAICodexResponsesTransformer } from "./openai.codex.responses.transformer";

test("openai-codex-responses transformer builds Codex request payload and URL", async () => {
  const transformer = new OpenAICodexResponsesTransformer();

  const transformed = await transformer.transformRequestIn!(
    {
      model: "gpt-5.4",
      stream: true,
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: "You are Codex.",
            },
          ],
        },
        {
          role: "user",
          content: "Reply with OK",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "noop",
            description: "No-op tool",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      reasoning: {
        effort: "medium",
      },
    } as any,
    {
      name: "openai-oauth",
      baseUrl: "https://api.openai.com/v1/chat/completions",
    } as any,
    {
      req: {
        id: "req_codex_123",
      },
    },
  );

  assert.equal(
    transformed.config?.url?.toString(),
    "https://chatgpt.com/backend-api/codex/responses",
  );
  assert.equal(transformed.config?.headers?.["OpenAI-Beta"], "responses=experimental");
  assert.equal(transformed.config?.headers?.accept, "text/event-stream");
  assert.equal(transformed.config?.headers?.session_id, "req_codex_123");

  assert.equal(transformed.body.model, "gpt-5.4");
  assert.equal(transformed.body.store, false);
  assert.equal(transformed.body.prompt_cache_key, "req_codex_123");
  assert.equal(transformed.body.parallel_tool_calls, true);
  assert.equal(transformed.body.tool_choice, "auto");
  assert.deepEqual(transformed.body.include, ["reasoning.encrypted_content"]);
  assert.deepEqual(transformed.body.text, { verbosity: "medium" });
  assert.deepEqual(transformed.body.reasoning, {
    effort: "medium",
    summary: "auto",
  });
  assert.equal(transformed.body.instructions, "You are Codex.");
  assert.ok(Array.isArray(transformed.body.input));
  assert.equal(
    transformed.body.input.some((item: any) => item?.role === "system"),
    false,
  );
});

test("openai-codex-responses transformer normalizes Codex SSE terminal events", async () => {
  const transformer = new OpenAICodexResponsesTransformer();
  const response = new Response(
    [
      'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"OK","response":{"model":"gpt-5.4"}}',
      'data: {"type":"response.done","response":{"id":"resp_1","model":"gpt-5.4","output":[]}}',
      "",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );

  const transformed = await transformer.transformResponseOut!(response, {});
  const body = await transformed.text();

  assert.match(body, /"content":"OK"/);
  assert.match(body, /"finish_reason":"stop"/);
});

test("openai-codex-responses transformer downgrades non-replayable assistant thinking to visible text context", async () => {
  const transformer = new OpenAICodexResponsesTransformer();

  const transformed = await transformer.transformRequestIn!(
    {
      model: "gpt-5.4",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Question one",
        },
        {
          role: "assistant",
          content: "Answer one",
          thinking: {
            content: "hidden chain of thought",
            signature: "sig_123",
          },
        },
        {
          role: "user",
          content: "Question two",
        },
      ],
    } as any,
    {
      name: "openai-oauth",
      baseUrl: "https://chatgpt.com/backend-api",
    } as any,
    {},
  );

  const assistantInput = transformed.body.input.find((item: any) => item?.role === "assistant");
  assert.equal(assistantInput?.content, "hidden chain of thought\n\nAnswer one");
  assert.equal("thinking" in assistantInput, false);
});

test("openai-codex-responses transformer replays provider-native reasoning signatures as OpenAI reasoning items", async () => {
  const transformer = new OpenAICodexResponsesTransformer();

  const transformed = await transformer.transformRequestIn!(
    {
      model: "gpt-5.4",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Question one",
        },
        {
          role: "assistant",
          content: "Answer one",
          thinking: {
            content: "codex hidden reasoning",
            signature: JSON.stringify({
              id: "rs_123",
              type: "reasoning",
              summary: [{ type: "summary_text", text: "codex hidden reasoning" }],
            }),
          },
        },
        {
          role: "user",
          content: "Question two",
        },
      ],
    } as any,
    {
      name: "openai-oauth",
      baseUrl: "https://chatgpt.com/backend-api",
    } as any,
    {},
  );

  assert.deepEqual(transformed.body.input[1], {
    id: "rs_123",
    type: "reasoning",
    summary: [{ type: "summary_text", text: "codex hidden reasoning" }],
  });
  assert.deepEqual(transformed.body.input[2], {
    role: "assistant",
    content: "Answer one",
  });
});

test("openai-codex-responses transformer preserves replayable reasoning signatures in streamed output", async () => {
  const transformer = new OpenAICodexResponsesTransformer();
  const response = new Response(
    [
      'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_123","delta":"hidden","response":{"model":"gpt-5.4"}}',
      'data: {"type":"response.output_item.done","item":{"id":"rs_123","type":"reasoning","summary":[{"type":"summary_text","text":"hidden"}]}}',
      'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"OK","response":{"model":"gpt-5.4"}}',
      'data: {"type":"response.done","response":{"id":"resp_1","model":"gpt-5.4","output":[]}}',
      "",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );

  const transformed = await transformer.transformResponseOut!(response, {
    req: {
      body: {
        stream: true,
      },
    },
  });
  const body = await transformed.text();
  const chunks = body
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  const signatureChunk = chunks.find(
    (chunk: any) => chunk.choices?.[0]?.delta?.thinking?.signature,
  );

  assert.equal(
    signatureChunk?.choices?.[0]?.delta?.thinking?.signature,
    JSON.stringify({
      id: "rs_123",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "hidden" }],
    }),
  );
  assert.match(body, /"content":"OK"/);
});

test("openai-codex-responses transformer does not emit duplicate reasoning signatures when summary completion arrives before item completion", async () => {
  const transformer = new OpenAICodexResponsesTransformer();
  const response = new Response(
    [
      'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_123","delta":"hidden","response":{"model":"gpt-5.4"}}',
      'data: {"type":"response.reasoning_summary_part.done","item_id":"rs_123","part":{"type":"summary_text","text":"hidden"},"response":{"model":"gpt-5.4"}}',
      'data: {"type":"response.output_item.done","item":{"id":"rs_123","type":"reasoning","summary":[{"type":"summary_text","text":"hidden"}],"encrypted_content":"enc_123"},"response":{"model":"gpt-5.4"}}',
      'data: {"type":"response.done","response":{"id":"resp_1","model":"gpt-5.4","output":[]}}',
      "",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );

  const transformed = await transformer.transformResponseOut!(response, {
    req: {
      body: {
        stream: true,
      },
    },
  });
  const body = await transformed.text();
  const chunks = body
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  const signatureChunks = chunks.filter(
    (chunk: any) => chunk.choices?.[0]?.delta?.thinking?.signature,
  );

  assert.equal(signatureChunks.length, 1);
  assert.equal(
    signatureChunks[0]?.choices?.[0]?.delta?.thinking?.signature,
    JSON.stringify({
      id: "rs_123",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "hidden" }],
      encrypted_content: "enc_123",
    }),
  );
});

test("openai-codex-responses transformer treats streamed Codex responses as SSE even when content-type is non-standard", async () => {
  const transformer = new OpenAICodexResponsesTransformer();
  const response = new Response(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"OK","response":{"model":"gpt-5.4"}}',
      "",
      'event: response.done',
      'data: {"type":"response.done","response":{"id":"resp_1","model":"gpt-5.4","output":[]}}',
      "",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );

  const transformed = await transformer.transformResponseOut!(response, {
    req: {
      body: {
        stream: true,
      },
    },
  });
  const body = await transformed.text();

  assert.match(body, /"content":"OK"/);
  assert.match(body, /"finish_reason":"stop"/);
});

test("openai-codex-responses transformer preserves usage on completed SSE events", async () => {
  const transformer = new OpenAICodexResponsesTransformer();
  const response = new Response(
    [
      'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"OK","response":{"model":"gpt-5.4"}}',
      'data: {"type":"response.done","response":{"id":"resp_1","model":"gpt-5.4","output":[],"usage":{"input_tokens":120,"output_tokens":34,"total_tokens":154,"input_tokens_details":{"cached_tokens":20}}}}',
      "",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );

  const transformed = await transformer.transformResponseOut!(response, {
    req: {
      body: {
        stream: true,
      },
    },
  });
  const body = await transformed.text();

  assert.match(body, /"prompt_tokens":120/);
  assert.match(body, /"completion_tokens":34/);
  assert.match(body, /"total_tokens":154/);
  assert.match(body, /"cached_tokens":20/);
});
