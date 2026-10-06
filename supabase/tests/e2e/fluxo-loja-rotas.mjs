// Teste no navegador: endereço da loja, pedido com endereço digitado (sem GPS
// do aparelho), rota da loja até as paradas para o motoboy mesmo sem GPS e
// trajeto previsto no mapa ao vivo. Rodar depois de setup.sh e do preview.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS || '/tmp/shots'; mkdirSync(SHOTS, { recursive: true });
const APP = 'http://localhost:4173';
const sql = (q) => execSync(`sudo -u postgres psql -X -At -d sistema_e2e -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const log = (...a) => console.log('•', ...a);
const errors = [];
const cont = (p) => p.getByRole('button', { name: 'Continuar' }).click();
const nominatimCalls = [];
const photonCalls = [];

// Nominatim simulado: acha qualquer endereço, menos os que têm "Inexistente".
const PLACES = {
  direita: { road: 'Rua Direita', house_number: '100', suburb: 'Sé', lat: -23.5489, lon: -46.6350 },
  paulista: { road: 'Avenida Paulista', house_number: '1000', suburb: 'Bela Vista', lat: -23.5631, lon: -46.6544 },
  augusta: { road: 'Rua Augusta', house_number: '500', suburb: 'Consolação', lat: -23.5530, lon: -46.6520 },
};
async function mockExternal(ctx) {
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
  await ctx.route(/nominatim\.openstreetmap\.org/, (r) => {
    const u = new URL(r.request().url());
    const text = [...u.searchParams.entries()].map(([, v]) => v).join(' ').toLowerCase();
    nominatimCalls.push(Object.fromEntries(u.searchParams));
    if (text.includes('inexistente')) return r.fulfill({ json: [] });
    const key = Object.keys(PLACES).find((k) => text.includes(k)) || 'augusta';
    const p = PLACES[key];
    r.fulfill({ json: [{
      lat: String(p.lat), lon: String(p.lon), display_name: `${p.road}, ${p.house_number}, ${p.suburb}, São Paulo - SP`,
      address: { road: p.road, house_number: p.house_number, suburb: p.suburb, city: 'São Paulo', state: 'São Paulo' },
    }] });
  });
  // Photon simulado: igual ao Nominatim; "adelina" é rua sem números no mapa (comum no Brasil).
  await ctx.route(/photon\.komoot\.io/, (r) => {
    const u = new URL(r.request().url());
    const q = (u.searchParams.get('q') || '').toLowerCase();
    photonCalls.push(Object.fromEntries(u.searchParams));
    if (q.includes('inexistente')) return r.fulfill({ json: { features: [] } });
    if (q.includes('adelina')) return r.fulfill({ json: { features: [{
      geometry: { coordinates: [-45.4300, -21.5600] },
      properties: { osm_key: 'highway', type: 'street', name: 'Rua Adelina Garcia Chagas', district: 'Rio Verde II', city: 'São Paulo', state: 'São Paulo', countrycode: 'BR' },
    }] } });
    const key = Object.keys(PLACES).find((k) => q.includes(k)) || 'augusta';
    const p = PLACES[key];
    r.fulfill({ json: { features: [{
      geometry: { coordinates: [p.lon, p.lat] },
      properties: { osm_key: 'place', type: 'house', street: p.road, housenumber: p.house_number, district: p.suburb, city: 'São Paulo', state: 'São Paulo', countrycode: 'BR' },
    }] } });
  });
  await ctx.route(/viacep\.com\.br/, (r) => r.fulfill({ json: r.request().url().includes('37000000') ? { erro: true }
    : { logradouro: 'Rua Augusta', bairro: 'Consolação', localidade: 'São Paulo', uf: 'SP' } }));
  await ctx.route(/router\.project-osrm\.org/, (r) => {
    const u = new URL(r.request().url());
    const pts = u.pathname.split('/').pop().split(';').map((p) => p.split(',').map(Number));
    const coords = pts.flatMap((p, i) => (i ? [[(pts[i - 1][0] + p[0]) / 2 + 0.001, (pts[i - 1][1] + p[1]) / 2], p] : [p]));
    const base = { geometry: { coordinates: coords }, distance: 2500 * (pts.length - 1), duration: 420 * (pts.length - 1),
      legs: pts.slice(1).map(() => ({ distance: 2500, duration: 420 })) };
    r.fulfill({ json: { routes: u.searchParams.get('alternatives') ? [base, { ...base, duration: base.duration + 60 }] : [base] } });
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
  page.on('console', (m) => { if (m.type() === 'error' && !/websocket|realtime|404|functions/i.test(m.text())) errors.push(`${who}: ${m.text()}`); });
}
const polylines = (page) => page.locator('path.leaflet-interactive').count();

sql(`update companies set strict_route_mode = false, feature_delivery_code = false where id = 'aaaaaaaa-0000-0000-0000-000000000000'`);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

// ───────── Admin: endereço da loja ─────────
const adminCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await mockExternal(adminCtx);
const admin = await adminCtx.newPage(); watch(admin, 'admin');
await login(admin, 'a1@t');
await admin.getByText('Entregas: ajustes', { exact: true }).click();
await admin.getByText('Endereço da loja (ponto de partida)').waitFor();
await admin.getByLabel('Buscar endereço').fill('Rua Direita 100');
await admin.getByRole('menuitem', { name: /Rua Direita, 100/ }).click();
log('sugestões usaram a posição da busca:', photonCalls.length > 0);
await admin.getByText('✓ Endereço localizado no mapa.').waitFor();
await admin.getByRole('button', { name: 'Salvar endereço da loja' }).click();
await admin.getByText('Endereço da loja salvo.').waitFor();
log('loja no banco:', sql(`select store_street||', '||store_number||' · '||store_neighborhood||' · '||store_city||' ('||store_lat||','||store_lng||')' from companies where name='Empresa A'`));
await admin.screenshot({ path: `${SHOTS}/30-endereco-loja.png`, fullPage: true });

// ───────── Admin: pedido com endereço digitado ─────────
await admin.reload(); await admin.waitForLoadState('networkidle');
await admin.getByText('Pedidos', { exact: true }).first().click();
await admin.getByRole('button', { name: 'Novo pedido' }).click();
await admin.getByLabel('Nome do cliente').fill('Rua Errada');
await cont(admin);
log('botão de GPS do aparelho no pedido:', await admin.getByText(/localização deste aparelho/).count());
await admin.getByLabel('Rua').fill('Rua Inexistente');
await admin.getByLabel('Número').fill('1');
await admin.getByText(/Não achei esse endereço no mapa/).waitFor({ timeout: 8000 });
await cont(admin);
await admin.getByText(/Não achei esse endereço no mapa. Confira o endereço, use/).waitFor();
log('pedido sem ponto no mapa: não passa da etapa do endereço, pede para marcar no mapa');
// marca o ponto clicando no mapa
const map = admin.locator('.MuiDialog-root .leaflet-container');
const box = await map.boundingBox();
await admin.mouse.click(box.x + box.width / 2 + 30, box.y + box.height / 2);
await admin.getByText('✓ Ponto marcado no mapa.').waitFor();
await cont(admin);
await admin.getByLabel('Adicionar produto do cardápio').fill('Misto');
await admin.getByRole('option', { name: /Misto quente/ }).click();
await admin.getByRole('button', { name: /^Adicionar R\$/ }).click();
await cont(admin);
await admin.getByRole('button', { name: 'Criar pedido' }).click();
await admin.getByText('Rua Errada').first().waitFor();
log('pedido com ponto marcado à mão:', sql(`select (lat is not null)::text||' cidade='||coalesce(address_city,'-') from delivery_orders where customer_name='Rua Errada'`));

// rua que o mapa conhece mas sem números: avisa com honestidade
await admin.getByRole('button', { name: 'Novo pedido' }).click();
await admin.getByLabel('Nome do cliente').fill('Teste Rua');
await cont(admin);
await admin.getByLabel('Rua').fill('adelina garcia chagas');
await admin.getByLabel('Número').fill('45');
await admin.getByText(/Localizada a rua. O mapa gratuito não tem os números/).waitFor({ timeout: 8000 });
log('rua sem números no mapa: aviso de rua (não de número)');
// CEP preenche rua, bairro e cidade
await admin.getByLabel('CEP (opcional)').fill('01305000');
await admin.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => i.value === 'Consolação'));
log('CEP preencheu:', await admin.getByLabel('Rua').inputValue(), '·', await admin.getByLabel('Bairro').inputValue(), '·', await admin.getByLabel('Cidade').inputValue());
await admin.getByLabel('CEP (opcional)').fill('37000000');
await admin.getByText('CEP não encontrado.').waitFor();
await admin.getByLabel('Bairro').fill('');
await admin.keyboard.press('Escape');
await admin.waitForTimeout(400);

await admin.getByRole('button', { name: 'Novo pedido' }).click();
await admin.getByLabel('Nome do cliente').fill('Paula Prado');
await cont(admin);
await admin.getByLabel('Rua').fill('Avenida Paulista');
await admin.getByLabel('Número').fill('1000');
await admin.getByText('✓ Endereço localizado no mapa.').waitFor({ timeout: 8000 });
await cont(admin);
const call = photonCalls.at(-1);
log('busca do pedido usou a cidade e a posição da loja:', `q=${call.q} perto=${call.lat ? 'sim' : 'não'}`);
await admin.getByLabel('Adicionar produto do cardápio').fill('Misto');
await admin.getByRole('option', { name: /Misto quente/ }).click();
await admin.getByRole('button', { name: /^Adicionar R\$/ }).click();
await admin.screenshot({ path: `${SHOTS}/31-pedido-endereco.png` });
await cont(admin);
await admin.getByRole('button', { name: 'Criar pedido' }).click();
await admin.getByText('Paula Prado').first().waitFor();
log('pedido digitado no banco:', sql(`select address_neighborhood||' · '||address_city||' ('||round(lat::numeric,4)||','||round(lng::numeric,4)||')' from delivery_orders where customer_name='Paula Prado'`));

// detalhe mostra a rota da loja até o cliente
await admin.getByText('Paula Prado').first().click();
await admin.waitForTimeout(1200);
log('rota loja → cliente no detalhe do pedido:', (await polylines(admin)) > 0);
await admin.screenshot({ path: `${SHOTS}/32-pedido-rota-loja.png` });
await admin.keyboard.press('Escape');

// despacha Paula + Ana para o C1
sql(`update delivery_orders set status='ready' where customer_name in ('Paula Prado')`);
await admin.reload(); await admin.waitForLoadState('networkidle');
for (const name of ['Ana Souza', 'Paula Prado']) {
  const card = admin.locator('div').filter({ has: admin.getByText(name) }).filter({ has: admin.locator('input[type=checkbox]') }).last();
  await card.locator('input[type=checkbox]').check();
}
await admin.getByRole('button', { name: /Despachar \(2\)/ }).click();
await admin.getByLabel('Motoboy').click();
await admin.getByRole('option', { name: 'C1' }).click();
await admin.getByRole('button', { name: /^Despachar$/ }).click();
await admin.getByText('SAÍDAS EM ANDAMENTO').waitFor();
await admin.waitForTimeout(800);
log('ordem sugerida a partir da loja:', sql(`select string_agg(customer_name, ' → ' order by stop_sequence) from delivery_orders where run_id is not null`));

// ───────── Motoboy SEM GPS ─────────
const courierCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mockExternal(courierCtx);
const courier = await courierCtx.newPage(); watch(courier, 'motoboy');
await login(courier, 'c1@t');
await courier.getByRole('button', { name: 'Confirmar saída para entrega' }).waitFor();
await courier.getByText(/Trajeto da loja por 2 parada/).waitFor();
log('saída planejada mostra o trajeto:', await courier.getByText(/Trajeto da loja por 2 parada/).innerText());
await courier.screenshot({ path: `${SHOTS}/33-motoboy-trajeto.png`, fullPage: true });
await courier.getByRole('button', { name: 'Confirmar saída para entrega' }).click();
await courier.getByText('Principal (mais rápida)').waitFor();
log('rotas da 1ª parada sem GPS:', await courier.getByText(/min · .* km/).count(), 'opção(ões)');
await courier.screenshot({ path: `${SHOTS}/34-motoboy-rota-sem-gps.png`, fullPage: true });

// ───────── Mapa ao vivo ─────────
await admin.getByText('Mapa ao vivo', { exact: true }).click();
await admin.waitForTimeout(2000);
log('mapa ao vivo com trajeto previsto:', (await polylines(admin)) > 0);
await admin.screenshot({ path: `${SHOTS}/35-mapa-ao-vivo-rota.png` });

console.log('\nERROS NO NAVEGADOR:', errors.length ? errors : 'nenhum');
await browser.close();
