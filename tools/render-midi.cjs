const fs = require('fs'), path = require('path');
const libfluidsynth = require('js-synthesizer/libfluidsynth');
const JSSynth = require('js-synthesizer');
const SR = 44100;
(async () => {
  JSSynth.Synthesizer.initializeWithFluidSynthModule(libfluidsynth);
  await JSSynth.waitForReady();
  const sf = fs.readFileSync('gu.sf2');
  const dir = 'E:/Projects2025/PowerTheGame2/Audio/Music';
  for (const f of fs.readdirSync(dir)) {
    const synth = new JSSynth.Synthesizer();
    synth.init(SR);
    await synth.loadSFont(sf.buffer.slice(sf.byteOffset, sf.byteOffset + sf.byteLength));
    const mid = fs.readFileSync(path.join(dir, f));
    await synth.addSMFDataToPlayer(mid.buffer.slice(mid.byteOffset, mid.byteOffset + mid.byteLength));
    await synth.playPlayer();
    const chunks = []; const N = 8192; let total = 0;
    const tail = SR * 2; let tailLeft = tail;
    while (true) {
      const l = new Float32Array(N), r = new Float32Array(N);
      synth.render([l, r]);
      chunks.push([l, r]); total += N;
      if (!synth.isPlayerPlaying()) { tailLeft -= N; if (tailLeft <= 0) break; }
      if (total > SR * 600) break;
    }
    const pcm = Buffer.alloc(total * 4);
    let o = 0;
    for (const [l, r] of chunks) for (let i = 0; i < N; i++) {
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767 * 0.9))), o); o += 2;
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767 * 0.9))), o); o += 2;
    }
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28);
    h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
    const out = f.replace(/\.MID$/i, '').toLowerCase() + '.wav';
    fs.writeFileSync(out, Buffer.concat([h, pcm]));
    console.log(out, (total / SR).toFixed(1) + 's');
    synth.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
