const projects = ['tsconfig.json', 'tsconfig.pure.json'] as const;

for (const project of projects) {
  console.log(`[typecheck] ${project}`);
  const child = Bun.spawn(
    ['tsc', '--noEmit', '--project', project, '--pretty', 'false'],
    {
      stderr: 'inherit',
      stdout: 'inherit',
    },
  );
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    console.error(`[typecheck] ${project} failed with exit code ${exitCode}`);
    process.exit(exitCode);
  }
}

console.log('[typecheck] application and pure-package configs passed');

export {};
