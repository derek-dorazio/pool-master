import { resolve } from 'node:path';
import { buildApp } from './app';
import { ScenarioStore } from './scenario-store';

async function main(): Promise<void> {
  const app = buildApp();

  try {
    new ScenarioStore(resolve(process.cwd(), 'contest-feed-scenarios'), app.log);
    app.log.info({ action: 'mockScenarioValidation.success' }, 'Scenario validation passed');
  } finally {
    await app.close();
  }
}

void main();
