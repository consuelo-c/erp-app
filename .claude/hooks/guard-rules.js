// The rules behind guard.js, kept pure so they can be tested. Each check
// returns the reason a tool call is denied, or null when it may run.
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

const DELETE_VERBS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'trash']);
const WRAPPERS = new Set([
	'sudo',
	'command',
	'builtin',
	'exec',
	'nohup',
	'time',
	'nice',
	'env',
	'doas'
]);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const GUARDED_PATH = /\.claude\/(settings[^/\s'"]*\.json|hooks\/)/;
const WRITE_HINT =
	/(^|\s)(sed\s+-i|perl\s+-[a-z]*i|tee|mv|cp|rm|ln|chmod|truncate|install|dd)\b|>|git\s+(checkout|restore|reset|stash|apply|am)\b/;
const GH_BANNED = {
	'pr merge': "merging is the developer's.",
	'pr close': "closing a pull request is the developer's.",
	'issue delete': 'issues are closed, never deleted.',
	'issue transfer': "transferring an issue is the developer's.",
	'repo delete': '',
	'repo archive': '',
	'repo rename': '',
	'repo edit': '',
	'release delete': '',
	'label delete': '',
	'workflow disable': ''
};
const GH_FIELD_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);
const GH_VALUE_FLAGS = new Set([
	'-H',
	'--header',
	'-q',
	'--jq',
	'-t',
	'--template',
	'--cache',
	'--hostname',
	'-p'
]);

/** Resolves symlinks in the longest existing prefix of `path`; the rest is kept as written. */
export function realPath(path) {
	let head = path;
	let tail = '';
	while (head !== dirname(head)) {
		try {
			return join(realpathSync(head), tail);
		} catch {
			tail = join(basename(head), tail);
			head = dirname(head);
		}
	}
	return path;
}

/** The allowed roots for a session whose project is `projectDirectory`. */
export function rootsFor(projectDirectory, temporaryDirectories) {
	const workspace = dirname(projectDirectory);
	const repos = [
		projectDirectory,
		join(workspace, 'erp-planning'),
		join(workspace, 'branding')
	].map(realPath);
	return { repos, pushBlocked: repos.slice(1), temp: temporaryDirectories.map(realPath) };
}

const isInside = (path, root) => path.startsWith(root + sep);

function expandHome(path) {
	if ('~' === path) {
		return homedir();
	}
	return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

/** Denies Edit/Write on the files that hold the session's safety rules. */
export function checkFileTool(filePath) {
	if (/(^|\/)\.claude\/(settings[^/]*\.json|hooks\/)/.test(filePath)) {
		return `${filePath} holds the session's safety rules; the developer edits it by hand.`;
	}
	return null;
}

function readQuoted(text, start, quote) {
	let end = start + 1;
	let content = '';
	while (end < text.length && text[end] !== quote) {
		const escaped = '"' === quote && '\\' === text[end] && end + 1 < text.length;
		content += escaped ? text[++end] : text[end];
		end++;
	}
	return { content, end, dynamic: '"' === quote && /[$`]/.test(content) };
}

function operatorLength(text, index) {
	const char = text[index];
	if ('<' === char || '>' === char) {
		let end = index + 1;
		while ('>' === text[end] || '&' === text[end]) {
			end++;
		}
		return { kind: 'redirect', length: end - index };
	}
	if ('\n;|&()'.includes(char)) {
		const pair = text.slice(index, index + 2);
		return { kind: 'separator', length: ['&&', '||', ';;', '|&'].includes(pair) ? 2 : 1 };
	}
	return null;
}

const isDynamicStart = (text, index) =>
	'`' === text[index] || ('$' === text[index] && /[({A-Za-z_]/.test(text[index + 1] ?? ''));

/** Reads the token at `index` into `state` and returns the index of its last character. */
function readToken(text, index, state) {
	const operator = operatorLength(text, index);
	if (operator) {
		state.flush();
		state.tokens.push({ operator: operator.kind });
		return index + operator.length - 1;
	}
	if (/[ \t]/.test(text[index])) {
		state.flush();
		return index;
	}
	if ("'" === text[index] || '"' === text[index]) {
		const quoted = readQuoted(text, index, text[index]);
		state.append(quoted.content, quoted.dynamic);
		return quoted.end;
	}
	const escaped = '\\' === text[index] && index + 1 < text.length;
	const at = escaped ? index + 1 : index;
	state.append(text[at], !escaped && isDynamicStart(text, index));
	return at;
}

/** Splits a shell string into words and operators. Quotes are removed; `dynamic` marks a word built from $… or `…`. */
export function tokenize(text) {
	const state = { tokens: [], word: null };
	state.flush = () => {
		if (null !== state.word) {
			state.tokens.push(state.word);
		}
		state.word = null;
	};
	state.append = (content, dynamic) => {
		const { word } = state;
		state.word = { text: (word?.text ?? '') + content, dynamic: Boolean(word?.dynamic || dynamic) };
	};
	for (let i = 0; i < text.length; i++) {
		i = readToken(text, i, state);
	}
	state.flush();
	return state.tokens;
}

/** Splits a shell string into simple commands (arrays of words), dropping redirect targets. */
export function simpleCommands(text) {
	const commands = [[]];
	let skipNext = false;
	for (const token of tokenize(text)) {
		if ('separator' === token.operator) {
			commands.push([]);
		} else if ('redirect' === token.operator) {
			skipNext = true;
		} else if (skipNext) {
			skipNext = false;
		} else {
			commands.at(-1).push(token);
		}
	}
	return commands.filter((words) => words.length > 0);
}

/** Drops leading VAR=value assignments and wrapper commands such as sudo or env. */
function stripWrappers(words) {
	let rest = words;
	while (rest.length > 0) {
		const first = rest[0].text;
		if (/^[A-Za-z_]\w*=/.test(first)) {
			rest = rest.slice(1);
		} else if (WRAPPERS.has(basename(first))) {
			const flags = rest.slice(1).findIndex((word) => !word.text.startsWith('-'));
			rest = -1 === flags ? [] : rest.slice(1 + flags);
		} else {
			return rest;
		}
	}
	return rest;
}

function checkDeleteTarget(target, context, verb) {
	if (target.dynamic) {
		return `${verb} with a computed path (${target.text}) can't be checked; use a literal path.`;
	}
	let path = expandHome(target.text);
	const glob = path.search(/[*?[]/);
	if (glob >= 0) {
		path = path.slice(0, glob) || '.';
	}
	const absolute = realPath(resolve(context.directory, path));
	if (/(^|\/)\.git(\/|$)/.test(absolute)) {
		return `${verb} on a .git directory (${absolute}).`;
	}
	const { repos, temp } = context.roots;
	if ([...repos, ...temp].some((root) => isInside(absolute, root))) {
		return null;
	}
	return `${verb} outside erp-app, erp-planning, branding and the temp folders (${absolute}). Deleting there is the developer's.`;
}

const firstReason = (items, check) => items.map(check).find(Boolean) ?? null;

function operands(words) {
	const index = words.findIndex((word) => '--' === word.text);
	const flagged = -1 === index ? words : words.slice(0, index);
	const after = -1 === index ? [] : words.slice(index + 1);
	return [...flagged.filter((word) => !word.text.startsWith('-')), ...after];
}

function checkDelete(verb, words, context) {
	const targets = operands(words);
	if (0 === targets.length && 'rm' !== verb) {
		return `${verb} without a literal target.`;
	}
	return firstReason(targets, (target) => checkDeleteTarget(target, context, verb));
}

function checkFind(words, context) {
	const texts = words.map((word) => word.text);
	const execDeletes = texts.some(
		(text, i) =>
			['-exec', '-execdir', '-ok', '-okdir'].includes(text) &&
			['rm', 'rmdir', 'unlink', 'mv', 'shred'].includes(basename(texts[i + 1] ?? ''))
	);
	if (!texts.includes('-delete') && !execDeletes) {
		return null;
	}
	const firstExpression = words.findIndex((word) => /^[-(!]/.test(word.text));
	const starts = words.slice(0, -1 === firstExpression ? words.length : firstExpression);
	const targets = starts.length > 0 ? starts : [{ text: '.', dynamic: false }];
	return firstReason(targets, (target) => checkDeleteTarget(target, context, 'find -delete'));
}

function repositoryOf(directory, roots) {
	const absolute = realPath(directory);
	const longestFirst = [...roots.repos].sort((first, second) => second.length - first.length);
	return longestFirst.find((root) => absolute === root || isInside(absolute, root)) ?? null;
}

/** Reads git's global options (-C, -c…) and returns the directory it works in and the rest of the words. */
function gitTarget(words, directory) {
	let target = directory;
	let i = 0;
	while (i < words.length && words[i].text.startsWith('-')) {
		const flag = words[i].text;
		if ('-C' === flag) {
			target = resolve(target, expandHome(words[i + 1]?.text ?? '.'));
		}
		i += ['-C', '-c', '--git-dir', '--work-tree'].includes(flag) ? 2 : 1;
	}
	return { target, subcommand: words[i]?.text, rest: words.slice(i + 1).map((word) => word.text) };
}

function checkPush(target, rest, roots) {
	const repository = repositoryOf(target, roots);
	if (repository && roots.pushBlocked.includes(repository)) {
		return `git push in ${repository}: commit there locally and list the commit in the PR; the developer pushes it.`;
	}
	if (
		rest.some(
			(text) => '--delete' === text || '-d' === text || /^:[^/]/.test(text) || text.startsWith('+')
		)
	) {
		return 'git push that deletes or force-updates a remote branch.';
	}
	if (
		rest.some((text) => text.startsWith('--force') || /^-[a-z]*f/.test(text) || '--mirror' === text)
	) {
		return 'force push.';
	}
	return null;
}

function checkGit(words, context) {
	const { target, subcommand, rest } = gitTarget(words, context.directory);
	if ('push' === subcommand) {
		return checkPush(target, rest, context.roots);
	}
	if (['clean', 'rm'].includes(subcommand) && !repositoryOf(target, context.roots)) {
		return `git ${subcommand} outside the allowed repos (${target}).`;
	}
	return null;
}

const isFieldFlag = (text) =>
	GH_FIELD_FLAGS.has(text) ||
	/^(-f|-F)./.test(text) ||
	/^(--field|--raw-field|--input)=/.test(text);

/** Reads `-X PUT`, `-XPUT` or `--method=PUT` at `index`, or returns null. */
function readMethod(texts, index) {
	const text = texts[index];
	if ('-X' === text || '--method' === text) {
		return { value: (texts[index + 1] ?? '').toUpperCase(), used: 2 };
	}
	if (/^(-X|--method=)./.test(text)) {
		return { value: text.replace(/^(-X|--method=)/, '').toUpperCase(), used: 1 };
	}
	return null;
}

/** Reads the `gh api` argument at `index` into `request`; returns how many arguments it used. */
function readGhApiArgument(texts, index, request) {
	const text = texts[index];
	const method = readMethod(texts, index);
	if (method) {
		request.method = method.value;
		return method.used;
	}
	if (isFieldFlag(text)) {
		request.hasFields = true;
		return GH_FIELD_FLAGS.has(text) ? 2 : 1;
	}
	if (GH_VALUE_FLAGS.has(text)) {
		return 2;
	}
	if (!text.startsWith('-') && null === request.endpoint) {
		request.endpoint = text;
	}
	return 1;
}

/** Reads `gh api` arguments: the endpoint, the explicit method and whether fields are sent. */
function parseGhApi(texts) {
	const request = { endpoint: null, method: null, hasFields: false };
	for (let i = 0; i < texts.length; i += readGhApiArgument(texts, i, request)) {
		// The step reads the argument.
	}
	return request;
}

function checkGhApi(texts) {
	const request = parseGhApi(texts);
	if ('graphql' === request.endpoint) {
		return /\bmutation\b/i.test(texts.join(' '))
			? 'gh api graphql mutation: gh api is read-only here.'
			: null;
	}
	const method = request.method ?? (request.hasFields ? 'POST' : 'GET');
	if (['GET', 'HEAD'].includes(method)) {
		return null;
	}
	return `gh api ${method}: gh api is read-only here; use the gh issue/pr subcommands for writes.`;
}

function checkGh(words) {
	const [group, subcommand, ...rest] = words.map((word) => word.text);
	const key = `${group} ${subcommand}`;
	if (key in GH_BANNED) {
		return `gh ${key}: ${GH_BANNED[key] || "repository settings are the developer's."}`;
	}
	if (['secret', 'variable'].includes(group)) {
		return `gh ${group}: the developer's.`;
	}
	if (
		['issue', 'pr'].includes(group) &&
		'comment' === subcommand &&
		rest.includes('--delete-last')
	) {
		return 'deleting a comment: the record of a run stays.';
	}
	return 'api' === group ? checkGhApi(words.slice(1).map((word) => word.text)) : null;
}

function checkNestedShell(words, context) {
	const flag = words.findIndex((word) => /^-[a-z]*c$/.test(word.text));
	if (-1 === flag || !words[flag + 1]) {
		return null;
	}
	return checkBash(words[flag + 1].text, { ...context, depth: context.depth + 1 });
}

function checkMove(words, context) {
	return firstReason(operands(words), (target) => checkDeleteTarget(target, context, 'mv'));
}

const VERB_CHECKS = {
	find: checkFind,
	git: checkGit,
	gh: (words) => checkGh(words),
	mv: checkMove,
	eval: (words, context) =>
		checkBash(words.map((word) => word.text).join(' '), { ...context, depth: context.depth + 1 })
};

function changeDirectory(words, context) {
	if (words[0] && !words[0].dynamic) {
		context.directory = resolve(context.directory, expandHome(words[0].text));
	}
	return null;
}

const verbCheck = (verb) => {
	if (DELETE_VERBS.has(verb)) {
		return (words, context) => checkDelete(verb, words, context);
	}
	if (SHELLS.has(verb)) {
		return checkNestedShell;
	}
	return 'cd' === verb || 'pushd' === verb ? changeDirectory : VERB_CHECKS[verb];
};

/** Checks one simple command; `cd` updates the directory later commands run in. */
function checkSimpleCommand(words, context) {
	const [first, ...rest] = stripWrappers(words);
	if (!first) {
		return null;
	}
	return verbCheck(basename(first.text))?.(rest, context) ?? null;
}

/**
 * Checks a Bash command line. `context` is { directory, roots, depth }.
 * @returns {string | null} why the command is denied, or null
 */
export function checkBash(command, context) {
	if (context.depth > 4) {
		return 'nested shells too deep to check.';
	}
	if (GUARDED_PATH.test(command) && WRITE_HINT.test(command)) {
		return "changing .claude/settings*.json or .claude/hooks: the session's safety rules; the developer edits them by hand.";
	}
	if (/\bxargs\b[^|;&]*\b(rm|rmdir|unlink|mv|shred)\b/.test(command)) {
		return "a delete fed by xargs can't be checked; delete literal paths instead.";
	}
	const local = { ...context };
	return firstReason(simpleCommands(command), (words) => checkSimpleCommand(words, local));
}
