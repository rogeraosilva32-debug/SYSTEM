import { useRef, useState, useEffect } from "react";
import { Box, Button, Typography } from "@mui/material";

// Assinatura simples por toque/mouse num canvas — usada pra confirmação do
// cliente no fechamento do atendimento. Sem biblioteca externa: é só
// desenho livre num <canvas>, exportado como PNG (data URL) no fim.
export default function SignaturePad({ onConfirm, onSkip, disabled = false }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  // A resolução interna do canvas precisa bater com o tamanho realmente
  // renderizado na tela — sem isso, o traço desenhado fica deslocado de
  // onde o dedo/mouse realmente está, porque as coordenadas de toque vêm em
  // pixels de tela (CSS) mas o desenho usa as coordenadas internas do
  // canvas, que por padrão são fixas (300x150) independente do tamanho
  // exibido.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.getContext("2d").scale(ratio, ratio);
  }, []);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#1F2933";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
    setHasDrawn(true);
  };

  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const confirm = () => {
    onConfirm(canvasRef.current.toDataURL("image/png"));
  };

  return (
    <Box>
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#78716C", mb: 1 }}>
        ASSINATURA DE CONFIRMAÇÃO DO CLIENTE (opcional)
      </Typography>
      <Box sx={{ border: "1px solid #E7E5E4", borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
        <canvas
          ref={canvasRef} style={{ width: "100%", height: 140, display: "block", touchAction: "none", cursor: "crosshair" }}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
      </Box>
      <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
        <Button size="small" onClick={clear} disabled={disabled} sx={{ color: "#78716C", textTransform: "none" }}>Limpar</Button>
        <Button size="small" onClick={onSkip} disabled={disabled} sx={{ color: "#78716C", textTransform: "none", ml: "auto" }}>Pular</Button>
        <Button size="small" variant="contained" onClick={confirm} disabled={!hasDrawn || disabled} sx={{ textTransform: "none", fontWeight: 700 }}>
          Confirmar
        </Button>
      </Box>
    </Box>
  );
}
