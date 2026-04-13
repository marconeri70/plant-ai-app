const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const preview = document.getElementById("preview");
const startCameraBtn = document.getElementById("startCameraBtn");
const takePhotoBtn = document.getElementById("takePhotoBtn");
const resetBtn = document.getElementById("resetBtn");
const fileInput = document.getElementById("fileInput");
const resultBox = document.getElementById("resultBox");

let stream = null;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }
      },
      audio: false
    });

    video.srcObject = stream;
    video.classList.remove("hidden");
    preview.classList.add("hidden");

    takePhotoBtn.disabled = false;
    resetBtn.disabled = false;

    resultBox.innerHTML = "Fotocamera attiva. Scatta una foto della pianta.";
  } catch (error) {
    console.error("Errore fotocamera:", error);
    resultBox.innerHTML =
      "Non sono riuscito ad aprire la fotocamera. Controlla i permessi del browser.";
  }
}

function takePhoto() {
  if (!stream) return;

  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) {
    resultBox.innerHTML = "Attendi un attimo e riprova a scattare.";
    return;
  }

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, width, height);

  const imageDataUrl = canvas.toDataURL("image/jpeg", 0.9);

  preview.src = imageDataUrl;
  preview.classList.remove("hidden");
  video.classList.add("hidden");

  resultBox.innerHTML = `
    <strong>Foto acquisita.</strong><br>
    La base dell'app funziona correttamente.<br>
    Nel prossimo passaggio aggiungeremo il riconoscimento AI della pianta.
  `;
}

function resetPhoto() {
  preview.src = "";
  preview.classList.add("hidden");

  if (stream) {
    video.classList.remove("hidden");
    resultBox.innerHTML = "Puoi scattare una nuova foto oppure caricarne una.";
  } else {
    resultBox.innerHTML = "Nessuna immagine caricata.";
  }
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    preview.src = e.target.result;
    preview.classList.remove("hidden");
    video.classList.add("hidden");
    resetBtn.disabled = false;

    resultBox.innerHTML = `
      <strong>Immagine caricata.</strong><br>
      Perfetto: la tua app ora può ricevere una foto della pianta.
    `;
  };

  reader.readAsDataURL(file);
}

startCameraBtn.addEventListener("click", startCamera);
takePhotoBtn.addEventListener("click", takePhoto);
resetBtn.addEventListener("click", resetPhoto);
fileInput.addEventListener("change", handleFileUpload);
