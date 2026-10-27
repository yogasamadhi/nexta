import { runInherit } from './lib/runtime';

const checks = [
  'format:check',
  'lint',
  'typecheck',
  'test',
  'test:architecture',
  'test:integration',
  'docs:check',
  'release:check',
  'server:check',
  'build:check',
] as const;

for (const check of checks) {
  console.log(`\n[check] ${check}`);
  const exitCode = await runInherit('pnpm', ['run', check]);

  if (exitCode !== 0) {
    console.error(`[check] ${check} failed with exit code ${exitCode}`);
    process.exit(exitCode);
  }
}

console.log('\n[check] all repository checks passed');

export {};
