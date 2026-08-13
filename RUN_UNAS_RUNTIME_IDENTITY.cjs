'use strict';
const {runUnasPermissionPreflight}=require('./engine/unas-permission-preflight.cjs');
async function main(){try{const result=await runUnasPermissionPreflight({unasConfigured:Boolean(String(process.env.UNAS_API_KEY||'').trim())});console.log(`UNAS_SHOP_ID: ${result.shopId}`);console.log(`UNAS_SUBSCRIPTION: ${result.subscription}`);console.log(`GET_ORDER_PERMISSION: ${result.getOrderAllowed?'YES':'NO'}`);}catch{console.log('UNAS_SHOP_ID: UNKNOWN');console.log('UNAS_SUBSCRIPTION: UNKNOWN');console.log('GET_ORDER_PERMISSION: NO');process.exitCode=1;}}
if(require.main===module)main();
module.exports={main};
