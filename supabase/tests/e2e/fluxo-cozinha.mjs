// Modo cozinha: admin pega o link nos ajustes; a TV abre sem login e vê a
// fila de preparo com adicionais e observações; 3 a 5 por tela, fixo ou
// alternando; botões de preparo; link trocado deixa de funcionar.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS || '/tmp/shots';
mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const APP = 'http://localhost:4173';
const errors = [];
const expand = async (p, title) => {
  const h = p.locator('[role=button][aria-expanded]').filter({ hasText: new RegExp('^' + title) }).first();
  await h.waitFor();
  if ((await h.getAttribute('aria-expanded')) === 'false') await h.click();
  await p.waitForTimeout(300);
};
let expectRejected = false; // depois de trocar o link, o banco recusa o antigo (HTTP 400)
const check = (label, ok) => { console.log(ok ? '✓' : '✗', label); if (!ok) errors.push(`falhou: ${label}`); };
const A = 'aaaaaaaa-0000-0000-0000-000000000000';

// Fila: 6 pedidos recebidos; o mais antigo tem adicional e observação.
sql(`update delivery_orders set status = 'cancelled' where company_id = '${A}'`);
sql(`insert into products (company_id, kind, name, price) values ('${A}', 'addon', 'Cheddar', 4) on conflict do nothing`);
for (let i = 1; i <= 6; i++) {
  sql(`insert into delivery_orders (company_id, order_type, customer_name, status, created_at, notes)
       values ('${A}', 'local', 'Cliente ${i}', 'received', now() - interval '${30 - i} minutes', ${i === 1 ? "'capricha no molho'" : 'null'})`);
}
sql(`insert into delivery_order_items (order_id, company_id, name, variant, quantity, unit_price, notes, addons)
     select id, company_id, 'X-Bacon', 'Grande', 2, 20, 'sem cebola', '[{"name":"Cheddar","price":4}]'::jsonb
     from delivery_orders where customer_name = 'Cliente 1'`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/websocket|realtime|404|functions|ERR_TUNNEL/i.test(m.text())
    && !(expectRejected && /status of 400/.test(m.text()))) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}

// ───────── Admin pega o link ─────────
const admin = await newPage({ width: 1360, height: 900 });
await admin.goto(APP + '/login');
await admin.getByLabel('E-mail').fill('a1@t');
await admin.getByLabel('Senha').fill('senha123');
await admin.getByRole('button', { name: /^entrar$/i }).click();
await admin.waitForLoadState('networkidle');
check('aba pedidos tem o botão do modo cozinha', await admin.getByRole('button', { name: 'Modo cozinha' }).isVisible());
await admin.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Ajustes de entrega', exact: true }).click();
await expand(admin, 'Tela da cozinha');
await admin.getByRole('button', { name: 'Mostrar link da cozinha' }).click();
const link = await admin.getByLabel('Link da cozinha').inputValue();
check('link da cozinha gerado', /\/cozinha\/[0-9a-f]{64}$/.test(link));

// ───────── TV sem login ─────────
const tv = await newPage({ width: 1920, height: 1080 });
await tv.goto(link.replace(/^https?:\/\/[^/]+/, APP));
await tv.getByText('6 pedidos para preparar').waitFor({ timeout: 10000 });
check('TV sem login mostra 4 pedidos por padrão', (await tv.getByTestId('kitchen-order').count()) === 4);
check('mostra quantos ficaram de fora', await tv.getByText('+ 2 na fila').isVisible());
check('mais antigo primeiro, com opção', await tv.getByTestId('kitchen-order').first().getByText('2x X-Bacon (Grande)').isVisible());
check('adicional em destaque', await tv.getByText('+ Cheddar').isVisible());
check('observação do item', await tv.getByText('⚠ sem cebola').isVisible());
check('observação do pedido', await tv.getByText('Obs.: capricha no molho').isVisible());
check('não mostra valores', (await tv.getByText(/R\$/).count()) === 0);
await tv.screenshot({ path: `${SHOTS}/70-cozinha.png` });

// Ajustes desta tela: 3 por tela, alternando a cada 10 s.
await tv.getByRole('button', { name: 'Ajustes da tela' }).click();
await tv.getByLabel('Pedidos por tela').click();
await tv.getByRole('option', { name: '3 pedidos' }).click();
await tv.getByLabel('Quando houver mais pedidos').click();
await tv.getByRole('option', { name: 'Alternar as páginas por tempo' }).click();
await tv.getByLabel('Trocar de página a cada').click();
await tv.getByRole('option', { name: '10 segundos' }).click();
await tv.getByRole('button', { name: 'Salvar' }).click();
check('3 por tela', (await tv.getByTestId('kitchen-order').count()) === 3);
check('página 1 de 2', await tv.getByText('Página 1 de 2').isVisible());
await tv.getByText('Página 2 de 2').waitFor({ timeout: 13000 });
check('alterna sozinho para a página 2', await tv.getByText('Cliente 4', { exact: true }).isVisible());
await tv.reload();
await tv.getByText(/Página \d de 2/).waitFor();
check('ajuste fica salvo no aparelho', (await tv.getByTestId('kitchen-order').count()) === 3);

// Botões de preparo
await tv.getByRole('button', { name: 'Ajustes da tela' }).click();
await tv.getByLabel('Quando houver mais pedidos').click();
await tv.getByRole('option', { name: 'Fixo: mostra os mais antigos' }).click();
await tv.getByRole('button', { name: 'Salvar' }).click();
const first = tv.getByTestId('kitchen-order').first();
await first.getByRole('button', { name: 'Iniciar preparo' }).click();
await first.getByText('EM PREPARO').waitFor();
check('iniciar preparo grava no banco', sql(`select status from delivery_orders where customer_name = 'Cliente 1'`) === 'preparing');
await first.getByRole('button', { name: 'Pronto' }).click();
await tv.getByText('PRONTOS:').waitFor();
check('pronto sai da fila e vai para os prontos', sql(`select status from delivery_orders where customer_name = 'Cliente 1'`) === 'ready'
  && await tv.getByText('5 pedidos para preparar').isVisible());
await tv.screenshot({ path: `${SHOTS}/71-cozinha-prontos.png` });

// ───────── Admin que abre /cozinha vai para o link, sem a conta dele ─────────
const authHeaders = [];
admin.on('request', (r) => { if (/kitchen_(board|advance)/.test(r.url())) authHeaders.push(r.headers()['authorization'] || ''); });
await admin.goto(APP + '/cozinha');
await admin.getByText('5 pedidos para preparar').waitFor({ timeout: 10000 });
check('admin em /cozinha é levado para o link da cozinha', admin.url() === link);
await admin.getByTestId('kitchen-order').first().getByRole('button', { name: 'Iniciar preparo' }).click();
await admin.getByText('EM PREPARO').first().waitFor();
const adminJwt = await admin.evaluate(() => Object.keys(localStorage).filter((k) => /auth-token/.test(k)).map((k) => JSON.parse(localStorage[k])?.access_token).find(Boolean));
check('cozinha não usa a sessão do admin logado no aparelho',
  authHeaders.length > 0 && adminJwt && authHeaders.every((h) => !h.includes(adminJwt)));
check('ação da cozinha sai como "Tela da cozinha" no log, não como o admin',
  sql(`select actor_name from system_log where entity is not null order by id desc limit 1`) === 'Tela da cozinha');

// ───────── Gestor voltando da cozinha vê a mudança na hora ─────────
// (aqui não há tempo real: só a volta para a aba atualiza antes dos 30 s)
const painel = admin;
await painel.goto(APP + '/painel');
await painel.getByText('Cliente 2').first().waitFor({ timeout: 10000 });
// Quantos pedidos a coluna "Em preparo" mostra no cabeçalho.
const emPreparo = () => painel.evaluate(() => {
  const h = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim().toUpperCase() === 'EM PREPARO');
  return Number(h?.parentElement?.textContent.replace(/\D+/g, '') || -1);
});
const before = await emPreparo();
sql(`update delivery_orders set status = 'preparing' where customer_name = 'Cliente 3'`);
await painel.waitForTimeout(1000);
const semFoco = await emPreparo();
await painel.evaluate(() => window.dispatchEvent(new Event('focus')));
await painel.waitForTimeout(2000);
check('voltar para a aba do painel atualiza os pedidos na hora', semFoco === before && (await emPreparo()) === before + 1);

// ───────── Trocar o link derruba o antigo ─────────
await admin.goto(APP + '/painel');
await admin.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Ajustes de entrega', exact: true }).click();
await expand(admin, 'Tela da cozinha');
await admin.getByRole('button', { name: 'Mostrar link da cozinha' }).click();
await admin.getByRole('button', { name: 'Trocar link' }).click();
await admin.getByText('Link trocado').waitFor();
check('link novo é diferente', (await admin.getByLabel('Link da cozinha').inputValue()) !== link);
expectRejected = true;
await tv.reload();
await tv.getByText(/Link da cozinha inválido ou trocado/).waitFor({ timeout: 10000 });
check('TV com link antigo deixa de ver a fila', (await tv.getByTestId('kitchen-order').count()) === 0);

// ───────── Motoboy não abre ─────────
const courier = await newPage({ width: 412, height: 860 });
await courier.goto(APP + '/login');
await courier.getByLabel('E-mail').fill('c1@t');
await courier.getByLabel('Senha').fill('senha123');
await courier.getByRole('button', { name: /^entrar$/i }).click();
await courier.waitForLoadState('networkidle');
await courier.goto(APP + '/cozinha');
await courier.waitForTimeout(1500);
check('motoboy é mandado para a tela dele', !courier.url().endsWith('/cozinha'));

console.log('\nERROS:', errors.length ? errors : 'nenhum');
await browser.close();
process.exit(errors.length ? 1 : 0);
