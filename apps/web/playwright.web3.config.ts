import { defineConfig } from '@playwright/test';
const webPort = 13_100;
const apiPort = 13_101;
const webUrl = `http://127.0.0.1:${webPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir:'./tests/wallet',workers:1,timeout:45_000,
  use:{baseURL:webUrl,viewport:{width:390,height:844},channel:process.env.PLAYWRIGHT_CHROMIUM === '1' ? undefined:'msedge',trace:'retain-on-failure'},
  webServer:[
    {command:`npm run dev -- --port ${webPort}`,url:webUrl,reuseExistingServer:false,timeout:60_000,
      env:{NEXT_PUBLIC_API_BASE:apiUrl}},
    {command:'npm run dev:local --workspace @everyday/api',url:`${apiUrl}/health/live`,reuseExistingServer:false,timeout:60_000,
      env:{PORT:String(apiPort),WEB_ORIGINS:webUrl,API_AUDIENCE:apiUrl}},
  ],
});
