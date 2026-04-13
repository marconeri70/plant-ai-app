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

const STORAGE_KEY = "plant_ai_history_v1";

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
        <strong>Fotocamera non supportata.</strong><br>
        Questo browser non supporta l'apertura della fotocamera.
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
          Inquadra bene la pianta, meglio se si vedono foglie e parte centrale.
        </div>
      </div>
    `);
  } catch (error) {
    console.error("Errore apertura fotocamera:", error);
    setResultMessage(`
      <div class="result-card">
        <div class="result-section">
          <div class="result-title">Impossibile aprire la fotocamera</div>
          Controlla i permessi del browser oppure usa il caricamento manuale della foto.
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

function analyzeCurrentImage() {
  if (!currentImageData) {
    setResultMessage("Nessuna immagine caricata.");
    return;
  }

  setResultMessage(`
    <div class="result-card">
      <div class="result-section">
        <div class="result-title">Analisi in corso...</div>
        Sto valutando aspetto generale, stato foglie e primi consigli.
      </div>
    </div>
  `);

  setTimeout(() => {
    const analysis = generateDemoAnalysis();
    renderAnalysis(analysis);
    saveAnalysisToHistory(analysis, currentImageData);
    renderHistory();
  }, 1100);
}

function renderAnalysis(analysis) {
  setResultMessage(`
    <div class="result-card">
      <div class="result-top">
        <div class="result-chip">🌿 ${analysis.plant}</div>
        <div class="result-chip">📊 Affidabilità: ${analysis.confidence}%</div>
        <div class="result-chip">💧 Acqua: ${analysis.water}</div>
        <div class="result-chip">☀️ Luce: ${analysis.light}</div>
      </div>

      <div class="result-section">
        <div class="result-title">Stato visivo</div>
        ${analysis.health}
      </div>

      <div class="result-section">
        <div class="result-title">Possibili cause</div>
        ${analysis.causes.map((item) => `• ${item}`).join("<br>")}
      </div>

      <div class="result-section">
        <div class="result-title">Cure consigliate</div>
        ${analysis.care.map((item) => `• ${item}`).join("<br>")}
      </div>

      <div class="note-box">
        <strong>Nota</strong><br>
        Questa è una prima analisi dimostrativa. Nel prossimo step collegheremo il riconoscimento reale della pianta.
      </div>
    </div>
  `);
}

function generateDemoAnalysis() {
  const demoResults = [
    {
      plant: "Monstera Deliciosa",
      confidence: 91,
      health: "Buona, con lieve stress sulle foglie.",
      water: "Medio",
      light: "Intensa indiretta",
      causes: [
        "leggera carenza di umidità",
        "irrigazione non perfettamente regolare",
        "esposizione a luce diretta in alcune ore"
      ],
      care: [
        "innaffia solo quando il terreno è asciutto nei primi centimetri",
        "evita sole diretto forte",
        "pulisci le foglie e aumenta leggermente l'umidità"
      ]
    },
    {
      plant: "Pothos",
      confidence: 87,
      health: "Discreto, con alcuni segnali di affaticamento.",
      water: "Medio-alto",
      light: "Indiretta moderata",
      causes: [
        "terreno troppo asciutto",
        "aria secca",
        "foglie esposte a sbalzi termici"
      ],
      care: [
        "controlla il terreno più spesso",
        "rimuovi le foglie molto rovinate",
        "mantieni la pianta in ambiente luminoso ma non al sole diretto"
      ]
    },
    {
      plant: "Sansevieria",
      confidence: 89,
      health: "Buono, ma con possibile stress da eccesso d'acqua.",
      water: "Basso",
      light: "Mezz'ombra luminosa",
      causes: [
        "troppa acqua rispetto al fabbisogno",
        "drenaggio insufficiente",
        "vaso poco arieggiato"
      ],
      care: [
        "riduci la frequenza delle annaffiature",
        "verifica che il vaso scarichi bene",
        "lascia asciugare meglio il terriccio tra un'irrigazione e l'altra"
      ]
    },
    {
      plant: "Ficus elastica",
      confidence: 85,
      health: "Leggero ingiallimento fogliare.",
      water: "Medio",
      light: "Intensa indiretta",
      causes: [
        "stress da posizione",
        "irrigazione irregolare",
        "accumulo di polvere sulle foglie"
      ],
      care: [
        "mantieni una posizione stabile",
        "bagna con regolarità senza eccedere",
        "pulisci delicatamente le foglie"
      ]
    }
  ];

  const index = Math.floor(Math.random() * demoResults.length);
  return demoResults[index];
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

  history.unshift({
    id: Date.now(),
    imageData,
    plant: analysis.plant,
    confidence: analysis.confidence,
    health: analysis.health,
    water: analysis.water,
    light: analysis.light,
    date: new Date().toLocaleString("it-IT")
  });

  const trimmed = history.slice(0, 10);
  saveHistory(trimmed);
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
          <img src="${item.imageData}" alt="${item.plant}" class="history-thumb" />
          <div class="history-body">
            <div class="history-name">${item.plant}</div>
            <div class="history-meta">
              Stato: ${item.health}<br>
              Acqua: ${item.water}<br>
              Luce: ${item.light}<br>
              Affidabilità: ${item.confidence}%
            </div>
            <div class="history-date">${item.date}</div>
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
