import { ThinkLevel } from "@/types/llm";

export function getThinkLevel(
  effort?: string | number
): ThinkLevel | undefined {
  if (typeof effort === "number") {
    return effort > 32768 ? "xhigh" : "high";
  }

  switch (effort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "max":
      return "xhigh";
    default:
      return "medium";
  }
}
