// Teste no navegador do financeiro e dos relatórios: admin vê relatórios,
// confere dinheiro no caixa, define valores e fecha acerto; motoboy abre
// turno e vê ganhos; plataforma vê uso de licenças, cobra e gera faturas.
// Rodar depois de setup.sh e do preview (veja README.md).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS || '/tmp/shots'; mkdirSync(SHOTS, { recursive: true });
const APP = 'http://localhost:4173';
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const log = (...a) => console.log('•', ...a);
const errors = [];

// Histórico: 6 entregas nos últimos dias (C1 e C2) e posições de C1 hoje.
sql(`insert into delivery_orders (company_id, customer_name, address_neighborhood, zone_id, subtotal, delivery_fee, payment_method, status, courier_id,
       created_at, ready_at, dispatched_at, delivered_at, delivered_by_code, number)
     select 'aaaaaaaa-0000-0000-0000-000000000000', 'Cliente ' || g, case when g % 2 = 0 then 'Centro' else 'Bela Vista' end,
       (select id from delivery_zones where name = case when g % 2 = 0 then 'Centro' else 'Bela Vista' end),
       30 + g * 5, 5, (array['dinheiro','pix','cartao'])[1 + g % 3], 'delivered',
       case when g <= 4 then '00000000-0000-0000-0000-0000000000c1'::uuid else '00000000-0000-0000-0000-0000000000c2'::uuid end,
       now() - make_interval(days => g % 3, mins => 60), now() - make_interval(days => g % 3, mins => 50),
       now() - make_interval(days => g % 3, mins => 40), now() - make_interval(days => g % 3, mins => 15 + g), true, 100 + g
     from generate_series(1, 6) g`);
sql(`insert into location_pings (company_id, courier_id, lat, lng, recorded_at)
     select 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', -23.55 - g * 0.002, -46.63, now() - make_interval(mins => 40 - g)
     from generate_series(0, 20) g`);

async function login(page, email) {
  await page.context().clearCookies();
  await page.goto(APP + '/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto(APP + '/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha123');
  await page.getByRole('button', { name: /^entrar$/i }).click();
  await page.waitForLoadState('networkidle');
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.route(/tile\.openstreetmap\.org|nominatim|osrm/, (r) => r.fulfill({ status: 200, body: '' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|realtime\/v1/.test(m.text())) errors.push(m.text()); });

// ---------------- Admin: relatórios ----------------
await login(page, 'a1@t');
await page.getByText('Relatórios', { exact: true }).first().click();
await page.getByText('Faturamento', { exact: true }).first().waitFor();
log('faturamento 7 dias na tela:', await page.getByText('Faturamento', { exact: true }).locator('xpath=..').locator('p').nth(1).innerText());
log('no banco:', sql(`select sum(total) from delivery_orders where status='delivered' and created_at > now() - interval '7 days'`));
const row = page.getByRole('row').filter({ hasText: 'C1' });
log('linha do C1 (produtividade):', (await row.innerText()).replace(/\s+/g, ' '));
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('Por motoboy').locator('xpath=../..').getByRole('button', { name: 'CSV' }).click()]);
log('CSV baixado:', dl.suggestedFilename());
await page.screenshot({ path: `${SHOTS}/20-relatorios.png`, fullPage: true });
await page.getByText('Hoje', { exact: true }).click();
await page.waitForTimeout(800);
log('faturamento hoje:', await page.getByText('Faturamento', { exact: true }).locator('xpath=..').locator('p').nth(1).innerText());

// ---------------- Admin: financeiro ----------------
await page.getByText('Financeiro', { exact: true }).first().click();
await page.getByText('Conferência do dinheiro dos motoboys').waitFor();
await page.getByLabel('Valor (R$)').fill('100');
await page.getByRole('button', { name: 'Lançar' }).click();
await page.getByText('Abertura (troco inicial)', { exact: false }).last().waitFor();
const pend = await page.getByText('A conferir', { exact: true }).count();
log('pedidos em dinheiro a conferir hoje:', pend);
if (pend) {
  await page.getByRole('row').filter({ hasText: 'A conferir' }).first().locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: /Conferir 1 selecionado/ }).click();
  await page.waitForTimeout(800);
}
log('conferidos no banco:', sql(`select count(*) from delivery_orders where payment_received`));
await page.screenshot({ path: `${SHOTS}/21-caixa-do-dia.png`, fullPage: true });

await page.getByText('Valores do motoboy', { exact: true }).click();
await page.getByLabel('Diária (R$)').first().fill('40');
await page.getByLabel('Por entrega (R$)').first().fill('3,50');
await page.getByLabel('Por km (R$)').first().fill('0,80');
await page.getByRole('button', { name: 'Salvar' }).click();
await page.getByText('Valores padrão salvos.').waitFor();
log('valores no banco:', sql(`select courier_daily_rate||' '||courier_per_delivery||' '||courier_per_km from companies where name='Empresa A'`));

await page.getByText('Acertos dos motoboys', { exact: true }).click();
await page.getByLabel('Motoboy').click();
await page.getByRole('option', { name: 'C1' }).click();
await page.getByRole('button', { name: 'Calcular' }).click();
await page.getByText(/^Diárias:/).waitFor();
log('prévia:', (await page.getByText(/^Diárias:/).locator('xpath=../..').innerText()).replace(/\s+/g, ' '));
await page.getByLabel('Ajuste (R$, use − para desconto)').fill('-10');
await page.getByLabel('Motivo do ajuste').fill('vale');
await page.getByRole('button', { name: /Gravar acerto/ }).click();
await page.getByText('Acerto gravado.').waitFor();
await page.getByRole('button', { name: 'Marcar pago' }).click();
await page.waitForTimeout(800);
log('acerto no banco:', sql(`select deliveries||' entregas, km='||km||', total='||total||', '||status from settlements`));
await page.screenshot({ path: `${SHOTS}/22-acertos.png`, fullPage: true });

// ---------------- Motoboy: ganhos ----------------
await login(page, 'c1@t');
log('sem botão de turno:', await page.getByRole('button', { name: /turno/i }).count() === 0);
await page.getByText('Ganhos', { exact: true }).click();
await page.getByText('Previsto no período').waitFor();
log('ganhos (motoboy):', (await page.getByText('Previsto no período').locator('xpath=..').innerText()).replace(/\s+/g, ' '));
await page.screenshot({ path: `${SHOTS}/23-motoboy-ganhos.png`, fullPage: true });

// ---------------- Plataforma ----------------
await login(page, 'p@t');
await page.getByText('Empresa A').first().click();
await page.getByText('COBRANÇA DA LICENÇA').waitFor();
await page.getByText('FATURAS DESTA EMPRESA').waitFor();
await page.getByLabel('Mensalidade (R$)').fill('149,90');
await page.getByLabel('Dia de vencimento (1–28)').fill('5');
await page.getByText('COBRANÇA DA LICENÇA').locator('xpath=..').getByRole('button', { name: 'Salvar' }).click();
await page.getByText('Cobrança salva.').waitFor();
await page.getByText('Relatórios', { exact: true }).first().click();
await page.getByText('Faturamento', { exact: true }).first().waitFor();
log('plataforma vê relatório da empresa: ok');
await page.getByText('Todas as empresas').click();
await page.getByText('Faturas', { exact: true }).click();
await page.getByLabel('Mês').fill('2026-09');
await page.getByRole('button', { name: 'Gerar faturas do mês' }).click();
await page.getByText(/fatura\(s\) gerada\(s\)/).waitFor();
await page.getByRole('button', { name: 'Suspender inadimplentes' }).click();
await page.getByText(/suspensa\(s\) por atraso|Nenhuma empresa com atraso/).waitFor();
log('faturas e situação:', sql(`select string_agg(c.name||' '||i.amount||' venc '||i.due_date||' → '||c.status, '; ') from license_invoices i join companies c on c.id=i.company_id`));
await page.screenshot({ path: `${SHOTS}/24-plataforma-faturas.png`, fullPage: true });
await page.getByText('Uso de licenças', { exact: true }).click();
await page.getByText('Vagas usadas', { exact: true }).waitFor();
log('uso de licenças:', (await page.getByRole('row').filter({ hasText: 'Empresa A' }).innerText()).replace(/\s+/g, ' '));
await page.screenshot({ path: `${SHOTS}/25-plataforma-uso.png`, fullPage: true });

// ---------------- Admin: abas do financeiro; celular ----------------
await login(page, 'a1@t');
await page.setViewportSize({ width: 390, height: 844 });
await page.getByText('Financeiro', { exact: true }).first().click();
await page.getByText('Caixa do dia', { exact: true }).waitFor();
log('admin da empresa sem aba Licença/Turnos:', await page.getByText(/^(Licença|Turnos)$/).count() === 0);
await page.getByText('Relatórios', { exact: true }).first().click();
await page.getByText('Faturamento', { exact: true }).first().waitFor();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
log('rolagem horizontal no celular:', overflow);
await page.screenshot({ path: `${SHOTS}/26-relatorios-celular.png`, fullPage: true });

console.log('\nERROS NO NAVEGADOR:', errors.length ? errors : 'nenhum');
await browser.close();
