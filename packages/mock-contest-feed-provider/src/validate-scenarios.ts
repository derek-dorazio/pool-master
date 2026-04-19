import { resolve } from 'node:path';
import { ScenarioStore } from './scenario-store';

new ScenarioStore(resolve(process.cwd(), 'contest-feed-scenarios'));
console.log('scenario validation passed');
