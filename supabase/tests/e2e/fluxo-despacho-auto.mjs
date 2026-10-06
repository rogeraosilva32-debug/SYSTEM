// Despacho automático: admin liga nos ajustes; motoboy inicia o expediente
// e recebe sozinho a saída com o pedido mais antigo e o vizinho; o pedido
// longe fica para o próximo motoboy livre.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS || '/tmp/shots';
mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const APP = 'http://localhost:4173';
const errors = [];
const check = (label, ok) => { console.log(ok ? '✓' : '✗', label); if (!ok) errors.push(`falhou: ${label}`); };
const A = 'aaaaaaaa-0000-0000-0000-000000000000';

// Loja no Centro; Ana (pronta há 20 min) e Carla ficam perto; um pedido longe.
sql(`update companies set store_lat = -23.5505, store_lng = -46.6333 where id = '${A}'`);
sql(`update delivery_orders set status = 'ready', ready_at = now() - interval '20 minutes' where customer_name = 'Ana Souza'`);
sql(`update delivery_orders set status = 'ready', ready_at = now() - interval '5 minutes' where customer_name = 'Carla Dias'`);
sql(`update delivery_orders set ready_at = now() - interval '10 minutes', lat = -23.62, lng = -46.70 where customer_name = 'Bruno Lima'`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
async function open(email, geo) {
  const ctx = await browser.newContext({ viewport: geo ? { width: 412, height: 860 } : { width: 1360, height: 900 },
    geolocation: geo, permissions: geo ? ['geolocation'] : [] });
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
  await ctx.route(/router\.project-osrm\.org/, (r) => r.fulfill({ json: { routes: [] } }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/websocket|realtime|404|functions|ERR_TUNNEL/i.test(m.text())) errors.push(`${email}: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + '/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha123');
  await page.getByRole('button', { name: /^entrar$/i }).click();
  await page.waitForLoadState('networkidle');
  return page;
}

// ───────── Admin liga o despacho automático ─────────
const admin = await open('a1@t');
await admin.getByText('Entregas: ajustes', { exact: true }).click();
await admin.getByText('Despachar sozinho para os motoboys em expediente').waitFor();
await admin.getByLabel('Máximo de entregas por saída').fill('2');
await admin.getByRole('button', { name: 'Salvar limites' }).click();
await admin.waitForTimeout(500);
await admin.getByRole('switch', { name: 'Despacho automático' }).click();
await admin.waitForTimeout(800);
await admin.screenshot({ path: `${SHOTS}/50-ajustes-despacho.png`, fullPage: true });
check('admin liga e define máximo de 2 entregas', sql(`select auto_dispatch||' '||auto_max_stops from companies where id = '${A}'`) === 'true 2');
check('sem motoboy em expediente, nada sai', sql(`select count(*) from delivery_runs`) === '0');

// ───────── Motoboy inicia o expediente ─────────
const c1 = await open('c1@t', { latitude: -23.5505, longitude: -46.6333 });
check('motoboy vê o botão de expediente', await c1.getByRole('button', { name: 'Iniciar expediente' }).isVisible());
await c1.getByRole('button', { name: 'Iniciar expediente' }).click();
await c1.getByText(/Nova saída: 2 parada/).waitFor({ timeout: 10000 });
await c1.screenshot({ path: `${SHOTS}/51-motoboy-saida-automatica.png`, fullPage: true });
check('saída automática com o mais antigo primeiro e o vizinho',
  sql(`select string_agg(customer_name, ',' order by stop_sequence) from delivery_orders where courier_id = '00000000-0000-0000-0000-0000000000c1'`) === 'Ana Souza,Carla Dias');
check('pedido longe fica na fila', sql(`select courier_id is null from delivery_orders where customer_name = 'Bruno Lima'`) === 't');

// ───────── Admin vê o expediente e a saída automática ─────────
await admin.getByText('Pedidos', { exact: true }).click();
await admin.getByText('EM EXPEDIENTE', { exact: true }).waitFor();
await admin.getByText('Saída aguardando').waitFor();
check('fila mostra a saída como automática', await admin.getByText('Automática', { exact: true }).isVisible());
check('com o automático ligado não há despacho manual', (await admin.getByRole('button', { name: /^Despachar/ }).count()) === 0);
check('aviso de despacho automático', await admin.getByText(/Despacho automático ligado: cada saída/).isVisible());
check('pedidos da saída continuam na fila de prontos', sql(`select string_agg(distinct status, ',') from delivery_orders where courier_id = '00000000-0000-0000-0000-0000000000c1'`) === 'ready');
check('fila de prontos mostra quem vai levar', await admin.getByText('Aguardando o motoboy confirmar a saída').first().isVisible());
check('fila de prontos numerada', (await admin.getByTestId('ready-order').first().innerText()).startsWith('1º'));
await admin.screenshot({ path: `${SHOTS}/52-fila-expediente.png`, fullPage: true });

// ───────── Motoboy confirma a saída: pedidos vão para Em rota ─────────
await c1.getByRole('button', { name: 'Confirmar saída para entrega' }).click();
await c1.getByText(/Saída confirmada/).waitFor();
check('confirmar saída põe os pedidos em rota', sql(`select string_agg(distinct status, ',') from delivery_orders where courier_id = '00000000-0000-0000-0000-0000000000c1'`) === 'on_route');
await admin.reload();
await admin.getByText('EM EXPEDIENTE', { exact: true }).waitFor();
check('saem da fila de prontos', (await admin.getByText('Aguardando o motoboy confirmar a saída').count()) === 0);

// ───────── Segundo motoboy pega o pedido que sobrou ─────────
const c2 = await open('c2@t', { latitude: -23.5505, longitude: -46.6333 });
await c2.getByRole('button', { name: 'Iniciar expediente' }).click();
await c2.getByText(/Nova saída: 1 parada/).waitFor({ timeout: 10000 });
check('segundo motoboy recebe o pedido longe', sql(`select courier_id from delivery_orders where customer_name = 'Bruno Lima'`) === '00000000-0000-0000-0000-0000000000c2');

// ───────── Pausa devolve a saída ─────────
await c2.getByRole('button', { name: 'Pausar' }).click();
await c2.getByText('Em pausa: não recebe novas saídas').waitFor();
check('pausar devolve a saída não iniciada', sql(`select courier_id is null from delivery_orders where customer_name = 'Bruno Lima'`) === 't');
await c2.getByRole('button', { name: 'Voltar a receber' }).click();
await c2.getByText(/Nova saída: 1 parada/).waitFor({ timeout: 10000 });
check('ao voltar, recebe de novo', sql(`select courier_id from delivery_orders where customer_name = 'Bruno Lima'`) === '00000000-0000-0000-0000-0000000000c2');
await c2.screenshot({ path: `${SHOTS}/53-motoboy2.png`, fullPage: true });

// ───────── Pedido que fica pronto entra na saída ainda não confirmada ─────────
sql(`insert into delivery_orders (company_id, customer_name, lat, lng, subtotal, status) values ('${A}', 'Davi Rocha', -23.61, -46.69, 20, 'received')`);
sql(`update delivery_orders set status = 'ready' where customer_name = 'Davi Rocha'`);
check('pronto entra na saída não confirmada até o máximo', sql(`select courier_id from delivery_orders where customer_name = 'Davi Rocha'`) === '00000000-0000-0000-0000-0000000000c2');
await c2.reload();
await c2.getByText(/Nova saída: 2 parada/).waitFor({ timeout: 15000 });
check('motoboy vê a saída com as 2 paradas', true);

// ───────── Gestor edita a saída antes da confirmação ─────────
await admin.reload();
await admin.getByText('EM EXPEDIENTE', { exact: true }).waitFor();
await admin.getByText('Aguardando o motoboy confirmar a saída').locator('..').getByRole('button', { name: 'Editar' }).click();
await admin.getByRole('dialog').getByText('Editar saída').waitFor();
await admin.getByLabel('Motoboy').click();
check('motoboy ocupado aparece indisponível', await admin.getByRole('option', { name: /C1 · com outra saída/ }).getAttribute('aria-disabled') === 'true');
await admin.keyboard.press('Escape');
const dlg = admin.getByRole('dialog');
await dlg.locator('div').filter({ hasText: 'Davi Rocha' }).filter({ has: admin.getByRole('button', { name: 'Tirar da saída' }) }).last()
  .getByRole('button', { name: 'Tirar da saída' }).click();
await admin.getByRole('button', { name: 'Salvar saída' }).click();
await admin.getByRole('dialog').waitFor({ state: 'detached' });
check('pedido tirado volta para a fila', sql(`select run_id is null from delivery_orders where customer_name = 'Davi Rocha'`) === 't');
check('saída editada fica com o gestor', sql(`select locked from delivery_runs where courier_id = '00000000-0000-0000-0000-0000000000c2' and status = 'planned'`) === 't');
await admin.screenshot({ path: `${SHOTS}/54-saida-editada.png`, fullPage: true });

console.log('\nERROS:', errors.length ? errors : 'nenhum');
await browser.close();
process.exit(errors.length ? 1 : 0);
