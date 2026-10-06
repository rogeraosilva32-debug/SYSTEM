// Recursos da plataforma: alertas automáticos, planos com limite, avisos
// para as empresas e "ver como empresa" (modo suporte, só leitura).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS || '/tmp/shots'; mkdirSync(SHOTS, { recursive: true });
const APP = 'http://localhost:4173';
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const errors = [];
const check = (label, ok) => { console.log(ok ? '✓' : '✗', label); if (!ok) errors.push(`falhou: ${label}`); };
const A = 'aaaaaaaa-0000-0000-0000-000000000000';
const B = 'bbbbbbbb-0000-0000-0000-000000000000';
const expand = async (p, title) => {
  const h = p.locator('[role=button][aria-expanded]').filter({ hasText: new RegExp('^' + title) }).first();
  await h.waitFor();
  if ((await h.getAttribute('aria-expanded')) === 'false') await h.click();
  await p.waitForTimeout(300);
};

// Empresa B com um pedido parado há 5 horas (vira alerta).
sql(`insert into delivery_orders (company_id, customer_name, subtotal, status, created_at) values ('${B}', 'Pedido parado', 10, 'preparing', now() - interval '5 hours')`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/tile\.openstreetmap\.org|nominatim|osrm/, (r) => r.fulfill({ status: 200, body: '' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|realtime\/v1|websocket/i.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const nav = (name) => page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name, exact: true }).click();
async function login(email) {
  await page.context().clearCookies();
  await page.goto(APP + '/login');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(APP + '/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha123');
  await page.getByRole('button', { name: /^entrar$/i }).click();
  await page.waitForLoadState('networkidle');
}

// ───────── Alertas ─────────
await login('p@t');
await page.getByTestId('alerta').filter({ hasText: 'Pedido parado' }).first().waitFor({ timeout: 10000 });
check('alerta de pedido parado aparece na visão geral', await page.getByTestId('alerta').filter({ hasText: 'Empresa B' }).first().isVisible());
check('menu mostra o número de alertas', /\d/.test(await page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: /Visão geral/ }).innerText()));
await page.screenshot({ path: `${SHOTS}/70-alertas.png`, fullPage: true });
await page.getByTestId('alerta').filter({ hasText: 'Empresa B' }).first().getByRole('button', { name: 'Visto' }).click();
await page.waitForTimeout(600);
check('alerta marcado como visto', sql(`select count(*) from platform_alerts where company_id = '${B}' and seen_at is not null`) === '1');

// ───────── Planos ─────────
await nav('Planos');
await page.getByRole('button', { name: 'Novo plano' }).click();
await page.getByLabel('Nome do plano').fill('Básico');
await page.getByLabel('Mensalidade (R$)').fill('99,90');
await page.getByLabel('Vagas de colaborador').fill('4');
await page.getByLabel('Pedidos por mês').fill('3');
await page.getByText('Marca própria').click();
await page.getByRole('button', { name: 'Salvar plano' }).click();
await page.getByTestId('plano').filter({ hasText: 'Básico' }).waitFor();
check('plano criado', sql(`select monthly_price||' '||seats_limit||' '||max_orders_month||' '||feature_branding from plans where name = 'Básico'`) === '99.90 4 3 true');
await page.screenshot({ path: `${SHOTS}/71-planos.png`, fullPage: true });

await nav('Empresas');
await page.getByRole('row').filter({ hasText: 'Empresa A' }).click();
await expand(page, 'Licença, convite e vagas');
await page.getByLabel('Plano').click();
await page.getByRole('option', { name: /Básico/ }).click();
await page.waitForTimeout(800);
check('empresa entra no plano com vagas, mensalidade e recurso',
  sql(`select seats_limit||' '||monthly_price||' '||feature_branding||' '||(plan_id is not null) from companies where id = '${A}'`) === '4 99.90 true true');

// ───────── Avisos ─────────
await nav('Avisos');
await page.getByRole('button', { name: 'Novo aviso' }).click();
await page.getByLabel('Título').fill('Manutenção hoje às 23h');
await page.getByLabel('Mensagem').fill('O sistema fica fora por 10 minutos.');
await page.getByRole('button', { name: 'Publicar aviso' }).click();
await page.getByTestId('aviso').filter({ hasText: 'Manutenção hoje' }).waitFor();
check('aviso publicado para todas', sql(`select count(*) from platform_notices where company_ids is null`) === '1');

// ───────── Ver como empresa ─────────
await nav('Empresas');
await page.getByRole('row').filter({ hasText: 'Empresa A' }).click();
await page.getByRole('button', { name: 'Ver como empresa' }).click();
await page.getByText(/Modo suporte: vendo como/).waitFor({ timeout: 10000 });
check('abre o painel da empresa', page.url().includes('/painel'));
await page.getByText('Ana Souza').first().waitFor({ timeout: 10000 });
check('vê os pedidos da empresa', true);
check('não vê pedido de outra empresa', (await page.getByText('Pedido parado').count()) === 0);
await page.screenshot({ path: `${SHOTS}/72-modo-suporte.png`, fullPage: true });
const antes = sql(`select strict_route_mode from companies where id = '${A}'`);
await nav('Ajustes de entrega');
await expand(page, 'Rotas');
await page.getByText('Modo rota exata').locator('xpath=../..').locator('input[type=checkbox]').first().click();
await page.getByText(/Modo suporte: só leitura/).first().waitFor({ timeout: 10000 });
check('tentativa de alterar mostra que é só leitura', true);
check('nada mudou no banco', sql(`select strict_route_mode from companies where id = '${A}'`) === antes);
await page.getByRole('button', { name: 'Voltar para a plataforma' }).click();
await page.waitForURL(/\/plataforma/);
check('volta para a plataforma', true);
check('entrada e saída do modo suporte no log',
  sql(`select string_agg(action, ',' order by id) from system_log where action like 'support_%'`) === 'support_start,support_stop');

// ───────── Gestor vê o aviso e o limite do plano ─────────
await login('a1@t');
await page.getByTestId('aviso-plataforma').filter({ hasText: 'Manutenção hoje' }).waitFor({ timeout: 10000 });
check('gestor vê o aviso da plataforma', true);
check('gestor vê que atingiu o limite do plano', await page.getByTestId('limite-plano').isVisible());
await page.screenshot({ path: `${SHOTS}/73-aviso-gestor.png`, fullPage: true });
await page.getByTestId('aviso-plataforma').getByRole('button', { name: 'Entendi' }).click();
await page.waitForTimeout(600);
check('aviso some depois do Entendi', (await page.getByTestId('aviso-plataforma').count()) === 0);
check('leitura registrada', sql(`select count(*) from platform_notice_reads`) === '1');
const novo = sql(`select count(*) from delivery_orders where company_id = '${A}'`);
check('limite do plano bloqueia pedido novo (banco)', (() => {
  try { sql(`set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false); insert into delivery_orders (company_id, customer_name, subtotal) values ('${A}', 'x', 1)`); return false; }
  catch { return true; }
})());
check('nenhum pedido entrou', sql(`select count(*) from delivery_orders where company_id = '${A}'`) === novo);

console.log('\nERROS:', errors.length ? errors : 'nenhum');
await browser.close();
process.exit(errors.length ? 1 : 0);
