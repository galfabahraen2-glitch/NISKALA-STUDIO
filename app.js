// Niskala Studio – Browser Based Vocal Enhancer (Stable Version)

// GLOBAL
let vocalFile = null;
let audioCtx = null;

// Upload vocal handler
document.getElementById("vocalfile").addEventListener("change", e => {
    vocalFile = e.target.files[0];
});

// Button click
document.getElementById("generateBtn").addEventListener("click", () => {
    if (!vocalFile) {
        alert("Unggah vocal file terlebih dahulu.");
        return;
    }
    processVocal();
});

async function processVocal() {
    document.getElementById("status").innerText = "Processing...";

    // ACTIVATE AUDIO CONTEXT on click (needed by Chrome & Vercel)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Read file
    const arrayBuf = await vocalFile.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuf);

    // Offline context for processing
    const offlineCtx = new OfflineAudioContext(
        decoded.numberOfChannels,
        decoded.length,
        decoded.sampleRate
    );

    // SOURCE
    const src = offlineCtx.createBufferSource();
    src.buffer = decoded;

    // EFFECT 1 – Noise Reduction (soft gate)
    const noiseGate = offlineCtx.createDynamicsCompressor();
    noiseGate.threshold.value = -55;
    noiseGate.ratio.value = 12;

    // EFFECT 2 – EQ (lowshelf + highshelf)
    const low = offlineCtx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 180;
    low.gain.value = 4;

    const high = offlineCtx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 5000;
    high.gain.value = 6;

    // EFFECT 3 – Vocal Compressor
    const comp = offlineCtx.createDynamicsCompressor();
    comp.threshold.value = -25;
    comp.ratio.value = 5;
    comp.attack.value = 0.005;

    // CHAIN
    src.connect(noiseGate)
        .connect(low)
        .connect(high)
        .connect(comp)
        .connect(offlineCtx.destination);

    src.start(0);

    // Render
    const rendered = await offlineCtx.startRendering();

    // Convert to WAV
    const wavBlob = await bufferToWav(rendered);
    const wavURL = URL.createObjectURL(wavBlob);

    // Insert to player
    document.getElementById("player").src = wavURL;
    document.getElementById("downloadWav").href = wavURL;
    document.getElementById("resultCard").style.display = "block";

    document.getElementById("status").innerText = "Done!";
}

// Convert AudioBuffer → WAV Blob
function bufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels,
        length = buffer.length * numOfChan * 2 + 44,
        bufferArray = new ArrayBuffer(length),
        view = new DataView(bufferArray);

    let channels = [],
        i,
        sample,
        offset = 0,
        pos = 0;

    // Write WAV header
    writeString("RIFF"); pos += 4;
    view.setUint32(pos, length - 8, true); pos += 4;
    writeString("WAVE"); pos += 4;
    writeString("fmt "); pos += 4;
    view.setUint32(pos, 16, true); pos += 4;
    view.setUint16(pos, 1, true); pos += 2;
    view.setUint16(pos, numOfChan, true); pos += 2;
    view.setUint32(pos, buffer.sampleRate, true); pos += 4;
    view.setUint32(pos, buffer.sampleRate * 2 * numOfChan, true); pos += 4;
    view.setUint16(pos, numOfChan * 2, true); pos += 2;
    view.setUint16(pos, 16, true); pos += 2;
    writeString("data"); pos += 4;
    view.setUint32(pos, length - pos - 4, true); pos += 4;

    for (i = 0; i < numOfChan; i++)
        channels.push(buffer.getChannelData(i));

    while (pos < length) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }

    return new Blob([bufferArray], { type: "audio/wav" });

    function writeString(s) {
        for (let i = 0; i < s.length; i++)
            view.setUint8(pos + i, s.charCodeAt(i));
    }
                                            }    comp.ratio.setValueAtTime(6, audioCtx.currentTime);

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
