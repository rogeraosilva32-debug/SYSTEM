// Pedido local x entrega: no novo pedido, "Pedido local" esconde endereço,
// mapa e taxa de entrega; o pedido não vai para motoboy e é concluído no
// balcão. "Entrega" continua exigindo o endereço.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS || '/tmp/shots';
mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const APP = 'http://localhost:4173';
const errors = [];
const cont = (p) => p.getByRole('button', { name: 'Continuar' }).click();
const check = (label, ok) => { console.log(ok ? '✓' : '✗', label); if (!ok) errors.push(`falhou: ${label}`); };
const A = 'aaaaaaaa-0000-0000-0000-000000000000';
sql(`update companies set auto_dispatch = true, auto_hold_minutes = 0, auto_dispatch_when = 'any' where id = '${A}'`);
sql(`update delivery_orders set status = 'cancelled' where company_id = '${A}'`);
sql(`insert into courier_shifts (company_id, courier_id) values ('${A}', '00000000-0000-0000-0000-0000000000c1')`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
await ctx.route(/nominatim\.openstreetmap\.org|photon\.komoot\.io/, (r) => r.fulfill({ json: [] }));
await ctx.route(/router\.project-osrm\.org/, (r) => r.fulfill({ json: { routes: [] } }));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/websocket|realtime|404|functions|ERR_TUNNEL/i.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

await page.goto(APP + '/login');
await page.getByLabel('E-mail').fill('a1@t');
await page.getByLabel('Senha').fill('senha123');
await page.getByRole('button', { name: /^entrar$/i }).click();
await page.waitForLoadState('networkidle');
await page.getByText('Pedidos', { exact: true }).click();

// ───────── Entrega: campos de entrega aparecem e são exigidos ─────────
await page.getByRole('button', { name: 'Novo pedido' }).click();
check('entrega é o padrão', await page.getByRole('button', { name: 'Entrega' }).getAttribute('aria-pressed') === 'true');
check('entrega tem 4 etapas', await page.getByText('Etapa 1 de 4: Cliente').isVisible());
await cont(page);
check('entrega pede o nome antes de seguir', await page.getByText('Informe o nome do cliente.').isVisible());
await page.getByLabel('Nome do cliente').fill('Teste Entrega');
await cont(page);
check('etapa do endereço mostra o endereço', await page.getByLabel('Rua').isVisible());
check('uma etapa por vez: produto ainda não aparece', (await page.getByLabel('Adicionar produto do cardápio').count()) === 0);
await cont(page);
await page.getByText(/Digite o endereço, busque ou marque o ponto no mapa/).waitFor();
check('entrega sem endereço não passa da etapa', await page.getByText('Etapa 2 de 4: Endereço').isVisible());
await page.screenshot({ path: `${SHOTS}/59-etapa-endereco.png` });
await page.getByRole('button', { name: 'Voltar' }).click();

// ───────── Pedido local: só os campos do pedido ─────────
await page.getByRole('button', { name: 'Pedido local' }).click();
check('local tem 3 etapas, sem endereço', await page.getByText('Etapa 1 de 3: Cliente').isVisible() && (await page.getByRole('button', { name: 'Etapa Endereço' }).count()) === 0);
await page.getByLabel('Nome do cliente (opcional)').fill('Mesa 4');
await cont(page);
check('local esconde o mapa', (await page.locator('.MuiDialog-root .leaflet-container').count()) === 0);
await cont(page);
check('produtos são exigidos', await page.getByText('Adicione ao menos um produto do cardápio.').isVisible());
await page.getByLabel('Adicionar produto do cardápio').fill('Misto');
await page.getByRole('option', { name: /Misto quente/ }).click();
await page.getByRole('button', { name: /^Adicionar R\$/ }).click();
await page.screenshot({ path: `${SHOTS}/60-etapa-produtos.png` });
await cont(page);
check('local esconde taxa de entrega', (await page.getByLabel('Taxa de entrega').count()) === 0);
await page.getByLabel('Troco para').fill('abc');
await page.getByRole('button', { name: 'Criar pedido local' }).click();
check('troco inválido é recusado antes de salvar', await page.getByText(/Valor do troco inválido/).isVisible());
await page.getByLabel('Troco para').fill('');
await page.screenshot({ path: `${SHOTS}/61-etapa-pagamento.png`, fullPage: true });
await page.getByRole('button', { name: 'Criar pedido local' }).click();
await page.getByText('🏪 Pedido local', { exact: false }).first().waitFor({ timeout: 10000 });
const row = sql(`select order_type||'|'||coalesce(delivery_fee::text,'-')||'|'||coalesce(lat::text,'-')||'|'||total||'|'||source from delivery_orders where customer_name = 'Mesa 4'`);
check('pedido local gravado sem endereço nem taxa', row === 'local|-|-|19.00|balcao');
await page.waitForTimeout(1500);
check('pedido local não vai para o motoboy em expediente', sql(`select courier_id is null from delivery_orders where customer_name = 'Mesa 4'`) === 't');
const card = page.locator('div').filter({ has: page.getByText('Mesa 4', { exact: true }) }).filter({ has: page.getByText('🏪 Pedido local', { exact: false }) }).last();
check('pedido local não tem caixa de despacho', (await card.locator('input[type=checkbox]').count()) === 0);
await page.screenshot({ path: `${SHOTS}/62-fila-local.png`, fullPage: true });

// ───────── Concluir no balcão ─────────
await page.getByText('Mesa 4', { exact: true }).click();
check('detalhe não mostra endereço', (await page.getByText('Endereço', { exact: true }).count()) === 0);
await page.screenshot({ path: `${SHOTS}/63-detalhe-local.png` });
await page.getByRole('button', { name: 'Entregue ao cliente' }).click();
await page.waitForTimeout(1000);
check('pedido local concluído com pagamento conferido', sql(`select status||'|'||payment_received from delivery_orders where customer_name = 'Mesa 4'`) === 'delivered|true');
check('some da fila', (await page.getByText('Mesa 4', { exact: true }).count()) === 0);

console.log('\nERROS:', errors.length ? errors : 'nenhum');
await browser.close();
process.exit(errors.length ? 1 : 0);
