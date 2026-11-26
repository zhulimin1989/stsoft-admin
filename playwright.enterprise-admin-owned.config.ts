import { defineConfig } from '@playwright/test';
const output=process.env.EAC_BROWSER_FIXTURE_OUTPUT_ROOT;
if(!output)throw Error('owned fixture root required');
export default defineConfig({testDir:'./e2e/enterprise-admin-owned',testMatch:['creation.spec.ts','records.spec.ts','formal.spec.ts'],timeout:30000,expect:{timeout:5000},workers:1,retries:0,
  outputDir:output+'/browser-results',reporter:[['list'],['json',{outputFile:output+'/browser-report.json'}]],
  use:{baseURL:process.env.ADMIN_BASE_URL,channel:'msedge',headless:true,screenshot:'only-on-failure',trace:'off'},
});
