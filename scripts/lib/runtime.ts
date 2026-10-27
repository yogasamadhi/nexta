import { spawn, type SpawnOptions } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** scripts/lib/ 目录。 */
const libDir = dirname(fileURLToPath(import.meta.url));

/** scripts/ 目录（所有仓库脚本的公共父目录）。 */
export const scriptsDir = resolve(libDir, '..');

/** 仓库根目录。 */
export const workspaceRoot = resolve(scriptsDir, '..');

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** 直接把子进程输出转发到当前终端。 */
  inherit?: boolean;
  /** 超时后终止子进程。 */
  timeoutMs?: number;
}

/**
 * 运行一个子进程并收集其输出。
 * 退出码非 0 时由调用方决定如何处理。
 */
export async function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd ?? workspaceRoot,
    env: options.env ?? process.env,
    stdio: options.inherit
      ? ['ignore', 'inherit', 'inherit']
      : ['ignore', 'pipe', 'pipe'],
  };
  const child = spawn(command, args, spawnOptions);
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const timer = options.timeoutMs
    ? setTimeout(() => child.kill(), options.timeoutMs)
    : undefined;
  try {
    const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('close', (code, signal) => {
        resolveExit(code ?? (signal ? 1 : 0));
      });
    });
    return { exitCode, stdout, stderr };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 运行一个子进程并把输出转发到当前终端，只返回退出码。 */
export async function runInherit(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<number> {
  const result = await run(command, args, { ...options, inherit: true });
  return result.exitCode;
}

/** 等待指定毫秒。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
