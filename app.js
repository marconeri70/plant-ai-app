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

const STORAGE_KEY = "plant_ai_history_v4";
const PLANTNET_API_KEY = "2b10OfTLt1KLLHWfjIAqvR3HDe";

const PLANTNET_PROJECT = "all";
const PLANTNET_ORGAN = "auto";
const PLANTNET_NB_RESULTS = 3;

const DISEASES_NB_RESULTS = 3;
const DISEASE_SCORE_THRESHOLD = 0.25;
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
          Inquadra bene foglie, macchie, parti secche o zone sospette, poi premi <b>Scatta foto</b>.
        </div>
      </div>
    `);
  } catch (error) {
    console.error("Errore apertura fotocamera:", error);
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Impossibile aprire la fotocamera</div>
          Controlla i permessi del browser oppure usa il caricamento manuale.
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
  if (!stream) {
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Fotocamera non attiva</div>
          Apri prima la fotocamera oppure carica una foto.
        </div>
      </div>
    `);
    return;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) {
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Attendi un momento</div>
          La fotocamera si sta inizializzando, poi riprova.
        </div>
      </div>
    `);
    return;
  }

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
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Pronto per una nuova foto</div>
          Inquadra la pianta oppure carica una nuova immagine.
        </div>
      </div>
    `);
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
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">File non valido</div>
          Seleziona un'immagine della pianta.
        </div>
      </div>
    `);
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

  reader.onerror = function () {
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Errore lettura file</div>
          Non sono riuscito a caricare l'immagine selezionata.
        </div>
      </div>
    `);
  };

  reader.readAsDataURL(file);
}

async function analyzeCurrentImage() {
  if (!currentImageData) {
    setResultMessage("Nessuna immagine caricata.");
    return;
  }

  if (!PLANTNET_API_KEY || PLANTNET_API_KEY === "INSERISCI_LA_TUA_API_KEY") {
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">API key mancante</div>
          Inserisci la tua chiave API di Pl@ntNet nel file <b>app.js</b> per attivare il riconoscimento reale.
        </div>
      </div>
    `);
    return;
  }

  setResultMessage(`
    <div class="result-card">
      <div class="result-section">
        <div class="result-title">Analisi in corso...</div>
        Sto eseguendo il riconoscimento della specie e la verifica di possibili malattie.
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

    const analysis = mapCombinedResponseToAnalysis(
      speciesResponse.value,
      diseasesResponse.status === "fulfilled" ? diseasesResponse.value : null
    );

    renderAnalysis(analysis);
    saveAnalysisToHistory(analysis, currentImageData);
    renderHistory();
  } catch (error) {
    console.error("Errore analisi:", error);

    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Errore durante l'analisi</div>
          ${escapeHtml(error.message || "Non sono riuscito a completare l'analisi.")}
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
    const extra = await safeReadText(response);

    if (response.status === 404) throw new Error("Endpoint specie non trovato.");
    if (response.status === 429) throw new Error("Limite richieste raggiunto per oggi.");
    if (response.status === 401 || response.status === 403) throw new Error("API key non valida o non autorizzata.");

    throw new Error(`Errore API specie (${response.status}). ${extra}`);
  }

  const data = await response.json();

  if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
    throw new Error("Nessun risultato specie trovato. Prova con una foto più nitida.");
  }

  return data;
}

async function identifyDiseaseWithPlantNet(imageBlob) {
  const url =
    `https://my-api.plantnet.org/v2/diseases/identify` +
    `?api-key=${encodeURIComponent(PLANTNET_API_KEY)}` +
    `&nb-results=${encodeURIComponent(DISEASES_NB_RESULTS)}` +
    `&lang=it` +
    `&include-related-images=true`;

  const formData = new FormData();
  formData.append("images", imageBlob, "plant.jpg");
  formData.append("organs", "auto");

  const response = await fetch(url, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const extra = await safeReadText(response);

    if (response.status === 404) {
      throw new Error("Endpoint malattie non trovato.");
    }
    if (response.status === 429) {
      throw new Error("Limite richieste malattie raggiunto per oggi.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("API key non valida per diagnosi malattie.");
    }

    throw new Error(`Errore API malattie (${response.status}). ${extra}`);
  }

  return await response.json();
}

function mapCombinedResponseToAnalysis(speciesData, diseasesData) {
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
  const predictedOrgan = speciesData.predictedOrgans?.[0]?.organ || "auto";
  const remaining = speciesData.remainingIdentificationRequests ?? "n/d";

  const care = generateCareTipsFromPlantName(scientificName, commonName);
  const speciesHealth = generateVisualStatusMessage(confidence);
  const diseaseInfo = parseDiseaseInfo(diseasesData);

  const alternatives = speciesData.results.slice(1, 3).map((item) => {
    const altName =
      item.species?.scientificNameWithoutAuthor ||
      item.species?.scientificName ||
      "Specie alternativa";
    return `${altName} (${Math.round((item.score || 0) * 100)}%)`;
  });

  return {
    plant: scientificName,
    commonName,
    family,
    genus,
    confidence,
    health: speciesHealth,
    water: care.water,
    light: care.light,
    causes: [
      `organo rilevato: ${predictedOrgan}`,
      `famiglia botanica: ${family}`,
      alternatives.length ? `alternative probabili: ${alternatives.join(", ")}` : "nessuna alternativa forte disponibile"
    ],
    care: care.tips,
    remainingRequests: remaining,
    disease: diseaseInfo
  };
}

function parseDiseaseInfo(diseasesData) {
  if (!diseasesData || !Array.isArray(diseasesData.results) || diseasesData.results.length === 0) {
    return {
      status: "none",
      severity: "green",
      title: "Nessuna diagnosi malattie disponibile",
      summary: "Il servizio non ha restituito risultati utili per la diagnosi."
    };
  }

  const top = diseasesData.results[0];
  const score = Number(top.score || 0);
  const scorePercent = Math.round(score * 100);

  const topResults = diseasesData.results.slice(0, 3).map((item) => ({
    code: item.name || "N/D",
    description: item.description || item.label || "Descrizione non disponibile",
    scorePercent: Math.round((item.score || 0) * 100)
  }));

  if (score < DISEASE_YELLOW_THRESHOLD) {
    return {
      status: "low",
      severity: "green",
      title: "Nessun problema rilevante",
      summary: `Il risultato malattie è molto debole (${scorePercent}%). Al momento non emerge un problema affidabile.`,
      topResults
    };
  }

  if (score >= DISEASE_YELLOW_THRESHOLD && score < DISEASE_RED_THRESHOLD) {
    return {
      status: "warning",
      severity: "yellow",
      title: "Possibile problema da controllare",
      summary: `${top.description || "Problema non descritto"} (${scorePercent}%). Conviene controllare la pianta e fare una foto più ravvicinata.`,
      topResults
    };
  }

  return {
    status: "detected",
    severity: "red",
    title: "Problema probabile rilevato",
    summary: `${top.description || "Patologia non descritta"} (${scorePercent}%)`,
    topResults,
    remainingRequests: diseasesData.remainingIdentificationRequests ?? "n/d"
  };
}

function generateVisualStatusMessage(confidence) {
  if (confidence >= 85) {
    return "Riconoscimento specie molto affidabile.";
  }
  if (confidence >= 65) {
    return "Riconoscimento specie abbastanza affidabile. Una seconda foto può migliorare il risultato.";
  }
  return "Riconoscimento specie incerto. Prova con una foto più nitida e più vicina.";
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

  if (name.includes("pothos") || name.includes("epipremnum")) {
    return {
      water: "Medio",
      light: "Indiretta moderata",
      tips: [
        "mantieni il terreno leggermente umido ma non fradicio",
        "taglia le foglie molto rovinate",
        "tieni la pianta lontana da aria fredda e correnti"
      ]
    };
  }

  if (name.includes("sansevieria") || name.includes("dracaena trifasciata")) {
    return {
      water: "Basso",
      light: "Da media a intensa",
      tips: [
        "lascia asciugare bene il terriccio tra un'annaffiatura e l'altra",
        "usa un vaso con buon drenaggio",
        "evita eccessi d'acqua"
      ]
    };
  }

  if (name.includes("ficus")) {
    return {
      water: "Medio",
      light: "Intensa indiretta",
      tips: [
        "mantieni una posizione stabile e luminosa",
        "pulisci le foglie dalla polvere",
        "innaffia con regolarità senza ristagni"
      ]
    };
  }

  return {
    water: "Da valutare",
    light: "Luminosa senza eccessi",
    tips: [
      "controlla che il terreno non resti sempre bagnato",
      "verifica la luce disponibile nell'ambiente",
      "osserva foglie e fusto nei prossimi giorni per eventuali segnali di stress"
    ]
  };
}

function getSeverityBadge(disease) {
  if (!disease || !disease.severity) {
    return {
      label: "Stato non disponibile",
      className: "severity-green"
    };
  }

  if (disease.severity === "red") {
    return {
      label: "Gravità alta",
      className: "severity-red"
    };
  }

  if (disease.severity === "yellow") {
    return {
      label: "Gravità media",
      className: "severity-yellow"
    };
  }

  return {
    label: "Gravità bassa",
    className: "severity-green"
  };
}

function renderAnalysis(analysis) {
  const diseaseHtml = renderDiseaseSection(analysis.disease);
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
        <div class="result-title">Valutazione specie</div>
        ${escapeHtml(analysis.health)}
      </div>

      <div class="result-section">
        <div class="result-title">Dettagli utili</div>
        ${analysis.causes.map((item) => `• ${escapeHtml(item)}`).join("<br>")}
      </div>

      <div class="result-section">
        <div class="result-title">Gravità del problema</div>
        <div class="severity-wrap">
          <div class="severity-badge ${severityBadge.className}">
            <span class="severity-dot"></span>
            ${escapeHtml(severityBadge.label)}
          </div>
        </div>
      </div>

      ${diseaseHtml}

      <div class="result-section">
        <div class="result-title">Consigli base di cura</div>
        ${analysis.care.map((item) => `• ${escapeHtml(item)}`).join("<br>")}
      </div>

      <div class="note-box">
        <strong>Richieste specie rimanenti oggi:</strong> ${escapeHtml(String(analysis.remainingRequests))}
      </div>
    </div>
  `);
}

function renderDiseaseSection(disease) {
  if (!disease) {
    return `
      <div class="result-section">
        <div class="result-title">Diagnosi malattie</div>
        Nessun dato disponibile.
      </div>
    `;
  }

  const topResultsHtml = Array.isArray(disease.topResults) && disease.topResults.length
    ? disease.topResults
        .map(
          (item) =>
            `• ${escapeHtml(item.description)} — codice ${escapeHtml(item.code)} — ${escapeHtml(String(item.scorePercent))}%`
        )
        .join("<br>")
    : "Nessun dettaglio disponibile.";

  return `
    <div class="result-section">
      <div class="result-title">Diagnosi malattie</div>
      <strong>${escapeHtml(disease.title)}</strong><br>
      ${escapeHtml(disease.summary)}<br><br>
      ${topResultsHtml}
    </div>
  `;
}

function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("Errore lettura storico:", error);
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
    health: analysis.health,
    water: analysis.water,
    light: analysis.light,
    diseaseSummary: analysis.disease?.summary || "Nessuna diagnosi disponibile",
    severityLabel: severityBadge.label,
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

  historyList.innerHTML = history
    .map(
      (item) => `
        <div class="history-item">
          <img src="${item.imageData}" alt="${escapeHtml(item.plant)}" class="history-thumb" />
          <div class="history-body">
            <div class="history-name">${escapeHtml(item.plant)}</div>
            <div class="history-meta">
              Stato: ${escapeHtml(item.health)}<br>
              Acqua: ${escapeHtml(item.water)}<br>
              Luce: ${escapeHtml(item.light)}<br>
              Gravità: ${escapeHtml(item.severityLabel || "Non disponibile")}<br>
              Malattie: ${escapeHtml(item.diseaseSummary)}<br>
              Affidabilità specie: ${escapeHtml(String(item.confidence))}%
            </div>
            <div class="history-date">${escapeHtml(item.date)}</div>
          </div>
        </div>
      `
    )
    .join("");
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

async function safeReadText(response) {
  try {
    return await response.text();
  } catch (_) {
    return "";
  }
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
