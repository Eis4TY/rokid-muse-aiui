// Audio stays in memory until the user explicitly sends the voice note.
const SAMPLE_RATE = 16000;
const MAX_BYTES = SAMPLE_RATE * 2 * 15;
const MIN_BYTES = SAMPLE_RATE * 2 * 0.3;

export function createVoiceInput({ wx } = {}) {
  let current = null;
  let recorder = null;
  let stopping = Promise.resolve();
  let starting = Promise.resolve();
  const api = { start, stop, abort };
  const live = (run) => current === run;
  function finish(run, error) {
    if (!live(run)) return;
    current = null;
    clearTimeout(run.timer);
    run.frames = [];
    if (error && api.onerror) api.onerror({ error: 'recording-failed', message: error.message || String(error) });
    if (api.onend) api.onend();
  }
  function stopRecorder() {
    try { stopping = Promise.resolve(recorder.stop()).catch(() => {}); }
    catch (_) { stopping = Promise.resolve(); }
    return stopping;
  }
  function start() {
    if (current) return;
    const previous = starting;
    const task = begin(previous);
    starting = task.catch(() => {});
    return task;
  }
  async function begin(previous) {
    if (current) return;
    const run = { frames: [], bytes: 0, started: false, stopping: false };
    current = run;
    try {
      await previous;
      await stopping;
      if (!live(run)) return;
      recorder = wx && wx.media && wx.media.getRecorderManager && wx.media.getRecorderManager();
      if (!recorder) throw new Error('当前设备不支持录音');
      recorder.onFrameRecorded(({ frameBuffer }) => {
        if (!live(run) || !frameBuffer || !frameBuffer.byteLength) return;
        const take = Math.min(frameBuffer.byteLength, MAX_BYTES - run.bytes);
        if (take) { run.frames.push(new Uint8Array(frameBuffer).slice(0, take)); run.bytes += take; }
        if (run.bytes >= MAX_BYTES && run.started) stop();
      });
      recorder.onError((event) => { if (live(run)) { stopRecorder(); finish(run, new Error(event.errMsg || '录音失败')); } });
      recorder.onStop(() => {
        if (!live(run)) return;
        try {
          if (run.bytes < MIN_BYTES || run.bytes % 2) throw new Error('录音太短，请重新说话');
          const pcm = new Uint8Array(run.bytes);
          let offset = 0;
          for (const frame of run.frames) { pcm.set(frame, offset); offset += frame.length; }
          const note = { pcm_base64: wx.arrayBufferToBase64(pcm.buffer), duration: run.bytes / (SAMPLE_RATE * 2) };
          if (api.onrecorded) api.onrecorded(note);
          finish(run);
        } catch (error) { finish(run, error); }
      });
      run.timer = setTimeout(() => { stopRecorder(); finish(run, new Error('启动录音超时')); }, 15000);
      await recorder.start({ sampleRate: SAMPLE_RATE, numberOfChannels: 1, format: 'pcm', frameSize: 250 });
      if (!live(run)) { await stopRecorder(); return; }
      run.started = true;
      clearTimeout(run.timer);
      run.timer = setTimeout(stop, 15000);
      if (api.onstart) api.onstart();
    } catch (error) { finish(run, error); }
  }
  function stop() {
    const run = current;
    if (!run || run.stopping) return;
    if (!run.started) { abort(); return; }
    run.stopping = true;
    clearTimeout(run.timer);
    run.timer = setTimeout(() => finish(run, new Error('结束录音超时，请重试')), 15000);
    if (api.onstopping) api.onstopping();
    try { stopping = Promise.resolve(recorder.stop()); stopping.catch((error) => finish(run, error)); }
    catch (error) { finish(run, error); }
  }
  function abort() {
    const run = current;
    if (!run) return;
    current = null;
    clearTimeout(run.timer);
    run.frames = [];
    if (recorder && run.started) stopRecorder();
  }
  return api;
}
