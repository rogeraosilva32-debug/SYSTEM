import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const SHOTS = process.env.SHOTS || '/tmp/shots';
import { mkdirSync } from 'node:fs'; mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const APP = 'http://localhost:4173';
const log = (...a) => console.log('•', ...a);
const errors = [];
const check = (label, ok) => { console.log(ok ? '✓' : '✗', label); if (!ok) errors.push(`falhou: ${label}`); };
const expand = async (p, title) => {
  const h = p.locator('[role=button][aria-expanded]').filter({ hasText: new RegExp('^' + title) }).first();
  await h.waitFor();
  if ((await h.getAttribute('aria-expanded')) === 'false') await h.click();
  await p.waitForTimeout(300);
};
// Na etapa do endereço é preciso marcar que o endereço foi confirmado com o cliente.
const cont = async (p) => {
  const ok = p.getByLabel('Confirmei o endereço com o cliente');
  if (await ok.isVisible() && !(await ok.isChecked())) await ok.check();
  await p.getByRole('button', { name: 'Continuar' }).click();
};

async function mockExternal(ctx) {
  await ctx.addInitScript(() => { window.open = (u) => { window.__opened = u; return null; }; });
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
  await ctx.route(/nominatim\.openstreetmap\.org/, (r) => r.fulfill({ json: [{ lat: '-23.5614', lon: '-46.6559', address: { city: 'São Paulo' } }] }));
  await ctx.route(/router\.project-osrm\.org/, (r) => {
    const url = new URL(r.request().url());
    const [a, b] = url.pathname.split('/').pop().split(';').map((p) => p.split(',').map(Number));
    const mid = (k) => [[a[0], a[1]], [(a[0] + b[0]) / 2 + k, (a[1] + b[1]) / 2 - k], [b[0], b[1]]];
    r.fulfill({ json: { routes: [
      { geometry: { coordinates: mid(0.004) }, distance: 3400, duration: 720 },
      { geometry: { coordinates: mid(0) }, distance: 2900, duration: 540 },
      { geometry: { coordinates: mid(-0.004) }, distance: 3900, duration: 840 },
    ] } });
  });
}
async function login(page, email) {
  await page.goto(APP + '/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha123');
  await page.getByRole('button', { name: /^entrar$/i }).click();
  await page.waitForLoadState('networkidle');
}
function watch(page, who) {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/websocket|realtime|404|functions|ERR_TUNNEL/i.test(m.text())) errors.push(`${who}: ${m.text()}`); });
}

sql(`update companies set strict_route_mode = false, feature_delivery_code = true where id = 'aaaaaaaa-0000-0000-0000-000000000000'`);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

// ───────── Admin ─────────
const adminCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await mockExternal(adminCtx);
const admin = await adminCtx.newPage(); watch(admin, 'admin');
await login(admin, 'a1@t');
log('admin caiu em', admin.url().replace(APP, ''));
await admin.getByText('PRONTO', { exact: true }).waitFor();
await admin.screenshot({ path: `${SHOTS}/01-fila.png` });

await admin.getByRole('button', { name: 'Novo pedido' }).click();
await admin.getByLabel('Telefone do cliente').fill('11977778888');
await admin.getByLabel('Nome do cliente').fill('Diego Alves');
await cont(admin);
await admin.getByLabel('Rua').fill('Avenida Paulista');
await admin.getByLabel('Número').fill('1000');
await admin.getByLabel('Bairro').fill('Bela Vista');
await admin.getByLabel('Cidade').fill('São Paulo');
check('aviso para confirmar o endereço', await admin.getByText(/Confirme o endereço com o cliente/).first().isVisible());
await admin.getByRole('button', { name: 'Continuar' }).click();
check('sem confirmar o endereço não avança', await admin.getByText('Confirme o endereço com o cliente e marque a caixa abaixo.').isVisible());
await cont(admin);
await admin.getByLabel('Adicionar produto do cardápio').fill('Misto');
await admin.getByRole('option', { name: /Misto quente/ }).click();
await admin.getByRole('button', { name: /^Adicionar R\$/ }).click();
await admin.screenshot({ path: `${SHOTS}/02-novo-pedido.png` });
await cont(admin);
await admin.getByRole('button', { name: 'Criar pedido' }).click();
await admin.getByRole('dialog').waitFor({ state: 'detached' });
await admin.getByText('Diego Alves').first().waitFor();
log('novo pedido no banco:', sql(`select number||' '||status||' taxa='||delivery_fee||' total='||total||' lat='||coalesce(lat::text,'-') from delivery_orders where customer_name='Diego Alves'`));
log('cliente salvo:', sql(`select count(*) from customers where phone='11977778888'`));

// selecionar #1 e #2 e despachar
for (const n of ['#1', '#2']) {
  const card = admin.locator('div').filter({ has: admin.getByText(n, { exact: true }) }).filter({ has: admin.locator('input[type=checkbox]') }).last();
  await card.locator('input[type=checkbox]').check();
}
await admin.getByRole('button', { name: /Despachar \(2\)/ }).click();
await admin.getByLabel('Motoboy').click();
await admin.getByRole('option', { name: 'C1' }).click();
await admin.getByRole('button', { name: 'Sugerir ordem' }).click();
await admin.screenshot({ path: `${SHOTS}/03-despacho.png` });
await admin.getByRole('button', { name: /^Despachar$/ }).click();
await admin.getByText('SAÍDAS EM ANDAMENTO').waitFor();
await admin.waitForTimeout(800);
log('saída:', sql(`select string_agg('#'||number||'→parada '||stop_sequence, ', ' order by stop_sequence) from delivery_orders where run_id is not null`));
await admin.screenshot({ path: `${SHOTS}/04-saida.png` });

// detalhe do pedido 1: código + whatsapp
await admin.locator('text=Ana Souza').first().click();
await admin.getByText('CÓDIGO DE ENTREGA').waitFor();
const codeShown = await admin.locator('text=/^\\d{4}$/').first().innerText();
log('código mostrado ao admin:', codeShown, '(banco:', sql(`select code from order_delivery_codes c join delivery_orders o on o.id=c.order_id where o.number=1`) + ')');
await admin.getByRole('button', { name: /Enviar por WhatsApp/ }).click();
log('link WhatsApp:', decodeURIComponent(await admin.evaluate(() => window.__opened)));
await admin.screenshot({ path: `${SHOTS}/05-detalhe-codigo.png` });
await admin.keyboard.press('Escape');

// ───────── Motoboy (celular) ─────────
const courierCtx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  geolocation: { latitude: -23.5505, longitude: -46.6333 }, permissions: ['geolocation'],
});
await mockExternal(courierCtx);
const courier = await courierCtx.newPage(); watch(courier, 'motoboy');
await login(courier, 'c1@t');
log('motoboy caiu em', courier.url().replace(APP, ''));
await courier.getByRole('button', { name: 'Confirmar saída para entrega' }).waitFor();
await courier.screenshot({ path: `${SHOTS}/06-motoboy-saida.png`, fullPage: true });
await courier.getByRole('button', { name: 'Confirmar saída para entrega' }).click();
await courier.getByText('Principal (mais rápida)').waitFor();
await courier.screenshot({ path: `${SHOTS}/07-motoboy-rotas.png`, fullPage: true });
await courier.getByText('Alternativa 1').click();
await courier.waitForTimeout(500);
const firstStop = sql(`select number from delivery_orders where stop_sequence=1 and run_id is not null`);
log('rota escolhida no banco (pedido #' + firstStop + '):', sql(`select route_choice from delivery_orders where number=${firstStop}`));
await courier.getByRole('button', { name: /Google Maps/ }).click();
log('Google Maps:', decodeURIComponent(await courier.evaluate(() => window.__opened)));
await courier.getByRole('button', { name: /^Waze$/ }).click();
log('Waze:', await courier.evaluate(() => window.__opened));

await courier.getByLabel(/Código de entrega/).fill('0000');
await courier.getByRole('button', { name: 'Finalizar entrega' }).click();
await courier.getByText(/Código incorreto/).waitFor();
log('código errado: recusado');
const right = sql(`select code from order_delivery_codes c join delivery_orders o on o.id=c.order_id where o.number=${firstStop}`);
await courier.getByLabel(/Código de entrega/).fill(right);
await courier.getByRole('button', { name: 'Finalizar entrega' }).click();
await courier.getByText('Entrega finalizada!').waitFor();
await courier.getByText('Parada 2 de 2').waitFor();
log('após código certo:', sql(`select '#'||number||' '||status||' por_codigo='||delivered_by_code from delivery_orders where number=${firstStop}`));
await courier.screenshot({ path: `${SHOTS}/08-motoboy-parada2.png`, fullPage: true });

// desvio: move o GPS para longe da rota
await courierCtx.setGeolocation({ latitude: -23.60, longitude: -46.70 });
await courier.waitForTimeout(2500);
const offVisible = await courier.getByText(/Você saiu do trajeto/).isVisible().catch(() => false);
check('sem rota exata: desvio não acusa na tela', !offVisible);
check('sem rota exata: gestor não é avisado', sql(`select count(*) from notifications where type='off_route'`) === '0');
log('posições gravadas:', sql(`select count(*) from location_pings`));

// última entrega: motoboy volta para a loja
const right2 = sql(`select c.code from order_delivery_codes c join delivery_orders o on o.id=c.order_id where o.status='on_route' limit 1`);
await courier.getByLabel(/Código de entrega/).fill(right2);
await courier.getByRole('button', { name: 'Finalizar entrega' }).click();
await courier.getByRole('button', { name: 'Cheguei na loja' }).waitFor({ timeout: 10000 });
check('depois da última entrega aparece a volta para a loja', true);
await courier.screenshot({ path: `${SHOTS}/08b-motoboy-voltando.png`, fullPage: true });

// ───────── Admin: mapa ao vivo e ajustes ─────────
await admin.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Mapa ao vivo', exact: true }).click();
await admin.getByText('MOTOBOYS').waitFor();
await admin.waitForTimeout(800);
check('gestor vê o motoboy voltando para a loja', await admin.getByText(/Voltando para a loja/).first().isVisible());
await courier.getByRole('button', { name: 'Cheguei na loja' }).click();
await courier.getByText('Chegada na loja registrada.').waitFor();
check('chegada registrada', sql(`select count(*) from delivery_runs where returned_by='courier'`) === '1');
await admin.screenshot({ path: `${SHOTS}/09-mapa-ao-vivo.png` });
await admin.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Ajustes de entrega', exact: true }).click();
await expand(admin, 'Rotas');
await admin.getByText('Modo rota exata').waitFor();
await admin.locator('input[type=checkbox]').first().click();
await admin.waitForTimeout(600);
log('rota exata ligada pelo admin:', sql(`select strict_route_mode from companies where name='Empresa A'`));
await admin.screenshot({ path: `${SHOTS}/10-ajustes.png`, fullPage: true });

console.log('\nERROS NO NAVEGADOR:', errors.length ? errors : 'nenhum');
await browser.close();
