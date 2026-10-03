// Utilidades do módulo de entregas: rótulos da fila, links de navegação
// (Google Maps / Waze / WhatsApp), sugestão de ordem das paradas e busca de
// rotas alternativas.

export const ORDER_STATUS = {
  received: { label: "Recebido", bg: "#F5F5F4", fg: "#57534E" },
  preparing: { label: "Em preparo", bg: "#FBF3EA", fg: "#B0793D" },
  ready: { label: "Pronto", bg: "#EEF2F6", fg: "#4A6C8C" },
  on_route: { label: "Em rota", bg: "#EEF0FA", fg: "#4F5BA6" },
  delivered: { label: "Entregue", bg: "#EEF3EF", fg: "#4B7A5E" },
  problem: { label: "Problema", bg: "#F6EBEA", fg: "#B0463D" },
  cancelled: { label: "Cancelado", bg: "#F5F5F4", fg: "#A8A29E" },
};

export const PAYMENT_LABEL = { dinheiro: "Dinheiro", cartao: "Cartão", pix: "Pix", online: "Pago online" };
export const SOURCE_LABEL = { balcao: "Balcão", telefone: "Telefone", whatsapp: "WhatsApp", ifood: "iFood", outro: "Outro" };

export function money(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function orderAddress(o) {
  const street = [o.address_street, o.address_number].filter(Boolean).join(", ");
  return [street, o.address_complement, o.address_neighborhood, o.address_city].filter(Boolean).join(" · ");
}

export function whatsappUrl(phone, message) {
  const digits = (phone || "").replace(/\D/g, "");
  // Sem DDI o WhatsApp não acha a conversa; número com até 11 dígitos é
  // DDD + número brasileiro.
  const withCountry = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}

export function deliveryCodeMessage(companyName, order, code) {
  return `Olá, ${order.customer_name}! Seu pedido #${order.number} da ${companyName} está a caminho. ` +
    `Na entrega, informe ao entregador o código: ${code}`;
}

// Google Maps abre com todas as paradas (a origem é a posição atual do
// celular). O link oficial aceita até 9 pontos intermediários.
export const GOOGLE_MAX_WAYPOINTS = 9;
export function googleMapsUrl(stops) {
  const pts = stops.filter((s) => s.lat && s.lng);
  if (pts.length === 0) return null;
  const dest = pts[pts.length - 1];
  const params = new URLSearchParams({ api: "1", destination: `${dest.lat},${dest.lng}`, travelmode: "driving" });
  const middle = pts.slice(0, -1).slice(0, GOOGLE_MAX_WAYPOINTS);
  if (middle.length) params.set("waypoints", middle.map((p) => `${p.lat},${p.lng}`).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// Waze só navega para um destino por vez.
export function wazeUrl(stop) {
  if (!stop?.lat || !stop?.lng) return null;
  return `https://waze.com/ul?ll=${stop.lat},${stop.lng}&navigate=yes`;
}

export function distanceMeters(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Distância (m) de um ponto até uma linha [[lat,lng],...], projetando em
// cada segmento (mais preciso que comparar só com os vértices).
export function distanceToPath(point, path) {
  if (!path?.length) return Infinity;
  const toXY = (lat, lng) => ({
    x: lng * 111320 * Math.cos(point.lat * Math.PI / 180),
    y: lat * 110540,
  });
  const p = toXY(point.lat, point.lng);
  let min = Infinity;
  for (let i = 0; i < path.length; i++) {
    const a = toXY(path[i][0], path[i][1]);
    const b = i + 1 < path.length ? toXY(path[i + 1][0], path[i + 1][1]) : a;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < min) min = d;
  }
  return min;
}

function neighborhoodKey(o) {
  return (o.address_neighborhood || "Sem bairro")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

// Agrupa pedidos por bairro (para o despachante montar saídas).
export function groupByNeighborhood(orders) {
  const groups = new Map();
  for (const o of orders) {
    const key = neighborhoodKey(o);
    if (!groups.has(key)) groups.set(key, { key, name: o.address_neighborhood || "Sem bairro", orders: [] });
    groups.get(key).orders.push(o);
  }
  return [...groups.values()].sort((a, b) => b.orders.length - a.orders.length);
}

// Sugere a ordem das paradas: termina um bairro antes de ir para o próximo
// e, dentro dele, vai sempre para o ponto mais próximo (vizinho mais
// próximo). `start` é a posição de saída (ex.: o motoboy), se conhecida.
export function suggestStopOrder(orders, start = null) {
  const remaining = [...orders];
  const result = [];
  let pos = start;
  while (remaining.length) {
    const located = remaining.filter((o) => o.lat && o.lng);
    let next;
    if (!located.length) {
      next = remaining[0];
    } else if (!pos) {
      next = located[0];
    } else {
      // Prefere continuar no mesmo bairro da última parada.
      const lastKey = result.length ? neighborhoodKey(result[result.length - 1]) : null;
      const sameHood = lastKey ? located.filter((o) => neighborhoodKey(o) === lastKey) : [];
      const pool = sameHood.length ? sameHood : located;
      next = pool.reduce((best, o) => (distanceMeters(pos, o) < distanceMeters(pos, best) ? o : best));
    }
    result.push(next);
    remaining.splice(remaining.indexOf(next), 1);
    if (next.lat && next.lng) pos = { lat: next.lat, lng: next.lng };
  }
  return result;
}

// Até 3 rotas entre dois pontos: a primeira é a mais rápida, as outras são
// alternativas. Usa OSRM (o mesmo serviço do resto do app). Em trajetos
// curtos podem existir menos de 3 caminhos diferentes.
export async function fetchRouteOptions(from, to) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
      "?overview=full&geometries=geojson&alternatives=3";
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.routes || [])
      .slice(0, 3)
      .map((r) => ({
        path: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        distanceMeters: r.distance,
        durationSeconds: r.duration,
      }))
      .sort((a, b) => a.durationSeconds - b.durationSeconds);
  } catch {
    return [];
  }
}

export const ROUTE_COLORS = ["#1C1917", "#4F5BA6", "#B0793D"];
export const ROUTE_NAMES = ["Principal (mais rápida)", "Alternativa 1", "Alternativa 2"];
