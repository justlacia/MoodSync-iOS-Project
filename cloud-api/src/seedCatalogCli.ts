import { getPool, initDatabase } from './db';
import { seedFullCloudCatalog } from './musicCatalog';

async function main() {
  await initDatabase();
  console.log('Seeding full cloud music catalog into Azure PostgreSQL...');
  const res = await seedFullCloudCatalog(20);
  console.log(`Done! Upserted=${res.totalFetched}, Total catalog tracks=${res.totalCatalog}`);
  await getPool().end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
