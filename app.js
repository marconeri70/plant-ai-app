const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const preview = document.getElementById("preview");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");

const startCameraBtn = document.getElementById("startCameraBtn");
const takePhotoBtn = document.getElementById("takePhotoBtn");
const resetBtn = document.getElementById("resetBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const installBtn = document.getElementById("installBtn");

const fileInput = document.getElementById("fileInput");
const resultBox = document.getElementById("resultBox");
const historyList = document.getElementById("historyList");

let stream = null;
let currentImageData = null;
let deferredPrompt = null;

const STORAGE_KEY = "plant_ai_history_v5";
const PLANTNET_API_KEY = "2b10OfTLt1KLLHWfjIAqvR3HDe";

const PLANTNET_PROJECT = "all";
const PLANTNET_ORGAN = "auto";
const PLANTNET_NB_RESULTS = 3;

const DISEASES_NB_RESULTS = 3;
const DISEASE_RED_THRESHOLD = 0.65;
const DISEASE_YELLOW_THRESHOLD = 0.25;

function setResultMessage(html) {
  resultBox.innerHTML = html;
}

function showPlaceholder() {
  cameraPlaceholder.classList.remove("hidden");
}

function hidePlaceholder() {
  cameraPlaceholder.classList.add("hidden");
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setResultMessage(`
        <div class="result-card">
          <div class="result-section">
            <div class="result-title">Fotocamera non supportata</div>
            Questo browser non supporta l'apertura della fotocamera.
          </div>
        </div>
      `);
      return;
    }

    stopCamera();

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;
    video.classList.remove("hidden");
    preview.classList.add("hidden");
    hidePlaceholder();

    takePhotoBtn.disabled = false;
    resetBtn.disabled = false;

    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Fotocamera attiva</div>
          Inquadra bene foglie, fusto o fiore e poi premi <b>Scatta foto</b>.
        </div>
      </div>
    `);
  } catch (error) {
    console.error(error);
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Impossibile aprire la fotocamera</div>
          Controlla i permessi oppure usa il caricamento manuale.
        </div>
      </div>
    `);
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
}

function takePhoto() {
  if (!stream) return;

  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) return;

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, width, height);

  currentImageData = canvas.toDataURL("image/jpeg", 0.92);

  preview.src = currentImageData;
  preview.classList.remove("hidden");
  video.classList.add("hidden");
  hidePlaceholder();

  analyzeCurrentImage();
}

function resetPhoto() {
  currentImageData = null;
  preview.src = "";
  preview.classList.add("hidden");
  fileInput.value = "";

  if (stream) {
    video.classList.remove("hidden");
    hidePlaceholder();
    setResultMessage("Pronto per una nuova foto.");
  } else {
    video.classList.add("hidden");
    takePhotoBtn.disabled = true;
    showPlaceholder();
    setResultMessage("Nessuna immagine caricata.");
  }
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setResultMessage("Seleziona un'immagine valida.");
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    currentImageData = e.target.result;
    preview.src = currentImageData;
    preview.classList.remove("hidden");
    video.classList.add("hidden");
    hidePlaceholder();
    resetBtn.disabled = false;

    analyzeCurrentImage();
  };
  reader.readAsDataURL(file);
}

async function analyzeCurrentImage() {
  if (!currentImageData) return;

  if (!PLANTNET_API_KEY || PLANTNET_API_KEY === "INSERISCI_LA_TUA_API_KEY") {
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">API key mancante</div>
          Inserisci la tua chiave API Pl@ntNet in <b>app.js</b>.
        </div>
      </div>
    `);
    return;
  }

  setResultMessage(`
    <div class="result-card">
      <div class="result-section">
        <div class="result-title">Analisi in corso...</div>
        Sto eseguendo riconoscimento specie, controllo malattie e verifica botanica.
      </div>
    </div>
  `);

  try {
    const blob = dataURLToBlob(currentImageData);

    const [speciesResponse, diseasesResponse] = await Promise.allSettled([
      identifyPlantWithPlantNet(blob),
      identifyDiseaseWithPlantNet(blob)
    ]);

    if (speciesResponse.status !== "fulfilled") {
      throw speciesResponse.reason;
    }

    const top = speciesResponse.value.results[0];
    const scientificName =
      top.species?.scientificNameWithoutAuthor ||
      top.species?.scientificName ||
      speciesResponse.value.bestMatch ||
      "";

    const gbifData = scientificName
      ? await fetchGbifTaxonomy(scientificName)
      : null;

    const analysis = mapCombinedResponseToAnalysis(
      speciesResponse.value,
      diseasesResponse.status === "fulfilled" ? diseasesResponse.value : null,
      gbifData
    );

    renderAnalysis(analysis);
    saveAnalysisToHistory(analysis, currentImageData);
    renderHistory();
  } catch (error) {
    console.error(error);
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Errore durante l'analisi</div>
          ${escapeHtml(error.message || "Errore sconosciuto")}
        </div>
      </div>
    `);
  }
}

async function identifyPlantWithPlantNet(imageBlob) {
  const url =
    `https://my-api.plantnet.org/v2/identify/${encodeURIComponent(PLANTNET_PROJECT)}` +
    `?api-key=${encodeURIComponent(PLANTNET_API_KEY)}` +
    `&nb-results=${encodeURIComponent(PLANTNET_NB_RESULTS)}` +
    `&lang=it` +
    `&include-related-images=true`;

  const formData = new FormData();
  formData.append("images", imageBlob, "plant.jpg");
  formData.append("organs", PLANTNET_ORGAN);

  const response = await fetch(url, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Errore Pl@ntNet specie (${response.status})`);
  }

  const data = await response.json();

  if (!data.results || !data.results.length) {
    throw new Error("Nessun risultato specie trovato.");
  }

  return data;
}

async function identifyDiseaseWithPlantNet(imageBlob) {
  const url =
    `https://my-api.plantnet.org/v2/diseases/identify` +
    `?api-key=${encodeURIComponent(PLANTNET_API_KEY)}` +
    `&nb-results=${encodeURIComponent(DISEASES_NB_RESULTS)}` +
    `&lang=it`;

  const formData = new FormData();
  formData.append("images", imageBlob, "plant.jpg");
  formData.append("organs", "auto");

  const response = await fetch(url, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

async function fetchGbifTaxonomy(scientificName) {
  const url = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Errore GBIF (${response.status})`);
  }

  return await response.json();
}

function mapCombinedResponseToAnalysis(speciesData, diseasesData, gbifData) {
  const top = speciesData.results[0];
  const species = top.species || {};

  const scientificName =
    species.scientificNameWithoutAuthor ||
    species.scientificName ||
    speciesData.bestMatch ||
    "Specie non determinata";

  const commonNames = Array.isArray(species.commonNames) ? species.commonNames : [];
  const commonName = commonNames.length ? commonNames[0] : "Nome comune non disponibile";

  const family = species.family?.scientificNameWithoutAuthor || species.family?.scientificName || "Famiglia non disponibile";
  const genus = species.genus?.scientificNameWithoutAuthor || species.genus?.scientificName || "Genere non disponibile";
  const confidence = Math.round((top.score || 0) * 100);

  const disease = parseDiseaseInfo(diseasesData);
  const gbif = parseGbifInfo(gbifData);
  const care = generateCareTipsFromPlantName(scientificName, commonName);

  return {
    plant: scientificName,
    commonName,
    family,
    genus,
    confidence,
    health: confidence >= 85
      ? "Riconoscimento specie molto affidabile."
      : confidence >= 65
      ? "Riconoscimento specie abbastanza affidabile."
      : "Riconoscimento specie incerto.",
    water: care.water,
    light: care.light,
    care: care.tips,
    disease,
    gbif
  };
}

function parseGbifInfo(gbifData) {
  if (!gbifData || gbifData.matchType === "NONE") {
    return {
      found: false,
      summary: "Nessuna conferma trovata nel database botanico."
    };
  }

  return {
    found: true,
    summary: "Specie verificata con database botanico.",
    scientificName: gbifData.scientificName || "N/D",
    canonicalName: gbifData.canonicalName || "N/D",
    family: gbifData.family || "N/D",
    genus: gbifData.genus || "N/D",
    status: gbifData.status || "N/D",
    rank: gbifData.rank || "N/D",
    matchType: gbifData.matchType || "N/D",
    confidence: gbifData.confidence ?? "N/D"
  };
}

function parseDiseaseInfo(diseasesData) {
  if (!diseasesData || !Array.isArray(diseasesData.results) || !diseasesData.results.length) {
    return {
      severity: "green",
      title: "Nessun problema rilevante",
      summary: "Nessuna diagnosi malattie affidabile disponibile."
    };
  }

  const top = diseasesData.results[0];
  const score = Number(top.score || 0);
  const scorePercent = Math.round(score * 100);

  if (score < DISEASE_YELLOW_THRESHOLD) {
    return {
      severity: "green",
      title: "Nessun problema rilevante",
      summary: `Risultato malattie molto debole (${scorePercent}%).`
    };
  }

  if (score < DISEASE_RED_THRESHOLD) {
    return {
      severity: "yellow",
      title: "Possibile problema da controllare",
      summary: `${top.description || "Problema non descritto"} (${scorePercent}%).`
    };
  }

  return {
    severity: "red",
    title: "Problema probabile rilevato",
    summary: `${top.description || "Patologia non descritta"} (${scorePercent}%).`
  };
}

function generateCareTipsFromPlantName(scientificName, commonName) {
  const name = `${scientificName} ${commonName}`.toLowerCase();

  if (name.includes("monstera")) {
    return {
      water: "Medio",
      light: "Intensa indiretta",
      tips: [
        "innaffia quando il terriccio è asciutto nei primi centimetri",
        "evita sole diretto forte",
        "aumenta leggermente l'umidità ambientale"
      ]
    };
  }

  if (name.includes("ficus")) {
    return {
      water: "Medio",
      light: "Intensa indiretta",
      tips: [
        "mantieni una posizione luminosa stabile",
        "pulisci le foglie dalla polvere",
        "evita ristagni"
      ]
    };
  }

  return {
    water: "Da valutare",
    light: "Luminosa senza eccessi",
    tips: [
      "controlla il drenaggio del vaso",
      "osserva foglie e fusto nei prossimi giorni",
      "evita eccessi d'acqua"
    ]
  };
}

function getSeverityBadge(disease) {
  if (disease?.severity === "red") {
    return { label: "Gravità alta", className: "severity-red" };
  }
  if (disease?.severity === "yellow") {
    return { label: "Gravità media", className: "severity-yellow" };
  }
  return { label: "Gravità bassa", className: "severity-green" };
}

function renderAnalysis(analysis) {
  const severityBadge = getSeverityBadge(analysis.disease);

  setResultMessage(`
    <div class="result-card">
      <div class="result-top">
        <div class="result-chip">🌿 ${escapeHtml(analysis.plant)}</div>
        <div class="result-chip">📊 Affidabilità specie: ${analysis.confidence}%</div>
        <div class="result-chip">💧 Acqua: ${escapeHtml(analysis.water)}</div>
        <div class="result-chip">☀️ Luce: ${escapeHtml(analysis.light)}</div>
      </div>

      <div class="result-section">
        <div class="result-title">Specie riconosciuta</div>
        <strong>Nome scientifico:</strong> ${escapeHtml(analysis.plant)}<br>
        <strong>Nome comune:</strong> ${escapeHtml(analysis.commonName)}<br>
        <strong>Genere:</strong> ${escapeHtml(analysis.genus)}<br>
        <strong>Famiglia:</strong> ${escapeHtml(analysis.family)}
      </div>

      <div class="result-section">
        <div class="result-title">Verifica botanica database</div>
        ${analysis.gbif.found ? `
          <strong>Esito:</strong> ${escapeHtml(analysis.gbif.summary)}<br>
          <strong>Nome accettato:</strong> ${escapeHtml(analysis.gbif.scientificName)}<br>
          <strong>Canonical name:</strong> ${escapeHtml(analysis.gbif.canonicalName)}<br>
          <strong>Famiglia:</strong> ${escapeHtml(analysis.gbif.family)}<br>
          <strong>Genere:</strong> ${escapeHtml(analysis.gbif.genus)}<br>
          <strong>Status:</strong> ${escapeHtml(analysis.gbif.status)}<br>
          <strong>Rank:</strong> ${escapeHtml(analysis.gbif.rank)}<br>
          <strong>Match type:</strong> ${escapeHtml(analysis.gbif.matchType)}<br>
          <strong>Confidence GBIF:</strong> ${escapeHtml(String(analysis.gbif.confidence))}
        ` : escapeHtml(analysis.gbif.summary)}
      </div>

      <div class="result-section">
        <div class="result-title">Diagnosi malattie</div>
        <div class="severity-wrap">
          <div class="severity-badge ${severityBadge.className}">
            <span class="severity-dot"></span>
            ${escapeHtml(severityBadge.label)}
          </div>
        </div>
        <br>
        <strong>${escapeHtml(analysis.disease.title)}</strong><br>
        ${escapeHtml(analysis.disease.summary)}
      </div>

      <div class="result-section">
        <div class="result-title">Consigli base di cura</div>
        ${analysis.care.map((item) => `• ${escapeHtml(item)}`).join("<br>")}
      </div>
    </div>
  `);
}

function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function saveAnalysisToHistory(analysis, imageData) {
  const history = getHistory();
  const severityBadge = getSeverityBadge(analysis.disease);

  history.unshift({
    id: Date.now(),
    imageData,
    plant: analysis.plant,
    confidence: analysis.confidence,
    diseaseSummary: analysis.disease.summary,
    severityLabel: severityBadge.label,
    gbifSummary: analysis.gbif.summary,
    date: new Date().toLocaleString("it-IT")
  });

  saveHistory(history.slice(0, 10));
}

function renderHistory() {
  const history = getHistory();

  if (!history.length) {
    historyList.innerHTML = `<div class="history-empty">Nessuna analisi salvata.</div>`;
    return;
  }

  historyList.innerHTML = history.map((item) => `
    <div class="history-item">
      <img src="${item.imageData}" alt="${escapeHtml(item.plant)}" class="history-thumb" />
      <div class="history-body">
        <div class="history-name">${escapeHtml(item.plant)}</div>
        <div class="history-meta">
          Affidabilità specie: ${escapeHtml(String(item.confidence))}%<br>
          Gravità: ${escapeHtml(item.severityLabel)}<br>
          Malattie: ${escapeHtml(item.diseaseSummary)}<br>
          Database: ${escapeHtml(item.gbifSummary)}
        </div>
        <div class="history-date">${escapeHtml(item.date)}</div>
      </div>
    </div>
  `).join("");
}

function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
}

function dataURLToBlob(dataURL) {
  const [header, base64] = dataURL.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";

  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.classList.remove("hidden");
});

installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add("hidden");
});

clearHistoryBtn.addEventListener("click", clearHistory);
window.addEventListener("beforeunload", stopCamera);

startCameraBtn.addEventListener("click", startCamera);
takePhotoBtn.addEventListener("click", takePhoto);
resetBtn.addEventListener("click", resetPhoto);
fileInput.addEventListener("change", handleFileUpload);

renderHistory();
setResultMessage("Nessuna immagine caricata.");
showPlaceholder();
