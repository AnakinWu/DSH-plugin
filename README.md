# DSH-plugin

DSH (DeepSeek Harness) plugins by AnakinWu — one repo, independently installable packages.

| Package | What it does |
|---|---|
| [dsh-archive-finder](packages/dsh-archive-finder) | Find and restore archived sessions; auto-archive idle ones after 3 days. |
| [dsh-dsweb](packages/dsh-dsweb) | One-click button to open the DeepSeek web chat from the sidebar. |
| [dsh-tokcnt](packages/dsh-tokcnt) | Show input/output/cache token usage per message in the web UI. |

Each package under `packages/` declares its own `dsh.bundle` manifest and can be installed independently.

## License

MIT

## Requirements

- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) — the host app these plugins run in.

## Repo layout

```
packages/
  dsh-archive-finder/   # restore + auto-archive sessions
  dsh-dsweb/            # DeepSeek web chat entry button
  dsh-tokcnt/           # per-message token usage
```
