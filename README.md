# claude-mods

Claude Code mods: plugins built on function hooks that run inside Claude Code.

## Install

```
/plugin marketplace add nguyenngoctoan/claude-mods
/plugin install agent-progress@claude-mods
```

Then run `/reload-plugins`.

## Mods

### agent-progress

A progress bar above the prompt for a delegated plan, plus an agents panel (`/agents-info`) that lists running, finished and planned subagents with model, task progress, context, cost and time. The bar shows tokens used, the cache hit and tokens per second.

Based on [`savvy-progress`](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress) from [JohnnyVizz/claude-kit](https://github.com/JohnnyVizz/claude-kit) (MIT).

## Develop

```
claude plugin validate agent-progress
claude plugin test agent-progress
```

## License

MIT. See [`agent-progress/LICENSE`](agent-progress/LICENSE), which keeps the upstream copyright notice.
