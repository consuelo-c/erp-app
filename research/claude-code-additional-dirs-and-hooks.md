# Claude Code: additional directories, hook input, per-session plugins

Research for [#570](https://github.com/consuelo-c/erp-app/issues/570). Sources: the official Claude Code docs at code.claude.com (read 2026-11-20) and the locally installed CLI, `claude --help` on version 2.1.329.

## 1. What loads from an additional directory

**The flag and the setting behave differently.**

- `permissions.additionalDirectories` in a settings file **grants file access only** and loads no configuration at all: no `CLAUDE.md`, no skills, no settings, no hooks. "Directories listed in `permissions.additionalDirectories` in a settings file grant file access only and don't load any of the configuration below." ([permissions: Additional directories grant file access, not configuration](https://code.claude.com/docs/en/permissions#additional-directories-grant-file-access-not-configuration)); the same is stated on [skills](https://code.claude.com/docs/en/skills).
- `--add-dir <path>` (or `/add-dir`, or the Agent SDK's `additionalDirectories` / `add_dirs`, which the SDK passes as `--add-dir`) loads these, per the table in the same [permissions section](https://code.claude.com/docs/en/permissions#additional-directories-grant-file-access-not-configuration):

| Configuration in the added directory | Loaded from `--add-dir`? |
| :- | :- |
| `.claude/skills/` | Yes, with live reload |
| `.claude/commands/` | Yes, no live reload; the project's command wins a name clash |
| `.claude/agents/` | Yes, no live reload |
| `.claude/settings.json`, `.claude/settings.local.json` | Only the `enabledPlugins` and `extraKnownMarketplaces` keys; so **no hooks, no permissions, no `env`** from them |
| `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/`, `CLAUDE.local.md` | Only when `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` is set |

Details:

- **The env var.** `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude --add-dir ../shared-config` loads the added directory's `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` and `.claude/rules/*.md` except rules with a `paths` field; it can be made permanent through the `env` block of `~/.claude/settings.json` ([memory: Load from additional directories](https://code.claude.com/docs/en/memory#load-from-additional-directories)). An added directory's `AGENTS.md` doesn't load even with the variable ([memory](https://code.claude.com/docs/en/memory)). It applies to flag-added directories only: the setting loads none of this table ([permissions](https://code.claude.com/docs/en/permissions#additional-directories-grant-file-access-not-configuration)).
- **Skills.** Skills, commands and subagents from an added directory load through the `project` setting source, so `--setting-sources` without `project` drops them; bare mode and `--safe-mode` restrict them too ([permissions](https://code.claude.com/docs/en/permissions#additional-directories-grant-file-access-not-configuration), [skills](https://code.claude.com/docs/en/skills)). A clashing name gets the directory's folder as prefix: with `--add-dir ../cli`, `/verify` is the project's and `/cli:verify` the added one ([skills](https://code.claude.com/docs/en/skills)).
- **Hooks.** The hook locations are user, project and local settings, managed policy, plugins, skills and subagents; an added directory is not one of them ([hooks](https://code.claude.com/docs/en/hooks)), and its settings files contribute only the two plugin keys ([permissions](https://code.claude.com/docs/en/permissions#additional-directories-grant-file-access-not-configuration)). A hook defined in the **frontmatter of a skill** that loads from an added directory does register when that skill is invoked ([hooks: Hooks in skills and agents](https://code.claude.com/docs/en/hooks)); that is the only route.
- **Trust.** An interactive `--add-dir` of a folder workspace trust doesn't cover asks to trust it first (v2.1.326+) ([permissions](https://code.claude.com/docs/en/permissions#working-directories)); its `enabledPlugins: true` entries are skipped until trust is saved by starting a session in that directory ([plugins/loading: Enabled in an --add-dir directory but not loaded](https://code.claude.com/docs/en/plugins/loading#enabled-in-an-add-dir-directory-but-not-loaded)).
- **Project settings come from the primary working directory only.** Claude Code reads `.claude/settings.json` from the session's primary working directory ([settings](https://code.claude.com/docs/en/settings)).

## 2. Does a `PreToolUse` hook see the permission mode?

**Yes: the common input field `permission_mode`.** Values: `"default"`, `"plan"`, `"acceptEdits"`, `"auto"`, `"dontAsk"`, `"bypassPermissions"`. The mode labelled **Manual** arrives as `"default"`, never `"manual"` ([hooks: common input fields](https://code.claude.com/docs/en/hooks)). The CLI's `--permission-mode` choices are `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan` (`claude --help`, v2.1.329).

The docs add that "not all events receive this field", so check each event's example; the `PreToolUse` example includes it ([hooks](https://code.claude.com/docs/en/hooks)):

```json
{
  "session_id": "abc123",
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "scratchpad_dir": "/tmp/claude-1000/-home-user-my-project/abc123/scratchpad",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test", "description": "Run test suite", "timeout": 120000, "run_in_background": false },
  "tool_use_id": "toolu_01ABC123..."
}
```

Other common fields: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `effort`, `hook_event_name`, and `agent_id` / `agent_type` when the hook fires inside a subagent ([hooks](https://code.claude.com/docs/en/hooks)). So a hook can branch on `jq -r .permission_mode` (for instance, act only when it is `"auto"`).

## 3. Turning a plugin on or off for one session or one skill

**Per session: yes, without touching `.claude/settings.json`. Per skill invocation: no.**

`enabledPlugins` merges per plugin id across six sources, lowest to highest: an `--add-dir` directory's settings, `user`, `project`, `local` (`.claude/settings.local.json`), `flag` (`--settings`), `managed`; for each id the highest source that mentions it wins ([plugins/loading: Find where a plugin is enabled](https://code.claude.com/docs/en/plugins/loading#find-where-a-plugin-is-enabled)). Hence:

- **One session, no file written**: `claude --settings '{"enabledPlugins": {"<name>@<marketplace>": false}}'` (or `true`). `--settings` applies above user, project and local files, for that session only, and can set any key a user file can ([settings: Change a setting for one session](https://code.claude.com/docs/en/settings#change-a-setting-for-one-session), [plugins/loading](https://code.claude.com/docs/en/plugins/loading#find-where-a-plugin-is-enabled)). `--settings` also accepts a file path, so it can be a git-ignored or out-of-repo file.
- **One session, plugin loaded from disk**: `--plugin-dir <path>` / `--plugin-url <url>` load a plugin as `<name>@inline` for that session only, shadowing an installed plugin of the same name ([plugins/cli-reference: Flags that load a plugin for one session](https://code.claude.com/docs/en/plugins/cli-reference#flags-that-load-a-plugin-for-one-session)).
- **One session, via an added directory**: `enabledPlugins` in an `--add-dir` directory's `.claude/settings.json` reaches that session only, and every other source overrides it ([plugins/loading](https://code.claude.com/docs/en/plugins/loading#find-where-a-plugin-is-enabled)). It can only add a plugin nobody else mentions; it can't override the project's `false` or `true`.
- **Persistently, for this developer only**: `.claude/settings.local.json` outranks the committed project file; `claude plugin disable <plugin> --scope local` writes that override ([plugins/loading: Disabled in user settings but still loads](https://code.claude.com/docs/en/plugins/loading#disabled-in-user-settings-but-still-loads), [plugins/cli-reference: plugin enable](https://code.claude.com/docs/en/plugins/cli-reference)). Not session-scoped: it stays until removed.
- **Mid-session**: `/plugin enable|disable <plugin>` (interactive only; not in `claude -p`) and `claude plugin enable|disable --scope …` from another terminal followed by `/reload-plugins` change the running session, but they write to a settings file, so they persist ([plugins/cli-reference: /plugin in a session, /reload-plugins](https://code.claude.com/docs/en/plugins/cli-reference#plugin-in-a-session)). `/reload-plugins` may refuse a change that alters MCP tools unless `--force`, because it invalidates the prompt cache ([plugins/cli-reference](https://code.claude.com/docs/en/plugins/cli-reference)).
- **Coarse switches**: `--safe-mode` disables all customizations, installed plugins included; `--setting-sources` limits which files load (`user`, `project`, `local`) ([`claude --help`](https://code.claude.com/docs/en/cli-reference)).
- **Per skill: not possible.** Skill frontmatter has `hooks`, `allowed-tools`, `disallowed-tools`, `disable-model-invocation`, `user-invocable`, `paths`, but no field that enables or disables a plugin; plugin skills are also unaffected by `skillOverrides` and are managed through `/plugin` ([skills](https://code.claude.com/docs/en/skills)). A skill's `disallowed-tools` can remove a plugin's MCP tools while it is active, but the plugin's skills and hooks stay loaded.

## Open points

- The docs don't list which events omit `permission_mode`; `PreToolUse` includes it. Confirm on this machine with a hook that logs its stdin before depending on it for other events.
