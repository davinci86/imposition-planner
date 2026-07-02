# Imposition Planner

App interna per il calcolo del montaggio prodotti su foglio macchina
(commerciale ed editoriale), dorso, alette e libreria carte.

## Pubblicazione su GitHub Pages

1. **Crea il repository su GitHub** (github.com → New repository).
   Chiamalo ad es. `imposition-planner`. Se non vuoi che il codice sia
   visibile pubblicamente puoi crearlo **privato**: GitHub Pages funziona
   anche su repo privati, l'importante è pubblicare tramite GitHub
   Actions (il workflow incluso qui usa già quel metodo).

2. **Se cambi il nome del repository**, aggiorna `base` in
   `vite.config.ts` di conseguenza (deve combaciare col nome del repo).

3. **Collega e pusha il codice** (dalla cartella del progetto):

   ```bash
   git init
   git add .
   git commit -m "Prima versione Imposition Planner"
   git branch -M main
   git remote add origin https://github.com/<tuo-utente>/imposition-planner.git
   git push -u origin main
   ```

4. **Attiva GitHub Pages**: su GitHub, vai in
   `Settings → Pages → Build and deployment → Source` e scegli
   **"GitHub Actions"** (non "Deploy from a branch").

5. Al primo push su `main`, il workflow in
   `.github/workflows/deploy.yml` builda l'app e la pubblica in
   automatico. Trovi l'URL finale in `Settings → Pages` una volta
   completato (di solito
   `https://<tuo-utente>.github.io/imposition-planner/`).

Da quel momento, ogni `git push` su `main` aggiorna automaticamente la
versione online — i colleghi devono solo aprire il link, nessuna
installazione richiesta.

## Sviluppo locale

```bash
npm install
npm run dev
```

## Note

- Nessun dato sensibile è incluso nel codice: fogli macchina e libreria
  carte sono salvati nel `localStorage` del browser di ciascun utente
  (non condivisi automaticamente tra colleghi).
- Se in futuro vuoi che fogli macchina e libreria carte siano condivisi
  fra tutti (stesso DB per tutti i colleghi), serve un piccolo backend o
  un servizio come Firebase/Supabase: il `localStorage` è per definizione
  locale al singolo browser.
