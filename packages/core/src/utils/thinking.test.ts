import assert from "node:assert/strict";
import test from "node:test";
import { getThinkLevel } from "./thinking";

test("getThinkLevel maps large budgets to xhigh", () => {
  assert.equal(getThinkLevel(32768), "high");
  assert.equal(getThinkLevel(32769), "xhigh");
});
