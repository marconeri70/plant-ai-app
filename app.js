const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const preview = document.getElementById("preview");
const startCameraBtn = document.getElementById("startCameraBtn");
const takePhotoBtn = document.getElementById("takePhotoBtn");
const resetBtn = document.getElementById("resetBtn");
const fileInput = document.getElementById("fileInput");
const resultBox = document.getElementById("resultBox");

let stream = null;
let currentImageData = null;

function setResultMessage(html) {
  resultBox.innerHTML = html;
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

    takePhotoBtn.disabled = false;
    resetBtn.disabled = false;

    setResultMessage(`
      <strong>Fotocamera attiva.</strong><br>
      Inquadra bene foglie e pianta, poi premi <b>Scatta foto</b>.
    `);
  } catch (error) {
    console.error("Errore apertura fotocamera:", error);
    setResultMessage(`
      <strong>Impossibile aprire la fotocamera.</strong><br>
      Controlla i permessi del browser oppure usa il caricamento manuale della foto.
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
      <strong>Fotocamera non attiva.</strong><br>
      Apri prima la fotocamera oppure carica una foto.
    `);
    return;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) {
    setResultMessage(`
      <strong>Attendi un momento.</strong><br>
      La fotocamera si sta inizializzando, poi riprova.
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

  analyzeCurrentImage();
}

function resetPhoto() {
  currentImageData = null;
  preview.src = "";
  preview.classList.add("hidden");
  fileInput.value = "";

  if (stream) {
    video.classList.remove("hidden");
    setResultMessage(`
      <strong>Pronto per una nuova foto.</strong><br>
      Inquadra la pianta oppure carica una nuova immagine.
    `);
  } else {
    video.classList.add("hidden");
    takePhotoBtn.disabled = true;
    setResultMessage("Nessuna immagine caricata.");
  }
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setResultMessage(`
      <strong>File non valido.</strong><br>
      Seleziona un'immagine della pianta.
    `);
    return;
  }

  const reader = new FileReader();

  reader.onload = function (e) {
    currentImageData = e.target.result;
    preview.src = currentImageData;
    preview.classList.remove("hidden");
    video.classList.add("hidden");
    resetBtn.disabled = false;

    analyzeCurrentImage();
  };

  reader.onerror = function () {
    setResultMessage(`
      <strong>Errore lettura file.</strong><br>
      Non sono riuscito a caricare l'immagine selezionata.
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
    <strong>Analisi in corso...</strong><br>
    Sto valutando aspetto generale, stato foglie e primi consigli.
  `);

  setTimeout(() => {
    const analysis = generateDemoAnalysis();

    setResultMessage(`
      <div style="display:grid; gap:12px;">
        <div>
          <strong>Pianta probabile:</strong><br>
          ${analysis.plant}
        </div>

        <div>
          <strong>Stato visivo:</strong><br>
          ${analysis.health}
        </div>

        <div>
          <strong>Bisogno d'acqua:</strong><br>
          ${analysis.water}
        </div>

        <div>
          <strong>Luce consigliata:</strong><br>
          ${analysis.light}
        </div>

        <div>
          <strong>Possibili cause:</strong><br>
          ${analysis.causes.map((item) => `• ${item}`).join("<br>")}
        </div>

        <div>
          <strong>Cure consigliate:</strong><br>
          ${analysis.care.map((item) => `• ${item}`).join("<br>")}
        </div>

        <div style="padding:10px; border-radius:12px; background:#fff8e1; border:1px solid #ffe082;">
          <strong>Nota:</strong><br>
          Questa è una prima analisi dimostrativa. Nel prossimo passo collegheremo il riconoscimento reale della pianta.
        </div>
      </div>
    `);
  }, 1200);
}

function generateDemoAnalysis() {
  const demoResults = [
    {
      plant: "Monstera Deliciosa",
      health: "Buona, con lieve stress sulle foglie",
      water: "Medio",
      light: "Luce intensa ma indiretta",
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
      health: "Discreto, con alcuni segnali di affaticamento",
      water: "Medio-alto",
      light: "Luce indiretta moderata",
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
      health: "Buono, ma con possibile stress da eccesso d'acqua",
      water: "Basso",
      light: "Luce indiretta o mezz'ombra luminosa",
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
      health: "Leggero ingiallimento fogliare",
      water: "Medio",
      light: "Luce intensa indiretta",
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

window.addEventListener("beforeunload", stopCamera);

startCameraBtn.addEventListener("click", startCamera);
takePhotoBtn.addEventListener("click", takePhoto);
resetBtn.addEventListener("click", resetPhoto);
fileInput.addEventListener("change", handleFileUpload);

setResultMessage("Nessuna immagine caricata.");
