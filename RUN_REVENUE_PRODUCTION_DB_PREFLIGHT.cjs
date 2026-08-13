'use strict';

const { Client } = require('pg');
const { CONNECTION_ENV, CERT_ENV, PREFLIGHT_STEPS, buildSafeConnectDiagnostic, runProductionDbPreflight } = require('./engine/revenue-production-db-preflight.cjs');

function reportStep(step, status, error) {
  if (!PREFLIGHT_STEPS.includes(step) || !['PASS','FAIL'].includes(status)) return;
  if (step === 'CONNECT' && status === 'FAIL') {
    const diagnostic = buildSafeConnectDiagnostic(error);
    console.log(`CONNECT_ERROR_CODE: ${diagnostic.code}`);
    console.log(`CONNECT_ERROR_NAME: ${diagnostic.name}`);
    if (diagnostic.category) console.log(`CONNECT_ERROR_CATEGORY: ${diagnostic.category}`);
    return;
  }
  console.log(`STEP: ${step} ${status}`);
}

(async () => {
  const connectionString = process.env[CONNECTION_ENV];
  const caCertPath = process.env[CERT_ENV];
  try {
    await runProductionDbPreflight({ connectionString, caCertPath, Client, onStep: reportStep });
  } catch {
    process.exitCode = 1;
  }
})();
