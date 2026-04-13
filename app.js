const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const preview = document.getElementById("preview");
const startCameraBtn = document.getElementById("startCameraBtn");
const takePhotoBtn = document.getElementById("takePhotoBtn");
const resetBtn = document.getElementById("resetBtn");
const fileInput = document.getElementById("fileInput");
const resultBox = document.getElementById("resultBox");

let stream = null;

let model;
let maxPredictions;

const MODEL_URL = "https://teachablemachine.withgoogle.com/models/your-model/";

async function loadModel() {

  const modelURL = MODEL_URL + "model.json";
  const metadataURL = MODEL_URL + "metadata.json";

  model = await tmImage.load(modelURL, metadataURL);
  maxPredictions = model.getTotalClasses();

}

async function predict(imageElement) {

  const prediction = await model.predict(imageElement);

  prediction.sort((a, b) => b.probability - a.probability);

  let best = prediction[0];

  resultBox.innerHTML = `
  <strong>Risultato AI</strong><br><br>
  Pianta probabile: <b>${best.className}</b><br>
  Affidabilità: ${(best.probability * 100).toFixed(1)} %
  `;

}

async function startCamera() {

  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }
  });

  video.srcObject = stream;

  video.classList.remove("hidden");
  preview.classList.add("hidden");

  takePhotoBtn.disabled = false;

}

function takePhoto() {

  const context = canvas.getContext("2d");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  context.drawImage(video, 0, 0);

  const imageData = canvas.toDataURL("image/jpeg");

  preview.src = imageData;

  preview.classList.remove("hidden");
  video.classList.add("hidden");

  predict(preview);

}

function resetPhoto() {

  preview.classList.add("hidden");
  video.classList.remove("hidden");

}

fileInput.addEventListener("change", async function(e){

  const file = e.target.files[0];

  const reader = new FileReader();

  reader.onload = function(event){

    preview.src = event.target.result;

    preview.classList.remove("hidden");
    video.classList.add("hidden");

    predict(preview);

  };

  reader.readAsDataURL(file);

});

startCameraBtn.addEventListener("click", startCamera);
takePhotoBtn.addEventListener("click", takePhoto);
resetBtn.addEventListener("click", resetPhoto);

loadModel();
