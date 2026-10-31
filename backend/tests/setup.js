const { newDb } = require('pg-mem');
const { initializeDatabase } = require('../src/db/initialize');

async function createTestPool() {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({
    name: 'current_database',
    implementation: () => 'careflow_test'
  });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await initializeDatabase(pool);
  return pool;
}

module.exports = { createTestPool };
