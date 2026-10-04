// Google Maps (opcional): só é usado se VITE_GOOGLE_MAPS_API_KEY estiver
// configurada. Acha o número da casa, coisa que o OpenStreetMap quase nunca
// tem no Brasil. Usa Places API (New) para sugestões e Geocoding para os campos.

const KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim().replace(/^["']|["']$/g, "");
export const hasGoogleMaps = Boolean(KEY);

let loading = null;
function loadGoogle() {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.__gmapsReady = () => resolve(window.google.maps);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&language=pt-BR&region=BR&callback=__gmapsReady`;
    s.async = true;
    s.onerror = () => { loading = null; reject(new Error("Não foi possível carregar o Google Maps.")); };
    document.head.appendChild(s);
  });
  return loading;
}

// Componentes vêm como {longText, shortText, types} (Places New) ou
// {long_name, short_name, types} (Geocoder).
function fromComponents(components = []) {
  const get = (type, short = false) => {
    const c = components.find((x) => x.types?.includes(type));
    if (!c) return "";
    return short ? c.shortText || c.short_name || "" : c.longText || c.long_name || "";
  };
  return {
    street: get("route"),
    number: get("street_number"),
    neighborhood: get("sublocality_level_1") || get("sublocality") || get("neighborhood"),
    city: get("administrative_area_level_2") || get("locality"),
    state: get("administrative_area_level_1", true),
  };
}

const latLng = (loc) => ({
  lat: typeof loc.lat === "function" ? loc.lat() : loc.lat,
  lng: typeof loc.lng === "function" ? loc.lng() : loc.lng,
});

export async function googleSuggest(input, near) {
  const maps = await loadGoogle();
  const { AutocompleteSuggestion } = await maps.importLibrary("places");
  const req = { input, includedRegionCodes: ["br"], language: "pt-BR", region: "br" };
  if (near?.lat) req.locationBias = { center: { lat: near.lat, lng: near.lng }, radius: 30000 };
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
  return (suggestions || [])
    .filter((s) => s.placePrediction)
    .slice(0, 6)
    .map((s) => ({ display: s.placePrediction.text?.text || "", placePrediction: s.placePrediction }));
}

export async function googlePlace(prediction) {
  const place = prediction.toPlace();
  await place.fetchFields({ fields: ["location", "addressComponents", "formattedAddress"] });
  const parts = fromComponents(place.addressComponents);
  return {
    ...parts,
    display: place.formattedAddress,
    ...latLng(place.location),
    precision: parts.number ? "number" : parts.street ? "street" : "neighborhood",
  };
}

export async function googleGeocode(address, near) {
  const maps = await loadGoogle();
  const { Geocoder } = await maps.importLibrary("geocoding");
  const req = { address, region: "br" };
  if (near?.lat) {
    const d = 0.35;
    req.bounds = { north: near.lat + d, south: near.lat - d, east: near.lng + d, west: near.lng - d };
  }
  const { results } = await new Geocoder().geocode(req);
  const r = results?.[0];
  if (!r) return null;
  const types = r.types || [];
  const precision = types.includes("street_address") || types.includes("premise") || types.includes("subpremise")
    ? "number" : types.includes("route") ? "street" : "neighborhood";
  return { ...fromComponents(r.address_components), display: r.formatted_address, ...latLng(r.geometry.location), precision };
}
