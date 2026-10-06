// Teste no navegador: plataforma libera recursos; admin envia a marca
// (com validação de formato e medida); app passa a mostrar a marca.
// Rodar depois de setup.sh e do preview (veja README.md). Imagens de teste
// em $IMGS: logo.png (600x200), icone.jpg (512x512), quadrado-pequeno.png (300x300).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS || '/tmp/shots'; mkdirSync(SHOTS, { recursive: true });
const IMGS = process.env.IMGS || '/tmp/imgs';
const APP = 'http://localhost:4173';
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const log = (...a) => console.log('•', ...a);
const errors = [];
const expand = async (p, title) => {
  const h = p.locator('[role=button][aria-expanded]').filter({ hasText: new RegExp('^' + title) }).first();
  await h.waitFor();
  if ((await h.getAttribute('aria-expanded')) === 'false') await h.click();
  await p.waitForTimeout(300);
};

async function login(page, email) {
  await page.goto(APP + '/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha123');
  await page.getByRole('button', { name: /^entrar$/i }).click();
  await page.waitForLoadState('networkidle');
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/tile\.openstreetmap\.org|nominatim|osrm/, (r) => r.fulfill({ status: 200, body: '' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

// Plataforma
await login(page, 'p@t');
log('plataforma em', page.url().replace(APP, ''));
await page.getByText('Empresa A').first().click();
await expand(page, 'Recursos liberados');
await page.getByText('Marca própria', { exact: true }).locator('xpath=../..').locator('input[type=checkbox]').click();
await page.getByText('Código de finalização de entrega', { exact: true }).locator('xpath=../..').locator('input[type=checkbox]').click();
await page.waitForTimeout(700);
log('liberações no banco:', sql(`select 'marca='||feature_branding||' codigo='||feature_delivery_code from companies where name='Empresa A'`));
await page.screenshot({ path: `${SHOTS}/11-plataforma-liberacoes.png` });
await page.context().clearCookies(); await page.evaluate(() => localStorage.clear());

// Admin da empresa
await login(page, 'a1@t');
await page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Marca', exact: true }).click();
await page.getByText('Logo horizontal').waitFor();
const slot = (title) => page.getByText(title, { exact: true }).locator('xpath=..');
// formato errado no ícone (JPG onde só aceita PNG)
await slot('Ícone (quadrado)').locator('input[type=file]').setInputFiles(`${IMGS}/icone.jpg`);
log('ícone JPG:', await slot('Ícone (quadrado)').getByRole('alert').innerText());
// medida fora no logo (300x300 em vez de 600x200) só avisa
await slot('Logo horizontal').locator('input[type=file]').setInputFiles(`${IMGS}/quadrado-pequeno.png`);
log('logo 300x300:', await slot('Logo horizontal').getByRole('alert').innerText());
// medida certa
await slot('Logo horizontal').locator('input[type=file]').setInputFiles(`${IMGS}/logo.png`);
await slot('Logo horizontal').getByText(/Medida ok/).waitFor();
log('logo 600x200:', await slot('Logo horizontal').getByRole('alert').innerText());
await slot('Logo horizontal').getByRole('button', { name: 'Salvar' }).click();
await page.waitForTimeout(1000);
log('logo salvo no banco:', sql(`select coalesce(brand_logo_url,'(vazio)') from companies where name='Empresa A'`));
await page.locator('input[type=color] ~ div input, input[value^="#"]').first().fill('#e30613');
await page.getByRole('button', { name: 'Salvar cor' }).click();
await page.waitForTimeout(800);
log('cor no banco:', sql(`select brand_color from companies where name='Empresa A'`));
await page.screenshot({ path: `${SHOTS}/12-marca-admin.png`, fullPage: true });
const logoInHeader = await page.locator('header, div').locator('img[alt="Empresa A"]').first().isVisible().catch(() => false);
log('logo no cabeçalho do admin:', logoInHeader);
await page.context().clearCookies(); await page.evaluate(() => localStorage.clear());

// Motoboy vê a marca
await page.setViewportSize({ width: 390, height: 844 });
await login(page, 'c1@t');
await page.waitForTimeout(800);
log('logo no app do motoboy:', await page.locator('img[alt="Empresa A"]').first().isVisible().catch(() => false));
await page.screenshot({ path: `${SHOTS}/13-marca-motoboy.png` });

// Motoboy não consegue enviar imagem de marca (policy do storage)
const blocked = await page.evaluate(async () => {
  const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
  const token = JSON.parse(localStorage.getItem(key)).access_token;
  const r = await fetch('http://localhost:54321/storage/v1/object/company-branding/aaaaaaaa-0000-0000-0000-000000000000/x.png', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: 'x',
  });
  return r.status;
});
log('motoboy enviando imagem de marca → HTTP', blocked);

console.log('\nERROS NO NAVEGADOR:', errors.length ? errors : 'nenhum');
await browser.close();
