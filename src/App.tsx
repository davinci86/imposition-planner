import React, { useEffect, useMemo, useState } from "react";

/**
 * Imposition Planner — V5.9
 *
 * Funzioni principali:
 * - Prodotto commerciale o editoriale.
 * - Formato chiuso libero oppure ISO.
 * - Formato aperto = base/larghezza × 2, altezza invariata.
 * - Editoriale: spillato, brossura, spirale.
 * - Interni e copertina separati.
 * - Dorso calcolato solo dagli interni.
 * - Alette copertina: no / 6 cm / 8 cm / personalizzato.
 * - Fogli macchina con aggiunta/eliminazione e localStorage.
 * - Doppio montaggio verticale/orizzontale.
 * - Indicazione del foglio macchina usato.
 */

type Sheet = {
  id: string;
  name: string;
  w: number;
  h: number;
};

// Una carta in libreria. caliperUm è il dato tecnico (spessore singolo
// foglio, µm) che l'operatore NON deve conoscere: si imposta una sola
// volta quando si censisce la carta (da scheda tecnica del fornitore) e
// da quel momento viene usato in automatico dal calcolo del dorso.
type Paper = {
  id: string;
  family: string;
  manufacturer?: string;
  name: string;
  grammage: number; // g/m²
  caliperUm: number; // spessore singolo foglio, µm
};

type ProductType = "commerciale" | "editoriale";
type Orientation = "auto" | "portrait" | "landscape";
type Binding = "spillato" | "brossura" | "spirale";
type PrintSides = 1 | 2;
type FlapPresetId = "60" | "80" | "custom";

type GridFit = {
  usableW: number;
  usableH: number;
  nUp: number;
  cols: number;
  rows: number;
  placements: Array<{
    x: number;
    y: number;
    contentW: number;
    contentH: number;
    unitW: number;
    unitH: number;
  }>;
  coverage: number;
  unitW: number;
  unitH: number;
  mX: number;
  mY: number;
};

type EvalResult = {
  sheet: Sheet;
  fitPortrait: GridFit;
  fitLandscape: GridFit;
  bestFit: GridFit;
  nUp: number;
};

const ISO_SIZES: Record<string, { w: number; h: number }> = {
  A0: { w: 841, h: 1189 },
  A1: { w: 594, h: 841 },
  A2: { w: 420, h: 594 },
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  A6: { w: 105, h: 148 },
  A7: { w: 74, h: 105 },
};

const DEFAULT_SHEETS: Sheet[] = [
  { id: "sra3", name: "SRA3 (320×450)", w: 320, h: 450 },
  { id: "a3plus", name: "A3+ (330×488)", w: 330, h: 488 },
  { id: "50x70", name: "50×70 (500×700)", w: 500, h: 700 },
  { id: "64x90", name: "64×90 (640×900)", w: 640, h: 900 },
  { id: "70x100", name: "70×100 (700×1000)", w: 700, h: 1000 },
];

const LS_KEY = "impo_planner_v59_sheets";
const LS_KEY_PAPERS = "impo_planner_v59_papers";

const EDGE_MARGIN = 0.5;

const PAPER_FAMILIES = [
  "Patinata lucida",
  "Patinata opaca",
  "Naturale / Uso mano",
  "Riciclata",
  "Goffrata",
  "Accoppiata / Sintetica",
  "Altro",
];

// Libreria di partenza: gli stessi valori usati finora come default fissi,
// ora censiti come voci normali della libreria (modificabili/eliminabili).
const DEFAULT_PAPERS: Paper[] = [
  {
    id: "pat-opaca-170",
    family: "Patinata opaca",
    manufacturer: "",
    name: "Patinata Opaca 170",
    grammage: 170,
    caliperUm: 200,
  },
  {
    id: "pat-opaca-300",
    family: "Patinata opaca",
    manufacturer: "",
    name: "Patinata Opaca 300 (copertina)",
    grammage: 300,
    caliperUm: 280,
  },
];

const FLAP_PRESETS: Array<{ id: FlapPresetId; label: string; mm: number }> = [
  { id: "60", label: "6 cm", mm: 60 },
  { id: "80", label: "8 cm", mm: 80 },
  { id: "custom", label: "Personalizzato", mm: 0 },
];

function getFlapPresetMm(id: FlapPresetId): number {
  return FLAP_PRESETS.find((p) => p.id === id)?.mm ?? 0;
}

function loadSheets(): Sheet[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_SHEETS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_SHEETS;
    return parsed;
  } catch {
    return DEFAULT_SHEETS;
  }
}

function saveSheets(sheets: Sheet[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(sheets));
}

function loadPapers(): Paper[] {
  try {
    const raw = localStorage.getItem(LS_KEY_PAPERS);
    if (!raw) return DEFAULT_PAPERS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_PAPERS;
    return parsed;
  } catch {
    return DEFAULT_PAPERS;
  }
}

function savePapers(papers: Paper[]) {
  localStorage.setItem(LS_KEY_PAPERS, JSON.stringify(papers));
}

function floorDivPositive(n: number, d: number) {
  return d > 0 ? Math.max(0, Math.floor(n / d)) : 0;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function mm(n: number) {
  return `${Number(n.toFixed(2))} mm`;
}

function m2(n: number) {
  return `${Number(n.toFixed(2))} m²`;
}

function openFromClosed(w: number, h: number) {
  // Regola corretta:
  // il formato aperto raddoppia sempre la base/larghezza.
  // A4 verticale 210×297 -> 420×297
  // A4 orizzontale 297×210 -> 594×210
  return { w: w * 2, h };
}

function computeGridFit({
  sheetW,
  sheetH,
  prodW,
  prodH,
  marginX,
  marginY,
  bleed,
  gapX,
  gapY,
}: {
  sheetW: number;
  sheetH: number;
  prodW: number;
  prodH: number;
  marginX: number;
  marginY: number;
  bleed: number;
  gapX: number;
  gapY: number;
}): GridFit {
  const mX = marginX + EDGE_MARGIN;
  const mY = marginY + EDGE_MARGIN;

  const usableW = Math.max(0, sheetW - 2 * mX);
  const usableH = Math.max(0, sheetH - 2 * mY);

  const unitW = prodW + 2 * bleed;
  const unitH = prodH + 2 * bleed;

  const cols = floorDivPositive(usableW + gapX, unitW + gapX);
  const rows = floorDivPositive(usableH + gapY, unitH + gapY);
  const nUp = cols * rows;

  const placements: GridFit["placements"] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = mX + c * (unitW + gapX);
      const y = mY + r * (unitH + gapY);
      placements.push({
        x,
        y,
        contentW: prodW,
        contentH: prodH,
        unitW,
        unitH,
      });
    }
  }

  const coverage = nUp > 0 ? (nUp * prodW * prodH) / (sheetW * sheetH) : 0;

  return {
    usableW,
    usableH,
    nUp,
    cols,
    rows,
    placements,
    coverage,
    unitW,
    unitH,
    mX,
    mY,
  };
}

export default function App() {
  const [sheets, setSheets] = useState<Sheet[]>(loadSheets);

  const [productType, setProductType] = useState<ProductType>("editoriale");

  const [useISO, setUseISO] = useState(true);
  const [isoKey, setIsoKey] = useState("A5");
  const [prodW, setProdW] = useState(148);
  const [prodH, setProdH] = useState(210);
  const [orientation, setOrientation] = useState<Orientation>("auto");

  const [qtyCommercial, setQtyCommercial] = useState(100);
  const [printSidesCommercial, setPrintSidesCommercial] = useState<PrintSides>(1);

  const [copies, setCopies] = useState(100);
  const [facciate, setFacciate] = useState(64);
  const [binding, setBinding] = useState<Binding>("brossura");
  const [autocopertinato, setAutocopertinato] = useState(false);
  const [printSidesInt, setPrintSidesInt] = useState<PrintSides>(2);
  const [printSidesCov, setPrintSidesCov] = useState<PrintSides>(1);

  const [papers, setPapers] = useState<Paper[]>(loadPapers);
  const [interiorPaperId, setInteriorPaperId] = useState<string>(
    DEFAULT_PAPERS[0].id
  );
  const [coverPaperId, setCoverPaperId] = useState<string>(DEFAULT_PAPERS[1].id);

  const [showAddPaper, setShowAddPaper] = useState(false);
  const [newPaperFamily, setNewPaperFamily] = useState(PAPER_FAMILIES[0]);
  const [newPaperManufacturer, setNewPaperManufacturer] = useState("");
  const [newPaperName, setNewPaperName] = useState("");
  const [newPaperGrammage, setNewPaperGrammage] = useState("");
  const [newPaperCaliper, setNewPaperCaliper] = useState("");
  const [confirmDeletePaperId, setConfirmDeletePaperId] = useState<
    string | null
  >(null);

  const [hasFlaps, setHasFlaps] = useState(false);
  const [flapPresetId, setFlapPresetId] = useState<FlapPresetId>("60");
  const [flapCustomMm, setFlapCustomMm] = useState(60);

  const [marginX, setMarginX] = useState(5);
  const [marginY, setMarginY] = useState(5);
  const [bleed, setBleed] = useState(2);
  const [gapX, setGapX] = useState(2);
  const [gapY, setGapY] = useState(2);
  const [safety, setSafety] = useState(3);

  const [forceSheet, setForceSheet] = useState(false);
  const [forcedSheetId, setForcedSheetId] = useState(DEFAULT_SHEETS[0].id);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newW, setNewW] = useState("");
  const [newH, setNewH] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    saveSheets(sheets);
  }, [sheets]);

  useEffect(() => {
    if (!sheets.some((s) => s.id === forcedSheetId)) {
      setForcedSheetId(sheets[0]?.id || "");
    }
  }, [sheets, forcedSheetId]);

  useEffect(() => {
    savePapers(papers);
  }, [papers]);

  useEffect(() => {
    if (!papers.some((p) => p.id === interiorPaperId)) {
      setInteriorPaperId(papers[0]?.id || "");
    }
  }, [papers, interiorPaperId]);

  useEffect(() => {
    if (!papers.some((p) => p.id === coverPaperId)) {
      setCoverPaperId(papers[0]?.id || "");
    }
  }, [papers, coverPaperId]);

  useEffect(() => {
    if (!useISO) return;

    const selected = ISO_SIZES[isoKey];
    if (!selected) return;

    let { w, h } = selected;

    if (orientation === "landscape") {
      if (h > w) [w, h] = [h, w];
    }

    if (orientation === "portrait") {
      if (w > h) [w, h] = [h, w];
    }

    setProdW(w);
    setProdH(h);
  }, [useISO, isoKey, orientation]);

  useEffect(() => {
    if (useISO) return;

    let w = prodW;
    let h = prodH;

    if (orientation === "landscape" && h > w) [w, h] = [h, w];
    if (orientation === "portrait" && w > h) [w, h] = [h, w];

    if (w !== prodW || h !== prodH) {
      setProdW(w);
      setProdH(h);
    }
  }, [orientation, useISO, prodW, prodH]);

  useEffect(() => {
    if (binding === "spirale" && hasFlaps) {
      setHasFlaps(false);
    }
  }, [binding, hasFlaps]);

  const dimsClosed = useMemo(() => ({ w: prodW, h: prodH }), [prodW, prodH]);
  const dimsOpen = useMemo(() => openFromClosed(prodW, prodH), [prodW, prodH]);

  const interiorPaper = papers.find((p) => p.id === interiorPaperId) || null;
  const coverPaper = autocopertinato
    ? interiorPaper
    : papers.find((p) => p.id === coverPaperId) || null;

  // Il dorso, per spec, dipende SOLO dalla carta interni. Il caliper
  // copertina non entra in questa formula: viene tenuto solo a scopo
  // informativo/futuro (es. costificazione).
  const caliperIntMm = (interiorPaper?.caliperUm ?? 0) / 1000;
  const caliperCovMm = (coverPaper?.caliperUm ?? 0) / 1000;

  const facesValid = facciate > 0 && facciate % 4 === 0;

  const consideredSheets = useMemo(() => {
    if (!forceSheet) return sheets;
    return sheets.filter((s) => s.id === forcedSheetId);
  }, [forceSheet, sheets, forcedSheetId]);

  function getFlapMm() {
    if (!hasFlaps || binding === "spirale") return 0;
    if (flapPresetId === "custom") return Math.max(0, flapCustomMm);
    return getFlapPresetMm(flapPresetId);
  }

  function editorialDimsAndQty() {
    const COVER_FAC = 4;
    const totalFaces = Math.max(0, facciate);
    const interiorFac = Math.max(0, totalFaces - COVER_FAC);
    const interiorSpreads = interiorFac / 2;
    const interiorLeaves = interiorFac / 2;

    const spine = interiorLeaves * caliperIntMm;
    const flapMm = getFlapMm();

    let interiorDims = dimsClosed;
    let coverDims = dimsClosed;
    let coverPiecesPerCopy = 1;

    if (binding === "spillato") {
      interiorDims = dimsOpen;
      coverDims = {
        w: dimsOpen.w + 2 * flapMm,
        h: dimsOpen.h,
      };
      coverPiecesPerCopy = 1;
    }

    if (binding === "brossura") {
      interiorDims = dimsClosed;
      const open = openFromClosed(prodW, prodH);
      coverDims = {
        w: open.w + spine + 2 * flapMm,
        h: open.h,
      };
      coverPiecesPerCopy = 1;
    }

    if (binding === "spirale") {
      interiorDims = dimsClosed;
      coverDims = dimsClosed;
      coverPiecesPerCopy = 2;
    }

    const interiorPieces = Math.ceil(copies * interiorSpreads);
    const coverPieces = copies * coverPiecesPerCopy;

    return {
      interiorDims,
      coverDims,
      interiorPieces,
      coverPieces,
      interiorFac,
      interiorLeaves,
      spine,
      flapMm,
    };
  }

  function evalForPieceDims(pw: number, ph: number, sheetList: Sheet[]): EvalResult[] {
    return sheetList
      .map((sheet) => {
        const fitPortrait = computeGridFit({
          sheetW: sheet.w,
          sheetH: sheet.h,
          prodW: Math.min(pw, ph),
          prodH: Math.max(pw, ph),
          marginX,
          marginY,
          bleed,
          gapX,
          gapY,
        });

        const fitLandscape = computeGridFit({
          sheetW: sheet.w,
          sheetH: sheet.h,
          prodW: Math.max(pw, ph),
          prodH: Math.min(pw, ph),
          marginX,
          marginY,
          bleed,
          gapX,
          gapY,
        });

        const bestFit =
          fitPortrait.nUp > fitLandscape.nUp ||
          (fitPortrait.nUp === fitLandscape.nUp &&
            fitPortrait.coverage > fitLandscape.coverage)
            ? fitPortrait
            : fitLandscape;

        return {
          sheet,
          fitPortrait,
          fitLandscape,
          bestFit,
          nUp: bestFit.nUp,
        };
      })
      .sort((a, b) => b.nUp - a.nUp || b.bestFit.coverage - a.bestFit.coverage);
  }

  const evalCommercial = useMemo(() => {
    return evalForPieceDims(dimsClosed.w, dimsClosed.h, consideredSheets).map((ev) => {
      const sheetsNeeded = ev.nUp > 0 ? Math.ceil(qtyCommercial / ev.nUp) : Infinity;
      return {
        ...ev,
        qty: qtyCommercial,
        sheetsNeeded,
        // Il numero di fogli fisici non cambia con fronte/retro (i pezzi
        // ci stanno comunque); a raddoppiare sono le passate macchina,
        // perché lo stesso foglio deve passare due volte sotto stampa.
        passesNeeded: sheetsNeeded * printSidesCommercial,
      };
    });
  }, [
    dimsClosed,
    consideredSheets,
    qtyCommercial,
    printSidesCommercial,
    marginX,
    marginY,
    bleed,
    gapX,
    gapY,
  ]);

  function addSheet() {
    const w = Number(newW);
    const h = Number(newH);

    if (!newName.trim() || !w || !h || w <= 0 || h <= 0) return;

    const id =
      newName.toLowerCase().replace(/\s+/g, "-") +
      "-" +
      Math.random().toString(36).slice(2, 6);

    setSheets((prev) => [...prev, { id, name: newName.trim(), w, h }]);
    setNewName("");
    setNewW("");
    setNewH("");
    setShowAdd(false);
  }

  function deleteSheet(id: string) {
    setSheets((prev) => prev.filter((s) => s.id !== id));
    setConfirmDeleteId(null);
  }

  function addPaper() {
    const grammage = Number(newPaperGrammage);
    const caliperUm = Number(newPaperCaliper);

    if (
      !newPaperName.trim() ||
      !grammage ||
      grammage <= 0 ||
      !caliperUm ||
      caliperUm <= 0
    )
      return;

    const id =
      newPaperName.toLowerCase().replace(/\s+/g, "-") +
      "-" +
      Math.random().toString(36).slice(2, 6);

    setPapers((prev) => [
      ...prev,
      {
        id,
        family: newPaperFamily,
        manufacturer: newPaperManufacturer.trim() || undefined,
        name: newPaperName.trim(),
        grammage,
        caliperUm,
      },
    ]);
    setNewPaperFamily(PAPER_FAMILIES[0]);
    setNewPaperManufacturer("");
    setNewPaperName("");
    setNewPaperGrammage("");
    setNewPaperCaliper("");
    setShowAddPaper(false);
  }

  function deletePaper(id: string) {
    setPapers((prev) => prev.filter((p) => p.id !== id));
    setConfirmDeletePaperId(null);
  }

  function SheetSVG({
    sheet,
    fit,
    label,
  }: {
    sheet: Sheet;
    fit: GridFit;
    label: string;
  }) {
    const maxPx = 620 * zoom;
    const scale = Math.min(maxPx / sheet.w, maxPx / sheet.h);

    // Sfrido = complementare della copertura: l'area del foglio non
    // occupata dai pezzi utili (che finisce scartata dopo il taglio).
    const wasteFraction = Math.max(0, 1 - fit.coverage);
    const sheetAreaM2 = (sheet.w * sheet.h) / 1_000_000;
    const wasteAreaM2 = sheetAreaM2 * wasteFraction;
    const coveredAreaM2 = sheetAreaM2 * fit.coverage;

    return (
      <div className="space-y-1">
        <div className="text-xs text-gray-700">
          {label} · resa: <b>{fit.nUp}</b> ({fit.cols}×{fit.rows}) · copertura:{" "}
          <b>{pct(fit.coverage)}</b> ({m2(coveredAreaM2)}) · sfrido:{" "}
          <b>{pct(wasteFraction)}</b> ({m2(wasteAreaM2)})
        </div>

        <svg
          width={sheet.w * scale}
          height={sheet.h * scale}
          viewBox={`0 0 ${sheet.w} ${sheet.h}`}
          className="border shadow-sm bg-white"
        >
          <rect x={0} y={0} width={sheet.w} height={sheet.h} fill="#f8fafc" stroke="#94a3b8" />

          <rect
            x={marginX + EDGE_MARGIN}
            y={marginY + EDGE_MARGIN}
            width={Math.max(0, sheet.w - 2 * (marginX + EDGE_MARGIN))}
            height={Math.max(0, sheet.h - 2 * (marginY + EDGE_MARGIN))}
            fill="none"
            stroke="#cbd5e1"
            strokeDasharray="6 6"
          />

          {fit.placements.map((p, i) => (
            <g key={i}>
              <rect
                x={p.x}
                y={p.y}
                width={p.unitW}
                height={p.unitH}
                fill="#e5e7eb"
                stroke="#9ca3af"
              />
              <rect
                x={p.x + bleed}
                y={p.y + bleed}
                width={p.contentW}
                height={p.contentH}
                fill="#9ca3af"
                stroke="#6b7280"
              />
              <rect
                x={p.x + bleed + safety}
                y={p.y + bleed + safety}
                width={Math.max(0, p.contentW - 2 * safety)}
                height={Math.max(0, p.contentH - 2 * safety)}
                fill="none"
                stroke="#0ea5e9"
                strokeDasharray="4 4"
              />
            </g>
          ))}
        </svg>
      </div>
    );
  }

  function PhysicalError({
    dims,
  }: {
    dims: { w: number; h: number };
  }) {
    const largestSheet = consideredSheets.reduce<Sheet | null>((best, s) => {
      if (!best) return s;
      return s.w * s.h > best.w * best.h ? s : best;
    }, null);

    if (!largestSheet) {
      return (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3">
          Nessun foglio macchina disponibile.
        </div>
      );
    }

    const maxSide = Math.max(largestSheet.w, largestSheet.h);
    const minSide = Math.min(largestSheet.w, largestSheet.h);
    const pieceMax = Math.max(dims.w + 2 * bleed, dims.h + 2 * bleed);
    const pieceMin = Math.min(dims.w + 2 * bleed, dims.h + 2 * bleed);

    return (
      <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3 space-y-1">
        <div>
          Il formato non entra su nessun foglio macchina disponibile.
        </div>
        <div className="text-xs">
          Pezzo con abbondanza: circa {mm(pieceMax)} × {mm(pieceMin)}. Foglio massimo disponibile:{" "}
          {largestSheet.name} — {largestSheet.w}×{largestSheet.h} mm.
        </div>
        <div className="text-xs">
          Serve almeno un foglio con lato lungo ≥ {mm(pieceMax)} e lato corto ≥ {mm(pieceMin)}, oltre a margini e distanza.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 font-sans">
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
        Imposition Planner — V5.9
      </h1>
      <p className="text-sm text-gray-600 mt-1">
        Editoriale/commerciale · dorso · alette · foglio macchina usato · doppio montaggio.
      </p>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white rounded-2xl shadow p-4 space-y-4">
          <h2 className="text-lg font-semibold">Tipo prodotto</h2>
          <div className="flex gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="ptype"
                checked={productType === "commerciale"}
                onChange={() => setProductType("commerciale")}
              />
              Commerciale
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="ptype"
                checked={productType === "editoriale"}
                onChange={() => setProductType("editoriale")}
              />
              Editoriale
            </label>
          </div>

          <h2 className="text-lg font-semibold">Formato prodotto</h2>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useISO}
                onChange={(e) => setUseISO(e.target.checked)}
              />
              Usa formato ISO
            </label>

            <select
              disabled={!useISO}
              className="border rounded px-2 py-1 text-sm"
              value={isoKey}
              onChange={(e) => setIsoKey(e.target.value)}
            >
              {Object.keys(ISO_SIZES).map((k) => (
                <option key={k} value={k}>
                  {k} ({ISO_SIZES[k].w}×{ISO_SIZES[k].h})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-600">Base (mm) — formato chiuso</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={prodW}
                onChange={(e) => setProdW(Number(e.target.value))}
                disabled={useISO}
                min={1}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">Altezza (mm) — formato chiuso</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={prodH}
                onChange={(e) => setProdH(Number(e.target.value))}
                disabled={useISO}
                min={1}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-600">Orientamento</label>
            <select
              className="border rounded px-2 py-1 text-sm w-full"
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as Orientation)}
            >
              <option value="auto">Libero (auto)</option>
              <option value="portrait">Verticale</option>
              <option value="landscape">Orizzontale</option>
            </select>
          </div>

          {productType === "commerciale" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600">Quantità pezzi</label>
                <input
                  type="number"
                  className="w-full border rounded px-2 py-1"
                  value={qtyCommercial}
                  onChange={(e) => setQtyCommercial(Math.max(0, Number(e.target.value)))}
                  min={0}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600">Stampa</label>
                <select
                  className="w-full border rounded px-2 py-1"
                  value={printSidesCommercial}
                  onChange={(e) =>
                    setPrintSidesCommercial(Number(e.target.value) as PrintSides)
                  }
                >
                  <option value={1}>Solo fronte</option>
                  <option value={2}>Fronte / Retro</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs text-gray-600">Copie</label>
                  <input
                    type="number"
                    className="w-full border rounded px-2 py-1"
                    value={copies}
                    onChange={(e) => setCopies(Math.max(0, Number(e.target.value)))}
                    min={0}
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600">
                    Facciate totali (incl. copertina)
                  </label>
                  <input
                    type="number"
                    className="w-full border rounded px-2 py-1"
                    value={facciate}
                    onChange={(e) => setFacciate(Math.max(0, Number(e.target.value)))}
                    min={4}
                    step={4}
                  />
                </div>
              </div>

              {!facesValid && (
                <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded p-2">
                  Errore: le facciate totali devono essere un <b>multiplo di 4</b>.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs text-gray-600">Rilegatura</label>
                  <select
                    className="border rounded px-2 py-1 text-sm w-full"
                    value={binding}
                    onChange={(e) => setBinding(e.target.value as Binding)}
                  >
                    <option value="spillato">Spillato</option>
                    <option value="brossura">Brossura</option>
                    <option value="spirale">Spirale</option>
                  </select>
                </div>

                <label className="inline-flex items-center gap-2 text-sm mt-5">
                  <input
                    type="checkbox"
                    checked={autocopertinato}
                    onChange={(e) => setAutocopertinato(e.target.checked)}
                  />
                  Autocopertinato
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600">Stampa Interni</label>
                  <select
                    className="border rounded px-2 py-1 text-sm w-full"
                    value={printSidesInt}
                    onChange={(e) => setPrintSidesInt(Number(e.target.value) as PrintSides)}
                  >
                    <option value={1}>Solo fronte</option>
                    <option value={2}>Fronte / Retro</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-600">Stampa Copertina</label>
                  <select
                    className="border rounded px-2 py-1 text-sm w-full"
                    value={printSidesCov}
                    onChange={(e) => setPrintSidesCov(Number(e.target.value) as PrintSides)}
                  >
                    <option value={1}>Solo fronte</option>
                    <option value={2}>Fronte / Retro</option>
                  </select>
                </div>
              </div>

              <div className="rounded-md border bg-white p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={hasFlaps}
                      onChange={(e) => setHasFlaps(e.target.checked)}
                      disabled={binding === "spirale"}
                    />
                    Alette copertina
                  </label>

                  {binding === "spirale" && (
                    <span className="text-[11px] text-gray-500">
                      Non applicabile per spirale
                    </span>
                  )}
                </div>

                <div
                  className={`grid grid-cols-2 gap-2 ${
                    !hasFlaps || binding === "spirale"
                      ? "opacity-50 pointer-events-none"
                      : ""
                  }`}
                >
                  <div>
                    <label className="block text-xs text-gray-600">Alette predefinite</label>
                    <select
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={flapPresetId}
                      onChange={(e) => {
                        const v = e.target.value as FlapPresetId;
                        setFlapPresetId(v);
                        if (v !== "custom") setFlapCustomMm(getFlapPresetMm(v));
                      }}
                    >
                      {FLAP_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600">Dimensione aletta (mm)</label>
                    <input
                      type="number"
                      className="w-full border rounded px-2 py-1"
                      value={flapPresetId === "custom" ? flapCustomMm : getFlapPresetMm(flapPresetId)}
                      onChange={(e) => setFlapCustomMm(Math.max(0, Number(e.target.value)))}
                      disabled={flapPresetId !== "custom"}
                      min={0}
                    />
                  </div>
                </div>

                {hasFlaps && binding !== "spirale" && (
                  <div className="text-[11px] text-gray-600">
                    Nota: 6 cm significa <b>2 alette da 60 mm</b> (sinistra + destra),
                    quindi +120 mm totali sulla larghezza della copertina.
                  </div>
                )}
              </div>

              <div className="rounded-md bg-slate-50 border p-2 text-xs text-gray-700 space-y-2">
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <label className="block text-[11px] text-gray-600">
                      Carta interni
                    </label>
                    <select
                      className="border rounded px-2 py-1 text-xs w-full"
                      value={interiorPaperId}
                      onChange={(e) => setInteriorPaperId(e.target.value)}
                    >
                      {papers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.family} — {p.name} ({p.grammage} g/m²)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-gray-600">
                      Carta copertina
                    </label>
                    {autocopertinato ? (
                      <div className="text-xs py-1 text-gray-500">
                        Autocopertinato: stessa carta degli interni.
                      </div>
                    ) : (
                      <select
                        className="border rounded px-2 py-1 text-xs w-full"
                        value={coverPaperId}
                        onChange={(e) => setCoverPaperId(e.target.value)}
                      >
                        {papers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.family} — {p.name} ({p.grammage} g/m²)
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {papers.length === 0 && (
                    <div className="text-red-700 bg-red-50 border border-red-200 rounded p-1">
                      Nessuna carta in libreria: aggiungine una qui sotto per
                      poter calcolare il dorso.
                    </div>
                  )}
                </div>

                {(() => {
                  const { interiorLeaves, spine } = editorialDimsAndQty();
                  const geometric = binding === "brossura";
                  return (
                    <div>
                      <b>{geometric ? "Dorso" : "Spessore blocco (informativo)"}</b>:{" "}
                      {mm(spine)} · {interiorLeaves} fogli interni ×{" "}
                      {mm(caliperIntMm)}
                      {!interiorPaper && (
                        <span className="text-red-700"> (nessuna carta selezionata)</span>
                      )}
                      {!geometric && (
                        <span className="text-gray-500">
                          {" "}
                          — non applicato geometricamente alla copertina ({binding})
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="pt-1 border-t">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Carte (DB)</h3>
                  {!showAddPaper && (
                    <button
                      onClick={() => setShowAddPaper(true)}
                      className="text-sm px-2 py-1 rounded bg-slate-900 text-white hover:bg-slate-800"
                    >
                      + Aggiungi
                    </button>
                  )}
                </div>

                {showAddPaper && (
                  <div className="mt-2 p-2 border rounded bg-slate-50 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className="border rounded px-2 py-1 text-sm"
                        value={newPaperFamily}
                        onChange={(e) => setNewPaperFamily(e.target.value)}
                      >
                        {PAPER_FAMILIES.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <input
                        placeholder="Produttore (opzionale)"
                        className="border rounded px-2 py-1 text-sm"
                        value={newPaperManufacturer}
                        onChange={(e) => setNewPaperManufacturer(e.target.value)}
                      />
                      <input
                        placeholder="Nome commerciale"
                        className="border rounded px-2 py-1 text-sm col-span-2"
                        value={newPaperName}
                        onChange={(e) => setNewPaperName(e.target.value)}
                      />
                      <input
                        placeholder="Grammatura (g/m²)"
                        type="number"
                        className="border rounded px-2 py-1 text-sm"
                        value={newPaperGrammage}
                        onChange={(e) => setNewPaperGrammage(e.target.value)}
                      />
                      <input
                        placeholder="Spessore singolo foglio (µm)"
                        type="number"
                        className="border rounded px-2 py-1 text-sm"
                        value={newPaperCaliper}
                        onChange={(e) => setNewPaperCaliper(e.target.value)}
                      />
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Lo spessore in µm va preso dalla scheda tecnica del
                      fornitore (non dall'etichetta del pacco). Una volta
                      censito, l'operatore sceglierà solo famiglia/nome/
                      grammatura: il µm resta un dato interno.
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={addPaper}
                        className="text-sm px-3 py-1 rounded bg-emerald-600 text-white"
                      >
                        Aggiungi
                      </button>
                      <button
                        onClick={() => {
                          setShowAddPaper(false);
                          setNewPaperFamily(PAPER_FAMILIES[0]);
                          setNewPaperManufacturer("");
                          setNewPaperName("");
                          setNewPaperGrammage("");
                          setNewPaperCaliper("");
                        }}
                        className="text-sm px-3 py-1 rounded border"
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}

                <ul className="mt-2 space-y-1 max-h-48 overflow-auto">
                  {papers.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span>
                        {p.family} — {p.name}{" "}
                        <span className="text-gray-500">
                          ({p.grammage} g/m², {p.caliperUm} µm
                          {p.manufacturer ? `, ${p.manufacturer}` : ""})
                        </span>
                      </span>

                      {confirmDeletePaperId === p.id ? (
                        <span className="flex items-center gap-2">
                          <span className="text-red-700">Sicuro?</span>
                          <button
                            onClick={() => deletePaper(p.id)}
                            className="px-2 py-1 rounded bg-red-600 text-white"
                          >
                            Conferma
                          </button>
                          <button
                            onClick={() => setConfirmDeletePaperId(null)}
                            className="px-2 py-1 rounded border"
                          >
                            Annulla
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeletePaperId(p.id)}
                          className="px-2 py-1 rounded hover:bg-red-50"
                        >
                          🗑️
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <h2 className="text-lg font-semibold pt-2">Parametri di montaggio</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600">Margine X</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={marginX}
                onChange={(e) => setMarginX(Math.max(0, Number(e.target.value)))}
                min={0}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">Margine Y</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={marginY}
                onChange={(e) => setMarginY(Math.max(0, Number(e.target.value)))}
                min={0}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">Abbondanza</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={bleed}
                onChange={(e) => setBleed(Math.max(0, Number(e.target.value)))}
                min={0}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">Distanza X</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={gapX}
                onChange={(e) => setGapX(Math.max(0, Number(e.target.value)))}
                min={0}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">Distanza Y</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={gapY}
                onChange={(e) => setGapY(Math.max(0, Number(e.target.value)))}
                min={0}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">Margine sicurezza</label>
              <input
                type="number"
                className="w-full border rounded px-2 py-1"
                value={safety}
                onChange={(e) => setSafety(Math.max(0, Number(e.target.value)))}
                min={0}
              />
            </div>
          </div>

          <p className="text-[11px] text-gray-500">
            Incluso bordo macchina fisso: {EDGE_MARGIN} mm.
          </p>

          <h2 className="text-lg font-semibold pt-2">Scelta foglio macchina</h2>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={forceSheet}
                onChange={(e) => setForceSheet(e.target.checked)}
              />
              Forza foglio
            </label>

            <select
              disabled={!forceSheet}
              className="border rounded px-2 py-1 text-sm"
              value={forcedSheetId}
              onChange={(e) => setForcedSheetId(e.target.value)}
            >
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.w}×{s.h})
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2 border-t">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Fogli macchina (DB)</h3>
              {!showAdd && (
                <button
                  onClick={() => setShowAdd(true)}
                  className="text-sm px-2 py-1 rounded bg-slate-900 text-white hover:bg-slate-800"
                >
                  + Aggiungi
                </button>
              )}
            </div>

            {showAdd && (
              <div className="mt-2 p-2 border rounded bg-slate-50 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <input
                    placeholder="Label"
                    className="border rounded px-2 py-1 text-sm"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <input
                    placeholder="Base"
                    type="number"
                    className="border rounded px-2 py-1 text-sm"
                    value={newW}
                    onChange={(e) => setNewW(e.target.value)}
                  />
                  <input
                    placeholder="Altezza"
                    type="number"
                    className="border rounded px-2 py-1 text-sm"
                    value={newH}
                    onChange={(e) => setNewH(e.target.value)}
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={addSheet}
                    className="text-sm px-3 py-1 rounded bg-emerald-600 text-white"
                  >
                    Aggiungi
                  </button>
                  <button
                    onClick={() => {
                      setShowAdd(false);
                      setNewName("");
                      setNewW("");
                      setNewH("");
                    }}
                    className="text-sm px-3 py-1 rounded border"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}

            <ul className="mt-2 space-y-1 max-h-48 overflow-auto">
              {sheets.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <span>
                    {s.name} <span className="text-gray-500">({s.w}×{s.h})</span>
                  </span>

                  {confirmDeleteId === s.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-red-700">Sicuro?</span>
                      <button
                        onClick={() => deleteSheet(s.id)}
                        className="px-2 py-1 rounded bg-red-600 text-white"
                      >
                        Conferma
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 rounded border"
                      >
                        Annulla
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(s.id)}
                      className="px-2 py-1 rounded hover:bg-red-50"
                    >
                      🗑️
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-2 border-t">
            <label className="block text-xs text-gray-600">Zoom anteprima</label>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {productType === "commerciale" && (
            <div className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold mb-2">Commerciale — risultati</h2>

              {(() => {
                const list = evalCommercial;

                if (!list.length || list[0].nUp <= 0) {
                  return <PhysicalError dims={dimsClosed} />;
                }

                return (
                  <div className="space-y-4">
                    {list.slice(0, 6).map((ev, idx) => (
                      <div
                        key={ev.sheet.id}
                        className={`p-3 rounded border ${idx === 0 ? "bg-slate-50" : ""}`}
                      >
                        <div className="text-sm font-medium mb-1">
                          Foglio macchina: <b>{ev.sheet.name}</b> — {ev.sheet.w}×{ev.sheet.h} mm ·
                          Fogli necessari:{" "}
                          <b>{isFinite(ev.sheetsNeeded) ? ev.sheetsNeeded : "—"}</b> · Passate
                          macchina:{" "}
                          <b>{isFinite(ev.passesNeeded) ? ev.passesNeeded : "—"}</b> (
                          {printSidesCommercial === 2 ? "fronte/retro" : "solo fronte"})
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <SheetSVG sheet={ev.sheet} fit={ev.fitPortrait} label="Montaggio verticale" />
                          <SheetSVG sheet={ev.sheet} fit={ev.fitLandscape} label="Montaggio orizzontale" />
                        </div>

                        <div className="text-xs text-gray-600 mt-1">
                          Formula fogli: ceil({ev.qty} / {ev.nUp}) · Formula passate:{" "}
                          {isFinite(ev.sheetsNeeded) ? ev.sheetsNeeded : "—"} ×{" "}
                          {printSidesCommercial}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {productType === "editoriale" && (
            <div className="space-y-6">
              {!facesValid ? (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3">
                  Le facciate totali devono essere un <b>multiplo di 4</b>.
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border shadow bg-white">
                    <div className="p-3 border-b flex items-center justify-between">
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                        Interni
                      </h2>
                      <span className="text-xs text-gray-600">
                        Stampa: {printSidesInt === 2 ? "F/R" : "solo fronte"}
                      </span>
                    </div>

                    <div className="p-3 space-y-3">
                      {(() => {
                        const { interiorDims, interiorPieces } = editorialDimsAndQty();

                        const list = evalForPieceDims(
                          interiorDims.w,
                          interiorDims.h,
                          consideredSheets
                        ).map((ev) => ({
                          ...ev,
                          sheetsNeeded:
                            ev.nUp > 0
                              ? Math.ceil(interiorPieces / (ev.nUp * printSidesInt))
                              : Infinity,
                        }));

                        if (!list.length || list[0].nUp <= 0) {
                          return <PhysicalError dims={interiorDims} />;
                        }

                        const best = list[0];

                        return (
                          <div className="space-y-3">
                            <div className="text-xs text-gray-600">
                              Pezzi interni: {interiorPieces} · Dim.: {mm(interiorDims.w)} ×{" "}
                              {mm(interiorDims.h)}
                            </div>

                            <div className="text-sm font-medium">
                              Foglio macchina (best): <b>{best.sheet.name}</b> — {best.sheet.w}×
                              {best.sheet.h} mm
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <SheetSVG sheet={best.sheet} fit={best.fitPortrait} label="Montaggio verticale" />
                              <SheetSVG sheet={best.sheet} fit={best.fitLandscape} label="Montaggio orizzontale" />
                            </div>

                            <div className="text-sm">
                              Fogli necessari (best):{" "}
                              <b>{isFinite(best.sheetsNeeded) ? best.sheetsNeeded : "—"}</b> ·
                              Formula: ceil({interiorPieces} / ({best.nUp} × {printSidesInt}))
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="rounded-2xl border shadow bg-white">
                    <div className="p-3 border-b flex items-center justify-between">
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
                        Copertina
                      </h2>
                      <span className="text-xs text-gray-600">
                        Stampa: {printSidesCov === 2 ? "F/R" : "solo fronte"}
                      </span>
                    </div>

                    <div className="p-3 space-y-3">
                      {(() => {
                        const { coverDims, coverPieces, spine, flapMm } = editorialDimsAndQty();

                        const list = evalForPieceDims(
                          coverDims.w,
                          coverDims.h,
                          consideredSheets
                        ).map((ev) => ({
                          ...ev,
                          sheetsNeeded:
                            ev.nUp > 0
                              ? Math.ceil(coverPieces / (ev.nUp * printSidesCov))
                              : Infinity,
                        }));

                        if (!list.length || list[0].nUp <= 0) {
                          return <PhysicalError dims={coverDims} />;
                        }

                        const best = list[0];
                        const isBrossura = binding === "brossura";

                        return (
                          <div className="space-y-3">
                            <div className="text-xs text-gray-600">
                              Pezzi copertina: {coverPieces} · Dim.: {mm(coverDims.w)} ×{" "}
                              {mm(coverDims.h)}
                              {isBrossura && (
                                <>
                                  {" "}
                                  · Dorso aggiunto alla larghezza: <b>{mm(spine)}</b>
                                </>
                              )}
                              {flapMm > 0 && (
                                <>
                                  {" "}
                                  · Alette: <b>2×{mm(flapMm)}</b> (tot. +{mm(2 * flapMm)} larghezza)
                                </>
                              )}
                            </div>

                            <div className="text-sm font-medium">
                              Foglio macchina (best): <b>{best.sheet.name}</b> — {best.sheet.w}×
                              {best.sheet.h} mm
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <SheetSVG sheet={best.sheet} fit={best.fitPortrait} label="Montaggio verticale" />
                              <SheetSVG sheet={best.sheet} fit={best.fitLandscape} label="Montaggio orizzontale" />
                            </div>

                            <div className="text-sm">
                              Fogli necessari (best):{" "}
                              <b>{isFinite(best.sheetsNeeded) ? best.sheetsNeeded : "—"}</b> ·
                              Formula: ceil({coverPieces} / ({best.nUp} × {printSidesCov}))
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm">
                    <div>
                      <b>Rilegatura:</b> {binding}
                    </div>
                    {(() => {
                      const { interiorLeaves, spine, flapMm } = editorialDimsAndQty();
                      const geometric = binding === "brossura";
                      return (
                        <>
                          <div>
                            <b>{geometric ? "Dorso" : "Spessore blocco (informativo)"}:</b>{" "}
                            {mm(spine)} · {interiorLeaves} fogli ×{" "}
                            {interiorPaper ? interiorPaper.caliperUm : "—"} µm
                            {interiorPaper && (
                              <span className="text-gray-500">
                                {" "}
                                ({interiorPaper.name})
                              </span>
                            )}
                            {!geometric && (
                              <span className="text-gray-500">
                                {" "}
                                — non applicato geometricamente alla copertina
                              </span>
                            )}
                          </div>
                          {flapMm > 0 && (
                            <div>
                              <b>Alette:</b> 2×{mm(flapMm)} = +{mm(2 * flapMm)} sulla larghezza
                              copertina.
                            </div>
                          )}
                        </>
                      );
                    })()}
                    <div className="text-[11px] text-amber-700">
                      Il dorso è calcolato solo sullo spessore carta degli interni, senza colla,
                      laminazione o maggiorazioni.
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
