(() => {
  const ids = ['stage','placeholder','shade','imageDate','frameCount','play','playIcon','playLabel','speed','scrubber','rangeStart','rangeEnd','position','from','to','status'];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const video = document.getElementById('video');
  const inspect = document.getElementById('inspect');
  let frames = [], fps = 30, first = 0, last = 0, start = 0, end = 0, ready = false, hls;
  const status = (message, error = false) => { el.status.textContent = message; el.status.classList.toggle('error', error); };
  const displayDate = t => t.replace('T', ' ') + ' · Eastern time';
  const playPath = 'M6 3.8c0-.7.8-1.1 1.4-.7l9 5.7a1.4 1.4 0 0 1 0 2.4l-9 5.7c-.6.4-1.4 0-1.4-.7V3.8Z';
  const pausePath = 'M5 3h4v14H5zm7 0h4v14h-4z';
  function button() {
    el.playIcon.innerHTML = `<path d="${video.paused ? playPath : pausePath}"/>`;
    el.playLabel.textContent = video.paused ? 'Play' : 'Pause';
    el.play.setAttribute('aria-label', video.paused ? 'Play timelapse' : 'Pause timelapse');
  }
  function frameAt(seconds) {
    let lo = 0, hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (frames[mid][1] <= seconds) lo = mid + 1; else hi = mid;
    }
    return Math.max(first, Math.min(last, lo - 1));
  }
  function update() {
    if (!ready) return;
    const i = frameAt(video.currentTime);
    el.scrubber.value = i;
    el.position.textContent = displayDate(frames[i][0]);
    el.imageDate.textContent = displayDate(frames[i][0]);
    el.frameCount.textContent = `${(i - first + 1).toLocaleString()} / ${(last - first + 1).toLocaleString()}`;
    inspect.href = 'https://raw.githubusercontent.com/fiu-seagrass/tower_data/main/raw_images/' + encodeURIComponent(frames[i][2]);
    if (video.currentTime >= end - 0.005 && !video.paused) {
      video.pause();
      video.currentTime = Math.max(start, end - 1 / fps);
    }
  }
  function applyRange() {
    video.pause();
    const from = el.from.value, to = el.to.value;
    first = frames.findIndex(f => f[0].slice(0, 10) >= from);
    last = frames.findLastIndex(f => f[0].slice(0, 10) <= to);
    if (from > to || first < 0 || last < first) {
      ready = false;
      el.play.disabled = el.scrubber.disabled = true;
      status('No frames in that range. Choose different dates.', true);
      return;
    }
    ready = true;
    start = frames[first][1];
    end = frames[last][1] + 1 / fps;
    el.play.disabled = el.scrubber.disabled = false;
    el.scrubber.min = first;
    el.scrubber.max = last;
    el.rangeStart.textContent = from;
    el.rangeEnd.textContent = to;
    video.currentTime = start;
    update();
    status(`${(last - first + 1).toLocaleString()} frames · HLS streaming · ${Math.round((end - start) / Number(el.speed.value))} seconds at this speed`);
  }
  async function play() {
    if (!ready) return;
    if (!video.paused) { video.pause(); return; }
    if (video.currentTime >= end - 1 / fps || video.currentTime < start) video.currentTime = start;
    try { await video.play(); }
    catch (error) { status('Playback could not start: ' + error.message, true); button(); }
  }
  el.play.addEventListener('click', play);
  el.speed.addEventListener('change', () => {
    video.playbackRate = Number(el.speed.value);
    status(`Playback speed ${el.speed.value}× · HLS buffers upcoming video segments automatically`);
  });
  el.from.addEventListener('change', applyRange);
  el.to.addEventListener('change', applyRange);
  // Seek after the user releases the slider; don't download every position while dragging.
  el.scrubber.addEventListener('input', () => {
    video.pause();
    el.position.textContent = displayDate(frames[Number(el.scrubber.value)][0]);
  });
  el.scrubber.addEventListener('change', () => { video.currentTime = frames[Number(el.scrubber.value)][1]; update(); });
  video.addEventListener('play', button);
  video.addEventListener('pause', button);
  video.addEventListener('timeupdate', update);
  video.addEventListener('waiting', () => status('Buffering video segments…'));
  video.addEventListener('playing', () => status('Streaming · only nearby video segments are downloaded'));
  video.addEventListener('loadeddata', () => {
    el.placeholder.hidden = true;
    video.hidden = false;
    el.shade.hidden = false;
    el.stage.classList.remove('empty');
  });
  video.addEventListener('error', () => status('Video could not load. Try the original image viewer below.', true));
  fetch('./timelapse/hls/timeline.json').then(r => {
    if (!r.ok) throw new Error('Timeline unavailable (' + r.status + ')');
    return r.json();
  }).then(index => {
    if (!Array.isArray(index.frames) || !index.frames.length) throw new Error('Empty video timeline');
    frames = index.frames;
    fps = index.fps;
    el.from.min = el.to.min = frames[0][0].slice(0, 10);
    el.from.max = el.to.max = frames.at(-1)[0].slice(0, 10);
    el.from.value = el.from.min;
    el.to.value = el.to.max;
    video.addEventListener('loadedmetadata', () => {
      [el.from, el.to, el.speed].forEach(control => control.disabled = false);
      applyRange();
    }, { once: true });
    const source = new URL('./timelapse/hls/index.m3u8', location.href).href;
    if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = source;
    else if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 15, maxBufferSize: 30 * 1024 * 1024 });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) { video.pause(); status('Streaming error. Reload or use the original image viewer below.', true); }
      });
      hls.loadSource(source);
      hls.attachMedia(video);
    } else throw new Error('HLS is not supported in this browser; use the original image viewer.');
  }).catch(error => {
    el.placeholder.querySelector('strong').textContent = 'Video unavailable';
    el.placeholder.querySelector('span').textContent = error.message;
    status(error.message, true);
  });
})();
