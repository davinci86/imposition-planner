import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANTE: "base" deve corrispondere al nome del repository GitHub,
// altrimenti CSS/JS non si caricano sulla pagina pubblicata.
// Esempio: se il repo si chiama "imposition-planner",
// l'URL pubblico sarà https://<utente>.github.io/imposition-planner/
export default defineConfig({
  plugins: [react()],
  base: "/imposition-planner/",
});
