import { readdir, readFile, stat } from 'node:fs/promises';
import {
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path';

import { workspaceRoot } from './lib/runtime';

const ignoredDirectories = new Set([
  '.artifacts',
  '.expo',
  '.expo-export',
  '.git',
  'android',
  'coverage',
  'dist',
  'ios',
  'node_modules',
]);

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(path)));
    } else if (extname(entry.name) === '.md') {
      files.push(normalize(relative(workspaceRoot, path)));
    }
  }

  return files.sort();
}

function githubSlug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function anchorsFor(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const duplicateCounts = new Map<string, number>();

  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const heading = match[1];
    if (!heading) continue;
    const base = githubSlug(heading);
    const count = duplicateCounts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    duplicateCounts.set(base, count + 1);
  }

  for (const match of markdown.matchAll(
    /<a\s+(?:[^>]*?\s)?id=["']([^"']+)["'][^>]*>/gi,
  )) {
    const anchor = match[1];
    if (anchor) anchors.add(anchor);
  }

  return anchors;
}

function definedIds(markdown: string, pattern: RegExp): Set<string> {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(pattern)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return ids;
}

const markdownFiles = await collectMarkdownFiles(workspaceRoot);
const markdownByFile = new Map<string, string>();
const failures: string[] = [];

for (const file of markdownFiles) {
  const markdown = await readFile(join(workspaceRoot, file), 'utf8');
  markdownByFile.set(file, markdown);

  const fenceCount = Array.from(markdown.matchAll(/^```/gm)).length;
  if (fenceCount % 2 !== 0)
    failures.push(`${file}: unbalanced fenced code block`);
}

for (const [file, markdown] of markdownByFile) {
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget || /^(?:https?:|mailto:|app:|codex:)/.test(rawTarget))
      continue;

    const [rawPath, rawAnchor] = rawTarget.split('#', 2);
    const targetFile = rawPath
      ? normalize(
          relative(
            workspaceRoot,
            resolve(dirname(join(workspaceRoot, file)), decodeURI(rawPath)),
          ),
        )
      : file;
    const targetAbsolutePath = join(workspaceRoot, targetFile);

    try {
      const targetStat = await stat(targetAbsolutePath);
      if (!targetStat.isFile()) throw new Error('not a file');
    } catch {
      failures.push(`${file}: missing local link target ${rawTarget}`);
      continue;
    }

    if (rawAnchor && extname(targetFile) === '.md') {
      const targetMarkdown =
        markdownByFile.get(targetFile) ??
        (await readFile(targetAbsolutePath, 'utf8'));
      const anchor = decodeURIComponent(rawAnchor).toLocaleLowerCase();
      if (!anchorsFor(targetMarkdown).has(anchor)) {
        failures.push(`${file}: missing anchor #${rawAnchor} in ${targetFile}`);
      }
    }
  }
}

const manifest = markdownByFile.get('MANIFEST.md') ?? '';
const manifestFiles = definedIds(manifest, /^- `([^`]+\.md)`$/gm);
const documentedTotal = Number(manifest.match(/Total files:\s*(\d+)/)?.[1]);

if (documentedTotal !== markdownFiles.length) {
  failures.push(
    `MANIFEST.md: expected total ${markdownFiles.length}, found ${documentedTotal}`,
  );
}

for (const file of markdownFiles) {
  if (!manifestFiles.has(file)) failures.push(`MANIFEST.md: missing ${file}`);
}
for (const file of manifestFiles) {
  if (!markdownByFile.has(file))
    failures.push(`MANIFEST.md: lists unknown file ${file}`);
}

const requirements = markdownByFile.get('docs/02-REQUIREMENTS.md') ?? '';
const testing = markdownByFile.get('docs/08-TESTING-ACCEPTANCE.md') ?? '';
const plan = markdownByFile.get('.ai/PLAN.md') ?? '';
const status = markdownByFile.get('.ai/STATUS.md') ?? '';
const decisions = markdownByFile.get('docs/DECISIONS.md') ?? '';
const requirementIds = definedIds(requirements, /^##\s+(REQ-[A-Z]+-\d{3})\b/gm);
const acceptanceIds = definedIds(
  requirements,
  /\*\*Acceptance\s+—\s+(AC-[A-Z]+-\d{3})\*\*/g,
);
const matrixRequirements = definedIds(
  testing,
  /^\|\s*(REQ-[A-Z]+-\d{3})\s*\|/gm,
);
const matrixAcceptance = definedIds(
  testing,
  /^\|\s*REQ-[A-Z]+-\d{3}\s*\|[^\n]*?\|\s*(AC-[A-Z]+-\d{3})\s*\|/gm,
);
const caseIds = definedIds(testing, /^\|\s*(CASE-[A-Z]+-\d{2})\s*\|/gm);
const e2eIds = definedIds(testing, /^###\s+(E2E-\d{3})\b/gm);
const decisionIds = definedIds(
  decisions,
  /<a id="dec-\d{3}"><\/a>(DEC-\d{3})/g,
);

if (plan.includes('Phase 0 工程基线已建立')) {
  const stalePhaseZeroClaims = [
    '工程尚未初始化',
    '当前只有 Markdown 文档',
    '不存在 package manifest',
    '本地目录尚未初始化 Git',
  ];

  for (const claim of stalePhaseZeroClaims) {
    if (status.includes(claim)) {
      failures.push(
        `.ai/STATUS.md: stale Phase 0 claim conflicts with .ai/PLAN.md (${claim})`,
      );
    }
  }

  for (const evidence of ['pnpm run check', 'iOS', 'Android']) {
    if (!status.includes(evidence)) {
      failures.push(
        `.ai/STATUS.md: Phase 0 completion evidence is missing ${evidence}`,
      );
    }
  }
}

if (/DEC-004\s*\|\s*Closed/.test(decisions)) {
  for (const evidence of ['DEC-004', 'expo-doctor']) {
    if (!status.includes(evidence)) {
      failures.push(
        `.ai/STATUS.md: closed DEC-004 evidence is missing ${evidence}`,
      );
    }
  }
}

for (const requirement of requirementIds) {
  if (!matrixRequirements.has(requirement))
    failures.push(`Testing matrix: missing ${requirement}`);
  if (!plan.includes(requirement))
    failures.push(`.ai/PLAN.md: missing ${requirement}`);
}
for (const acceptance of acceptanceIds) {
  if (!matrixAcceptance.has(acceptance))
    failures.push(`Testing matrix: missing ${acceptance}`);
}

if (requirementIds.size !== 26 || acceptanceIds.size !== 26) {
  failures.push(
    `Requirements coverage: expected 26 REQ and 26 AC, found ${requirementIds.size} REQ and ${acceptanceIds.size} AC`,
  );
}
if (caseIds.size !== 29 || e2eIds.size !== 5 || decisionIds.size !== 14) {
  failures.push(
    `Reference definitions: expected 29 CASE, 5 E2E and 14 DEC; found ${caseIds.size} CASE, ${e2eIds.size} E2E and ${decisionIds.size} DEC`,
  );
}

const knownIds: Readonly<Record<string, ReadonlySet<string>>> = {
  AC: acceptanceIds,
  CASE: caseIds,
  DEC: decisionIds,
  E2E: e2eIds,
  REQ: requirementIds,
};

for (const [file, markdown] of markdownByFile) {
  for (const match of markdown.matchAll(
    /\b(REQ|AC|CASE|DEC|E2E)-[A-Z0-9]+(?:-[0-9]{2,3})?\b/g,
  )) {
    const id = match[0];
    const prefix = match[1];
    if (prefix && !knownIds[prefix]?.has(id))
      failures.push(`${file}: unknown reference ${id}`);
  }
}

const adrIndex = markdownByFile.get('docs/ADR/README.md') ?? '';
const adrFiles = markdownFiles.filter((file) =>
  /^docs\/ADR\/\d{4}-.+\.md$/.test(file),
);
for (const adrFile of adrFiles) {
  const basename = adrFile.slice('docs/ADR/'.length);
  if (!adrIndex.includes(`](${basename})`)) {
    failures.push(`docs/ADR/README.md: missing ${basename}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Docs passed: ${markdownFiles.length} files, ${requirementIds.size} requirements, ${acceptanceIds.size} acceptance groups, ${caseIds.size} cases, ${e2eIds.size} E2E journeys.`,
);
