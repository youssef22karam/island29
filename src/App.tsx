import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CloudLightning, Maximize2, RotateCcw, Waves } from "lucide-react";
import { createIslandEngine, IslandAudio } from "./engine/island.js";
import type { EngineState, IslandEngine, IslandWorld } from "./engine/island.js";
import ConditionsPanel from "./components/ConditionsPanel";
import Hud from "./components/Hud";
import Modals from "./components/Modals";
import LiteScene from "./components/LiteScene";
import { cameras } from "./lib/constants";
import { SHORELINE_CONFIG, SHORELINE_SHADER } from "./engine/shoreline-rebuild.js";
import { SWAMP_CONFIG, SWAMP_SHADER } from "./engine/swamp-water.js";
import { ATMOSPHERE_CONFIG, ATMOSPHERE_SHADER } from "./engine/atmosphere.js";
import "./styles/app01.css";
import "./styles/app02.css";
import "./styles/hud.css";
import "./styles/explorer.css";

const initialState: EngineState = {
  loading: true,
  progress: 0,
  label: "Tracing the waterways",
  mode: "survey",
  island: "Valara Cay",
  place: "The estuary",
  fps: 60,
  hour: 16.4,
  depth: 0,
  speed: 0,
  heading: 0,
  hs: 3.8,
  water: "fresh",
  error: null,
  seed: 504,
};

const FRESH = ["river", "lake", "swamp"];

export default function App() {
  const mount = useRef<HTMLDivElement>(null);
  const engine = useRef<IslandEngine | null>(null);
  const audio = useRef<IslandAudio | null>(null);
  const latest = useRef(initialState);
  const ready = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const underwaterWalkRef = useRef(true);
  const runLockRef = useRef(false);
  const toldSubmerged = useRef(false);

  const [state, setState] = useState(initialState);
  const [location, setLocation] = useState("swamp");
  const [panel, setPanel] = useState(false);
  const [panelTab, setPanelTab] = useState("atmosphere");
  const [modal, setModal] = useState<"atlas" | "help" | "notes" | null>(null);
  const [world, setWorld] = useState<IslandWorld | null>(null);
  const [storm, setStorm] = useState(0.12);
  const [wave, setWave] = useState(1);
  const [hour, setHour] = useState(16.4);
  const [mist, setMist] = useState(0.22);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [cameraMode, setCameraMode] = useState("Chase");
  const [throttle, setThrottle] = useState(0);
  const [quality, setQuality] = useState(() => new URLSearchParams(window.location.search).get("q") || "low");
  const [vegetation, setVegetation] = useState(true);
  const [toast, setToast] = useState("");
  const [immersive, setImmersive] = useState(false);
  const [capsized, setCapsized] = useState(false);
  const [underwaterWalk, setUnderwaterWalk] = useState(true);
  const [runLock, setRunLock] = useState(false);
  const [boat, setBoat] = useState({ throttle: 0, speed: 0 });
  const [mapImage, setMapImage] = useState("");
  const [touch, setTouch] = useState(
    () => window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window,
  );

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3600);
  }, []);

  // Go to a place. Whatever way of travelling is active stays active when you arrive.
  const visit = useCallback(
    (type: string, name?: string, first = false) => {
      const eng = engine.current;
      if (!eng || !eng.world) return;
      const mode = latest.current.mode;
      setLocation(type);
      setModal(null);
      eng.setMove(0, 0);
      if (type === "sea") {
        eng.teleport("surf");
        return;
      }
      if (!first && mode === "dive") {
        const hit = eng.dive(type, name);
        if (hit) {
          notify(`Beneath ${hit.name} · ${hit.bedDepth.toFixed(1)} m of water`);
          return;
        }
      }
      const view = eng.getFreshwaterView(type, name);
      if (!view) {
        eng.teleport(type, name);
        return;
      }
      const center = eng.currentCenter || { x: 0, z: 0 };
      const yaw = (Math.atan2(view.lz - view.z, view.lx - view.x) * 180) / Math.PI;
      const pitch = type === "swamp" ? -5 : first ? -9 : -7.5;
      const height = type === "swamp" ? 3.2 : first ? 9 : type === "lake" ? 5 : 5.5;
      eng.debugView("survey", view.x + center.x, view.z + center.z, yaw, pitch, height);
      if (!first && mode === "walk") eng.walkHere();
      else if (!first && mode === "boat") eng.setMode("boat");
    },
    [notify],
  );

  // Create the engine once.
  useEffect(() => {
    if (!mount.current) return;
    let alive = true;
    let active: IslandEngine | null = null;

    const initTimer = setTimeout(() => {
      if (!alive || !mount.current) return;
      try {
        active = createIslandEngine(mount.current, (update) => {
          if (!alive) return;
          latest.current = { ...latest.current, ...update };
          setState(latest.current);
          audio.current?.update({
            ...latest.current,
            storm: latest.current.storm ?? 0.12,
            waveHeight: latest.current.waveHeight ?? 1,
          });
          if (update.loading === false && !ready.current) {
            ready.current = true;
          }
        });
        engine.current = active;
        active.setAutoOrbit(false);
        active.setStorm(0.12);
        active.setWaveHeight(1);
        active.setHour(16.4);
        active.setMist(0.22);
        active.setUnderwaterWalk(underwaterWalkRef.current);
        active.setRun(runLockRef.current);
        active.regenerate(Number(new URLSearchParams(window.location.search).get("seed") || 504));
        (window as unknown as { islandEngine: IslandEngine }).islandEngine = active;
        (window as unknown as { __SHORE: unknown }).__SHORE = {
          config: SHORELINE_CONFIG,
          shader: SHORELINE_SHADER,
          swampConfig: SWAMP_CONFIG,
          swampShader: SWAMP_SHADER,
          atmosphereConfig: ATMOSPHERE_CONFIG,
          atmosphereShader: ATMOSPHERE_SHADER,
        };
      } catch (error) {
        setState((s) => ({
          ...s,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }, 40);

    return () => {
      alive = false;
      clearTimeout(initTimer);
      active?.dispose();
      engine.current = null;
      audio.current?.dispose();
      audio.current = null;
      ready.current = false;
    };
  }, [visit]);

  // Non-fatal engine warnings (e.g. a shader that is not supported on this GPU).
  useEffect(() => {
    if (state.warning) notify(state.warning);
  }, [state.warning, notify]);

  // A phone or tablet gets the thumb stick as soon as it is touched.
  useEffect(() => {
    const onTouch = () => setTouch(true);
    window.addEventListener("touchstart", onTouch, { once: true, passive: true });
    return () => window.removeEventListener("touchstart", onTouch);
  }, []);

  const toggleUnderwaterWalk = useCallback(() => {
    const next = !underwaterWalkRef.current;
    underwaterWalkRef.current = next;
    setUnderwaterWalk(next);
    engine.current?.setUnderwaterWalk(next);
    notify(
      next
        ? "Walking under water is on · wade in and keep going"
        : "Walking under water is off · you swim at the surface",
    );
  }, [notify]);

  const toggleRunLock = useCallback(() => {
    const next = !runLockRef.current;
    runLockRef.current = next;
    setRunLock(next);
    engine.current?.setRun(next);
    notify(next ? "Running" : "Walking");
  }, [notify]);

  const cycleCamera = useCallback(() => {
    setCameraMode((prev) => cameras[(cameras.indexOf(prev) + 1) % cameras.length]);
  }, []);

  // Choose how to travel. Walking and diving start where the view already is.
  const changeMode = useCallback(
    (mode: string) => {
      const eng = engine.current;
      if (!eng) return;
      eng.setMove(0, 0);
      if (mode === "dive") {
        const fallback = FRESH.includes(location) ? location : "lake";
        const spot = eng.diveHere() ?? eng.dive(fallback);
        if (!spot) {
          notify("No lake, river or swamp close enough to dive into.");
          return;
        }
        if (!FRESH.includes(location)) setLocation(fallback);
        notify(
          touch
            ? "Diving · stick to swim · arrows change depth · tap to stir"
            : "Diving · WASD swim · E / Q up and down · click to stir",
        );
        return;
      }
      if (mode === "walk") {
        if (!eng.walkHere()) eng.setMode("walk");
        notify(
          touch
            ? "On foot · push the stick all the way to run"
            : "On foot · WASD · Shift runs · Space jumps",
        );
        return;
      }
      eng.setMode(mode);
      if (mode === "boat")
        notify(
          touch
            ? "At the helm · hold the arrows for speed, it stays where you leave it"
            : "At the helm · ↑ ↓ speed (it holds) · ← → steer · Space stops",
        );
    },
    [location, notify, touch],
  );

  // The boat camera follows the chosen view whenever the boat is in use.
  useEffect(() => {
    if (state.mode === "boat") engine.current?.setCameraMode(cameraMode);
  }, [cameraMode, state.mode]);

  // Boat telemetry: capsize warning, speed and where the throttle lever sits.
  useEffect(() => {
    if (state.mode !== "boat") {
      setCapsized(false);
      return;
    }
    const timer = setInterval(() => {
      const info = engine.current?.getBoatState();
      if (!info) return;
      setCapsized(info.capsized);
      setBoat((prev) =>
        Math.abs(prev.throttle - info.throttle) > 0.03 || Math.abs(prev.speed - info.speed) > 0.03
          ? { throttle: info.throttle, speed: info.speed }
          : prev,
      );
      setThrottle((prev) => (Math.abs(prev - info.throttle) > 0.05 ? info.throttle : prev));
    }, 160);
    return () => clearInterval(timer);
  }, [state.mode]);

  // Say once what happens when the walker first goes under.
  const submerged = state.mode === "walk" && (state.altitude ?? 1) < -0.05;
  useEffect(() => {
    if (!submerged || toldSubmerged.current) return;
    toldSubmerged.current = true;
    notify(
      touch
        ? "Under water · keep walking · hold the arrow to swim up"
        : "Under water · keep walking along the bed · hold Space to swim up",
    );
  }, [submerged, notify, touch]);

  // Shortcuts that belong to the interface rather than to movement.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input,select,textarea") || modal || e.repeat) return;
      const mode = latest.current.mode;
      if (e.code === "KeyH") setImmersive((v) => !v);
      else if (e.code === "KeyC" && mode === "boat") cycleCamera();
      else if (e.code === "KeyU") {
        if (mode === "walk") toggleUnderwaterWalk();
        else changeMode(mode === "dive" ? "survey" : "dive");
      } else if (e.code === "KeyR") {
        if (mode === "walk") toggleRunLock();
        else if (mode === "dive") engine.current?.stirWater(1.6);
        else if (mode === "boat") engine.current?.rightBoat();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modal, cycleCamera, toggleUnderwaterWalk, toggleRunLock, changeMode]);

  // Hold the world still while a dialog is open.
  useEffect(() => {
    engine.current?.setPaused(Boolean(modal));
    return () => engine.current?.setPaused(false);
  }, [modal]);

  const closeModal = useCallback(() => setModal(null), []);

  const setStormValue = (v: number) => {
    setStorm(v);
    engine.current?.setStorm(v);
  };
  const setWaveValue = (v: number) => {
    setWave(v);
    engine.current?.setWaveHeight(v);
  };
  const setHourValue = (v: number) => {
    setHour(v);
    engine.current?.setHour(v);
  };
  const setMistValue = (v: number) => {
    setMist(v);
    engine.current?.setMist(v);
  };

  const toggleAudio = async () => {
    try {
      audio.current ||= new IslandAudio();
      await audio.current.setMuted(!muted);
      setMuted((v) => !v);
    } catch {
      notify("Audio is not available in this browser.");
    }
  };

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setImmersive((v) => !v);
    }
  };

  const capture = () => {
    if (state.loading || !engine.current) {
      notify("The island is still taking shape.");
      return;
    }
    try {
      const link = document.createElement("a");
      link.download = `island-${state.seed}-${location}.png`;
      link.href = engine.current.capture();
      link.click();
      notify("Photo saved.");
    } catch {
      notify("Capture is unavailable on this device.");
    }
  };

  const reset = () => {
    setStormValue(0.06);
    setWaveValue(0.85);
    setHourValue(14.4);
    setMistValue(0.15);
    setPlaying(false);
    engine.current?.setPlaying(false);
    notify("Restored the island's natural conditions.");
  };

  const maximumStorm = () => {
    setStormValue(1);
    setWaveValue(2.5);
    visit("sea");
    notify("Full storm. Maximum 2.5x waves. Allow the sea a moment to build.");
  };

  const shownHour = playing ? state.hour : hour;
  const time = `${String(Math.floor(shownHour)).padStart(2, "0")}:${String(Math.floor((shownHour % 1) * 60)).padStart(2, "0")}`;
  const available = !state.loading && !state.error;

  // Draw the atlas map once the world exists.
  useEffect(() => {
    const terrain = engine.current?.world;
    if (!world || !terrain || modal !== "atlas") {
      setMapImage("");
      return;
    }
    const canvas = document.createElement("canvas");
    const size = Math.min(terrain.N, 480);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const ix = Math.floor((x / size) * terrain.N);
        const iy = Math.floor((y / size) * terrain.N);
        const k = iy * terrain.N + ix;
        const height = terrain.h[k];
        const water = height < 0;
        // Only water joined to the river network is drawn as water; stray beach pools read as damp sand.
        const inl = terrain.inl ? terrain.inl[k] : 0;
        const shade = Math.min(1, Math.max(0, height / terrain.maxHeight));
        const rgb: [number, number, number] = !water
          ? [73 + shade * 80, 87 + shade * 77, 62 + shade * 70]
          : inl > 0.4
            ? [104, 144, 130]
            : [56, 91, 92];
        const p = (y * size + x) * 4;
        image.data[p] = rgb[0];
        image.data[p + 1] = rgb[1];
        image.data[p + 2] = rgb[2];
        image.data[p + 3] = 255;
      }
    ctx.putImageData(image, 0, 0);
    setMapImage(canvas.toDataURL());
  }, [world, modal]);

  return (
    <main className={`island-app ${immersive ? "is-immersive" : ""}`}>
      <div className="environment-preview" aria-hidden="true" />
      {state.error && <LiteScene />}
      <div
        className={`scene-mount ${available ? "scene-ready" : ""}`}
        ref={mount}
        aria-label="Interactive island and ocean simulation"
      />

      <Hud
        engine={engine}
        state={state}
        available={available}
        touch={touch}
        location={location}
        panel={panel}
        muted={muted}
        underwaterWalk={underwaterWalk}
        runLock={runLock}
        cameraMode={cameraMode}
        boat={boat}
        onMode={changeMode}
        onPlace={visit}
        onTogglePanel={() => setPanel((v) => !v)}
        onToggleAudio={toggleAudio}
        onToggleUnderwaterWalk={toggleUnderwaterWalk}
        onToggleRunLock={toggleRunLock}
        onCycleCamera={cycleCamera}
         onAtlas={() => {
           const w = engine.current?.world;
           if (w) setWorld({
             name: w.name, seed: w.seed, N: w.N, cell: w.cell, half: w.half,
             landArea: w.landArea, maxHeight: w.maxHeight,
             rivers: w.rivers, lakes: w.lakes, marshes: w.marshes,
             h: new Float32Array(), wet: new Uint8Array(), inl: new Float32Array(),
             swamp: new Float32Array(), fresh: new Float32Array(),
           });
           setModal("atlas");
         }}
        onHelp={() => setModal("help")}
        onCapture={capture}
        onFullscreen={fullscreen}
        onHide={() => setImmersive(true)}
      />

      <ConditionsPanel
        cameraMode={cameraMode}
        engine={engine}
        hour={hour}
        maximumStorm={maximumStorm}
        mist={mist}
        notify={notify}
        panel={panel}
        panelTab={panelTab}
        playing={playing}
        quality={quality}
        ready={ready}
        reset={reset}
        setCameraMode={setCameraMode}
        setHourValue={setHourValue}
        setMistValue={setMistValue}
        setPanel={setPanel}
        setPanelTab={setPanelTab}
        setPlaying={setPlaying}
        setQuality={setQuality}
        setStormValue={setStormValue}
        setThrottle={setThrottle}
        setVegetation={setVegetation}
        setWaveValue={setWaveValue}
        state={state}
        storm={storm}
        throttle={throttle}
        time={time}
        vegetation={vegetation}
        wave={wave}
      />

      {state.loading && !state.error && (
        <div className="loading-progress" role="status">
          <span className="loading-orbit" />
          <div>
            <span>{state.label || "Waking the wetlands"}</span>
            <div className="loading-track">
              <i style={{ width: `${Math.max(3, state.progress * 100)}%` }} />
            </div>
          </div>
          <span>{Math.round(state.progress * 100)}%</span>
        </div>
      )}

      {state.warningDetail && (
        <div
          role="status"
          style={{ position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 20, maxHeight: "32vh", overflow: "auto", background: "#15291eee", color: "#e4e8ce", padding: 12, borderRadius: 6, fontSize: 10.5, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "text" }}
        >
          <strong>Shader problem on this device (send this to the developer):</strong>
          {"\n"}
          {state.warningDetail}
        </div>
      )}
      {state.error && (
        <div className="graphics-notice" role="alert" style={{ top: 92, right: 24, left: "auto", transform: "none", maxWidth: 320 }}>
          <Waves size={18} />
          <div>
            <strong>Lite mode · full 3D unavailable</strong>
            <p>Live 3D needs a WebGL 2 compatible browser. Your graphics device could not start the simulation.</p>
            <p style={{ opacity: 0.7, fontSize: 11, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
              {String(state.error).slice(0, 400)}
            </p>
            <p style={{ opacity: 0.75, fontSize: 11 }}>
              Tip: make sure hardware acceleration is on (Chrome: Settings, System) and the browser is up to date.
            </p>
            <button onClick={() => window.location.reload()}>
              Retry 3D <ArrowRight size={13} />
            </button>
            <button
              onClick={() => {
                const u = new URL(window.location.href);
                u.searchParams.set("q", "lowest");
                window.location.href = u.href;
              }}
              style={{ marginLeft: 12 }}
            >
              Try lowest quality <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {capsized && (
        <div className="capsize-notice">
          <CloudLightning size={20} />
          <div>
            <strong>Heavy seas. Hold steady.</strong>
            <span>Your boat has capsized.</span>
          </div>
          <button onClick={() => engine.current?.rightBoat()}>
            Right the boat <RotateCcw size={14} />
          </button>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <Check size={15} /> {toast}
        </div>
      )}

      <button className="restore-ui" onClick={() => setImmersive(false)}>
        <Maximize2 size={15} /> Show interface <kbd>H</kbd>
      </button>

      <Modals
        closeModal={closeModal}
        mapImage={mapImage}
        modal={modal}
        state={state}
        visit={visit}
        world={world}
      />
    </main>
  );
}
