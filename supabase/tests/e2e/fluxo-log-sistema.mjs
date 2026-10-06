// Teste no navegador do log do sistema: login errado, login, queda de
// internet e ajuste mudado aparecem no log da plataforma, com filtro,
// busca, detalhe (antes/depois) e modo ao vivo.
// Rodar depois de setup.sh e do preview (veja README.md).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS || '/tmp/shots'; mkdirSync(SHOTS, { recursive: true });
const APP = 'http://localhost:4173';
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const log = (...a) => console.log('•', ...a);
const errors = [];
let falhas = 0;
const check = (name, cond) => { console.log(cond ? 'PASSOU' : 'FALHOU', name); if (!cond) falhas++; };

async function login(page, email, password = 'senha123') {
  await page.context().clearCookies();
  await page.goto(APP + '/login');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(APP + '/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: /^entrar$/i }).click();
  await page.waitForLoadState('networkidle');
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/tile\.openstreetmap\.org|nominatim|osrm/, (r) => r.fulfill({ status: 200, body: '' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_INTERNET_DISCONNECTED|Failed to load resource|realtime\/v1|Failed to fetch/.test(m.text())) errors.push(m.text()); });

sql(`delete from system_log`);

// ---------------- Login errado, login certo, queda de internet ----------------
// (o auth de teste não confere senha: e-mail que não existe dá o mesmo erro)
await login(page, 'ninguem@t', 'errada99');
await page.waitForTimeout(800);
check('login errado registrado com o e-mail', sql(`select count(*) from system_log where action = 'login_failed' and message like '%ninguem@t'`) === '1');

await login(page, 'a1@t');
await page.waitForTimeout(1500);
check('entrada no sistema registrada com o gestor', sql(`select actor_name || '|' || company_name from system_log where action = 'session_start'`) === 'A1|Empresa A');

await ctx.setOffline(true);
await page.waitForTimeout(1500);
await ctx.setOffline(false);
await page.waitForTimeout(2500);
const net = sql(`select message from system_log where action = 'connection_restored'`);
log('evento de conexão:', net);
check('volta da internet registrada com o tempo sem conexão', /^Internet voltou depois de \d+ s sem conexão$/.test(net));
check('aparelho vai junto', sql(`select details->'aparelho'->>'navegador' from system_log where action = 'connection_restored'`) === 'Chrome');

// Ajuste mudado pelo gestor (pelo banco, como a tela faria).
sql(`begin; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
     update companies set auto_max_stops = 6, auto_hold_minutes = 3 where id = 'aaaaaaaa-0000-0000-0000-000000000000'; commit;`);

await page.locator('header button:has(.MuiAvatar-root), button:has(.MuiAvatar-root)').last().click();
await page.getByRole('menuitem', { name: 'Sair' }).click();
await page.waitForTimeout(1500);
check('saída do sistema registrada', sql(`select count(*) from system_log where action = 'logout' and actor_name = 'A1'`) === '1');

// ---------------- Plataforma lê o log ----------------
await login(page, 'p@t');
await page.getByText('Log do sistema', { exact: true }).click();
await page.getByTestId('log-row').first().waitFor();
const rows = await page.getByTestId('log-row').count();
log('linhas na tela:', rows);
check('log mostra os eventos', rows >= 4);
check('linha do ajuste com nome dos campos', await page.getByText(/Ajustes alterados: .*máximo de entregas por saída/).isVisible());
check('login errado aparece como aviso', await page.getByText('Tentativa de login sem sucesso para ninguem@t').isVisible());
await page.screenshot({ path: `${SHOTS}/40-log-sistema.png`, fullPage: true });

await page.getByText(/Ajustes alterados: /).first().click();
check('detalhe mostra antes e depois', await page.getByRole('cell', { name: 'máximo de entregas por saída' }).isVisible()
  && await page.getByRole('cell', { name: '6', exact: true }).isVisible());
check('detalhe mostra quem mudou', await page.getByText(/A1 · a1@t · gestor/).isVisible());
await page.screenshot({ path: `${SHOTS}/41-log-detalhe.png`, fullPage: true });

await page.getByRole('button', { name: 'Conexão' }).click();
await page.waitForTimeout(800);
const onlyNet = await page.getByTestId('log-row').allInnerTexts();
check('filtro de tópico mostra só conexão', onlyNet.length > 0 && onlyNet.every((t) => t.includes('rede,')));
await page.getByRole('button', { name: 'Conexão' }).click();

await page.getByLabel(/Buscar/).fill('login sem sucesso');
await page.waitForTimeout(1200);
check('busca encontra pelo texto', (await page.getByTestId('log-row').count()) === 1);
await page.getByLabel(/Buscar/).fill('');
await page.waitForTimeout(1200);

// Ao vivo: evento novo aparece sozinho.
sql(`begin; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
     select start_shift(); commit;`);
await page.getByText('C1 iniciou o expediente').waitFor({ timeout: 9000 }).catch(() => {});
check('ao vivo: evento novo aparece sem recarregar', await page.getByText('C1 iniciou o expediente').isVisible());

// Celular.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('no celular não sobra para o lado', !overflow);
await page.screenshot({ path: `${SHOTS}/42-log-celular.png`, fullPage: false });

// Gestor não acessa.
check('gestor não lê o log pela API', sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true); select count(*) from system_log; commit;`).split('\n').includes('0'));

log('erros no console:', errors.length ? errors : 'nenhum');
check('sem erros no console', errors.length === 0);
await browser.close();
console.log(falhas ? `---- ${falhas} falha(s)` : '---- tudo certo');
process.exit(falhas ? 1 : 0);
