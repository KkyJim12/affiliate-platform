import { prepareDeployment } from './lib/referral-deployment.mjs';
try {
  const { plan } = prepareDeployment({ initialize: true });
  console.log('Compiled ReferralDistributor and AmoyTestUSDT. No transactions were broadcast.');
  console.log('Public deployment plan: .data/contracts/deployment-plan.json');
  console.log(`Quote authority address: ${plan.authority}`);
  if (plan.missing.length) console.log(`Set these .env fields before deployment: ${plan.missing.join(', ')}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
