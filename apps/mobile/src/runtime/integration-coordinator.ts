import type {
  IntegrationJobWakeupPort,
  IntegrationWorkerResult,
} from '@workspace/application';
import type { IntegrationJobChannel } from '@workspace/domain';

export type IntegrationWorker = Readonly<{
  processNext(channel: IntegrationJobChannel): Promise<IntegrationWorkerResult>;
}>;

export type IntegrationCoordinatorOptions = Readonly<{
  worker: IntegrationWorker;
  /** A corruption guard, not a background-daemon work budget. */
  maximumJobsPerChannelRun?: number;
  onResult?: (result: IntegrationWorkerResult) => void;
}>;

/**
 * Coalesces foreground wake signals and serially drains each integration
 * channel. It deliberately does nothing while inactive: durable SQLite jobs,
 * rather than a resident JavaScript daemon, remain the recovery source.
 */
export class ForegroundIntegrationCoordinator implements IntegrationJobWakeupPort {
  readonly #worker: IntegrationWorker;
  readonly #maximumJobsPerChannelRun: number;
  readonly #onResult: ((result: IntegrationWorkerResult) => void) | undefined;
  #active = false;
  #requested = false;
  #running: Promise<void> | null = null;

  constructor(options: IntegrationCoordinatorOptions) {
    this.#worker = options.worker;
    this.#maximumJobsPerChannelRun = options.maximumJobsPerChannelRun ?? 100;
    this.#onResult = options.onResult;
    if (
      !Number.isSafeInteger(this.#maximumJobsPerChannelRun) ||
      this.#maximumJobsPerChannelRun <= 0
    ) {
      throw new Error('maximumJobsPerChannelRun must be a positive integer.');
    }
  }

  setActive(active: boolean): Promise<void> {
    this.#active = active;
    return active ? this.wake() : (this.#running ?? Promise.resolve());
  }

  wake(): Promise<void> {
    if (!this.#active) return Promise.resolve();
    this.#requested = true;
    if (this.#running === null) {
      this.#running = this.#run().finally(() => {
        this.#running = null;
      });
    }
    return this.#running;
  }

  async #run(): Promise<void> {
    while (this.#active && this.#requested) {
      this.#requested = false;
      await Promise.all([
        this.#drainChannel('calendar'),
        this.#drainChannel('notification'),
      ]);
    }
  }

  async #drainChannel(channel: IntegrationJobChannel): Promise<void> {
    for (let index = 0; index < this.#maximumJobsPerChannelRun; index += 1) {
      if (!this.#active) return;
      const result = await this.#worker.processNext(channel);
      this.#onResult?.(result);
      if (
        result.status === 'pending' ||
        result.status === 'succeeded' ||
        result.status === 'superseded'
      ) {
        continue;
      }
      return;
    }
    throw new Error(
      `Integration channel ${channel} exceeded its foreground drain limit.`,
    );
  }
}
