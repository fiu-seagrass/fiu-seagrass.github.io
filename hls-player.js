(() => {
  const ids = ['stage','placeholder','shade','imageDate','frameCount','play','playIcon','playLabel','speed','scrubber','rangeStart','rangeEnd','position','from','to','status'];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const video = document.getElementById('video');
  const inspect = document.getElementById('inspect');
  let frames = [], fps = 30, first = 0, last = 0, start = 0, end = 0, ready = false, hls;
  let wantsPlayback = false, playRequest = 0;
  let days = [], dayButtons = [], selectedDay = 0, playlistEnd = 0, dayMetadata = [];
  const playlist = document.getElementById('dayPlaylist');
  const dayHeading = document.getElementById('dayHeading');
  const playlistCount = document.getElementById('playlistCount');
  function selectDay(number, seek = true) {
    selectedDay = number;
    const day = days[number];
    first = day.first; last = day.last; start = day.start; end = day.end;
    el.scrubber.min = first; el.scrubber.max = last;
    el.rangeStart.textContent = frames[first][0].slice(11);
    el.rangeEnd.textContent = frames[last][0].slice(11);
    dayHeading.textContent = day.date;
    dayButtons.forEach((button, i) => {
      button.classList.toggle('current', i === number);
      if (i === number) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
    dayButtons[number]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (seek) video.currentTime = start;
    status(`Day ${number + 1} of ${days.length} · ${day.count} frames · next day plays automatically`);
  }
  function renderPlaylist() {
    playlist.replaceChildren();
    dayButtons = days.map((day, number) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'day-item';
      const title = document.createElement('strong');
      title.textContent = day.date;
      const detail = document.createElement('span');
      detail.textContent = `${day.count.toLocaleString()} frames · ${(day.end - day.start).toFixed(1)}s at 1×`;
      button.append(title, detail);
      button.addEventListener('click', () => {
        const resume = wantsPlayback;
        stopPlayback();
        selectDay(number);
        update();
        if (resume) play();
      });
      playlist.append(button);
      return button;
    });
    playlistCount.textContent = `${days.length} daily clips`;
  }
  function stopPlayback() { wantsPlayback = false; playRequest++; video.pause(); button(); }
  function bufferedAhead() {
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.1 && video.buffered.end(i) > video.currentTime)
        return video.buffered.end(i) - video.currentTime;
    }
    return 0;
  }
  function waitForBuffer(request) {
    if (!hls) return Promise.resolve(); // Safari manages its native HLS buffer.
    return new Promise((resolve, reject) => {
      const target = Math.max(0, Math.min(60, 12 * video.playbackRate, playlistEnd - video.currentTime - 0.1));
      const cleanup = () => { clearInterval(checkTimer); clearTimeout(timeout); };
      const check = () => {
        if (request !== playRequest || !wantsPlayback) { cleanup(); resolve(); return; }
        const ahead = bufferedAhead();
        if (ahead + 0.05 >= target) { cleanup(); resolve(); return; }
        status(`Building a playback buffer: ${Math.floor(ahead)} / ${Math.ceil(target)} seconds…`);
      };
      const checkTimer = setInterval(check, 250);
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Buffering is taking too long. Try 1× playback or reload.')); }, 120000);
      check();
    });
  }
  const status = (message, error = false) => { el.status.textContent = message; el.status.classList.toggle('error', error); };
  const displayDate = t => t.replace('T', ' ') + ' · Eastern time';
  const playPath = 'M6 3.8c0-.7.8-1.1 1.4-.7l9 5.7a1.4 1.4 0 0 1 0 2.4l-9 5.7c-.6.4-1.4 0-1.4-.7V3.8Z';
  const pausePath = 'M5 3h4v14H5zm7 0h4v14h-4z';
  function button() {
    const stopped = !wantsPlayback;
    el.playIcon.innerHTML = `<path d="${stopped ? playPath : pausePath}"/>`;
    el.playLabel.textContent = stopped ? 'Play' : 'Pause';
    el.play.setAttribute('aria-label', stopped ? 'Play timelapse' : 'Pause timelapse');
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
    // Daily clips share one HLS timeline: crossing days does not reload the player.
    while (selectedDay + 1 < days.length && video.currentTime >= days[selectedDay + 1].start - 0.001)
      selectDay(selectedDay + 1, false);
    const i = frameAt(video.currentTime);
    el.scrubber.value = i;
    el.position.textContent = displayDate(frames[i][0]);
    el.imageDate.textContent = displayDate(frames[i][0]);
    el.frameCount.textContent = `${(i - first + 1).toLocaleString()} / ${(last - first + 1).toLocaleString()}`;
    inspect.href = 'https://raw.githubusercontent.com/fiu-seagrass/tower_data/main/raw_images/' + encodeURIComponent(frames[i][2]);
    if (video.currentTime >= playlistEnd - 0.005 && !video.paused) {
      stopPlayback();
      video.currentTime = Math.max(start, end - 1 / fps);
    }
  }
  function applyRange() {
    stopPlayback();
    const from = el.from.value, to = el.to.value;
    first = frames.findIndex(f => f[0].slice(0, 10) >= from);
    last = frames.findLastIndex(f => f[0].slice(0, 10) <= to);
    days = [];
    for (let i = first; i >= 0 && i <= last; i++) {
      const date = frames[i][0].slice(0, 10);
      if (!days.length || days.at(-1).date !== date) days.push({ date, first: i, last: i, start: frames[i][1], count: 0 });
      const day = days.at(-1);
      day.last = i; day.count++;
    }
    const metadata = new Map(dayMetadata.map(day => [day.date, day]));
    days.forEach(day => { day.end = metadata.get(day.date)?.end ?? frames[day.last][1] + 1 / fps; });
    renderPlaylist();
    if (from > to || first < 0 || last < first) {
      ready = false;
      el.play.disabled = el.scrubber.disabled = true;
      status('No frames in that range. Choose different dates.', true);
      return;
    }
    ready = true;
    playlistEnd = days.at(-1).end;
    el.play.disabled = el.scrubber.disabled = false;
    selectDay(0);
    update();
  }
  async function play() {
    if (!ready) return;
    if (wantsPlayback) { stopPlayback(); return; }
    wantsPlayback = true;
    const request = ++playRequest;
    button();
    if (video.currentTime >= end - 1 / fps || video.currentTime < start) video.currentTime = start;
    try {
      await waitForBuffer(request);
      if (request === playRequest && wantsPlayback) await video.play();
    }
    catch (error) { stopPlayback(); status('Playback could not start: ' + error.message, true); button(); }
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
    stopPlayback();
    el.position.textContent = displayDate(frames[Number(el.scrubber.value)][0]);
  });
  el.scrubber.addEventListener('change', () => { video.currentTime = frames[Number(el.scrubber.value)][1]; update(); });
  video.addEventListener('play', button);
  video.addEventListener('pause', button);
  video.addEventListener('timeupdate', update);
  video.addEventListener('waiting', async () => {
    if (!wantsPlayback || !hls) { status('Buffering video segments…'); return; }
    const request = ++playRequest;
    video.pause();
    try {
      await waitForBuffer(request);
      if (request === playRequest && wantsPlayback) await video.play();
    } catch (error) { stopPlayback(); status(error.message, true); }
  });
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
    dayMetadata = index.days || [];
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
      hls = new Hls({ startLevel: 0, abrEwmaDefaultEstimate: 200000, maxBufferLength: 90, maxMaxBufferLength: 120, backBufferLength: 15, maxBufferSize: 30 * 1024 * 1024 });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) { stopPlayback(); status('Streaming error. Reload or use the original image viewer below.', true); }
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
