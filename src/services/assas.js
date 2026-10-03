import supabase from "./supabase";
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from "@supabase/supabase-js";
// Reaproveita a mesma validação de CPF usada no resto do app (Login, Profile,
// CompleteProfile) em vez de manter uma segunda cópia do algoritmo aqui —
// evita as duas regras de validação divergirem com o tempo.
import { isValidCpf } from "../utils/validators";

async function callAssasEdge(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("assas-payment", {
    body: { action, payload },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        console.error("Erro real Edge:", body);
        const msg =
          body?.errors?.[0]?.description ||
          body?.error ||
          body?.message ||
          "Erro no servidor de pagamento.";
        throw new Error(msg);
      } catch (e) {
        if (e.message !== error.message) throw e;
      }
    }
    if (error instanceof FunctionsRelayError) throw new Error("Erro de rede com o servidor de pagamento.");
    if (error instanceof FunctionsFetchError) throw new Error("Não foi possível conectar ao servidor de pagamento.");
    throw new Error(error.message || "Erro desconhecido.");
  }

  if (data?.errors?.length) {
    console.error("Erro Assas:", data.errors);
    throw new Error(data.errors[0].description || "Erro na API de pagamento.");
  }

  if (data?.error) throw new Error(data.error);

  return data;
}

export async function createAssasCustomer(userId, profile) {
  const cpfCnpj = (profile.cpf || "").replace(/\D/g, "");

  if (!cpfCnpj) {
    throw new Error("CPF não cadastrado. Acesse seu Perfil e informe seu CPF antes de pagar.");
  }

  if (!isValidCpf(cpfCnpj)) {
    throw new Error("CPF inválido. Acesse seu Perfil, corrija seu CPF e tente novamente.");
  }

  return callAssasEdge("create-customer", {
    name: profile.name || "Cliente",
    email: profile.email || `user-${userId}@app.local`,
    cpfCnpj,
    phone: profile.phone || "",
    externalReference: userId,
  });
}

export async function createAssasPayment(customerId, orderData) {
  const value = Number(orderData.price);
  if (!value || value <= 0) {
    throw new Error("Valor do serviço inválido para gerar pagamento.");
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 1);
  const dueDateStr = dueDate.toISOString().split("T")[0];

  const payment = await callAssasEdge("create-payment", {
    customer: customerId,
    billingType: "PIX",
    value,
    dueDate: dueDateStr,
    description: `Serviço: ${orderData.service_type || "Serviço"}`,
    externalReference: String(orderData.orderId),
  });

  try {
    const pix = await getAssasPix(payment.id);
    if (pix?.encodedImage) payment.pixQrCode = `data:image/png;base64,${pix.encodedImage}`;
    if (pix?.payload) payment.pixCopiaECola = pix.payload;
  } catch (e) {
    console.warn("QR Code ainda não disponível:", e.message);
  }

  return payment;
}

// Busca o QR Code/copia-e-cola de um pagamento PIX já existente (não cria outro)
export async function getAssasPix(paymentId) {
  return callAssasEdge("get-pix", { paymentId });
}

// Consulta o status atual do pagamento direto no Asaas
export async function getAssasPaymentStatus(paymentId) {
  return callAssasEdge("get-payment", { paymentId });
}