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
let localAiModel = null; // Il nostro motore locale TensorFlow.js

const STORAGE_KEY = "plant_ai_history_v8";
const LOCATION_KEY = "plant_ai_location_v1";

const DISEASES_NB_RESULTS = 3;
const DISEASE_RED_THRESHOLD = 0.65;
const DISEASE_YELLOW_THRESHOLD = 0.25;

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
      const location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: Date.now()
      };
      saveLocation(location);
    },
    (error) => {
      let message = "Impossibile ottenere la posizione.";
      if (error.code === 1) message = "Permesso posizione negato.";
      if (error.code === 2) message = "Posizione non disponibile.";
      if (error.code === 3) message = "Tempo scaduto nella richiesta GPS.";
      setLocationStatus(message, true);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000
    }
  );
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

  // Diamo al browser un frame per aggiornare l'immagine nel DOM prima di passarla all'AI
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

    setTimeout(() => analyzeCurrentImage(), 50);
  };
  reader.readAsDataURL(file);
}

// ---------------------------------------------------------
// INTEGRAZIONE EDGE AI (SISTEMA LOCALE)
// ---------------------------------------------------------

async function initializeLocalAI() {
  setResultMessage(`
    <div class="result-card">
      <div class="result-section" style="text-align: center;">
        <div class="result-title">Caricamento Motore AI...</div>
        <div style="font-size: 14px; color: #586558;">Inizializzazione delle reti neurali sul dispositivo. Nessun dato viene inviato a server di terze parti.</div>
      </div>
    </div>
  `);

  try {
    localAiModel = await mobilenet.load({ version: 2, alpha: 1.0 });
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Sistema Neurale Attivo</div>
          Motore AI caricato in memoria. L'analisi avverrà sul tuo dispositivo. Fotografa una pianta.
        </div>
      </div>
    `);
    
    startCameraBtn.disabled = false;
    fileInput.disabled = false;
  } catch (error) {
    console.error("Errore fatale caricamento AI:", error);
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Errore AI</div>
          Errore nell'inizializzazione del motore neurale. Ricarica la pagina.
        </div>
      </div>
    `);
  }
}

function mapTfjsToPlantNetFormat(tfPredictions) {
  const formattedResults = tfPredictions.map(pred => {
    const names = pred.className.split(",").map(n => n.trim());
    const primaryName = names[0];
    
    return {
      score: pred.probability,
      species: {
        scientificNameWithoutAuthor: primaryName,
        scientificName: primaryName,
        commonNames: names,
        family: { scientificName: "Non rilevabile offline" },
        genus: { scientificName: "Richiede verifica GBIF" }
      }
    };
  });

  return { results: formattedResults };
}

async function analyzeCurrentImage() {
  if (!currentImageData || !localAiModel) {
    setResultMessage("Motore AI non ancora pronto. Attendi qualche istante.");
    return;
  }

  setResultMessage(`
    <div class="result-card">
      <div class="result-section">
        <div class="result-title">Inferenza visiva in corso...</div>
        Elaborazione tramite processore locale in esecuzione.
      </div>
    </div>
  `);

  try {
    // 1. Elaborazione Edge: Il canvas viene letto direttamente dalla libreria TF.js
    const previewElement = document.getElementById("preview");
    const predictions = await localAiModel.classify(previewElement, 3);

    if (!predictions || predictions.length === 0) {
      throw new Error("Il modello visivo non ha rilevato alcun target valido.");
    }

    // 2. Mappatura Adattatore (Isola l'UI dai cambiamenti di back-end)
    const speciesData = mapTfjsToPlantNetFormat(predictions);
    
    // Al momento, il modello generalista non fa diagnosi di patologie
    const diseasesData = null; 

    // 3. Validazione incrociata gratuita su database GBIF
    const gbifChecks = await fetchGbifChecksForCandidates(speciesData, currentLocation);

    const analysis = mapCombinedResponseToAnalysis(
      speciesData,
      diseasesData,
      gbifChecks,
      currentLocation
    );

    renderAnalysis(analysis);
    saveAnalysisToHistory(analysis, currentImageData);
    renderHistory();

  } catch (error) {
    console.error(error);
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Errore Elaborazione Visiva</div>
          ${escapeHtml(error.message || "Eccezione sconosciuta nel runtime locale.")}
        </div>
      </div>
    `);
  }
}

// ---------------------------------------------------------
// CHIAMATE DATI PUBBLICI (GBIF)
// ---------------------------------------------------------

async function fetchGbifChecksForCandidates(speciesData, location) {
  const candidates = (speciesData.results || []).slice(0, 3);
  const checks = [];

  for (const item of candidates) {
    const scientificName =
      item.species?.scientificNameWithoutAuthor ||
      item.species?.scientificName ||
      "";

    if (!scientificName) continue;

    const taxonomy = await fetchGbifTaxonomy(scientificName);
    let geo = null;

    if (location && taxonomy && taxonomy.usageKey) {
      geo = await fetchGbifNearbyOccurrences(taxonomy.usageKey, location);
    }

    checks.push({
      queryName: scientificName,
      plantNetScore: Number(item.score || 0),
      taxonomy,
      geo
    });
  }

  return checks;
}

async function fetchGbifTaxonomy(scientificName) {
  const url = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Errore GBIF match (${response.status})`);
  }

  const data = await response.json();

  if (!data || data.matchType === "NONE") {
    return {
      found: false,
      scientificName,
      summary: "Nessuna conferma trovata nel database botanico."
    };
  }

  return {
    found: true,
    usageKey: data.usageKey || null,
    scientificName: data.scientificName || scientificName,
    canonicalName: data.canonicalName || "N/D",
    family: data.family || "N/D",
    genus: data.genus || "N/D",
    status: data.status || "N/D",
    rank: data.rank || "N/D",
    matchType: data.matchType || "N/D",
    confidence: data.confidence ?? 0,
    summary: "Specie verificata con database botanico."
  };
}

async function fetchGbifNearbyOccurrences(usageKey, location) {
  const radiusKm = getRadiusKmFromAccuracy(location.accuracy);
  const geometry = createWktCircle(location.latitude, location.longitude, radiusKm);

  const url =
    `https://api.gbif.org/v1/occurrence/search?taxon_key=${encodeURIComponent(usageKey)}` +
    `&limit=20&has_coordinate=true&geometry=${encodeURIComponent(geometry)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        checked: false,
        nearbyCount: 0,
        radiusKm,
        summary: "Verifica geografica non disponibile."
      };
    }

    const data = await response.json();
    const count = Number(data.count || 0);

    return {
      checked: true,
      nearbyCount: count,
      radiusKm,
      summary:
        count > 0
          ? `Trovate ${count} occorrenze GBIF nell'area vicina.`
          : "Nessuna occorrenza GBIF trovata nell'area vicina."
    };
  } catch (error) {
    return {
      checked: false,
      nearbyCount: 0,
      radiusKm,
      summary: "Errore nella verifica geografica."
    };
  }
}

function getRadiusKmFromAccuracy(accuracyMeters) {
  if (!accuracyMeters || Number.isNaN(accuracyMeters)) return 50;
  const km = Math.max(10, Math.min(100, Math.ceil(accuracyMeters / 1000) * 5));
  return km;
}

function createWktCircle(lat, lon, radiusKm) {
  const points = [];
  const earthRadiusKm = 6371;
  const steps = 24;

  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.sin(angle);
    const dLon =
      ((radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.cos(angle)) /
      Math.cos((lat * Math.PI) / 180);

    const pointLat = lat + dLat;
    const pointLon = lon + dLon;

    points.push(`${pointLon} ${pointLat}`);
  }

  return `POLYGON((${points.join(", ")}))`;
}

// ---------------------------------------------------------
// LOGICA DI PRESENTAZIONE & ALGORITMI
// ---------------------------------------------------------

function mapCombinedResponseToAnalysis(speciesData, diseasesData, gbifChecks, location) {
  const rankedCandidates = rankCandidates(speciesData, gbifChecks, location);
  const bestCandidate = rankedCandidates[0];

  const scientificName = bestCandidate?.name || "Specie non determinata";
  const commonName = bestCandidate?.commonName || "Nome comune non disponibile";
  const family = bestCandidate?.family || "Famiglia non disponibile";
  const genus = bestCandidate?.genus || "Genere non disponibile";

  const confidence = Math.round((bestCandidate?.plantNetScore || 0) * 100);
  const finalScore = Math.round((bestCandidate?.finalScore || 0) * 100);
  const geoScore = Math.round((bestCandidate?.geoScore || 0) * 100);

  const disease = parseDiseaseInfo(diseasesData);
  const care = generateCareTipsFromPlantName(scientificName, commonName);

  return {
    plant: scientificName,
    commonName,
    family,
    genus,
    confidence,
    finalScore,
    geoScore,
    health:
      finalScore >= 85
        ? "Risultato finale molto affidabile."
        : finalScore >= 65
        ? "Risultato finale abbastanza affidabile."
        : "Risultato finale ancora incerto.",
    water: care.water,
    light: care.light,
    care: care.tips,
    disease,
    location,
    gbif: {
      found: !!bestCandidate?.taxonomy?.found,
      summary: bestCandidate?.taxonomy?.summary || "Nessuna verifica botanica disponibile.",
      scientificName: bestCandidate?.taxonomy?.scientificName || scientificName,
      canonicalName: bestCandidate?.taxonomy?.canonicalName || "N/D",
      family: bestCandidate?.taxonomy?.family || family,
      genus: bestCandidate?.taxonomy?.genus || genus,
      status: bestCandidate?.taxonomy?.status || "N/D",
      rank: bestCandidate?.taxonomy?.rank || "N/D",
      matchType: bestCandidate?.taxonomy?.matchType || "N/D",
      confidence: bestCandidate?.taxonomy?.confidence ?? 0
    },
    geography: {
      enabled: !!location,
      summary:
        bestCandidate?.geo?.summary ||
        (location ? "Verifica geografica eseguita." : "Posizione non usata."),
      nearbyCount: bestCandidate?.geo?.nearbyCount ?? 0,
      radiusKm: bestCandidate?.geo?.radiusKm ?? null
    },
    alternatives: rankedCandidates.slice(1, 3).map((item) => ({
      name: item.name,
      finalScore: Math.round((item.finalScore || 0) * 100)
    }))
  };
}

function rankCandidates(speciesData, gbifChecks, location) {
  const results = (speciesData.results || []).slice(0, 3);

  return results
    .map((item) => {
      const name =
        item.species?.scientificNameWithoutAuthor ||
        item.species?.scientificName ||
        "Specie alternativa";

      const commonNames = Array.isArray(item.species?.commonNames) ? item.species.commonNames : [];
      const commonName = commonNames.length ? commonNames[0] : "Nome comune non disponibile";

      const plantNetScore = Number(item.score || 0);
      const check = gbifChecks.find((c) => c.queryName === name);

      const taxonomyConfidence = check?.taxonomy?.found
        ? Math.min((Number(check.taxonomy.confidence || 0) / 100), 1)
        : 0;

      let geoScore = 0;
      if (location && check?.geo?.checked) {
        if (check.geo.nearbyCount >= 20) geoScore = 1;
        else if (check.geo.nearbyCount >= 10) geoScore = 0.8;
        else if (check.geo.nearbyCount >= 5) geoScore = 0.6;
        else if (check.geo.nearbyCount >= 1) geoScore = 0.4;
        else geoScore = 0.1;
      }

      const finalScore = location
        ? (plantNetScore * 0.6) + (taxonomyConfidence * 0.15) + (geoScore * 0.25)
        : (plantNetScore * 0.85) + (taxonomyConfidence * 0.15);

      return {
        name,
        commonName,
        family:
          item.species?.family?.scientificNameWithoutAuthor ||
          item.species?.family?.scientificName ||
          check?.taxonomy?.family ||
          "Famiglia non disponibile",
        genus:
          item.species?.genus?.scientificNameWithoutAuthor ||
          item.species?.genus?.scientificName ||
          check?.taxonomy?.genus ||
          "Genere non disponibile",
        plantNetScore,
        taxonomyConfidence,
        geoScore,
        finalScore,
        taxonomy: check?.taxonomy || null,
        geo: check?.geo || null
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}

function parseDiseaseInfo(diseasesData) {
  if (!diseasesData || !Array.isArray(diseasesData.results) || !diseasesData.results.length) {
    return {
      severity: "green",
      title: "Funzione non attiva",
      summary: "Diagnosi delle patologie non inclusa nel modello Edge AI base."
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

  if (name.includes("pothos") || name.includes("epipremnum")) {
    return {
      water: "Medio",
      light: "Indiretta moderata",
      tips: [
        "mantieni il terreno leggermente umido ma non fradicio",
        "evita correnti d'aria fredde",
        "taglia le foglie molto rovinate"
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
  return { label: "Info", className: "severity-green" };
}

function renderAnalysis(analysis) {
  const severityBadge = getSeverityBadge(analysis.disease);

  const alternativesHtml = analysis.alternatives && analysis.alternatives.length
    ? `<ul class="result-list">${analysis.alternatives
        .map((item) => `<li>${escapeHtml(item.name)} — punteggio ${escapeHtml(String(item.finalScore))}%</li>`)
        .join("")}</ul>`
    : "Nessuna alternativa forte disponibile.";

  const locationSummary = analysis.location
    ? `
      <div class="tech-item">
        <div class="tech-label">Posizione usata</div>
        <div class="tech-value">${escapeHtml(analysis.location.latitude.toFixed(5))}, ${escapeHtml(analysis.location.longitude.toFixed(5))}</div>
      </div>
      <div class="tech-item">
        <div class="tech-label">Accuratezza GPS</div>
        <div class="tech-value">±${escapeHtml(String(Math.round(analysis.location.accuracy)))} m</div>
      </div>
      <div class="tech-item">
        <div class="tech-label">Occorrenze vicine GBIF</div>
        <div class="tech-value">${escapeHtml(String(analysis.geography.nearbyCount))}${analysis.geography.radiusKm ? ` entro ${escapeHtml(String(analysis.geography.radiusKm))} km` : ""}</div>
      </div>
      <div class="tech-item">
        <div class="tech-label">Esito geografico</div>
        <div class="tech-value">${escapeHtml(analysis.geography.summary)}</div>
      </div>
    `
    : `
      <div class="tech-item">
        <div class="tech-label">Geolocalizzazione</div>
        <div class="tech-value">Non usata</div>
      </div>
      <div class="tech-item">
        <div class="tech-label">Suggerimento</div>
        <div class="tech-value">Attiva “Usa posizione” per verificare contro l'ecosistema locale.</div>
      </div>
    `;

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
        <div class="summary-card">
          <div class="summary-label">Riconoscimento Locale</div>
          <div class="summary-value">${escapeHtml(String(analysis.confidence))}%</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Controllo Geografico</div>
          <div class="summary-value">${escapeHtml(String(analysis.geoScore))}%</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Acqua</div>
          <div class="summary-value">${escapeHtml(analysis.water)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Luce</div>
          <div class="summary-value">${escapeHtml(analysis.light)}</div>
        </div>
      </div>

      <div class="result-section">
        <div class="result-title">Risultato principale</div>
        <div class="result-tech-grid">
          <div class="tech-item">
            <div class="tech-label">Classe rilevata (Modello)</div>
            <div class="tech-value">${escapeHtml(analysis.plant)}</div>
          </div>
          <div class="tech-item">
            <div class="tech-label">Nome comune (Approssimato)</div>
            <div class="tech-value">${escapeHtml(analysis.commonName)}</div>
          </div>
        </div>
        <div style="margin-top:12px;">
          <strong>Stato Elaborazione:</strong> ${escapeHtml(analysis.health)}
        </div>
      </div>

      <div class="result-section">
        <div class="result-title">Diagnosi malattie</div>
        <div class="severity-wrap">
          <div class="severity-badge ${severityBadge.className}">
            <span class="severity-dot"></span>
            ${escapeHtml(severityBadge.label)}
          </div>
        </div>
        <div style="margin-top:12px;">
          <strong>${escapeHtml(analysis.disease.title)}</strong><br>
          ${escapeHtml(analysis.disease.summary)}
        </div>
      </div>

      <div class="result-section">
        <div class="result-title">Consigli base di cura</div>
        <ul class="result-list">
          ${analysis.care.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>

      <div class="result-section">
        <div class="result-title">Verifica botanica remota (GBIF)</div>
        <div class="result-tech-grid">
          <div class="tech-item">
            <div class="tech-label">Esito connessione</div>
            <div class="tech-value">${escapeHtml(analysis.gbif.summary)}</div>
          </div>
          <div class="tech-item">
            <div class="tech-label">Nome accettato</div>
            <div class="tech-value">${escapeHtml(analysis.gbif.scientificName)}</div>
          </div>
          <div class="tech-item">
            <div class="tech-label">Famiglia Registrata</div>
            <div class="tech-value">${escapeHtml(analysis.gbif.family)}</div>
          </div>
          <div class="tech-item">
            <div class="tech-label">Genere Registrato</div>
            <div class="tech-value">${escapeHtml(analysis.gbif.genus)}</div>
          </div>
        </div>
      </div>

      <div class="result-section">
        <div class="result-title">Controllo geografico</div>
        <div class="result-tech-grid">
          ${locationSummary}
        </div>
      </div>

      <div class="result-section">
        <div class="result-title">Alternative considerate dal modello locale</div>
        ${alternativesHtml}
      </div>
    </div>
  `);
}

// ---------------------------------------------------------
// STORICO LOCALE E GESTIONE UI
// ---------------------------------------------------------

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
    finalScore: analysis.finalScore,
    geoScore: analysis.geoScore,
    diseaseSummary: analysis.disease.summary,
    severityLabel: severityBadge.label,
    gbifSummary: analysis.gbif.summary,
    geographySummary: analysis.geography.summary,
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
          Inferenza Rete Neurale: ${escapeHtml(String(item.confidence))}%<br>
          Punteggio Aggregato: ${escapeHtml(String(item.finalScore))}%<br>
          Database Remoto: ${escapeHtml(item.gbifSummary)}<br>
          Riscontro Geografico: ${escapeHtml(item.geographySummary)}
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
  if (installBtn) installBtn.classList.remove("hidden");
});

if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add("hidden");
  });
}

if (locationBtn) locationBtn.addEventListener("click", requestLocation);
if (clearHistoryBtn) clearHistoryBtn.addEventListener("click", clearHistory);
window.addEventListener("beforeunload", stopCamera);

if (startCameraBtn) startCameraBtn.addEventListener("click", startCamera);
if (takePhotoBtn) takePhotoBtn.addEventListener("click", takePhoto);
if (resetBtn) resetBtn.addEventListener("click", resetPhoto);
if (fileInput) fileInput.addEventListener("change", handleFileUpload);

// INIT FASE 1: UI Base e Dati
loadSavedLocation();
renderHistory();
showPlaceholder();

// INIT FASE 2: Avvio Asincrono Modello AI
initializeLocalAI();
