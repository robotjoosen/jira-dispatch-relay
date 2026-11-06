import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";

const env = { JIRA_WEBHOOK_SECRET: "s3cret", GITHUB_TOKEN: "gh-token", GITHUB_REPO: "owner/repo" };
let dispatched;

beforeEach(() => {
  dispatched = [];
  globalThis.fetch = async (url, init) => {
    dispatched.push({ url, init, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
});

function webhook(payload, secret = env.JIRA_WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return new Request("https://relay.example", {
    method: "POST",
    headers: { "X-Hub-Signature": `sha256=${signature}` },
    body,
  });
}

const movedTo = (status) => ({
  issue: { key: "DVF-8" },
  user: { accountId: "abc" },
  changelog: { items: [{ field: "status", fromString: "Backlog", toString: status }] },
});

test("a move to To Do dispatches the coding agent", async () => {
  const response = await worker.fetch(webhook(movedTo("To Do")), env);
  assert.equal(response.status, 202);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].url, "https://api.github.com/repos/owner/repo/dispatches");
  assert.equal(dispatched[0].init.headers.Authorization, "Bearer gh-token");
  assert.deepEqual(dispatched[0].body, {
    event_type: "jira-coding-agent",
    client_payload: { key: "DVF-8", actor: "abc" },
  });
});

test("a move to In Review dispatches the review agent", async () => {
  await worker.fetch(webhook(movedTo("In Review")), env);
  assert.equal(dispatched[0].body.event_type, "jira-review-agent");
});

test("other status moves and non-status edits are ignored", async () => {
  await worker.fetch(webhook(movedTo("Done")), env);
  await worker.fetch(webhook({ issue: { key: "DVF-8" }, changelog: { items: [{ field: "summary" }] } }), env);
  assert.equal(dispatched.length, 0);
});

test("a wrong or missing signature is rejected", async () => {
  const wrong = await worker.fetch(webhook(movedTo("To Do"), "other"), env);
  const missing = await worker.fetch(new Request("https://relay.example", { method: "POST", body: "{}" }), env);
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(dispatched.length, 0);
});

test("a GitHub failure returns 502 so Jira retries", async () => {
  globalThis.fetch = async () => new Response("bad credentials", { status: 401 });
  const response = await worker.fetch(webhook(movedTo("To Do")), env);
  assert.equal(response.status, 502);
});
