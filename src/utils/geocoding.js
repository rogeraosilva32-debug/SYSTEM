import { hasGoogleMaps, googleSuggest, googlePlace, googleGeocode } from "./googleMaps";
// Geocodificação via Nominatim (OpenStreetMap) — usado tanto pra endereço de
// serviço (Booking) quanto pra localização base do profissional (Profile).

export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};
    const streetName = [addr.road, addr.pedestrian, addr.footway, addr.suburb].filter(Boolean).join(" ");
    return {
      street: streetName || "",
      neighborhood: addr.neighbourhood || addr.suburb || addr.city_district || "",
      city: addr.city || addr.town || addr.village || "",
      display: data.display_name || "",
    };
  } catch {
    return null;
  }
}

// Remove acentos e caixa pra comparar "Sao paulo" com "São Paulo" sem diferença
function normalize(str) {
  return String(str || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

// Confere se a cidade que o Nominatim REALMENTE encontrou bate com a que a
// pessoa digitou. Sem isso, um endereço inventado (rua que não existe nesse
// bairro/cidade) pode "casar" com uma rua de mesmo nome em outro lugar do
// Brasil, e a gente aceitaria uma coordenada errada sem perceber.
function cityMatches(result, typedCity) {
  if (!typedCity) return true; // pessoa não informou cidade, não dá pra validar
  const found = result?.address || {};
  const foundCity = normalize(found.city || found.town || found.village || found.municipality);
  const typed = normalize(typedCity);
  if (!foundCity) return false;
  return foundCity.includes(typed) || typed.includes(foundCity);
}

export async function forwardGeocode({ street, number, neighborhood, city }) {
  const streetQuery = [street, number].filter(Boolean).join(", ");
  // Nominatim não tem um campo próprio pra "bairro" na busca estruturada —
  // combinar com a cidade funciona bem melhor do que jogar tudo junto num
  // texto livre (que confunde nomes genéricos como "Centro").
  const cityQuery = [neighborhood, city].filter(Boolean).join(", ");

  if (!streetQuery && !cityQuery) return null;

  try {
    const params = new URLSearchParams({ format: "json", limit: "1", countrycodes: "br", addressdetails: "1" });
    if (streetQuery) params.set("street", streetQuery);
    if (cityQuery) params.set("city", cityQuery);

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    const data = await res.json();
    if (data?.[0] && cityMatches(data[0], city)) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch {
    // segue pro fallback abaixo
  }

  // Fallback: busca estruturada às vezes não acha nada (endereço incompleto,
  // typo, etc.) — tenta de novo como texto livre antes de desistir.
  const q = [street, number, neighborhood, city, "Brasil"].filter(Boolean).join(", ");
  if (!q) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&addressdetails=1&q=${encodeURIComponent(q)}`
    );
    const data = await res.json();
    if (data?.[0] && cityMatches(data[0], city)) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch {
    // segue sem coordenadas
  }
  return null;
}

export function getCurrentPosition(options = { enableHighAccuracy: false, timeout: 20000 }) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("GPS não disponível nesse dispositivo.")); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

// Traça uma rota de verdade (seguindo ruas, não linha reta) entre dois
// pontos, usando o servidor público e gratuito do OSRM — mesma filosofia do
// Nominatim usado no resto do app: sem custo, sem chave de API, mas é um
// serviço comunitário/demo com limite de uso; pra um volume grande de
// usuários simultâneos, valeria contratar um provedor pago (Mapbox/Google/
// OSRM auto-hospedado) no futuro.
export async function fetchRoute(fromLat, fromLng, toLat, toLng) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (!coords) return null;
    // GeoJSON vem como [lng, lat] — Leaflet espera [lat, lng].
    return {
      path: coords.map(([lng, lat]) => [lat, lng]),
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    };
  } catch {
    return null;
  }
}

// Busca sugestões de endereços REAIS conforme a pessoa digita (autocomplete).
// Como só é possível escolher um resultado que o Nominatim realmente
// encontrou, não tem como cadastrar um endereço inventado — resolve o
// problema de precisão sem precisar de nenhum serviço pago.
export async function searchAddressSuggestions(query) {
  const q = query?.trim();
  if (!q || q.length < 3) return [];

  try {
    const params = new URLSearchParams({
      format: "json", limit: "5", countrycodes: "br", addressdetails: "1", q,
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();

    return (data || []).map((item) => {
      const addr = item.address || {};
      return {
        display: item.display_name,
        street: [addr.road, addr.pedestrian, addr.footway].filter(Boolean).join(" ") || "",
        neighborhood: addr.neighbourhood || addr.suburb || addr.city_district || "",
        city: addr.city || addr.town || addr.village || addr.municipality || "",
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
      };
    });
  } catch {
    return [];
  }
}

// ── Busca de endereço de entrega (pedido e loja) ──────────────────────────
// Com a chave do Google configurada (VITE_GOOGLE_MAPS_API_KEY), usa o Google,
// que acha o número da casa. Sem ela, usa OpenStreetMap (Photon para as
// sugestões e Nominatim), que no Brasil quase nunca tem o número: o ponto
// fica na rua. O CEP (ViaCEP) preenche rua, bairro e cidade oficiais.

const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const sameCity = (a, b) => !a || !b || norm(a).includes(norm(b)) || norm(b).includes(norm(a));
const STREET_TYPES = /^(rua|r\.|avenida|av\.?|travessa|tv\.?|alameda|al\.?|estrada|rodovia|praca|praça|largo|viela|beco|via|servidao|servidão)\b/i;

// Prefere resultados perto da loja (caixa de ~40 km em volta dela).
function nearParams(near) {
  if (!near?.lat || !near?.lng) return {};
  const d = 0.35;
  return { viewbox: `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`, bounded: "0" };
}

// Precisão real do que foi achado (não do que foi pedido): número, rua ou só a região.
function nominatimResult(item) {
  const addr = item.address || {};
  const street = [addr.road, addr.pedestrian, addr.footway].filter(Boolean).join(" ") || "";
  const precision = addr.house_number ? "number" : item.class === "highway" || (street && item.class !== "place" && item.class !== "boundary") ? "street" : "neighborhood";
  return {
    display: item.display_name, street, number: addr.house_number || "",
    neighborhood: addr.neighbourhood || addr.suburb || addr.city_district || addr.quarter || "",
    city: addr.city || addr.town || addr.village || addr.municipality || "",
    state: addr.state || "", lat: parseFloat(item.lat), lng: parseFloat(item.lon), precision,
  };
}

function photonResult(f) {
  const p = f.properties || {};
  const isStreet = p.osm_key === "highway" || p.type === "street";
  const street = p.street || (isStreet ? p.name : "") || "";
  const precision = p.housenumber ? "number" : street ? "street" : "neighborhood";
  const neighborhood = p.district || p.locality || (p.type === "district" || p.type === "locality" ? p.name : "") || "";
  const display = [
    [street || (!isStreet ? p.name : ""), p.housenumber].filter(Boolean).join(", "),
    neighborhood, [p.city, p.state].filter(Boolean).join(" - "),
  ].filter(Boolean).join(" · ");
  return {
    display, street, number: p.housenumber || "", neighborhood, city: p.city || p.county || "", state: p.state || "",
    lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], precision, country: p.countrycode,
  };
}

async function nominatim(params) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    format: "json", countrycodes: "br", addressdetails: "1", "accept-language": "pt-BR", ...params,
  })}`);
  if (!res.ok) throw new Error(`Busca de endereço indisponível (${res.status}).`);
  return ((await res.json()) || []).map(nominatimResult);
}

async function photon(q, near, limit = 6) {
  const params = new URLSearchParams({ q, limit: String(limit + 4), lang: "default" });
  if (near?.lat) { params.set("lat", near.lat); params.set("lon", near.lng); }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features || []).map(photonResult).filter((r) => !r.country || r.country === "BR").slice(0, limit);
}

// CEP → rua, bairro, cidade e UF (ViaCEP, gratuito).
export async function lookupCep(cep) {
  const digits = String(cep || "").replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  if (!res.ok) return null;
  const d = await res.json();
  if (d.erro) return null;
  return { street: d.logradouro || "", neighborhood: d.bairro || "", city: d.localidade || "", state: d.uf || "", cep: digits };
}

export const addressProvider = hasGoogleMaps ? "google" : "osm";

// Sugestões enquanto digita (texto livre: "rua direita 100 centro").
export async function suggestAddresses(text, near) {
  const q = text?.trim();
  if (!q || q.length < 4) return [];
  if (hasGoogleMaps) {
    try { return await googleSuggest(q, near); } catch { /* cai no OpenStreetMap */ }
  }
  let list = [];
  try { list = await photon(q, near); } catch { /* tenta o Nominatim */ }
  if (list.length < 3) {
    try {
      const more = await nominatim({ q, limit: "6", ...nearParams(near) });
      const seen = new Set(list.map((r) => `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`));
      list = [...list, ...more.filter((r) => !seen.has(`${r.lat.toFixed(4)},${r.lng.toFixed(4)}`))];
    } catch { /* fica com o que tiver */ }
  }
  return list.slice(0, 6);
}

// Detalhe de uma sugestão (no Google, a sugestão ainda não traz o ponto).
export async function resolveSuggestion(s) {
  if (s.placePrediction) return googlePlace(s.placePrediction);
  return s;
}

const RANK = { number: 3, street: 2, neighborhood: 1 };

// Acha o ponto de um endereço digitado em campos e diz a precisão real
// (número, rua ou bairro). Tenta várias formas e fica com a mais precisa.
export async function locateAddress({ street, number, neighborhood, city, state }, near) {
  const where = [city, state].filter(Boolean).join(", ");
  if (hasGoogleMaps) {
    try {
      const r = await googleGeocode([[street, number].filter(Boolean).join(", "), neighborhood, where, "Brasil"].filter(Boolean).join(", "), near);
      if (r && sameCity(r.city, city)) return r;
    } catch { /* cai no OpenStreetMap */ }
  }
  const streets = street ? [street] : [];
  if (street && !STREET_TYPES.test(street.trim())) streets.push(`Rua ${street}`);
  const tries = [];
  for (const st of streets) {
    if (number) tries.push(() => photon([st, number, city].filter(Boolean).join(" "), near, 3));
    tries.push(() => nominatim({ street: [number, st].filter(Boolean).join(" "), city: city || "", state: state || "", limit: "3", ...nearParams(near) }));
    tries.push(() => nominatim({ q: [st, where].filter(Boolean).join(", "), limit: "3", ...nearParams(near) }));
    tries.push(() => photon([st, city].filter(Boolean).join(" "), near, 3));
    if (neighborhood) tries.push(() => nominatim({ q: [st, neighborhood, where].filter(Boolean).join(", "), limit: "3", ...nearParams(near) }));
  }
  if (neighborhood) tries.push(() => nominatim({ q: [neighborhood, where].filter(Boolean).join(", "), limit: "1", ...nearParams(near) }));

  let best = null;
  const want = norm(street).replace(STREET_TYPES, "").trim();
  for (const t of tries) {
    let results;
    try { results = await t(); } catch { continue; }
    for (const r of results) {
      if (!sameCity(r.city, city)) continue;
      // Resultado de rua precisa ser a rua digitada, não outra parecida.
      if (r.precision !== "neighborhood" && want && !norm(r.street).includes(want.split(" ").slice(-1)[0])) continue;
      if (r.precision === "number" && number && norm(r.number) !== norm(number)) r.precision = "street";
      if (!best || RANK[r.precision] > RANK[best.precision]) best = r;
      if (best.precision === "number" || (best.precision === "street" && !number)) return best;
    }
    if (best?.precision === "street" && tries.indexOf(t) > 2) return best;
  }
  return best;
}

// Rota passando por vários pontos em ordem ([{lat,lng}, ...]), para mostrar
// o trajeto completo de uma saída (loja → paradas).
export async function fetchMultiStopRoute(points) {
  const pts = points.filter((p) => p?.lat && p?.lng);
  if (pts.length < 2) return null;
  try {
    const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    if (!res.ok) return null;
    const route = (await res.json())?.routes?.[0];
    if (!route) return null;
    return {
      path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      legs: (route.legs || []).map((l) => ({ distanceMeters: l.distance, durationSeconds: l.duration })),
    };
  } catch {
    return null;
  }
}
