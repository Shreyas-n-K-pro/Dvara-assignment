import app from './app';
import { config, validateConfig } from './config';
import prisma from './config/database';
import { logger } from './utils';

async function main(): Promise<void> {
  // Validate environment variables
  validateConfig();

  // Test database connection
  try {
    await prisma.$connect();
    logger.info('Database connection established');
  } catch (error) {
    logger.error('Failed to connect to database', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  // Start server
  const server = app.listen(config.port, () => {
    logger.info(`Server running on port ${config.port}`, {
      environment: config.nodeEnv,
    });
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    server.close(async () => {
      await prisma.$disconnect();
      logger.info('Server shut down gracefully');
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('Failed to start server', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
