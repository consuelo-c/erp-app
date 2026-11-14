import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { checkBash, checkFileTool, rootsFor } from './guard-rules.js';

// A fake workspace with the three repos side by side, plus one that is not allowed.
const workspace = mkdtempSync(join(tmpdir(), 'guard-'));
for (const repository of ['erp-app', 'erp-planning', 'branding', 'website-planning']) {
	mkdirSync(join(workspace, repository, 'src'), { recursive: true });
}
const project = join(workspace, 'erp-app');
const roots = rootsFor(project, ['/tmp/guard-temp']);
const check = (command) => checkBash(command, { directory: project, roots, depth: 0 });

test('gh api only reads', () => {
	expect(check('gh api -X PUT repos/consuelo-c/erp-app/pulls/1/merge')).toMatch(/read-only/);
	expect(
		check(`gh api graphql -f query='mutation { deleteIssue(input:{}) { clientMutationId } }'`)
	).toMatch(/mutation/);
	expect(check('gh api repos/x/y/issues/1/comments -f body=hi')).toMatch(/POST/);
	expect(check('gh api repos/x/y/issues/1/sub_issues --jq ".[]"')).toBeNull();
	expect(check(`gh api graphql -f query='query { viewer { login } }'`)).toBeNull();
	expect(check('gh api -X GET search/issues -f q=x')).toBeNull();
});

test('deletes only inside the three repos and the temp folders', () => {
	expect(check('rm ~/x')).toMatch(/outside/);
	expect(check('rm -rf ../website-planning/x')).toMatch(/outside/);
	expect(check(`bash -c 'rm /etc/x'`)).toMatch(/outside/);
	expect(check('/bin/rm -rf ../erp-planning')).toMatch(/outside/);
	expect(check('cd .. && rm -rf website-planning/x')).toMatch(/outside/);
	expect(check('find ~ -name x -delete')).toMatch(/outside/);
	expect(check('mv src/a.ts ~/Desktop/')).toMatch(/outside/);
	expect(check('rm src/x')).toBeNull();
	expect(check('rm -rf ../erp-planning/x ../branding/y')).toBeNull();
	expect(check('rm -f /tmp/guard-temp/x')).toBeNull();
	expect(check('find src -name "*.orig" -delete')).toBeNull();
	expect(check('mv src/a.ts src/b.ts')).toBeNull();
});

test('deletes it cannot resolve are denied', () => {
	expect(check('rm -rf $HOME/x')).toMatch(/computed/);
	expect(check('rm "$(pwd)/x"')).toMatch(/computed/);
	expect(check('ls | xargs rm')).toMatch(/xargs/);
	expect(check('rm -rf .git')).toMatch(/\.git/);
});

test('erp-planning and branding commit locally, never push', () => {
	expect(check('git -C ../erp-planning push')).toMatch(/commit there locally/);
	expect(check('cd ../branding && git push origin main')).toMatch(/commit there locally/);
	expect(check('git -C ../erp-planning commit -m x')).toBeNull();
	expect(check('git push -u origin chore/533-afk-settings')).toBeNull();
});

test('no deleting or force-updating remote branches', () => {
	expect(check('git push origin --delete feat/x')).toMatch(/deletes/);
	expect(check('git push origin :feat/x')).toMatch(/deletes/);
	expect(check('git push --force-with-lease')).toMatch(/force/);
});

test('issues close but are never deleted; merging is the developer’s', () => {
	expect(check('gh issue close 12 --repo consuelo-c/erp-app')).toBeNull();
	expect(check('gh issue delete 12')).toMatch(/never deleted/);
	expect(check('gh pr merge 12 --squash')).toMatch(/merging/);
	expect(check('gh pr close 12')).toMatch(/closing/);
	expect(check('gh issue comment 3 --delete-last')).toMatch(/comment/);
	expect(check('gh repo delete consuelo-c/erp-app')).toMatch(/developer/);
	expect(check('gh secret list')).toMatch(/developer/);
	expect(check('npm run test && npm run lint')).toBeNull();
});

test('the safety rules themselves are the developer’s', () => {
	expect(check(`sed -i '' s/x/y/ .claude/settings.json`)).toMatch(/safety rules/);
	expect(check('echo {} > .claude/hooks/guard.js')).toMatch(/safety rules/);
	expect(check('cat .claude/settings.json | jq .')).toBeNull();
	expect(check('git add .claude/settings.json .claude/hooks/guard.js')).toBeNull();
	expect(checkFileTool('/x/erp-app/.claude/settings.json')).toMatch(/safety rules/);
	expect(checkFileTool('/x/erp-app/.claude/hooks/guard-rules.js')).toMatch(/safety rules/);
	expect(checkFileTool('/x/erp-app/src/a.ts')).toBeNull();
});
