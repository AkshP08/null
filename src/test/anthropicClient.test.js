import { describe, it, expect, vi, afterEach } from "vitest";
import { callAnthropic, proxyUrl, aiBackendAvailable } from "../ai/anthropicClient.js";

// AI-3: the client picks the SAFE transport. With a user key it calls Anthropic
// directly (key stays in the browser). With no user key but a configured proxy,
// it POSTs to the same-origin serverless path and NEVER sends a key from the
// browser — the server injects it. No network here: fetch is stubbed.

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function stubFetch() {
  const calls = [];
  const fetchMock = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("anthropicClient transport selection", () => {
  it("with a user key → calls Anthropic directly, key in header", async () => {
    const calls = stubFetch();
    await callAnthropic({ model: "m", messages: [] }, { userKey: "sk-ant-user" });
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].init.headers["x-api-key"]).toBe("sk-ant-user");
    expect(calls[0].init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  it("no user key but proxy configured → POSTs to the proxy, NO key in the browser", async () => {
    vi.stubEnv("VITE_AI_PROXY_URL", "/.netlify/functions/anthropic");
    const calls = stubFetch();
    expect(proxyUrl()).toBe("/.netlify/functions/anthropic");
    await callAnthropic({ model: "m", messages: [] }, { userKey: null });
    expect(calls[0].url).toBe("/.netlify/functions/anthropic");
    expect(calls[0].init.headers["x-api-key"]).toBeUndefined();
    // the browser never sends any Anthropic credential to the proxy
    expect(JSON.stringify(calls[0].init.headers)).not.toMatch(/sk-ant/);
  });

  it("no user key and no proxy → throws (no backend), and reports availability", async () => {
    expect(proxyUrl()).toBe("");
    expect(aiBackendAvailable(null)).toBe(false);
    expect(aiBackendAvailable("sk-ant-user")).toBe(true);
    await expect(callAnthropic({ messages: [] }, { userKey: null })).rejects.toThrow(/No AI backend/i);
  });
});
