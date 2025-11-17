// Niskala Studio - Free Client-Side Vocal Enhancer (No API, No Server)

// ================================
// Utility: Convert AudioBuffer → WAV
// ================================
function audioBufferToWav(buffer) {
    let numOfChan = buffer.numberOfChannels,
        length = buffer.length * numOfChan * 2 + 44,
        bufferArray = new ArrayBuffer(length),
        view = new DataView(bufferArray),
        channels = [],
        sample,
        offset = 0,
        pos = 0;

    // Write WAV header
    setUint32(0x46464952);
    setUint32(length - 8);
    setUint32(0x45564157);

    setUint32(0x20746d66);
    setUint32(16);
    setUint16(1);
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);

    setUint32(0x61746164);
    setUint32(length - pos - 4);

    for (let i = 0; i < buffer.numberOfChannels; i++)
        channels.push(buffer.getChannelData(i));

    while (pos < length) {
        for (let chan = 0; chan < numOfChan; chan++) {
            sample = Math.max(-1, Math.min(1, channels[chan][offset]));
            view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            pos += 2;
        }
        offset++;
    }

    return new Blob([bufferArray], { type: 'audio/wav' });

    function setUint16(data) {
        view.setUint16(pos, data, true); pos += 2;
    }
    function setUint32(data) {
        view.setUint32(pos, data, true); pos += 4;
    }
}

// ================================
// GLOBAL VARIABLES
// ================================
let vocalFile = null;
let musicFile = null;
let audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// ================================
// FILE UPLOAD HANDLERS
// ================================
document.getElementById("vocalfile").addEventListener("change", e => {
    vocalFile = e.target.files[0];
});

document.getElementById("musicfile").addEventListener("change", e => {
    musicFile = e.target.files[0];
});

// ================================
// MAIN FUNCTION: PROCESS VOCAL
// ================================
async function processAudio() {
    document.getElementById("status").innerText = "Processing...";

    // Load vocal
    let vocalArray = await vocalFile.arrayBuffer();
    let vocalBuffer = await audioCtx.decodeAudioData(vocalArray);

    // CREATE EFFECTS
    let source = audioCtx.createBufferSource();
    source.buffer = vocalBuffer;

    // Noise gate (simple)
    let noiseGate = audioCtx.createDynamicsCompressor();
    noiseGate.threshold.setValueAtTime(-50, audioCtx.currentTime);
    noiseGate.ratio.setValueAtTime(12, audioCtx.currentTime);

    // EQ
    let eqLow = audioCtx.createBiquadFilter();
    eqLow.type = "lowshelf";
    eqLow.frequency.setValueAtTime(200, audioCtx.currentTime);
    eqLow.gain.setValueAtTime(3, audioCtx.currentTime);

    let eqHigh = audioCtx.createBiquadFilter();
    eqHigh.type = "highshelf";
    eqHigh.frequency.setValueAtTime(4000, audioCtx.currentTime);
    eqHigh.gain.setValueAtTime(5, audioCtx.currentTime);

    // Compressor
    let comp = audioCtx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-20, audioCtx.currentTime);
    comp.ratio.setValueAtTime(6, audioCtx.currentTime);

    // Connect chain
    source.connect(noiseGate)
          .connect(eqLow)
          .connect(eqHigh)
          .connect(comp)
          .connect(audioCtx.destination);

    // Render processed audio
    let offlineCtx = new OfflineAudioContext(
        vocalBuffer.numberOfChannels,
        vocalBuffer.length,
        vocalBuffer.sampleRate
    );

    let v = offlineCtx.createBufferSource();
    v.buffer = vocalBuffer;

    v.connect(offlineCtx.destination);
    v.start(0);

    let rendered = await offlineCtx.startRendering();

    // Export WAV
    let wavBlob = audioBufferToWav(rendered);
    let wavURL = URL.createObjectURL(wavBlob);

    // Inject into player
    let player = document.getElementById("player");
    player.src = wavURL;

    // Show result
    document.getElementById("resultCard").style.display = "block";
    document.getElementById("downloadWav").href = wavURL;

    document.getElementById("status").innerText = "Done!";
}

// ================================
// BUTTON HANDLER
// ================================
document.getElementById("generateBtn").addEventListener("click", () => {
    if (!vocalFile) {
        alert("Please upload a vocal file first!");
        return;
    }
    processAudio();
});
