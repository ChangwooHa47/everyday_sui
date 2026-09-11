import { test,expect } from '@playwright/test';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

test('default product is Web3, signs real login messages, isolates wallet changes and makes no Spring requests',async ({page},testInfo) => {
  const keys = [new Ed25519Keypair(),new Ed25519Keypair()];
  const legacyRequests: string[] = [];
  page.on('request',r => {if(r.url().includes(':18080') || r.url().includes('/api/auth/')) legacyRequests.push(r.url());});
  await page.exposeFunction('testSign',async (message:number[],address:string) => {
    const key = keys.find(k => k.toSuiAddress() === address)!;
    return key.signPersonalMessage(Uint8Array.from(message));
  });
  await page.addInitScript((accounts) => {
    const listeners = new Set<(value:unknown) => void>();
    let active = 0;
    const walletAccounts = accounts.map(a => ({...a,publicKey:Uint8Array.from(a.publicKey),chains:['sui:testnet'],features:['sui:signPersonalMessage','sui:signTransaction']}));
    const wallet = {
      version:'1.0.0',name:'Everyday Test Wallet',icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',chains:['sui:testnet'],
      get accounts() {return [walletAccounts[active]];},
      features:{
        'standard:connect':{version:'1.0.0',connect:async () => ({accounts:[walletAccounts[active]]})},
        'standard:disconnect':{version:'1.0.0',disconnect:async () => {listeners.forEach(fn => fn({accounts:[]}));}},
        'standard:events':{version:'1.0.0',on:(_event:string,fn:(value:unknown) => void) => {listeners.add(fn);return () => listeners.delete(fn);}},
        'sui:signPersonalMessage':{version:'1.0.0',signPersonalMessage:async ({message,account}:{message:Uint8Array;account:{address:string}}) => {
          return (window as unknown as {testSign:(m:number[],a:string)=>Promise<unknown>}).testSign(Array.from(message),account.address);
        }},
        'sui:signTransaction':{version:'2.0.0',signTransaction:async () => {throw Error('No transaction signing in this browser test');}},
      },
    };
    const register = (api:{register:(wallet:unknown)=>void}) => api.register(wallet);
    window.addEventListener('wallet-standard:app-ready',((event:CustomEvent) => register(event.detail)) as EventListener);
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet',{detail:register}));
    (window as unknown as {switchTestWallet:()=>void}).switchTestWallet = () => {active=1;listeners.forEach(fn => fn({accounts:[walletAccounts[1]]}));};
  },keys.map(k => ({address:k.toSuiAddress(),publicKey:Array.from(k.getPublicKey().toRawBytes())})));
  await page.goto('/');
  await expect(page.getByText('우리의 이야기를')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('web3-welcome.png'),fullPage:true});
  await page.getByRole('button',{name:'Connect Wallet'}).first().click();
  await page.getByRole('dialog').getByText('Everyday Test Wallet',{exact:true}).click();
  await expect(page.getByRole('button',{name:'AI 로그인',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'AI 로그인',exact:true}).click();
  await expect(page.getByRole('button',{name:'AI 로그인됨'})).toBeVisible();
  await page.getByLabel('공개 이름',{exact:true}).fill('지갑 A의 초안');
  await page.getByRole('button',{name:'자산 새로고침'}).click();
  await expect(page.locator('.w3-error')).toContainText('패키지를 먼저 배포');
  await page.screenshot({path:testInfo.outputPath('web3-wallet.png'),fullPage:true});
  await page.evaluate(() => (window as unknown as {switchTestWallet:()=>void}).switchTestWallet());
  await expect(page.getByRole('button',{name:'AI 로그인',exact:true})).toBeVisible();
  await expect(page.getByLabel('공개 이름',{exact:true})).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('everyday.v2.jwt'))).toBeNull();
  await page.goto('/chat');
  await expect(page.getByRole('heading',{name:'everyday · Sui'})).toBeVisible();
  expect(legacyRequests).toEqual([]);
});
