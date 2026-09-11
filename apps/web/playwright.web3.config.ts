import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/wallet',workers:1,timeout:45_000,
  use:{baseURL:'http://127.0.0.1:3000',viewport:{width:390,height:844},channel:process.env.PLAYWRIGHT_CHROMIUM === '1' ? undefined:'msedge',trace:'retain-on-failure'},
  webServer:[
    {command:'npm run start -- --hostname 127.0.0.1',url:'http://127.0.0.1:3000',reuseExistingServer:false,timeout:60_000},
    {command:'npm run dev:local --workspace @everyday/api',url:'http://127.0.0.1:3001/health/live',reuseExistingServer:false,timeout:60_000},
  ],
});
