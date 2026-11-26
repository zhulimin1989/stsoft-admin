import {defineConfig} from '@playwright/test';
const root=process.env.EAC_BROWSER_FIXTURE_OUTPUT_ROOT;if(!root)throw Error('owned output root required');
export default defineConfig({testDir:'./e2e/enterprise-admin-owned',testMatch:['legacy.spec.ts'],timeout:30000,expect:{timeout:5000},workers:1,retries:0,outputDir:root+'/legacy-browser-results',reporter:[['list'],['json',{outputFile:root+'/legacy-browser-report.json'}]],use:{channel:'msedge',headless:true,screenshot:'only-on-failure',trace:'off'}});
