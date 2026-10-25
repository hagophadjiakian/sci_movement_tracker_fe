// Python engine: the backend runs the camera and RTMPose; we receive angles over a WebSocket and
// show the camera picture (skeleton already drawn) from an MJPEG stream.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AngleMeta, emptyValues } from '../lib/angles';
import type { FrameHandler } from './useBrowserEngine';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export interface PythonSettings {
  source: string; // camera index ("0") or a video file path
  model: 'wholebody' | 'body_feet' | 'body';
  mode: 'lightweight' | 'balanced' | 'performance';
  device: 'auto' | 'cpu' | 'cuda';
  view: 'auto' | 'side' | 'front';
}

export interface PythonStatus {
  state: 'idle' | 'loading' | 'running' | 'error';
  error: string | null;
  device: string | null;
  fps: number;
  people: number;
  side_swaps: number;
  frame_size: [number, number] | null;
}

export const DEFAULT_PYTHON_SETTINGS: PythonSettings = {
  source: '0',
  model: 'wholebody',
  mode: 'balanced',
  device: 'auto',
  view: 'auto',
};

function wsUrl() {
  if (API_BASE) return API_BASE.replace(/^http/, 'ws') + '/ws/live';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/live`;
}

export function usePythonEngine(active: boolean, onFrame: FrameHandler) {
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const [status, setStatus] = useState<PythonStatus>({
    state: 'idle', error: null, device: null, fps: 0, people: 0, side_swaps: 0, frame_size: null,
  });
  const [connected, setConnected] = useState(false);
  const [videoKey, setVideoKey] = useState(0);
  const [cameras, setCameras] = useState<{ index: number; width?: number; height?: number; in_use?: boolean }[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    const connect = () => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 2000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'status') {
            setStatus((s) => ({ ...s, ...msg }));
          } else if (msg.type === 'frame') {
            const raw = { ...emptyValues(), ...(msg.values as Record<string, number>) };
            const meta = msg.meta as AngleMeta;
            setStatus((s) => (s.fps === msg.fps && s.people === msg.people ? s : { ...s, fps: msg.fps, people: msg.people }));
            cb.current(raw, meta);
          }
        } catch {
          /* ignore malformed message */
        }
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [active]);

  const call = useCallback(async (path: string, body?: unknown) => {
    setRequestError(null);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = `Server error (${res.status})`;
        try {
          const j = await res.json();
          if (typeof j?.detail === 'string') detail = j.detail;
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      return await res.json();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Backend not reachable. Is the Python server running?');
      return null;
    }
  }, []);

  const start = useCallback(
    async (s: PythonSettings) => {
      const source = /^\d+$/.test(s.source.trim()) ? Number(s.source.trim()) : s.source.trim();
      const st = await call('/api/live/start', { ...s, source });
      if (st) {
        setStatus((x) => ({ ...x, ...st }));
        setVideoKey((k) => k + 1);
      }
    },
    [call],
  );
  const stop = useCallback(async () => {
    const st = await call('/api/live/stop', {});
    if (st) setStatus((x) => ({ ...x, ...st }));
  }, [call]);
  const refreshCameras = useCallback(async () => {
    const list = await call('/api/live/cameras');
    if (Array.isArray(list)) setCameras(list);
  }, [call]);

  // Stop the Python camera when the user switches back to the browser engine.
  useEffect(() => {
    if (!active && (status.state === 'running' || status.state === 'loading')) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const videoUrl = `${API_BASE}/live/video.mjpg?k=${videoKey}`;
  return { status, connected, start, stop, cameras, refreshCameras, videoUrl, requestError };
}
