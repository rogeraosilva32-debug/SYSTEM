import { motion } from "framer-motion";

// Troca de tela leve: só um fade rápido de entrada, sem desfoque nem saída
// (desfoque em tela cheia pesa no celular e a saída deixava a tela vazia).
export default function PageTransition({ children, routeKey }) {
  return (
    <motion.div
      key={routeKey}
      initial={{ opacity: 0.6 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{ minHeight: "100vh" }}
    >
      {children}
    </motion.div>
  );
}
