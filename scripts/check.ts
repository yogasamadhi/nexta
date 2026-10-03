const checks = [
  'format:check',
  'lint',
  'typecheck',
  'test',
  'test:architecture',
  'test:integration',
  'docs:check',
  'release:check',
  'build:check',
] as const;

for (const check of checks) {
  console.log(`\n[check] ${check}`);
  const child = Bun.spawn(['bun', 'run', check], {
    stderr: 'inherit',
    stdout: 'inherit',
  });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    console.error(`[check] ${check} failed with exit code ${exitCode}`);
    process.exit(exitCode);
  }
}

console.log('\n[check] all repository checks passed');

export {};
