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

test('deletes only inside erp-app, branding and the temp folders', () => {
	expect(check('rm ~/x')).toMatch(/outside/);
	expect(check('rm -rf ../website-planning/x')).toMatch(/outside/);
	expect(check(`bash -c 'rm /etc/x'`)).toMatch(/outside/);
	expect(check('cd .. && rm -rf website-planning/x')).toMatch(/outside/);
	expect(check('find ~ -name x -delete')).toMatch(/outside/);
	expect(check('mv src/a.ts ~/Desktop/')).toMatch(/outside/);
	expect(check('rm src/x')).toBeNull();
	expect(check('rm -rf ../branding/y')).toBeNull();
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

test('branding commits locally, never pushes', () => {
	expect(check('cd ../branding && git push origin main')).toMatch(/commit there locally/);
	expect(check('git -C ../branding commit -m x')).toBeNull();
	expect(check('git push -u origin chore/533-afk-settings')).toBeNull();
});

test('erp-planning is read-only', () => {
	expect(check('/bin/rm -rf ../erp-planning')).toMatch(/read-only/);
	expect(check('find ../erp-planning -name x -delete')).toMatch(/read-only/);
	expect(check('mv ../erp-planning/a.md src/')).toMatch(/read-only/);
	expect(check('echo x > ../erp-planning/a.md')).toMatch(/read-only/);
	expect(check(`sed -i '' s/a/b/ ../erp-planning/a.md`)).toMatch(/read-only/);
	expect(check('cp src/a.ts ../erp-planning/')).toMatch(/read-only/);
	expect(check('git -C ../erp-planning commit -m x')).toMatch(/read-only/);
	expect(check('cd ../erp-planning && git push')).toMatch(/read-only/);
	expect(check('git -C ../erp-planning log --oneline')).toBeNull();
	expect(check('rg foo ../erp-planning && cat ../erp-planning/a.md')).toBeNull();
	expect(check('cp ../erp-planning/a.md docs/')).toBeNull();
	expect(checkFileTool(join(workspace, 'erp-planning', 'a.md'), roots)).toMatch(/read-only/);
	expect(checkFileTool(join(project, 'docs', 'a.md'), roots)).toBeNull();
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
	expect(check('cp /tmp/x.js .claude/hooks/guard.js')).toMatch(/safety rules/);
	expect(check('git checkout -- .claude/settings.json')).toMatch(/safety rules/);
	expect(check('cat .claude/settings.json | jq .')).toBeNull();
	expect(check('git add .claude/settings.json .claude/hooks/guard.js')).toBeNull();
	expect(check('cp .claude/settings.json /tmp/guard-temp/')).toBeNull();
	expect(checkFileTool('/x/erp-app/.claude/settings.json')).toMatch(/safety rules/);
	expect(checkFileTool('/x/erp-app/.claude/hooks/guard-rules.js')).toMatch(/safety rules/);
	expect(checkFileTool('/x/erp-app/src/a.ts')).toBeNull();
});

test('mentioning the safety rules is not writing them', () => {
	expect(
		check('gh issue comment 1 --body "see .claude/settings.json" > /dev/null 2>&1')
	).toBeNull();
	expect(check('git status --short .claude && echo done > /tmp/guard-temp/log')).toBeNull();
});

test("wrangler and the wipe script are the developer's, however they are run", () => {
	expect(check('wrangler d1 list')).toMatch(/wrangler/);
	expect(check('npx --yes wrangler d1 execute db --remote')).toMatch(/wrangler/);
	expect(check('npm exec -- wrangler deploy')).toMatch(/wrangler/);
	expect(check('npm exec wrangler@4 deploy')).toMatch(/wrangler/);
	expect(check('pnpm dlx wrangler deploy')).toMatch(/wrangler/);
	expect(check('./node_modules/.bin/wrangler deploy')).toMatch(/wrangler/);
	expect(check('node node_modules/wrangler/bin/wrangler.js deploy')).toMatch(/wrangler/);
	expect(check('env CI=1 npx wrangler deploy')).toMatch(/wrangler/);
	expect(check(`bash -c 'npx -y wrangler deploy'`)).toMatch(/wrangler/);
	expect(check('node ./scripts/wipe-d1-if-squashed.js --remote --yes')).toMatch(/wipe-d1/);
	expect(check('npm run typecheck')).toBeNull();
	expect(check('npx vitest run')).toBeNull();
	expect(check('rg wrangler src')).toBeNull();
});
