# dsh-skill-switchboard

A **skill switchboard** in the DSH web client's left sidebar: see the skills you own, turn them on
or off, search inside them, check them against the SKILL.md spec, edit them, create new ones,
import a folder or a `.zip`, move them between roots, tag them, and delete them into a trash you
can restore from.

> This bundle is a **fork-free reimplementation** of a skills panel: it manages skills through the
> files themselves and the `skills` service. It does not ship or modify the built-in skills.

## Install

**As a bundle (recommended)**

1. Open **Plugins → Add plugin** and point it at this package, or install it from the market.
2. Restart the client once; a **技能 / Skills** entry appears in the left sidebar.

**Standalone (no bundle)**

The panel is client-side plus a host half, so it needs to be installed as a bundle. There is no
"drop a SKILL.md into `~/.dsh/skills`" mode for this one.

## What it shows

Only skills **you** installed or wrote:

| Root | Rank | Scope |
| --- | --- | --- |
| `<project>/.dsh/skills` | 100 | this project |
| `<project>/.agents/skills` | 200 | this project |
| `~/.dsh/skills` | 400 | every session |
| `~/.agents/skills` | 500 | every session |

Linked skills (junctions / symlinks, e.g. a folder shared with another tool) are listed and
marked **链接 / linked**. Skills provided by bundled packages and plugins are **not** listed —
they are read-only and belong to their package.

## What you can do

- **Enable / disable** — one switch writes `disable-model-invocation` and `user-invocable` back
  into the skill's SKILL.md frontmatter. The filesystem provider watches the file and re-discovers
  it, so the change takes effect without a restart. BOM and line endings are preserved.
- **Search** — name, description and body text, with chips for *all / enabled / disabled / has
  spec problems / linked*.
- **Check + fix** — validates the SKILL.md spec (kebab-case `name`, a real `description`, boolean
  flags, declared-but-missing files) and offers a one-click fix for what it can repair safely
  (normalising the frontmatter, renaming the directory to match `name`).
- **Edit** — opens SKILL.md in a modal (2 MB cap) and writes it back byte-safely.
- **Create** — new `kebab-case` skill in the root you pick, with a generated frontmatter.
- **Import** — a skill folder, a parent folder full of skills (batch), or a `.zip` (≤ 64 MB,
  safely extracted). A **preview** shows new / duplicate / overwrite before anything is copied.
- **Move** — move a skill between the user, agents and project roots without touching its content.
- **Tags** — up to 12 tags per skill (≤ 32 characters each), stored in
  `~/.dsh/skills-panel/groups.json`.
- **Delete / restore** — deleting moves the skill into a central trash (cap 100) instead of
  destroying it; the Trash view restores it.
- **Sediment** — append a dated entry to the skill's "经验附注 / notes" section; you can also ask
  the current session's agent to draft that note.
- **Version check** — compares the skill's `metadata.version` with the GitHub repository it names
  (only when you press the button).
- **Batch mode** — select several skills and enable or disable them at once.

## Safety and limits

- Every host command runs with `recordInput: false`: nothing the panel does is added to the model
  transcript.
- The panel writes to **your** skill files. The enable switch, the editor, the fixer, create,
  import, move, tag and sediment all touch the filesystem; delete goes to a trash directory, and
  the trash keeps at most 100 entries.
- Delete and move refuse junction/symlink roots, so a linked skill cannot be unlinked by accident.
- Built-in and plugin-provided skills are read-only: they are not listed and cannot be toggled.
- Network access happens only for the optional version check, against `api.github.com`.
- Windows is the tested platform; the code avoids shell calls and uses `node:` builtins only.
- Requires DSH ≥ 0.2.2-rc.1 and Node ≥ 22.

## Development

```bash
node --check index.js && node --check client.js
node tests/smoke.test.js
```

`tests/smoke.test.js` loads both halves in a sandbox, applies the plugin to a fake context and
asserts that the panel slots and the `skills-panel-*` commands are registered, plus the locale and
packaging invariants.

## License

MIT — see [LICENSE](LICENSE). Not affiliated with DeepSeek; "DeepSeek" and its whale mark belong to
their owner.