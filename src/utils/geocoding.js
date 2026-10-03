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
// Prefere resultados perto da loja (caixa de ~40 km em volta dela), para que
// "Rua das Flores, 10" ache a rua da cidade da loja e não outra do Brasil.
function nearParams(near) {
  if (!near?.lat || !near?.lng) return {};
  const d = 0.35;
  return { viewbox: `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`, bounded: "0" };
}

function toResult(item) {
  const addr = item.address || {};
  return {
    display: item.display_name,
    street: [addr.road, addr.pedestrian, addr.footway].filter(Boolean).join(" ") || "",
    number: addr.house_number || "",
    neighborhood: addr.neighbourhood || addr.suburb || addr.city_district || addr.quarter || "",
    city: addr.city || addr.town || addr.village || addr.municipality || "",
    state: addr.state || "",
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
  };
}

async function nominatim(params) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    format: "json", countrycodes: "br", addressdetails: "1", "accept-language": "pt-BR", ...params,
  })}`);
  if (!res.ok) throw new Error(`Busca de endereço indisponível (${res.status}).`);
  return res.json();
}

// Sugestões enquanto digita (texto livre: "rua direita 100 centro").
export async function suggestAddresses(text, near) {
  const q = text?.trim();
  if (!q || q.length < 4) return [];
  const data = await nominatim({ q, limit: "6", ...nearParams(near) });
  return (data || []).map(toResult);
}

// Acha o ponto de um endereço digitado em campos. Tenta do mais preciso
// (rua + número) ao menos preciso (só a rua; depois bairro) e diz qual foi.
export async function locateAddress({ street, number, neighborhood, city, state }, near) {
  const where = [city, state].filter(Boolean).join(", ");
  const attempts = [];
  if (street) {
    attempts.push({ precision: number ? "number" : "street", params: { street: [number, street].filter(Boolean).join(" "), city: city || "", state: state || "" } });
    attempts.push({ precision: number ? "number" : "street", params: { q: [street, number, neighborhood, where].filter(Boolean).join(", ") } });
    if (number) attempts.push({ precision: "street", params: { q: [street, neighborhood, where].filter(Boolean).join(", ") } });
  }
  if (neighborhood) attempts.push({ precision: "neighborhood", params: { q: [neighborhood, where].filter(Boolean).join(", ") } });
  for (const a of attempts) {
    const clean = Object.fromEntries(Object.entries(a.params).filter(([, v]) => v));
    const data = await nominatim({ ...clean, limit: "1", ...nearParams(near) });
    if (data?.[0]) {
      const r = toResult(data[0]);
      // Com cidade informada, recusa resultado de outra cidade.
      const n = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
      if (city && r.city && !n(r.city).includes(n(city)) && !n(city).includes(n(r.city))) continue;
      return { ...r, precision: a.precision };
    }
  }
  return null;
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
