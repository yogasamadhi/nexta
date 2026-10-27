import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

import { workspaceRoot } from './lib/runtime';

const packagesRoot = join(workspaceRoot, 'packages');
const purePackages = new Set([
  'agent-core',
  'agent-tools',
  'application',
  'domain',
  'scheduler-core',
  'user-model',
]);
const nodeBuiltins = new Set(
  builtinModules.flatMap((moduleName) => [
    moduleName,
    moduleName.replace(/^node:/, ''),
  ]),
);
const allowedPureRuntimeDependencies: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  'agent-core': new Set(),
  'agent-tools': new Set(['zod']),
  application: new Set(['zod']),
  domain: new Set(),
  'scheduler-core': new Set(),
  'user-model': new Set(),
};
const allowedWorkspaceDependencies: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  'agent-core': new Set(),
  'agent-tools': new Set(['agent-core', 'application', 'domain']),
  application: new Set(['domain', 'scheduler-core', 'user-model']),
  calendar: new Set(['application']),
  database: new Set(['application', 'domain']),
  domain: new Set(),
  'model-runtime': new Set(['agent-core']),
  notifications: new Set(['application']),
  'scheduler-core': new Set(),
  ui: new Set(['application', 'domain']),
  'user-model': new Set(['domain']),
};

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(path)));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

function packageNameForSpecifier(specifier: string): string {
  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }

  return specifier.split('/')[0] ?? specifier;
}

function isNodeRuntimeImport(specifier: string): boolean {
  const normalized = specifier.replace(/^node:/, '');
  return (
    specifier.startsWith('node:') ||
    nodeBuiltins.has(normalized) ||
    nodeBuiltins.has(normalized.split('/')[0] ?? normalized)
  );
}

function isForbiddenPureRuntimeImport(specifier: string): boolean {
  return (
    isNodeRuntimeImport(specifier) ||
    specifier === '@types/node' ||
    specifier === 'expo' ||
    specifier.startsWith('expo-') ||
    specifier.startsWith('@expo/') ||
    specifier === 'react' ||
    specifier.startsWith('react/') ||
    specifier === 'react-dom' ||
    specifier.startsWith('react-dom/') ||
    specifier === 'react-native' ||
    specifier.startsWith('react-native/') ||
    specifier.startsWith('react-native-')
  );
}

function isInside(directory: string, candidate: string): boolean {
  const pathFromDirectory = relative(directory, candidate);
  return (
    pathFromDirectory === '' ||
    (!pathFromDirectory.startsWith(`..${sep}`) &&
      pathFromDirectory !== '..' &&
      !isAbsolute(pathFromDirectory))
  );
}

function scriptKindForPath(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function collectModuleSpecifiers(path: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(path),
  );
  const specifiers = new Set<string>();

  const addSpecifier = (node: ts.Expression | undefined) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      addSpecifier(node.argument.literal);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addSpecifier(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      addSpecifier(node.arguments[0]);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [
    ...specifiers,
    ...sourceFile.typeReferenceDirectives.map(
      (directive) => `@types/${directive.fileName}`,
    ),
  ];
}

function collectForbiddenPlatformGlobals(
  path: string,
  source: string,
): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(path),
  );
  const forbiddenNames = new Set([
    'Buffer',
    'Deno',
    '__dirname',
    '__filename',
    'process',
  ]);
  const found = new Set<string>();

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && forbiddenNames.has(node.text)) {
      const parent = node.parent;
      const isNonComputedPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        ((ts.isPropertyAssignment(parent) ||
          ts.isPropertyDeclaration(parent) ||
          ts.isPropertySignature(parent) ||
          ts.isMethodDeclaration(parent) ||
          ts.isMethodSignature(parent)) &&
          parent.name === node);

      if (!isNonComputedPropertyName) found.add(node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...found];
}

function collectNonLiteralModuleLoads(path: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(path),
  );
  const found: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteralLike(argument)) {
        found.push(
          node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? 'import()'
            : 'require()',
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

const failures: string[] = [];
const guardFixture = `
  /// <reference types="node" />
  import 'node:fs';
  export type { Config } from 'expo/config';
  type NativeModule = typeof import('react-native');
  const moduleName = 'node:path';
  void import(moduleName);
`;
const fixtureImports = new Set(
  collectModuleSpecifiers('architecture-guard.fixture.ts', guardFixture),
);
for (const expectedImport of [
  '@types/node',
  'expo/config',
  'node:fs',
  'react-native',
]) {
  if (!fixtureImports.has(expectedImport)) {
    failures.push(
      `architecture guard self-check: failed to extract ${expectedImport}`,
    );
  }
}
if (
  collectNonLiteralModuleLoads('architecture-guard.fixture.ts', guardFixture)
    .length !== 1
) {
  failures.push(
    'architecture guard self-check: failed to reject non-literal import()',
  );
}
if (!isForbiddenPureRuntimeImport('fs/promises')) {
  failures.push(
    'architecture guard self-check: failed to classify a bare Node builtin',
  );
}
if (isInside('/workspace/packages/domain', '/workspace/packages/database')) {
  failures.push(
    'architecture guard self-check: failed to detect a package-boundary escape',
  );
}

const packageEntries = await readdir(packagesRoot, { withFileTypes: true });
const actualPackageNames = new Set(
  packageEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
const expectedPackageNames = new Set(Object.keys(allowedWorkspaceDependencies));

for (const expectedPackage of expectedPackageNames) {
  if (!actualPackageNames.has(expectedPackage)) {
    failures.push(`packages: missing required package ${expectedPackage}`);
  }
}
for (const actualPackage of actualPackageNames) {
  if (!expectedPackageNames.has(actualPackage)) {
    failures.push(
      `packages: unclassified package ${actualPackage}; define its dependency boundary first`,
    );
  }
}

for (const entry of packageEntries) {
  if (!entry.isDirectory()) continue;

  const packageName = entry.name;
  const packageRoot = join(packagesRoot, packageName);
  const manifest = JSON.parse(
    await readFile(join(packageRoot, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    name?: string;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
  const runtimeDependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };

  if (manifest.name !== `@workspace/${packageName}`) {
    failures.push(
      `${packageName}: expected neutral package name @workspace/${packageName}`,
    );
  }

  for (const dependency of Object.keys(dependencies)) {
    if (
      purePackages.has(packageName) &&
      isForbiddenPureRuntimeImport(dependency)
    ) {
      failures.push(
        `${packageName}: forbidden pure-package dependency ${dependency}`,
      );
    }

    if (dependency.startsWith('@workspace/')) {
      const dependencyName = dependency.slice('@workspace/'.length);
      const allowed = allowedWorkspaceDependencies[packageName];
      if (!allowed?.has(dependencyName)) {
        failures.push(
          `${packageName}: forbidden workspace dependency ${dependency}`,
        );
      }

      if (dependencies[dependency] !== 'workspace:*') {
        failures.push(
          `${packageName}: workspace dependency ${dependency} must use workspace:*`,
        );
      }
    }
  }

  if (purePackages.has(packageName)) {
    const allowedExternalDependencies =
      allowedPureRuntimeDependencies[packageName] ?? new Set<string>();

    for (const dependency of Object.keys(runtimeDependencies)) {
      if (dependency.startsWith('@workspace/')) continue;
      if (isForbiddenPureRuntimeImport(dependency)) continue;
      if (!allowedExternalDependencies.has(dependency)) {
        failures.push(
          `${packageName}: unreviewed pure-package runtime dependency ${dependency}`,
        );
      }
    }
  }

  const sourceFiles = await collectSourceFiles(join(packageRoot, 'src'));
  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, 'utf8');
    const parsedSource = ts.createSourceFile(
      sourceFile,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(sourceFile),
    );

    if (purePackages.has(packageName) && !/\.[cm]?ts$/.test(sourceFile)) {
      failures.push(
        `${relative(workspaceRoot, sourceFile)}: pure packages must use non-JSX TypeScript source files`,
      );
    }

    for (const moduleLoad of collectNonLiteralModuleLoads(sourceFile, source)) {
      failures.push(
        `${relative(workspaceRoot, sourceFile)}: ${moduleLoad} must use a string literal so dependencies remain auditable`,
      );
    }

    if (purePackages.has(packageName)) {
      for (const platformGlobal of collectForbiddenPlatformGlobals(
        sourceFile,
        source,
      )) {
        failures.push(
          `${relative(workspaceRoot, sourceFile)}: forbidden platform global ${platformGlobal}`,
        );
      }

      for (const reference of parsedSource.libReferenceDirectives) {
        failures.push(
          `${relative(workspaceRoot, sourceFile)}: triple-slash lib reference is not allowed in a pure package (${reference.fileName})`,
        );
      }
    }

    for (const reference of parsedSource.referencedFiles) {
      const resolvedReference = resolve(
        dirname(sourceFile),
        reference.fileName,
      );
      if (purePackages.has(packageName)) {
        failures.push(
          `${relative(workspaceRoot, sourceFile)}: triple-slash path reference is not allowed in a pure package (${reference.fileName})`,
        );
      } else if (!isInside(packageRoot, resolvedReference)) {
        failures.push(
          `${relative(workspaceRoot, sourceFile)}: triple-slash path reference escapes package boundary (${reference.fileName})`,
        );
      }
    }

    const imports = collectModuleSpecifiers(sourceFile, source);

    for (const imported of imports) {
      if (imported.startsWith('@/') || isAbsolute(imported)) {
        failures.push(
          `${relative(workspaceRoot, sourceFile)}: app/absolute aliases are forbidden from packages (${imported})`,
        );
        continue;
      }

      if (imported.startsWith('.')) {
        const resolvedImport = resolve(dirname(sourceFile), imported);
        if (!isInside(packageRoot, resolvedImport)) {
          failures.push(
            `${relative(workspaceRoot, sourceFile)}: relative import escapes package boundary (${imported})`,
          );
        }
        continue;
      }

      if (
        purePackages.has(packageName) &&
        isForbiddenPureRuntimeImport(imported)
      ) {
        failures.push(
          `${relative(workspaceRoot, sourceFile)}: forbidden pure-package import ${imported}`,
        );
        continue;
      }

      if (imported.startsWith('@workspace/')) {
        const dependencyName = imported
          .slice('@workspace/'.length)
          .split('/')[0];
        const allowed = allowedWorkspaceDependencies[packageName];
        if (!dependencyName || !allowed?.has(dependencyName)) {
          failures.push(
            `${relative(workspaceRoot, sourceFile)}: forbidden workspace import ${imported}`,
          );
        }

        if (
          !sourceFile.match(/\.test\.[cm]?[jt]sx?$/) &&
          !Object.hasOwn(runtimeDependencies, `@workspace/${dependencyName}`)
        ) {
          failures.push(
            `${relative(workspaceRoot, sourceFile)}: undeclared workspace runtime import ${imported}`,
          );
        }
      } else if (
        purePackages.has(packageName) &&
        !sourceFile.match(/\.test\.[cm]?[jt]sx?$/) &&
        !allowedPureRuntimeDependencies[packageName]?.has(
          packageNameForSpecifier(imported),
        )
      ) {
        failures.push(
          `${relative(workspaceRoot, sourceFile)}: unreviewed pure-package runtime import ${imported}`,
        );
      } else if (
        !sourceFile.match(/\.test\.[cm]?[jt]sx?$/) &&
        !Object.hasOwn(runtimeDependencies, packageNameForSpecifier(imported))
      ) {
        failures.push(
          `${relative(workspaceRoot, sourceFile)}: undeclared runtime import ${imported}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

const packageCount = packageEntries.filter((entry) =>
  entry.isDirectory(),
).length;
console.log(`Architecture boundaries passed for ${packageCount} packages.`);
