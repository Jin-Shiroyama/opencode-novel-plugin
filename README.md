# opencode-novel-plugin — Japanese long-form fiction edition

An OpenCode plugin for writing long-form fiction **in Japanese**, from premise to finished manuscript.

**📖 Full documentation: [README.ja.md](README.ja.md)** (Japanese)

> ### Modification notice
>
> This repository is a fork of [wmzy/opencode-novel-plugin](https://github.com/wmzy/opencode-novel-plugin),
> which targets Chinese-language web fiction.
>
> **Modified on 2026-10-09** and rewritten throughout for Japanese long-form fiction.
> All prompts, templates, guides, agents, skills and commands were rewritten in Japanese; the
> word-counting logic, default values, genre detection and chapter-heading parsing were changed;
> a Japanese typography specification and a Japanese anti-AI-cliché list were added; the
> martial-arts skill was adapted to Japanese historical/swordsman fiction; and the
> reality-sourcing skill's legal section was replaced with one based on Japanese law.
>
> A full list of changes is in [README.ja.md § 上流との差分](README.ja.md#上流との差分).
>
> This notice is provided under AGPL-3.0 section 5(a).

---

## What it provides

- **6 tools** — `novel_init`, `novel_status`, `novel_save_chapter`, `novel_context`, `novel_guide`, `novel_update`
- **3 agents** — `novel-planner` (planning coach), `novel-writer` (drafting coach), `novel-editor` (editing coach)
- **5 skills** — workflow, writing (the canonical typography and anti-AI-cliché reference), editing, historical/swordsman fiction, reality sourcing
- **11 slash commands** — `/novel-init`, `/novel-concept`, `/write-chapter`, `/novel-review`, …
- **15 RTCO prompts** and **15 document templates**
- File-based project data under `.novel/`

Writing proceeds in six stages: premise → setting → characters → plot outline → scene breakdown → prose,
with checkpoints at each stage and context assembled automatically before each chapter.

## Install

```json
{
  "plugin": ["file:///path/to/opencode-novel-plugin"]
}
```

Or place the repository in `.opencode/plugins/` (per project) or `~/.config/opencode/plugins/` (global).

## Quick start

```
/novel-init                       # create a project
/novel-concept → /novel-world → /novel-characters → /novel-outline → /novel-scenes
/write-chapter 1                  # write chapter 1
/novel-review 1                   # review it
/novel                            # show progress and suggest the next step
```

The plugin's prompts, templates and interface are all in Japanese — it is built for writing Japanese prose.

## Development

```bash
pnpm install
pnpm typecheck   # type check (includes tests)
pnpm test        # 69 unit tests via node:test — no extra dependencies
pnpm build       # distribution build (dist/, tests excluded)
pnpm check:ja    # check that no Chinese text remains
```

## License

**AGPL-3.0-or-later**. See [LICENSE](LICENSE).

### Acknowledgements

The upstream opencode-novel-plugin drew on the design of three projects, and this fork stands on that work:

- **novel-workflow-mcp** (GPL-3.0) — template-driven project structure, multi-stage workflow, per-scene `_Prompt` format
- **AI_NovelGenerator** (AGPL-3.0) — snowflake method, character state tracking, running summary
- **MuMuAINovel** (GPL-3.0) — the RTCO prompt framework, foreshadowing tracking, prioritised context (P0/P1/P2)

Some prompt structures and constraint clauses derive from those projects. Thanks to their authors.
