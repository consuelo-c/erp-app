#!/usr/bin/env node
// PreToolUse guard for unattended (auto mode) sessions: denies what the
// classifier must never decide (the rules are in guard-rules.js). Reads the
// hook JSON on stdin; exit 2 with the reason on stderr denies the call.
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { checkBash, checkFileTool, rootsFor } from './guard-rules.js';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const project = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const roots = rootsFor(project, [
	tmpdir(),
	'/tmp',
	'/private/tmp',
	'/private/var/folders',
	'/var/folders'
]);

const reason =
	'Bash' === input.tool_name
		? checkBash(String(input.tool_input?.command ?? ''), {
				directory: input.cwd || project,
				roots,
				depth: 0
			})
		: checkFileTool(input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '', roots);

if (reason) {
	process.stderr.write(`Blocked by .claude/hooks/guard.js: ${reason}`);
	process.exit(2);
}
