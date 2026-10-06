// Cardápio: admin cadastra categoria, produto com opções e adicional; cria
// pedido escolhendo produtos (sem digitar valor); ao despachar, a taxa do
// motoboy entra no total e aparece separada no detalhe.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS || '/tmp/shots';
mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const APP = 'http://localhost:4173';
const log = (...a) => console.log('•', ...a);
const errors = [];
const cont = (p) => p.getByRole('button', { name: 'Continuar' }).click();
const check = (label, ok) => { console.log(ok ? '✓' : '✗', label); if (!ok) errors.push(`falhou: ${label}`); };

const A = 'aaaaaaaa-0000-0000-0000-000000000000';
sql(`update companies set courier_per_delivery = 4, courier_fee_on_order = true where id = '${A}'`);
sql(`delete from courier_rates where company_id = '${A}'`);
sql(`insert into courier_rates (courier_id, company_id, per_delivery) values ('00000000-0000-0000-0000-0000000000c2', '${A}', 6)`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
await ctx.route(/nominatim\.openstreetmap\.org/, (r) => r.fulfill({ json: [{ lat: '-23.5489', lon: '-46.6350', address: { road: 'Rua Direita', house_number: '100', suburb: 'Centro', city: 'São Paulo' } }] }));
await ctx.route(/photon\.komoot\.io/, (r) => r.fulfill({ json: { features: [{ geometry: { coordinates: [-46.6350, -23.5489] },
  properties: { osm_key: 'place', type: 'house', street: 'Rua Direita', housenumber: '100', district: 'Centro', city: 'São Paulo', state: 'São Paulo', countrycode: 'BR' } }] } }));
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

// ───────── Cardápio ─────────
await page.getByText('Cardápio', { exact: true }).click();
await page.getByLabel('Nova categoria').fill('Sanduíches tradicionais');
await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
await page.getByText('SANDUÍCHES TRADICIONAIS', { exact: true }).waitFor();

await page.getByRole('button', { name: 'Novo produto' }).click();
await page.getByLabel('Nome', { exact: true }).fill('X-Tudo');
await page.getByRole('combobox', { name: 'Categoria' }).click();
await page.getByRole('option', { name: 'Sanduíches tradicionais' }).click();
await page.getByLabel('Descrição / ingredientes').fill('carne, queijo, alface, tomate, bacon, ovo');
await page.getByRole('button', { name: 'Com opções de preço' }).click();
const opts = page.getByLabel('Opção', { exact: true });
const prices = page.getByLabel('Preço (R$)');
await opts.nth(0).fill('Hambúrguer'); await prices.nth(0).fill('26,00');
await opts.nth(1).fill('Frango ou lombo'); await prices.nth(1).fill('29,50');
await page.screenshot({ path: `${SHOTS}/40-produto-opcoes.png` });
await page.getByRole('button', { name: 'Salvar' }).click();
await page.getByText('Hambúrguer: R$ 26,00 · Frango ou lombo: R$ 29,50').waitFor();

await page.getByRole('button', { name: 'Novo adicional' }).click();
await page.getByLabel('Nome', { exact: true }).fill('Bacon');
await page.getByLabel('Preço (R$)').fill('5');
await page.getByRole('button', { name: 'Salvar' }).click();
await page.getByText('Bacon', { exact: true }).waitFor();
await page.screenshot({ path: `${SHOTS}/41-cardapio.png`, fullPage: true });
check('produto gravado com opções', sql(`select price||' '||jsonb_array_length(variants) from products where name='X-Tudo'`) === '26.00 2');

// edita o preço (gerenciamento pela empresa)
await page.getByRole('button', { name: 'Editar X-Tudo' }).click();
await page.getByLabel('Preço (R$)').nth(1).fill('30');
await page.getByRole('button', { name: 'Salvar' }).click();
await page.getByText('Frango ou lombo: R$ 30,00').waitFor();
check('admin altera o preço da opção', sql(`select variants->1->>'price' from products where name='X-Tudo'`) === '30');

// ───────── Pedido ─────────
await page.getByText('Pedidos', { exact: true }).click();
await page.getByRole('button', { name: 'Novo pedido' }).click();
await page.getByLabel('Nome do cliente').fill('Rita Cardápio');
await cont(page);
await page.getByLabel('Rua').fill('Rua Direita');
await page.getByLabel('Número').fill('100');
await page.getByLabel('Bairro').fill('Centro');
await page.getByLabel('Cidade').fill('São Paulo');
await cont(page);
check('não há campo de valor digitado', (await page.getByLabel('Valor dos itens').count()) === 0);
await page.getByLabel('Adicionar produto do cardápio').fill('tudo');
await page.getByRole('option', { name: /X-Tudo/ }).click();
check('botão pede a opção antes de adicionar', await page.getByRole('button', { name: 'Escolha a opção' }).isDisabled());
await page.getByText('Frango ou lombo · R$ 30,00').click();
await page.getByText('Bacon +R$ 5,00').click();
await page.getByRole('button', { name: 'Aumentar quantidade' }).first().click(); // quantidade 2
await page.getByLabel('Observação do item').fill('sem tomate');
await page.getByRole('button', { name: 'Adicionar R$ 70,00' }).click();
await page.getByLabel('Adicionar produto do cardápio').fill('Misto');
await page.getByRole('option', { name: /Misto quente/ }).click();
await page.getByRole('button', { name: /^Adicionar R\$ 19,00$/ }).click();
await cont(page);
await page.getByText('Total agora').waitFor();
await page.screenshot({ path: `${SHOTS}/42-pedido-produtos.png`, fullPage: true });
check('resumo soma produtos + taxa do bairro', await page.getByText('R$ 94,00').isVisible());
await page.getByRole('button', { name: 'Criar pedido' }).click();
await page.getByText('Rita Cardápio').first().waitFor({ timeout: 10000 }).catch(async () => {
  errors.push('pedido não foi criado: ' + (await page.locator('.MuiAlert-message').allInnerTexts()).join(' | '));
});
const row = sql(`select subtotal||'|'||delivery_fee||'|'||total||'|'||items from delivery_orders where customer_name='Rita Cardápio'`);
log('pedido no banco:', row.replace(/\n/g, ' / '));
check('valor dos itens calculado pelo cardápio (2×35 + 19)', row.startsWith('89.00|5.00|94.00|'));

// ───────── Despacho com taxa do motoboy ─────────
const num = sql(`select number from delivery_orders where customer_name='Rita Cardápio'`);
const card = page.locator('div').filter({ has: page.getByText(`#${num}`, { exact: true }) }).filter({ has: page.locator('input[type=checkbox]') }).last();
await card.locator('input[type=checkbox]').check();
await page.getByRole('button', { name: /Despachar \(1\)/ }).click();
await page.getByLabel('Motoboy').click();
await page.getByRole('option', { name: /^C2 · .*R\$ 6,00 por entrega/ }).click();
await page.getByText(/A taxa de C2 \(R\$\s6,00\) entra no total/).waitFor();
check('parada mostra o total com a taxa do motoboy', await page.getByText(/total R\$\s100,00/).isVisible());
await page.screenshot({ path: `${SHOTS}/43-despacho-taxa.png` });
await page.getByRole('button', { name: /^Despachar$/ }).click();
await page.getByText('SAÍDAS EM ANDAMENTO').waitFor();
await page.waitForTimeout(800);
check('total no banco inclui a taxa do motoboy', sql(`select courier_fee||'|'||total from delivery_orders where customer_name='Rita Cardápio'`) === '6.00|100.00');

await page.getByText('Rita Cardápio').first().click();
await page.getByText('Taxa do motoboy (C2)').waitFor();
await page.screenshot({ path: `${SHOTS}/44-detalhe-pedido.png` });
check('detalhe mostra itens e taxas separadas', await page.getByText('2x X-Tudo (Frango ou lombo) + Bacon').isVisible());

console.log('\nERROS:', errors.length ? errors : 'nenhum');
await browser.close();
process.exit(errors.length ? 1 : 0);
