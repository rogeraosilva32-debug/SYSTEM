import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import { Box, Button, Typography } from "@mui/material";
import DirectionsIcon from "@mui/icons-material/Directions";
import L from "leaflet";
import supabase from "../services/supabase";
import { fetchRoute } from "../utils/geocoding";

const destIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#1C1917;border:3px solid #fff;box-shadow:0 0 0 2px #1C1917;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const meIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#4A6C8C;border:3px solid #fff;box-shadow:0 0 8px rgba(74,108,140,0.5);"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// O Leaflet mede o tamanho do próprio contêiner só uma vez, no momento em
// que o mapa é criado. Se esse tamanho mudar depois — um diálogo do MUI que
// ainda está terminando a animação de abrir, uma seção de fotos carregando
// abaixo e empurrando o layout — o mapa não fica sabendo, e continua
// desenhando os "quadradinhos" (tiles) do tamanho antigo esticados pro
// tamanho novo do contêiner. É exatamente esse esticamento que apareceu no
// mapa depois que a caixa de fotos foi adicionada abaixo dele (e o diálogo
// ficou mais largo). A correção padrão do Leaflet é chamar
// map.invalidateSize() sempre que o contêiner mudar de tamanho — este
// componente faz isso automaticamente.
function MapResizeFixer() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    // Corrige assim que monta (cobre a animação de abertura do diálogo)...
    const timer = setTimeout(() => map.invalidateSize(), 250);

    // ...e continua corrigindo se o contêiner mudar de tamanho depois disso
    // por qualquer outro motivo (fotos carregando, janela redimensionada).
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);

    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [map]);

  return null;
}

function timeAgo(iso) {
  if (!iso) return null;
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 20) return "agora mesmo";
  if (seconds < 3600) return `há ${Math.round(seconds / 60)} min`;
  return `há ${Math.round(seconds / 3600)} h`;
}

// Distância em metros entre duas coordenadas (fórmula de Haversine) — usada
// só pra decidir se vale a pena recalcular a rota (não faz sentido pedir uma
// rota nova ao servidor por um deslocamento de 5 metros).
function distanceMeters(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Distância aproximada (metros) de um ponto até a rota traçada — a menor
// distância até qualquer ponto do trajeto. Como o OSRM devolve pontos a
// cada poucos metros ao longo da rota, essa aproximação já é suficiente pra
// saber se alguém se afastou do caminho previsto, sem precisar de projeção
// geométrica exata em cada segmento.
function distanceToRoute(point, path) {
  let min = Infinity;
  for (const [lat, lng] of path) {
    const d = distanceMeters(point, { lat, lng });
    if (d < min) min = d;
  }
  return min;
}

const OFF_ROUTE_METERS = 250;

// Mostra o destino de uma designação num mapa, e — dependendo de quem está
// olhando — a posição de alguém, com a rota de verdade (seguindo ruas)
// desenhada entre os dois pontos:
//
// - `showMyLocation` (visão do colaborador): acompanha o GPS do próprio
//   aparelho localmente. Se `broadcastMyLocation` também for true, essa
//   posição é gravada periodicamente em profiles.last_lat/last_lng, pra
//   ficar disponível pro admin da empresa ver.
// - `trackCollaboratorId` (visão do admin): assina atualizações em tempo
//   real da posição daquele colaborador (com um polling de reforço a cada
//   20s, caso o Realtime não esteja disponível), mostrando há quanto tempo
//   foi vista pela última vez.
//
// Enquanto a posição de alguém e a rota calculada estiverem disponíveis, o
// componente também verifica se essa posição está a mais de 250m do
// trajeto previsto — e se `broadcastMyLocation` for true, avisa os admins
// da empresa (via `notify_off_route`) na primeira vez que isso acontecer.
export default function RouteMap({
  lat, lng, address,
  showMyLocation = false,
  broadcastMyLocation = false,
  trackCollaboratorId = null,
  assignmentId = null,
  mapHeight = 340,
}) {
  const [myPos, setMyPos] = useState(null);
  const [geoError, setGeoError] = useState("");
  const [broadcastError, setBroadcastError] = useState("");
  const [trackedPos, setTrackedPos] = useState(null);
  const [route, setRoute] = useState(null);
  const [offRoute, setOffRoute] = useState(false);
  const lastBroadcastAt = useRef(0);
  const lastRouteFetchPos = useRef(null);
  const hasNotifiedOffRoute = useRef(false);

  // ── Minha própria localização (colaborador navegando) ────────────────────
  useEffect(() => {
    if (!showMyLocation) return;

    if (!window.isSecureContext) {
      // O GPS do navegador só funciona em conexão segura (https ou
      // localhost). Testando pelo celular via IP local (http://192.168...),
      // o navegador bloqueia silenciosamente — sem isso, parecia que o mapa
      // "não funcionava pro colaborador" sem nenhuma explicação.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGeoError("Seu navegador só libera o GPS em conexão segura (https) ou localhost. Publicando o app (Netlify, etc.) isso funciona normalmente.");
      return;
    }
    if (!navigator.geolocation) {
      setGeoError("Este dispositivo não tem suporte a GPS pelo navegador.");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoError("");
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyPos(next);

        if (broadcastMyLocation) {
          // Não grava a cada callback do GPS (dispara demais) — só a cada
          // ~10s, o suficiente pro admin acompanhar sem sobrecarregar o banco.
          const now = Date.now();
          if (now - lastBroadcastAt.current > 10000) {
            lastBroadcastAt.current = now;
            supabase.auth.getUser().then(({ data }) => {
              if (!data?.user) return;
              supabase.from("profiles").update({
                last_lat: next.lat, last_lng: next.lng, last_location_at: new Date().toISOString(),
              }).eq("id", data.user.id).then(({ error }) => {
                // Sem checar isso, uma falha aqui (coluna que ainda não
                // existe no banco, RLS bloqueando, etc.) acontecia em
                // silêncio total — a pessoa via "sem localização" pra
                // sempre do outro lado, sem nenhuma pista do motivo.
                if (error) {
                  console.warn("Falha ao compartilhar localização:", error.message);
                  setBroadcastError(error.message);
                } else {
                  setBroadcastError("");
                }
              });
            });
          }
        }
      },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Permissão de GPS negada. Ative a localização pra esse site nas configurações do navegador."
            : "Não foi possível obter sua localização agora."
        );
      },
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [showMyLocation, broadcastMyLocation]);

  // ── Localização transmitida por um colaborador (visão do admin) ──────────
  useEffect(() => {
    if (!trackCollaboratorId) return;

    const applyRow = (row) => {
      if (row?.last_lat && row?.last_lng) {
        setTrackedPos({ lat: row.last_lat, lng: row.last_lng, at: row.last_location_at });
      }
    };

    const fetchPos = async () => {
      const { data } = await supabase.from("profiles").select("last_lat, last_lng, last_location_at").eq("id", trackCollaboratorId).maybeSingle();
      applyRow(data);
    };

    fetchPos();

    // Tempo real: assim que o colaborador atualiza a posição dele, o mapa do
    // admin recebe na hora — sem precisar esperar o próximo ciclo de polling.
    const channel = supabase
      .channel(`track-${trackCollaboratorId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${trackCollaboratorId}`,
      }, (payload) => applyRow(payload.new))
      .subscribe();

    // Polling de reforço — cobre o caso raro do Realtime não entregar o evento.
    const interval = setInterval(fetchPos, 20000);

    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, [trackCollaboratorId]);

  const otherPos = myPos || trackedPos;

  // ── Rota de verdade entre a posição de alguém e o destino ─────────────────
  useEffect(() => {
    if (!otherPos || !lat || !lng) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoute(null);
      return;
    }

    // Só recalcula se ninguém pediu rota ainda, ou se a posição mudou mais
    // de ~40m — evita bombardear o serviço de rotas a cada atualização de GPS.
    const last = lastRouteFetchPos.current;
    if (last && distanceMeters(last, otherPos) < 40) return;

    lastRouteFetchPos.current = otherPos;
    fetchRoute(otherPos.lat, otherPos.lng, lat, lng).then((result) => {
      if (result) setRoute(result);
    });
  }, [otherPos, lat, lng]);

  // ── Detecção de desvio de rota ────────────────────────────────────────────
  useEffect(() => {
    if (!otherPos || !route?.path?.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOffRoute(false);
      hasNotifiedOffRoute.current = false;
      return;
    }

    const isOff = distanceToRoute(otherPos, route.path) > OFF_ROUTE_METERS;
    setOffRoute(isOff);

    if (isOff && broadcastMyLocation && assignmentId && !hasNotifiedOffRoute.current) {
      // Só avisa uma vez por "episódio" de desvio — não a cada atualização
      // de GPS enquanto a pessoa continuar fora do trajeto.
      hasNotifiedOffRoute.current = true;
      supabase.rpc("notify_off_route", { p_assignment_id: assignmentId }).then(({ error }) => {
        if (error) console.warn("Falha ao avisar desvio de rota:", error.message);
      });
    }
    if (!isOff) {
      hasNotifiedOffRoute.current = false;
    }
  }, [otherPos, route, broadcastMyLocation, assignmentId]);

  if (!lat || !lng) {
    return (
      <Box sx={{ p: 3, textAlign: "center", color: "#A8A29E", fontSize: 13, border: "1px solid #E7E5E4", borderRadius: "14px" }}>
        Endereço sem coordenadas registradas.
      </Box>
    );
  }

  const openInMaps = () => {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Box sx={{ borderRadius: "14px", overflow: "hidden", border: "1px solid #E7E5E4" }}>
      <Box sx={{ height: mapHeight }}>
        <MapContainer center={[lat, lng]} zoom={14} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
          <MapResizeFixer />
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <Marker position={[lat, lng]} icon={destIcon}>
            <Popup>{address || "Destino"}</Popup>
          </Marker>
          {otherPos && (
            <>
              <Marker position={[otherPos.lat, otherPos.lng]} icon={meIcon}>
                <Popup>{myPos ? "Você" : `Colaborador · visto ${timeAgo(trackedPos?.at)}`}</Popup>
              </Marker>
              {route ? (
                <Polyline positions={route.path} pathOptions={{ color: offRoute ? "#B0463D" : "#292524", weight: 4, opacity: 0.85 }} />
              ) : (
                <Polyline positions={[[otherPos.lat, otherPos.lng], [lat, lng]]} pathOptions={{ color: "#A8A29E", dashArray: "6 6", weight: 2 }} />
              )}
            </>
          )}
        </MapContainer>
      </Box>
      {offRoute && (
        <Box sx={{ px: 1.5, py: 1, background: "#F6EBEA", borderBottom: "1px solid #E7C9C6" }}>
          <Typography sx={{ fontSize: 11.5, color: "#B0463D", fontWeight: 700 }}>
            ⚠ {myPos ? "Você está" : "O colaborador está"} a mais de {OFF_ROUTE_METERS}m do trajeto previsto.
          </Typography>
        </Box>
      )}
      <Box sx={{ p: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12.5, color: "#57534E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {address}
          </Typography>
          {route && (
            <Typography sx={{ fontSize: 11, color: "#292524", fontWeight: 700, mt: 0.2 }}>
              {Math.round(route.durationSeconds / 60)} min · {(route.distanceMeters / 1000).toFixed(1)} km
            </Typography>
          )}
          {trackCollaboratorId && (
            <Typography sx={{ fontSize: 11, color: trackedPos ? "#4B7A5E" : "#A8A29E", fontWeight: 600, mt: 0.2 }}>
              {trackedPos ? `Colaborador visto ${timeAgo(trackedPos.at)}` : "Ainda sem localização do colaborador"}
            </Typography>
          )}
          {showMyLocation && geoError && (
            <Typography sx={{ fontSize: 11, color: "#B0463D", fontWeight: 600, mt: 0.2 }}>{geoError}</Typography>
          )}
          {showMyLocation && broadcastMyLocation && broadcastError && (
            <Typography sx={{ fontSize: 11, color: "#B0463D", fontWeight: 600, mt: 0.2 }}>
              Não conseguimos compartilhar sua localização: {broadcastError}
            </Typography>
          )}
        </Box>
        <Button
          size="small" startIcon={<DirectionsIcon sx={{ fontSize: 16 }} />}
          onClick={openInMaps}
          sx={{ flexShrink: 0, textTransform: "none", fontWeight: 700, fontSize: 12.5 }}
        >
          Abrir rota
        </Button>
      </Box>
    </Box>
  );
}
