/**
 * Verify two already-started video streams without acquiring or owning either.
 * A successful result describes this short observation window, not a permanent
 * device capability. The caller must continue monitoring its camera tracks.
 */
export async function verifyConcurrentCamera({ rearStream, rearVideo, frontVideo, timeoutMs = 1200, signal } = {}) {
  const cancelled = () => ({ supported: false, reason: '双摄核验已取消。' });
  if (signal?.aborted) return cancelled();
  const videos = [
    { name: '后置实景', video: rearVideo, stream: rearStream },
    { name: '前置手势', video: frontVideo, stream: frontVideo?.srcObject }
  ];
  if (!rearVideo || !frontVideo || rearVideo === frontVideo || !rearStream || rearVideo.srcObject !== rearStream) {
    return { supported: false, reason: '未提供独立且正在显示的前后视频画面。' };
  }
  const tracksOf = stream => {
    try { return stream?.getVideoTracks?.() || []; } catch { return []; }
  };
  for (const side of videos) {
    side.tracks = tracksOf(side.stream);
    if (!side.tracks.length) return { supported: false, reason: `${side.name}画面没有相机视频轨道。` };
  }
  if (videos[0].stream === videos[1].stream || videos[0].tracks.some(track => videos[1].tracks.includes(track))) {
    return { supported: false, reason: '前后画面使用同一视频源，无法据此确认双摄。' };
  }
  // Some browsers silently satisfy both facing-mode requests with one device.
  // Matching device IDs disprove independence; missing IDs do not prove it.
  const deviceIds = videos.map(side => {
    try { return side.tracks[0].getSettings?.().deviceId || ''; } catch { return ''; }
  });
  if (deviceIds[0] && deviceIds[0] === deviceIds[1]) {
    return { supported: false, reason: '前后画面来自同一相机设备，无法确认独立双摄。' };
  }
  const duration = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) >= 0 ? Number(timeoutMs) : 1200;
  const freshnessWindow = Math.max(80, Math.min(300, duration / 3));

  return new Promise(resolve => {
    let settled = false;
    let timeout;
    let poll;
    const removeListeners = [];
    const listen = (target, type, callback) => {
      target?.addEventListener?.(type, callback);
      removeListeners.push(() => target?.removeEventListener?.(type, callback));
    };
    const finish = (supported, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      for (const side of videos) {
        if (side.callbackId !== undefined && side.callbackId !== null) {
          try { side.video.cancelVideoFrameCallback?.(side.callbackId); } catch {}
          side.callbackId = null;
        }
      }
      for (const remove of removeListeners) remove();
      resolve({ supported, reason });
    };
    const healthError = () => {
      for (const side of videos) {
        if (side.video.srcObject !== side.stream) return `${side.name}的视频源在核验时发生变化。`;
        const tracks = tracksOf(side.stream);
        if (tracks.length !== side.tracks.length || tracks.some(track => !side.tracks.includes(track))) return `${side.name}的视频轨道在核验时发生变化。`;
        for (const track of tracks) {
          if (track.readyState !== 'live') return `${side.name}相机的视频轨道已结束。`;
          if (track.muted) return `${side.name}相机的视频轨道已静音。`;
          if (track.enabled === false) return `${side.name}相机的视频轨道已停用。`;
        }
      }
      return null;
    };
    const healthy = () => {
      if (settled) return false;
      if (signal?.aborted) { finish(false, cancelled().reason); return false; }
      const reason = healthError();
      if (reason) { finish(false, reason); return false; }
      return true;
    };
    const videoReady = video => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
    const fresh = side => side.frames >= 2 && performance.now() - side.lastFrameAt <= freshnessWindow;
    const maybeComplete = () => {
      // Do not accept two old rear frames followed much later by two front
      // frames. Both streams must still be producing during the same window.
      if (!videos.every(fresh) || !healthy()) return;
      const weaker = videos.filter(side => side.method === 'time');
      finish(true, weaker.length
        ? `双摄同时持续输出画面（${weaker.map(side => side.name).join('、')}使用 currentTime + readyState 兼容核验，证据较弱）。`
        : '双摄同时持续输出画面（两路均已通过视频帧回调核验）。');
    };
    const frameSample = (side, metadata) => {
      // mediaTime is the source frame timestamp. A rising callback count with a
      // frozen source timestamp must not count as fresh camera content.
      if (Number.isFinite(metadata?.mediaTime)) return { value: metadata.mediaTime, kind: 'mediaTime' };
      if (Number.isFinite(metadata?.presentedFrames)) return { value: metadata.presentedFrames, kind: 'presentedFrames' };
      if (Number.isFinite(side.video.currentTime)) return { value: side.video.currentTime, kind: 'currentTime' };
      return null;
    };
    const armFrame = side => {
      if (settled) return;
      try {
        side.callbackId = side.video.requestVideoFrameCallback((_now, metadata) => {
          side.callbackId = null;
          if (!healthy()) return;
          if (videoReady(side.video)) {
            const sample = frameSample(side, metadata);
            if (sample && (!side.lastSample || (sample.kind === side.lastSample.kind && sample.value > side.lastSample.value))) {
              side.frames++;
              side.lastSample = sample;
              side.lastFrameAt = performance.now();
            } else if (sample && side.lastSample?.kind !== sample.kind) {
              // A browser changing metadata shape needs two fresh observations.
              side.frames = 1;
              side.lastSample = sample;
              side.lastFrameAt = performance.now();
            }
          }
          maybeComplete();
          armFrame(side);
        });
      } catch {
        side.callbackId = null;
        side.method = 'time';
        side.frames = 0;
        side.lastTime = Number(side.video.currentTime);
      }
    };

    for (const side of videos) {
      side.frames = 0;
      side.lastFrameAt = -Infinity;
      side.lastSample = null;
      side.callbackId = null;
      side.method = typeof side.video.requestVideoFrameCallback === 'function' ? 'frames' : 'time';
      side.lastTime = Number(side.video.currentTime);
      for (const track of side.tracks) {
        listen(track, 'ended', () => finish(false, `${side.name}相机的视频轨道已结束。`));
        listen(track, 'mute', () => finish(false, `${side.name}相机的视频轨道已静音。`));
      }
      listen(side.stream, 'removetrack', () => { healthy(); });
      listen(side.stream, 'addtrack', () => { healthy(); });
    }
    listen(signal, 'abort', () => finish(false, cancelled().reason));
    if (!healthy()) return;
    timeout = setTimeout(() => {
      if (!healthy()) return;
      const frozen = videos.filter(side => !fresh(side)).map(side => side.name).join('、');
      const weaker = videos.some(side => side.method === 'time') ? '（currentTime + readyState 兼容核验）' : '';
      finish(false, `双摄核验超时：${frozen}没有持续的新画面${weaker}。`);
    }, duration);
    poll = setInterval(() => {
      if (!healthy()) return;
      for (const side of videos) {
        if (side.method !== 'time' || !videoReady(side.video)) continue;
        const now = Number(side.video.currentTime);
        if (Number.isFinite(now) && Number.isFinite(side.lastTime) && now > side.lastTime) {
          side.frames++;
          side.lastFrameAt = performance.now();
        }
        side.lastTime = now;
      }
      maybeComplete();
    }, Math.max(8, Math.min(50, duration / 8)));
    for (const side of videos) if (side.method === 'frames') armFrame(side);
  });
}
