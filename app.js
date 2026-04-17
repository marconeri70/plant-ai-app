const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const preview = document.getElementById("preview");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");

const startCameraBtn = document.getElementById("startCameraBtn");
const takePhotoBtn = document.getElementById("takePhotoBtn");
const resetBtn = document.getElementById("resetBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const installBtn = document.getElementById("installBtn");
const locationBtn = document.getElementById("locationBtn");
const locationStatus = document.getElementById("locationStatus");

const fileInput = document.getElementById("fileInput");
const resultBox = document.getElementById("resultBox");
const historyList = document.getElementById("historyList");

let stream = null;
let currentImageData = null;
let deferredPrompt = null;
let currentLocation = null;

// Architettura Edge e Dinamica
let localAiModel = null; 
let activeKnowledge = {}; // La memoria RAM per i consigli di cura

const STORAGE_KEY = "plant_ai_history_v9";
const LOCATION_KEY = "plant_ai_location_v1";
const KNOWLEDGE_CACHE_KEY = "plant_ai_knowledge_v1";

// SOSTITUISCI CON IL TUO DOMINIO R2 REALE
const KNOWLEDGE_BASE_URL = "https://pub-61a4c996169b4df1bd3207906525c2a1.r2.dev"; 

const DISEASE_RED_THRESHOLD = 0.65;
const DISEASE_YELLOW_THRESHOLD = 0.25;

// ---------------------------------------------------------
// SINCRONIZZAZIONE KNOWLEDGE BASE (R2 -> EDGE)
// ---------------------------------------------------------

async function syncKnowledgeBase() {
  try {
    // 1. Carica dal disco locale (Zero Latenza per avvio offline)
    const cached = localStorage.getItem(KNOWLEDGE_CACHE_KEY);
    if (cached) {
      activeKnowledge = JSON.parse(cached);
    } else {
      // Dati di fallback predefiniti se l'app è offline al primissimo avvio
      activeKnowledge = {
        "daisy": { water: "Frequente", light: "Sole diretto", tips: ["Mantieni il terreno umido", "Rimuovi i fiori secchi"] },
        "pothos": { water: "Medio", light: "Indiretta", tips: ["Lascia asciugare tra le innaffiature", "Evita correnti fredde"] }
      };
    }

    // 2. Tenta l'aggiornamento invisibile dal Bucket R2
    const response = await fetch(KNOWLEDGE_BASE_URL, { cache: "no-store" });
    if (response.ok) {
      const freshData = await response.json();
      
      if (JSON.stringify(freshData) !== JSON.stringify(activeKnowledge)) {
        activeKnowledge = freshData;
        localStorage.setItem(KNOWLEDGE_CACHE_KEY, JSON.stringify(freshData));
        console.log("Knowledge Base sincronizzata con successo da R2.");
      }
    }
  } catch (error) {
    console.log("Sistema offline o R2 irraggiungibile. Utilizzo la Knowledge Base Edge.");
  }
}

function getCareTipsForLabel(aiLabel) {
  const key = aiLabel.toLowerCase();
  
  // Cerca un match dinamico nel dizionario caricato da R2
  for (const [k, v] of Object.entries(activeKnowledge)) {
    if (key.includes(k.toLowerCase())) {
      return {
        water: v.water || "Media",
        light: v.light || "Indiretta",
        tips: v.tips || ["Evita ristagni d'acqua", "Osserva lo sviluppo"]
      };
    }
  }
  
  // Fallback spietato se non c'è match
  return {
    water: "Da valutare",
    light: "Moderata",
    tips: ["Controlla il drenaggio", "Evita sole cocente diretto"]
  };
}

// ---------------------------------------------------------
// UI HELPERS E LOCATION
// ---------------------------------------------------------

function setResultMessage(html) {
  resultBox.innerHTML = html;
}

function showPlaceholder() {
  if (cameraPlaceholder) cameraPlaceholder.classList.remove("hidden");
}

function hidePlaceholder() {
  if (cameraPlaceholder) cameraPlaceholder.classList.add("hidden");
}

function setLocationStatus(text, isError = false) {
  if (!locationStatus) return;
  locationStatus.textContent = text;
  locationStatus.style.color = isError ? "#b71c1c" : "";
}

function loadSavedLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    currentLocation = raw ? JSON.parse(raw) : null;
  } catch (error) {
    currentLocation = null;
  }

  if (currentLocation) {
    setLocationStatus(
      `Posizione salvata: ${currentLocation.latitude.toFixed(5)}, ${currentLocation.longitude.toFixed(5)} (±${Math.round(currentLocation.accuracy)} m)`
    );
  } else {
    setLocationStatus("Posizione non impostata.");
  }
}

function saveLocation(location) {
  currentLocation = location;
  localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
  setLocationStatus(
    `Posizione attiva: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} (±${Math.round(location.accuracy)} m)`
  );
}

async function requestLocation() {
  if (!("geolocation" in navigator)) {
    setLocationStatus("Geolocalizzazione non supportata dal browser.", true);
    return;
  }

  setLocationStatus("Sto cercando la tua posizione...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      saveLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: Date.now()
      });
    },
    (error) => {
      let message = "Impossibile ottenere la posizione.";
      if (error.code === 1) message = "Permesso negato.";
      if (error.code === 2) message = "Posizione non disponibile.";
      if (error.code === 3) message = "Timeout.";
      setLocationStatus(message, true);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
  );
}

// ---------------------------------------------------------
// FOTOCAMERA E GESTIONE FILE
// ---------------------------------------------------------

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setResultMessage(`<div class="result-card"><div class="result-section">Fotocamera non supportata.</div></div>`);
      return;
    }

    stopCamera();

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });

    video.srcObject = stream;
    video.classList.remove("hidden");
    preview.classList.add("hidden");
    hidePlaceholder();

    takePhotoBtn.disabled = false;
    resetBtn.disabled = false;

    setResultMessage(`<div class="result-card"><div class="result-section">Fotocamera attiva. Inquadra bene e scatta.</div></div>`);
  } catch (error) {
    setResultMessage(`<div class="result-card"><div class="result-section">Impossibile accedere alla fotocamera. Controlla i permessi.</div></div>`);
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

  setTimeout(() => analyzeCurrentImage(), 50);
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
  if (!file || !file.type.startsWith("image/")) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    currentImageData = e.target.result;
    preview.src = currentImageData;
    preview.classList.remove("hidden");
    video.classList.add("hidden");
    hidePlaceholder();
    resetBtn.disabled = false;

    setTimeout(() => analyzeCurrentImage(), 50);
  };
  reader.readAsDataURL(file);
}

// ---------------------------------------------------------
// MOTORE EDGE AI (TENSORFLOW.JS)
// ---------------------------------------------------------

async function initializeLocalAI() {
  setResultMessage(`
    <div class="result-card">
      <div class="result-section" style="text-align: center;">
        <div class="result-title">Caricamento Motore Neurale...</div>
        <div style="font-size: 14px; color: #586558;">Inizializzazione AI sul dispositivo in corso. Nessun dato lascia il telefono.</div>
      </div>
    </div>
  `);

  try {
    localAiModel = await mobilenet.load({ version: 2, alpha: 1.0 });
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Sistema Attivo</div>
          Motore caricato in RAM. Fotografa una pianta.
        </div>
      </div>
    `);
    
    startCameraBtn.disabled = false;
    fileInput.disabled = false;
  } catch (error) {
    setResultMessage(`<div class="result-card"><div class="result-section">Errore caricamento AI. Ricarica la pagina.</div></div>`);
  }
}

function mapTfjsToPlantNetFormat(tfPredictions) {
  const formattedResults = tfPredictions.map(pred => {
    const names = pred.className.split(",").map(n => n.trim());
    return {
      score: pred.probability,
      species: {
        scientificNameWithoutAuthor: names[0],
        scientificName: names[0],
        commonNames: names,
        family: { scientificName: "Non rilevabile offline" },
        genus: { scientificName: "Richiede GBIF" }
      }
    };
  });
  return { results: formattedResults };
}

async function analyzeCurrentImage() {
  if (!currentImageData || !localAiModel) {
    setResultMessage("Motore non pronto. Attendi.");
    return;
  }

  setResultMessage(`<div class="result-card"><div class="result-section">Analisi visiva offline in esecuzione...</div></div>`);

  try {
    const previewElement = document.getElementById("preview");
    const predictions = await localAiModel.classify(previewElement, 3);

    if (!predictions || predictions.length === 0) throw new Error("Target non rilevato.");

    const speciesData = mapTfjsToPlantNetFormat(predictions);
    const gbifChecks = await fetchGbifChecksForCandidates(speciesData, currentLocation);

    const analysis = mapCombinedResponseToAnalysis(speciesData, null, gbifChecks, currentLocation);

    renderAnalysis(analysis);
    saveAnalysisToHistory(analysis, currentImageData);
    renderHistory();

  } catch (error) {
    setResultMessage(`<div class="result-card"><div class="result-section">Errore: ${escapeHtml(error.message)}</div></div>`);
  }
}

// ---------------------------------------------------------
// CHIAMATE PUBBLICHE (GBIF)
// ---------------------------------------------------------

async function fetchGbifChecksForCandidates(speciesData, location) {
  const candidates = (speciesData.results || []).slice(0, 3);
  const checks = [];

  for (const item of candidates) {
    const scientificName = item.species?.scientificName || "";
    if (!scientificName) continue;

    const taxonomy = await fetchGbifTaxonomy(scientificName);
    let geo = null;
    if (location && taxonomy && taxonomy.usageKey) {
      geo = await fetchGbifNearbyOccurrences(taxonomy.usageKey, location);
    }

    checks.push({ queryName: scientificName, plantNetScore: Number(item.score || 0), taxonomy, geo });
  }
  return checks;
}

async function fetchGbifTaxonomy(scientificName) {
  const response = await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`);
  if (!response.ok) return { found: false, scientificName, summary: "Errore DB." };

  const data = await response.json();
  if (!data || data.matchType === "NONE") return { found: false, scientificName, summary: "Nessun riscontro botanico." };

  return {
    found: true,
    usageKey: data.usageKey || null,
    scientificName: data.scientificName || scientificName,
    family: data.family || "N/D",
    genus: data.genus || "N/D",
    confidence: data.confidence ?? 0,
    summary: "Specie verificata."
  };
}

async function fetchGbifNearbyOccurrences(usageKey, location) {
  const radiusKm = Math.max(10, Math.min(100, Math.ceil(location.accuracy / 1000) * 5));
  const geometry = createWktCircle(location.latitude, location.longitude, radiusKm);
  const url = `https://api.gbif.org/v1/occurrence/search?taxon_key=${usageKey}&limit=20&has_coordinate=true&geometry=${encodeURIComponent(geometry)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error();
    const data = await response.json();
    return {
      checked: true,
      nearbyCount: Number(data.count || 0),
      radiusKm,
      summary: data.count > 0 ? `${data.count} occorrenze vicine.` : "Nessuna occorrenza vicina."
    };
  } catch (error) {
    return { checked: false, nearbyCount: 0, radiusKm, summary: "Geoverifica fallita." };
  }
}

function createWktCircle(lat, lon, radiusKm) {
  const points = [];
  const earthRadiusKm = 6371;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.sin(angle);
    const dLon = ((radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.cos(angle)) / Math.cos((lat * Math.PI) / 180);
    points.push(`${lon + dLon} ${lat + dLat}`);
  }
  return `POLYGON((${points.join(", ")}))`;
}

// ---------------------------------------------------------
// LOGICA PRESENTAZIONE E RENDER
// ---------------------------------------------------------

function mapCombinedResponseToAnalysis(speciesData, diseasesData, gbifChecks, location) {
  const results = (speciesData.results || []).slice(0, 3).map(item => {
    const name = item.species?.scientificName || "Sconosciuta";
    const check = gbifChecks.find(c => c.queryName === name);
    const taxonomyConfidence = check?.taxonomy?.found ? Math.min((Number(check.taxonomy.confidence || 0) / 100), 1) : 0;
    
    let geoScore = 0;
    if (location && check?.geo?.checked) {
      if (check.geo.nearbyCount >= 20) geoScore = 1;
      else if (check.geo.nearbyCount >= 5) geoScore = 0.6;
      else geoScore = 0.1;
    }

    const finalScore = location
      ? (item.score * 0.6) + (taxonomyConfidence * 0.15) + (geoScore * 0.25)
      : (item.score * 0.85) + (taxonomyConfidence * 0.15);

    return {
      name,
      commonName: item.species.commonNames[0] || name,
      family: check?.taxonomy?.family || "N/D",
      plantNetScore: item.score,
      finalScore,
      geoScore,
      taxonomy: check?.taxonomy || null,
      geo: check?.geo || null
    };
  }).sort((a, b) => b.finalScore - a.finalScore);

  const bestCandidate = results[0];
  const aiName = bestCandidate?.name || "Specie ignota";
  
  // Integrazione dinamica: interroghiamo la RAM popolata da R2
  const care = getCareTipsForLabel(aiName);

  return {
    plant: aiName,
    commonName: bestCandidate?.commonName || "N/D",
    family: bestCandidate?.family || "N/D",
    confidence: Math.round((bestCandidate?.plantNetScore || 0) * 100),
    finalScore: Math.round((bestCandidate?.finalScore || 0) * 100),
    geoScore: Math.round((bestCandidate?.geoScore || 0) * 100),
    water: care.water,
    light: care.light,
    care: care.tips,
    gbif: bestCandidate?.taxonomy || { summary: "Verifica botanica non disponibile." },
    geography: bestCandidate?.geo || { summary: location ? "Posizione non incrociata." : "Posizione disattivata." }
  };
}

function renderAnalysis(analysis) {
  setResultMessage(`
    <div class="result-card">
      <div class="result-hero">
        <div class="result-hero-top">
          <div>
            <div class="result-main-name">${escapeHtml(analysis.plant)}</div>
            <div class="result-subname">${escapeHtml(analysis.commonName)} • ${escapeHtml(analysis.family)}</div>
          </div>
          <div class="result-hero-score">
            <div class="result-hero-score-label">Affidabilità Modello</div>
            <div class="result-hero-score-value">${escapeHtml(String(analysis.finalScore))}%</div>
          </div>
        </div>
      </div>

      <div class="result-summary-grid">
        <div class="summary-card"><div class="summary-label">Visivo Locale</div><div class="summary-value">${escapeHtml(String(analysis.confidence))}%</div></div>
        <div class="summary-card"><div class="summary-label">Geoscore</div><div class="summary-value">${escapeHtml(String(analysis.geoScore))}%</div></div>
        <div class="summary-card"><div class="summary-label">Acqua</div><div class="summary-value">${escapeHtml(analysis.water)}</div></div>
        <div class="summary-card"><div class="summary-label">Luce</div><div class="summary-value">${escapeHtml(analysis.light)}</div></div>
      </div>

      <div class="result-section">
        <div class="result-title">Consigli di cura dinamicamente generati</div>
        <ul class="result-list">
          ${analysis.care.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>

      <div class="result-section">
        <div class="result-title">Riscontri incrociati</div>
        <div style="font-size: 14px;">
          <strong>DB Botanico:</strong> ${escapeHtml(analysis.gbif.summary)}<br>
          <strong>DB Geografico:</strong> ${escapeHtml(analysis.geography.summary)}
        </div>
      </div>
    </div>
  `);
}

// ---------------------------------------------------------
// STORICO LOCALE E GESTIONE UI BASE
// ---------------------------------------------------------

function getHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}

function saveAnalysisToHistory(analysis, imageData) {
  const history = getHistory();
  history.unshift({
    id: Date.now(), imageData, plant: analysis.plant,
    finalScore: analysis.finalScore, date: new Date().toLocaleString("it-IT")
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 10)));
}

function renderHistory() {
  const history = getHistory();
  if (!history.length) { historyList.innerHTML = `<div class="history-empty">Nessuna analisi salvata.</div>`; return; }
  historyList.innerHTML = history.map((item) => `
    <div class="history-item">
      <img src="${item.imageData}" class="history-thumb" />
      <div class="history-body">
        <div class="history-name">${escapeHtml(item.plant)}</div>
        <div class="history-meta">Punteggio: ${escapeHtml(String(item.finalScore))}%</div>
        <div class="history-date">${escapeHtml(item.date)}</div>
      </div>
    </div>
  `).join("");
}

function clearHistory() { localStorage.removeItem(STORAGE_KEY); renderHistory(); }

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); deferredPrompt = event;
  if (installBtn) installBtn.classList.remove("hidden");
});

if (installBtn) installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice;
  deferredPrompt = null; installBtn.classList.add("hidden");
});

if (locationBtn) locationBtn.addEventListener("click", requestLocation);
if (clearHistoryBtn) clearHistoryBtn.addEventListener("click", clearHistory);
window.addEventListener("beforeunload", stopCamera);
if (startCameraBtn) startCameraBtn.addEventListener("click", startCamera);
if (takePhotoBtn) takePhotoBtn.addEventListener("click", takePhoto);
if (resetBtn) resetBtn.addEventListener("click", resetPhoto);
if (fileInput) fileInput.addEventListener("change", handleFileUpload);

// ---------------------------------------------------------
// FASE DI INIZIALIZZAZIONE SISTEMA
// ---------------------------------------------------------
loadSavedLocation();
renderHistory();
showPlaceholder();

// L'app fa boot su due fronti: scarica l'intelligenza visiva e sincronizza il dizionario medico.
Promise.all([
  initializeLocalAI(),
  syncKnowledgeBase()
]);
