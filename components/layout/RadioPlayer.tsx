"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { SiteSettings } from "@/lib/site-data";
import { DCL_MUSIC_SELECT_EVENT, type RadioStation } from "@/lib/radio-stations";
import { analyticsEvents, capture } from "@/lib/analytics";

type Status = "idle" | "loading" | "playing" | "paused" | "stalled" | "offline" | "error";
type RadioSettings = Pick<SiteSettings, "radioEnabled" | "radioShowPlayer">;
type RadioContextValue = {
  available: boolean;
  station?: RadioStation;
  status: Status;
  toggle: () => void;
  pause: () => void;
  reconnect: () => void;
};

const RadioContext = createContext<RadioContextValue | null>(null);
const RECOVERY_DELAY_MS = 12_000;

export function RadioProvider({ settings, stations, children }: { settings: RadioSettings; stations: RadioStation[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const audio = useRef<HTMLAudioElement>(null);
  const selectedStation = useRef(stations[0]);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryAttempted = useRef(false);
  const shouldBePlaying = useRef(false);
  const changingStation = useRef(false);
  const [station, setStation] = useState(stations[0]);
  const [status, setStatus] = useState<Status>("idle");
  const available = Boolean(settings.radioEnabled && settings.radioShowPlayer && station);

  function clearRecoveryTimer() {
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    recoveryTimer.current = null;
  }

  function logMediaState(event: string) {
    const node = audio.current;
    if (!node) return;
    console.info("[DCL Music]", event, {
      networkState: node.networkState,
      readyState: node.readyState,
      paused: node.paused,
      online: navigator.onLine,
      stationId: selectedStation.current?.id,
    });
  }

  function play() {
    const node = audio.current;
    if (!node) return;
    shouldBePlaying.current = true;
    setStatus("loading");
    void node.play().catch(() => {
      setStatus(navigator.onLine ? "error" : "offline");
      logMediaState("play-rejected");
    });
  }

  function reconnect() {
    const node = audio.current;
    if (!node) return;
    clearRecoveryTimer();
    recoveryAttempted.current = true;
    node.load();
    play();
    logMediaState("reconnect");
  }

  function toggle() {
    const node = audio.current;
    if (!node) return;
    if (node.paused) play();
    else {
      shouldBePlaying.current = false;
      clearRecoveryTimer();
      node.pause();
    }
  }

  function pause() {
    const node = audio.current;
    if (!node || node.paused) return;
    shouldBePlaying.current = false;
    clearRecoveryTimer();
    node.pause();
  }

  function scheduleRecovery(event: "waiting" | "stalled" | "error") {
    logMediaState(event);
    setStatus(navigator.onLine ? (event === "error" ? "error" : "stalled") : "offline");
    if (!shouldBePlaying.current || recoveryAttempted.current || recoveryTimer.current) return;
    recoveryTimer.current = setTimeout(() => {
      recoveryTimer.current = null;
      if (shouldBePlaying.current && navigator.onLine) reconnect();
    }, RECOVERY_DELAY_MS);
  }

  useEffect(() => {
    const select = (event: Event) => {
      const next = (event as CustomEvent<RadioStation>).detail;
      const node = audio.current;
      if (!next || !node) return;
      clearRecoveryTimer();
      recoveryAttempted.current = false;
      shouldBePlaying.current = true;
      const changed = next.id !== selectedStation.current?.id;
      capture(analyticsEvents.radioStationSelected, { station_id: next.id, genre: next.genre });
      if (changed) {
        changingStation.current = true;
        node.pause();
        node.src = next.streamUrl;
        selectedStation.current = next;
        setStation(next);
      }
      setStatus("loading");
      // The station button dispatches this event synchronously, so play() stays
      // in the original user-gesture call stack on Android.
      void node.play().catch(() => {
        setStatus(navigator.onLine ? "error" : "offline");
        logMediaState("station-play-rejected");
      });
    };
    const online = () => {
      logMediaState("online");
      if (shouldBePlaying.current) setStatus("stalled");
    };
    const offline = () => {
      clearRecoveryTimer();
      setStatus("offline");
      logMediaState("offline");
    };
    window.addEventListener(DCL_MUSIC_SELECT_EVENT, select);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      clearRecoveryTimer();
      window.removeEventListener(DCL_MUSIC_SELECT_EVENT, select);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: station?.name || "La Nueva", artist: "DCL Music" });
    navigator.mediaSession.setActionHandler("pause", () => {
      shouldBePlaying.current = false;
      audio.current?.pause();
    });
    navigator.mediaSession.setActionHandler("play", () => {
      const node = audio.current;
      if (!node || status === "idle") return;
      shouldBePlaying.current = true;
      setStatus("loading");
      void node.play().catch(() => setStatus(navigator.onLine ? "error" : "offline"));
    });
    return () => {
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("play", null);
    };
  }, [station?.name, status]);

  const value: RadioContextValue = { available, station, status, toggle, pause, reconnect };

  return <RadioContext.Provider value={value}>
    {children}
    {available && !pathname.startsWith("/admin") && <audio controls ref={audio} src={stations[0]?.streamUrl} preload="none" playsInline aria-label={`${station?.name || "La Nueva"} · DCL Music`} className="hidden" onPlay={() => { changingStation.current = false; shouldBePlaying.current = true; capture(analyticsEvents.radioPlay, { station_id: station?.id, genre: station?.genre }); setStatus("loading"); }} onPlaying={() => { clearRecoveryTimer(); recoveryAttempted.current = false; setStatus("playing"); }} onPause={() => { if (recoveryAttempted.current || changingStation.current) return; shouldBePlaying.current = false; clearRecoveryTimer(); capture(analyticsEvents.radioPause, { station_id: station?.id }); setStatus("paused"); }} onWaiting={() => scheduleRecovery("waiting")} onStalled={() => scheduleRecovery("stalled")} onError={() => scheduleRecovery("error")}>Tu navegador no admite audio HTML.</audio>}
  </RadioContext.Provider>;
}

export function useRadio() {
  const value = useContext(RadioContext);
  if (!value) throw new Error("RadioProvider requerido");
  return value;
}
