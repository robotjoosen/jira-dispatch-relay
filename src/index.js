// Jira webhook → GitHub repository_dispatch relay. Replaces the Jira Automation rules that start the agents.
const EVENT_FOR_STATUS = {
  "To Do": "jira-coding-agent",
  "In Review": "jira-review-agent",
};

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    const body = await request.text();
    if (!(await hasValidSignature(body, request.headers.get("X-Hub-Signature"), env.JIRA_WEBHOOK_SECRET))) {
      return new Response("invalid signature", { status: 401 });
    }

    let event;
    try {
      event = JSON.parse(body);
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    const statusChange = event.changelog?.items?.find((item) => item.field === "status");
    const eventType = statusChange && EVENT_FOR_STATUS[statusChange.toString];
    const key = event.issue?.key;
    if (!eventType || !key) {
      return new Response("ignored", { status: 202 });
    }

    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "jira-dispatch-relay", // GitHub rejects requests without one
      },
      body: JSON.stringify({
        event_type: eventType,
        client_payload: { key, actor: event.user?.accountId ?? null },
      }),
    });

    if (!response.ok) {
      // A non-2xx reply lets Jira retry the delivery.
      return new Response(`github ${response.status}: ${await response.text()}`, { status: 502 });
    }
    return new Response(`dispatched ${eventType} for ${key}`, { status: 202 });
  },
};

// Jira sends "X-Hub-Signature: sha256=<hex HMAC of the raw body>" when the webhook has a secret.
async function hasValidSignature(body, header, secret) {
  if (!secret || !header?.startsWith("sha256=")) {
    return false;
  }
  const hex = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    return false;
  }
  const signature = new Uint8Array(hex.match(/../g).map((byte) => parseInt(byte, 16)));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", cryptoKey, signature, new TextEncoder().encode(body));
}
