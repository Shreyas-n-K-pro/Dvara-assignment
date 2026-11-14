import cron, { ScheduledTask } from 'node-cron';
import { accrualService } from './accrual.service';
import { AccrualJobSummary, SchedulerStatus } from './types';
import { logger } from '../../utils/logger';

export class AccrualScheduler {
  private scheduledTask: ScheduledTask | null = null;
  private isRunning: boolean = false;
  private isJobExecuting: boolean = false;
  private cronExpression: string = '0 0 * * *'; // Daily at midnight (00:00 UTC)
  private lastRunAt: Date | null = null;
  private lastSummary: AccrualJobSummary | null = null;

  /**
   * Starts the background cron job scheduler.
   */
  start(expression: string = '0 0 * * *'): void {
    if (this.isRunning) {
      logger.warn('Accrual scheduler is already running');
      return;
    }

    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression: ${expression}`);
    }

    this.cronExpression = expression;
    this.scheduledTask = cron.schedule(
      this.cronExpression,
      async () => {
        logger.info('Accrual scheduler triggered by cron schedule', {
          cronExpression: this.cronExpression,
          timestamp: new Date().toISOString(),
        });

        try {
          await this.executeJob();
        } catch (error) {
          logger.error('Error in scheduled accrual execution', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      {
        timezone: 'UTC',
      }
    );

    this.isRunning = true;
    logger.info('Accrual scheduler started successfully', {
      cronExpression: this.cronExpression,
      timezone: 'UTC',
    });
  }

  /**
   * Stops the background cron job scheduler.
   */
  stop(): void {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }
    this.isRunning = false;
    logger.info('Accrual scheduler stopped');
  }

  /**
   * Executes the accrual job with mutex concurrency protection.
   * Prevents overlapping executions under repeated trigger or restart.
   */
  async executeJob(
    asOfDate?: Date,
    triggeredById?: string
  ): Promise<AccrualJobSummary> {
    if (this.isJobExecuting) {
      logger.warn('Accrual job execution skipped: previous run is still in progress');
      throw new Error('Accrual job execution is already in progress');
    }

    this.isJobExecuting = true;
    try {
      const summary = await accrualService.processOverdueAccruals(
        { asOfDate },
        triggeredById,
        'scheduler'
      );

      this.lastRunAt = new Date();
      this.lastSummary = summary;
      return summary;
    } finally {
      this.isJobExecuting = false;
    }
  }

  /**
   * Returns current scheduler health and execution telemetry.
   */
  getStatus(): SchedulerStatus {
    return {
      isRunning: this.isRunning,
      isJobExecuting: this.isJobExecuting,
      cronExpression: this.cronExpression,
      lastRunAt: this.lastRunAt,
      lastSummary: this.lastSummary,
    };
  }
}

export const accrualScheduler = new AccrualScheduler();
