import { motion } from "framer-motion";

export default function PageTransition({
  children,
  routeKey,
}) {
  return (
    <motion.div
      key={routeKey}
      initial={{
        opacity: 0,
        y: 10,
        filter: "blur(10px)",
      }}
      animate={{
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
      }}
      exit={{
        opacity: 0,
        y: -10,
        filter: "blur(8px)",
      }}
      transition={{
        duration: 0.35,
      }}
      style={{
        minHeight: "100vh",
      }}
    >
      {children}
    </motion.div>
  );
}