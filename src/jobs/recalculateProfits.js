import dashboardService from '../services/dashboard.service.js';

async function run() {
  try {
    console.log('Starting profits recalculation...');
    const res = await dashboardService.recalculateProfits({ force: false });
    console.log(`Updated profits for ${res.updated} events`);
    process.exit(0);
  } catch (err) {
    console.error('Error recalculating profits', err);
    process.exit(1);
  }
}

if (require.main === module) run();

export default { run };
