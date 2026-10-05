import { createNeonDatabase } from '../db/neon.js';
import { DatasetProjectionService } from './datasetProjectionService.js';
import { PostgresDatasetReadRepository } from './postgresDatasetReadRepository.js';
import { PostgresAnalyticsContextRepository } from './analyticsContext.js';

export function datasetReadMode(): 'disabled' | 'public' {
  return process.env.REAL_DATASET_READ_MODE === 'public' ? 'public' : 'disabled';
}

let singleton: DatasetProjectionService | undefined;
let contextSingleton: PostgresAnalyticsContextRepository | undefined;

/** DATA-03B.2A aggregate population/evidence facts for view=analytics. */
export function createAnalyticsContextRepository(): PostgresAnalyticsContextRepository {
  if (datasetReadMode() !== 'public') throw new Error('Dataset read mode is disabled.');
  if (contextSingleton) return contextSingleton;
  const database = createNeonDatabase();
  if (!database) throw new Error('Dataset database is unavailable.');
  contextSingleton = new PostgresAnalyticsContextRepository(database);
  return contextSingleton;
}

export function createDatasetProjectionService(): DatasetProjectionService {
  if (datasetReadMode() !== 'public') throw new Error('Dataset read mode is disabled.');
  if (singleton) return singleton;
  const database = createNeonDatabase();
  if (!database) throw new Error('Dataset database is unavailable.');
  singleton = new DatasetProjectionService(new PostgresDatasetReadRepository(database));
  return singleton;
}
