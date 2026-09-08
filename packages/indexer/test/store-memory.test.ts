import { MemoryEventStore } from '../src/store-memory.js';
import { runStoreConformance } from './store-conformance.js';

runStoreConformance('MemoryEventStore', async () => new MemoryEventStore());
