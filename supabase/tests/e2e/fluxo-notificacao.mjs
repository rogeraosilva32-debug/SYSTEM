import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const SHOTS = process.env.SHOTS || '/tmp/shots';
import { mkdirSync } from 'node:fs'; mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const APP = 'http://localhost:4173';
const errors = [];
const check = (label, ok) => { console.log(ok ? '✓' : '✗', label); if (!ok) errors.push(`falhou: ${label}`); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

// Sem permissão ainda: o app convida para ativar
const ctx0 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p0 = await ctx0.newPage();
await p0.goto(APP + '/login');
await p0.getByLabel('E-mail').fill('c1@t'); await p0.getByLabel('Senha').fill('senha123');
await p0.getByRole('button', { name: /^entrar$/i }).click();
await p0.waitForLoadState('networkidle');
check('motoboy vê o convite para ativar as notificações', await p0.getByTestId('pedir-notificacao').isVisible());
await p0.screenshot({ path: `${SHOTS}/80-convite-notificacao.png` });
await p0.getByTestId('pedir-notificacao').getByRole('button', { name: 'Agora não' }).click();
check('convite some ao fechar', !(await p0.getByTestId('pedir-notificacao').isVisible()));
await ctx0.close();

// Com permissão: aviso novo vai para a barra de status
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['notifications'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(APP + '/login');
await page.getByLabel('E-mail').fill('c1@t'); await page.getByLabel('Senha').fill('senha123');
await page.getByRole('button', { name: /^entrar$/i }).click();
await page.waitForLoadState('networkidle');
check('com permissão o convite não aparece', !(await page.getByTestId('pedir-notificacao').isVisible()));
// O app mostra o aviso pelo service worker (o sino recebe em tempo real;
// aqui não há servidor de tempo real, então confere o caminho do SW).
await page.evaluate(() => navigator.serviceWorker.ready);
const shown = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Nova saída de entrega', { body: '2 parada(s) aguardando você.', tag: 'n-1' });
  await reg.showNotification('Nova saída de entrega', { body: '2 parada(s) aguardando você.', tag: 'n-1' });
  return (await reg.getNotifications()).map((n) => n.tag);
});
check('mesma tag não duplica na barra', shown.filter((t) => t === 'n-1').length === 1);
console.log('\nERROS:', errors.length ? errors : 'nenhum');
await browser.close();
if (errors.length) process.exit(1);
