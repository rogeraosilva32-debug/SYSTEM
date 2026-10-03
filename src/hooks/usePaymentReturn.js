import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import supabase from "../services/supabase";

const RELEASE_DELAY_MS = 2 * 60 * 60 * 1000; // 2 horas

export function usePaymentReturn() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    const params    = new URLSearchParams(location.search);
    const status    = params.get("payment_status");
    const orderId   = params.get("order_id");
    const txId      = params.get("tx_id");
    const paymentId = params.get("payment_id") ?? params.get("collection_id");

    if (!status || !orderId || processed.current) return;
    processed.current = true;

    // Limpa query string da URL imediatamente
    navigate("/orders", { replace: true });

    const handle = async () => {
      if (status === "approved") {
        const now       = new Date().toISOString();
        const releaseAt = new Date(Date.now() + RELEASE_DELAY_MS).toISOString();

        // Atualiza transação
        const txUpdate = supabase.from("transactions").update({
          status:             "paid",
          mp_payment_id:      paymentId ?? null,
          payment_method:     "mercado_pago",
          paid_at:            now,
          worker_released_at: releaseAt,
        });
        if (txId) txUpdate.eq("id", txId);
        else      txUpdate.eq("order_id", orderId).eq("status", "pending");
        await txUpdate;

        // Marca pedido como pago
        await supabase.from("orders")
          .update({ payment_status: "paid" })
          .eq("id", orderId);

        // Liberação automática client-side (use pg_cron em produção para maior confiabilidade)
        setTimeout(async () => {
          const q = supabase.from("transactions").update({ status: "released" }).eq("status", "paid");
          if (txId) q.eq("id", txId);
          else      q.eq("order_id", orderId);
          await q;
          await supabase.from("orders")
            .update({ payment_status: "released" })
            .eq("id", orderId);
        }, RELEASE_DELAY_MS);

      } else if (status === "pending") {
        const q = supabase.from("transactions").update({ status: "pending" });
        if (txId) q.eq("id", txId);
        else      q.eq("order_id", orderId).eq("status", "pending");
        await q;
        await supabase.from("orders")
          .update({ payment_status: "pending" })
          .eq("id", orderId);

      } else if (status === "failure") {
        const q = supabase.from("transactions").update({ status: "cancelled" });
        if (txId) q.eq("id", txId);
        else      q.eq("order_id", orderId).eq("status", "pending");
        await q;
        await supabase.from("orders")
          .update({ payment_status: "unpaid" })
          .eq("id", orderId);
      }
    };

    handle();
  }, [location.search, navigate]);
}