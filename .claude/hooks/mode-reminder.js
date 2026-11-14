#!/usr/bin/env node
// SessionStart: remind the developer to restart in auto mode. Project settings
// can't turn auto mode on; only the launch flag (or Shift+Tab) can.
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
if ('auto' === input.permission_mode) {
	process.exit(0);
}

const known = 'string' === typeof input.permission_mode;
const message = known
	? `This session is in ${input.permission_mode} mode. For unattended work, restart with: claude --permission-mode auto`
	: 'Unattended work runs in auto mode. If this session is not in it, restart with: claude --permission-mode auto';
process.stdout.write(
	JSON.stringify({
		systemMessage: message,
		hookSpecificOutput: {
			hookEventName: 'SessionStart',
			additionalContext: `${message}. If the developer asks for an unattended run (e.g. /build-phase) outside auto mode, remind them of this once before starting.`
		}
	})
);
