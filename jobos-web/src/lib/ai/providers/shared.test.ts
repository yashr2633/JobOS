import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWithTimeout } from "./shared.ts";
import { AiProviderError } from "./types.ts";

test("provider deadline remains active after headers while the body stalls", async (t) => {
  let aborted = false;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"unfinished":'));
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        controller.error(new DOMException("The operation was aborted", "AbortError"));
      }, { once: true });
    },
  })));
  await assert.rejects(fetchWithTimeout("https://provider.example/test", {}, 30, "test"),
    (error: unknown) => error instanceof AiProviderError && error.category === "timeout");
  assert.equal(aborted, true);
});

test("completed provider bodies remain readable with status and headers intact", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response('{"error":"retry"}', {
    status: 429, headers: { "Content-Type": "application/json", "Retry-After": "2" },
  }));
  const response = await fetchWithTimeout("https://provider.example/test", {}, 1000, "test");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "2");
  assert.deepEqual(await response.json(), { error: "retry" });
});

test("bodyless provider responses are preserved", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  const response = await fetchWithTimeout("https://provider.example/test", {}, 1000, "test");
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});
