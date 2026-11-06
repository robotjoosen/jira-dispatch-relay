# jira-dispatch-relay

A Cloudflare Worker that turns a Jira webhook into a GitHub `repository_dispatch`, so Jira status moves start the
agent workflows of [film-devel](https://github.com/robotjoosen/film-devel) without Jira Automation.

| Ticket moves to | Dispatch event      |
|-----------------|---------------------|
| `To Do`         | `jira-coding-agent` |
| `In Review`     | `jira-review-agent` |

The payload is `{"key": "<issue key>", "actor": "<account id>"}`. Requests without a valid `X-Hub-Signature` are
rejected.

## Deploy

```sh
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN          # fine-grained PAT, this repo only, permission to create dispatches
npx wrangler secret put JIRA_WEBHOOK_SECRET   # e.g. openssl rand -hex 32
```

Then in Jira, Settings → System → WebHooks, create a webhook:

- URL: the Worker URL
- Secret: the value of `JIRA_WEBHOOK_SECRET`
- Events: Issue → updated
- JQL: `project = DVF`

Disable the Jira Automation rules that send the same dispatches, or every move starts two runs. Watch deliveries with
`npx wrangler tail`.

## Test

```sh
npm test
```
