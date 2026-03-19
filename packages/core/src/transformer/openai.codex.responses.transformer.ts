import { LLMProvider, UnifiedChatRequest } from "../types/llm";
import { TransformerContext } from "../types/transformer";
import { resolveOpenAICodexResponsesUrl } from "../services/oauth/openai-codex";
import { OpenAIResponsesTransformer } from "./openai.responses.transformer";

function stringifyCodexInstructionPart(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object" && "text" in item) {
        return typeof item.text === "string" ? item.text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeCodexEventPayload(payload: Record<string, any>) {
  if (payload.type === "response.done" || payload.type === "response.incomplete") {
    return {
      ...payload,
      type: "response.completed",
    };
  }

  if (payload.type === "error") {
    return {
      error: {
        message: payload.message || "Codex error",
        type: "api_error",
        code: payload.code || "codex_error",
      },
    };
  }

  if (payload.type === "response.failed") {
    return {
      error: {
        message: payload.response?.error?.message || "Codex response failed",
        type: "api_error",
        code: payload.response?.error?.code || "codex_response_failed",
      },
    };
  }

  if (payload.type === "response.output_item.done" && payload.item?.type === "reasoning") {
    return {
      ...payload,
      type: "response.codex_reasoning_item.done",
    };
  }

  if (
    payload.type === "response.reasoning_summary_part.done" &&
    typeof payload.item_id === "string" &&
    payload.item_id.startsWith("rs_")
  ) {
    return null;
  }

  return payload;
}

function createCodexCompatibleEventStream(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) {
              controller.enqueue(encoder.encode(`${line}\n`));
              continue;
            }

            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") {
              controller.enqueue(encoder.encode(`${line}\n`));
              continue;
            }

            try {
              const payload = JSON.parse(data);
              const normalizedPayload = normalizeCodexEventPayload(payload);
              if (!normalizedPayload) {
                continue;
              }
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(normalizedPayload)}\n`),
              );
            } catch {
              controller.enqueue(encoder.encode(`${line}\n`));
            }
          }
        }

        if (buffer) {
          controller.enqueue(encoder.encode(buffer));
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {}
        controller.close();
      }
    },
  });
}

export class OpenAICodexResponsesTransformer extends OpenAIResponsesTransformer {
  name = "openai-codex-responses";
  endPoint = undefined;

  async transformRequestIn(
    request: UnifiedChatRequest,
    provider: LLMProvider,
    context: TransformerContext,
  ): Promise<Record<string, any>> {
    const transformed = (await super.transformRequestIn(request, provider, context)) as Record<
      string,
      any
    >;
    const body = transformed.body ?? transformed;

    const instructionParts: string[] = [];
    if (Array.isArray(body.input)) {
      body.input = body.input.filter((item: any) => {
        if (item?.role !== "system") {
          return true;
        }
        const text = stringifyCodexInstructionPart(item.content);
        if (text) {
          instructionParts.push(text);
        }
        return false;
      });
    }

    const instructions = [body.instructions, ...instructionParts].filter(Boolean).join("\n\n");
    if (instructions) {
      body.instructions = instructions;
    }

    body.store = false;
    body.include = ["reasoning.encrypted_content"];
    body.text = body.text ?? { verbosity: "medium" };
    body.parallel_tool_calls = true;
    body.tool_choice = body.tool_choice ?? "auto";
    if (body.reasoning) {
      body.reasoning = {
        ...body.reasoning,
        summary: "auto",
      };
    }

    const requestId = context?.req?.id;
    if (requestId) {
      body.prompt_cache_key = requestId;
    }

    return {
      body,
      config: {
        ...(transformed.config ?? {}),
        url: resolveOpenAICodexResponsesUrl(provider.baseUrl),
        headers: {
          ...(transformed.config?.headers ?? {}),
          "OpenAI-Beta": "responses=experimental",
          accept: body.stream === false ? "application/json" : "text/event-stream",
          ...(requestId ? { session_id: requestId } : {}),
        },
      },
    };
  }

  async transformResponseOut(response: Response, context: TransformerContext): Promise<Response> {
    const contentType = response.headers.get("Content-Type") || "";
    const expectsStream = Boolean(context?.req?.body?.stream);
    if (response.body && (contentType.includes("text/event-stream") || expectsStream)) {
      const headers = new Headers(response.headers);
      headers.set("Content-Type", "text/event-stream");
      response = new Response(createCodexCompatibleEventStream(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return super.transformResponseOut(response, context);
  }
}
