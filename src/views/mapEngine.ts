import { Map as GLMap, Marker, ScaleControl, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike, type StyleSpecification } from "maplibre-gl";
import workerSource from "maplibre-worker-source";
import glCss from "maplibre-gl/dist/maplibre-gl.css";
import type { MapPin } from "../project/mapData";
import { boundsOf } from "../project/geo";
import { graticule, type GridSettings } from "../project/mapGrid";
import type { RealWorldSettings } from "../project/mapsConfig";
import { LIGHT, type Basemap, type Inset, type MapController, type Palette, type PinHandlers } from "./mapTypes";
import { createEditPin, type EditPin } from "./pinEdit";
import { stackAround } from "../project/mapFan";

export { DARK, LIGHT, parseBasemap, gunzipBytes } from "./mapTypes";
export type { Basemap, MapController, Palette, PinHandlers } from "./mapTypes";

/**
 * The WebGL engine for the real-world map: MapLibre drawing the bundled Natural Earth basemap and the pins. No network is used: the
 * basemap is a file in the plugin folder, MapLibre's worker is started from a blob made from source bundled in main.js, and pins are
 * plain GeoJSON. Picture maps and the no-WebGL fallback use the other engine (mapLeaflet.ts).
 */

export { probeWebGL, hasWebGL } from "./webglProbe";

let workerReady = false;
let cssEl: HTMLStyleElement | null = null;
let users = 0;

function setup() {
  if (!workerReady) {
    setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
    workerReady = true;
  }
  if (!cssEl) {
    cssEl = document.head.createEl("style", { attr: { "data-booker": "maplibre" } });
    cssEl.textContent = glCss;
  }
  users++;
}

function teardown() {
  if (--users <= 0) {
    cssEl?.remove();
    cssEl = null;
    users = 0;
  }
}

function styleFor(b: Basemap | null, p: Palette, w: RealWorldSettings): StyleSpecification {
  const sources: StyleSpecification["sources"] = {};
  const layers: StyleSpecification["layers"] = [{ id: "ocean", type: "background", paint: { "background-color": p.ocean } }];
  if (b) {
    sources.land = { type: "geojson", data: b.land };
    sources.lakes = { type: "geojson", data: b.lakes };
    layers.push(
      { id: "land", type: "fill", source: "land", paint: { "fill-color": p.land, "fill-outline-color": p.coast } },
      { id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": p.water, "fill-outline-color": p.coast } },
    );
    if (w.rivers) {
      sources.rivers = { type: "geojson", data: b.rivers };
      layers.push({ id: "rivers", type: "line", source: "rivers", minzoom: 3, paint: { "line-color": p.water, "line-width": 0.8 } });
    }
    if (w.states) {
      sources.states = { type: "geojson", data: b.states };
      layers.push({ id: "states", type: "line", source: "states", minzoom: 3.5, paint: { "line-color": p.state, "line-width": 0.6, "line-dasharray": [3, 2] } });
    }
    if (w.borders) {
      sources.borders = { type: "geojson", data: b.borders };
      layers.push({ id: "borders", type: "line", source: "borders", paint: { "line-color": p.border, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 1.2] } });
    }
  }
  return { version: 8, sources, layers };
}

const PINS = "pins";
const SEL = "selected";
const GRID = "graticule";

export interface WebGLOptions {
  /** called when MapLibre cannot start or loses its context, so the view can fall back to the compatible engine */
  onFailure?(why: string): void;
}

export function createMap(host: HTMLElement, basemap: Basemap | null, world: RealWorldSettings, palette: Palette, handlers: PinHandlers, opts: WebGLOptions = {}): MapController {
  setup();
  const all = new Map<string, MapPin>();
  let pending: GeoJSON.FeatureCollection | null = null;
  let loaded = false;
  let lastPins: MapPin[] = [];
  let grid: GridSettings | null = null;
  let picking = false;
  let pal = palette ?? LIGHT;
  let failed = false;
  let inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
  let selected: string | null = null;
  let groupMarkers: Marker[] = [];
  // the pin being edited is a draggable marker; its dot is left out of the layer meanwhile
  let editing: { pin: MapPin; marker: Marker; look: EditPin } | null = null;
  let lastColor: (p: MapPin) => string = () => "#534ab7";
  const fail = (why: string) => {
    if (failed) return;
    failed = true;
    opts.onFailure?.(why);
  };

  const map = new GLMap({
    container: host,
    style: styleFor(basemap, pal, world),
    center: [10, 25],
    zoom: 1.4,
    minZoom: 0,
    maxZoom: 14,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    renderWorldCopies: true,
  });
  map.addControl(new ScaleControl({ unit: world.units }), "bottom-left");
  // touch rotation is not useful on a flat story map
  map.touchZoomRotate.disableRotation();
  // a double click on a pin edits it; it must not zoom the map
  map.doubleClickZoom.disable();

  host.addEventListener("webglcontextlost", () => fail("The graphics context was lost."), { once: true, capture: true });
  map.on("error", (e) => {
    const msg = String((e as unknown as { error?: Error }).error?.message ?? "");
    if (!loaded && /webgl|context/i.test(msg)) fail(msg);
  });

  const addPinLayers = () => {
    if (map.getSource(PINS)) return;
    map.addSource(GRID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "graticule-lines", type: "line", source: GRID, paint: { "line-color": ["get", "color"], "line-opacity": ["get", "opacity"], "line-width": ["case", ["get", "major"], 1, 0.5] } });
    map.addSource(SEL, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "pin-selected", type: "circle", source: SEL, paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 3, "circle-stroke-color": "#8b7cff" } });
    map.addSource(PINS, { type: "geojson", data: pending ?? { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "pin-points", type: "circle", source: PINS, paint: { "circle-color": ["get", "color"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4, 8, 7], "circle-stroke-width": 1.5, "circle-stroke-color": "#ffffff", "circle-opacity": 0.95 } });
    map.on("click", "pin-points", (e) => {
      if (picking) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      const pin = id ? all.get(id) : undefined;
      if (!pin) return;
      // pins on top of each other fan out instead of the top one hiding the rest
      const screen = (q: MapPin) => map.project([q.x, q.y]);
      const stack = stackAround(pin, [...all.values()], screen, 9);
      if (stack.length > 1) {
        const c = screen(pin);
        handlers.stack?.(stack, c.x, c.y);
      } else handlers.click(pin);
    });
    map.on("dblclick", "pin-points", (e) => {
      if (picking) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      const pin = id ? all.get(id) : undefined;
      if (pin) {
        e.preventDefault();
        handlers.open?.(pin);
      }
    });
    map.on("contextmenu", "pin-points", (e) => {
      if (picking) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      const pin = id ? all.get(id) : undefined;
      if (pin) {
        e.originalEvent.preventDefault();
        handlers.menu?.(pin, e.originalEvent.clientX, e.originalEvent.clientY);
      }
    });
    for (const layer of ["pin-points"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = picking ? "crosshair" : "pointer"));
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = picking ? "crosshair" : "";
        handlers.hover(null, 0, 0);
      });
    }
    map.on("mousemove", "pin-points", (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      handlers.hover(id ? all.get(id) ?? null : null, e.point.x, e.point.y);
    });
  };

  const paintGrid = () => {
    const src = loaded ? (map.getSource(GRID) as GeoJSONSource | undefined) : undefined;
    if (!src) return;
    if (!grid?.show) return void src.setData({ type: "FeatureCollection", features: [] });
    const b = map.getBounds();
    const lines = graticule({ xMin: b.getWest(), xMax: b.getEast(), yMin: b.getSouth(), yMax: b.getNorth() }, grid, 8);
    src.setData({
      type: "FeatureCollection",
      features: lines.map((l) => ({
        type: "Feature",
        properties: { major: l.major, color: grid!.color, opacity: grid!.opacity * (l.major ? 1 : 0.6) },
        geometry: { type: "LineString", coordinates: l.axis === "v" ? [[l.value, -85], [l.value, 85]] : [[-180, l.value], [180, l.value]] },
      })),
    });
  };

  // The grid numbers (MapLibre has no fonts here) are drawn on a canvas laid over the map, once the map has stopped moving.
  const labelCanvas = document.createElement("canvas");
  labelCanvas.className = "booker-map-gridlabels";
  host.appendChild(labelCanvas);
  let labelTimer = 0;
  const paintLabels = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    labelCanvas.width = Math.max(1, Math.round(w * dpr));
    labelCanvas.height = Math.max(1, Math.round(h * dpr));
    labelCanvas.style.width = `${w}px`;
    labelCanvas.style.height = `${h}px`;
    const g2 = labelCanvas.getContext("2d");
    if (!g2) return;
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, w, h);
    if (!loaded || !grid?.show || !grid.labels) return;
    const b = map.getBounds();
    const lines = graticule({ xMin: b.getWest(), xMax: b.getEast(), yMin: b.getSouth(), yMax: b.getNorth() }, grid, 8);
    g2.font = "11px sans-serif";
    g2.textBaseline = "top";
    g2.lineWidth = 2.5;
    g2.lineJoin = "round";
    g2.strokeStyle = pal.ocean;
    g2.fillStyle = grid.color;
    g2.globalAlpha = 0.95;
    const num = (v: number) => String(Math.round(Math.abs(v) * 100) / 100);
    for (const l of lines) {
      if (!l.label) continue;
      // meridians are labelled along the top, parallels along the left
      const text = l.axis === "v" ? `${num(((l.value + 540) % 360) - 180)}°${((l.value + 540) % 360) - 180 >= 0 ? "E" : "W"}` : `${num(l.value)}°${l.value >= 0 ? "N" : "S"}`;
      const pt = map.project(l.axis === "v" ? [l.value, b.getCenter().lat] : [b.getCenter().lng, l.value]);
      const x = l.axis === "v" ? pt.x + 3 : 6;
      const y = l.axis === "v" ? 6 : pt.y - 13;
      if (x < -40 || x > w || y < -14 || y > h) continue;
      g2.strokeText(text, x, y);
      g2.fillText(text, x, y);
    }
  };
  map.on("movestart", () => {
    window.clearTimeout(labelTimer);
    labelCanvas.style.opacity = "0";
  });
  const settleLabels = () => {
    window.clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      paintLabels();
      labelCanvas.style.opacity = "1";
    }, 100);
  };
  map.on("load", () => {
    loaded = true;
    addPinLayers();
    paintGrid();
    settleLabels();
  });
  map.on("moveend", () => {
    paintGrid();
    settleLabels();
    handlers.settled?.();
  });
  map.on("dragstart", () => handlers.moving?.());
  map.on("zoomstart", () => handlers.moving?.());
  map.on("contextmenu", (e) => {
    if (picking || !loaded) return;
    if (map.queryRenderedFeatures(e.point, { layers: ["pin-points"] }).length) return;
    e.originalEvent.preventDefault();
    handlers.mapMenu?.({ x: Math.round((((e.lngLat.lng + 540) % 360) - 180) * 1e5) / 1e5, y: Math.round(e.lngLat.lat * 1e5) / 1e5 }, e.originalEvent.clientX, e.originalEvent.clientY);
  });
  map.on("mousemove", (e) => handlers.pointer?.({ x: ((e.lngLat.lng + 540) % 360) - 180, y: e.lngLat.lat }));
  host.addEventListener("mouseleave", () => handlers.pointer?.(null));
  map.on("click", (e) => {
    if (!picking) {
      if (loaded && !map.queryRenderedFeatures(e.point, { layers: ["pin-points"] }).length) handlers.blank?.();
      return;
    }
    handlers.pick?.({ x: Math.round((((e.lngLat.lng + 540) % 360) - 180) * 1e5) / 1e5, y: Math.round(e.lngLat.lat * 1e5) / 1e5 });
  });

  const collection = (pins: MapPin[], colorOf: (p: MapPin) => string): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: pins.filter((p) => !p.members && !(editing && editing.pin.id === p.id)).map((p) => ({ type: "Feature", properties: { id: p.id, color: colorOf(p) }, geometry: { type: "Point", coordinates: [p.x, p.y] } })),
  });

  const fitTo = (pins: MapPin[], animate: boolean) => {
    const b = boundsOf(pins.map((p) => ({ lat: p.y, lng: p.x })));
    if (!b) return;
    const pad = { top: inset.top + 50, right: inset.right + 50, bottom: inset.bottom + 50, left: inset.left + 50 };
    if (b.west === b.east && b.south === b.north) return void map.easeTo({ center: [b.west, b.south], zoom: 6, padding: pad, duration: animate ? 500 : 0 });
    map.fitBounds([[b.west, b.south], [b.east, b.north]] as LngLatBoundsLike, { padding: pad, maxZoom: 8, duration: animate ? 500 : 0 });
  };

  return {
    setPins(pins, colorOf) {
      lastPins = pins;
      lastColor = colorOf;
      all.clear();
      for (const p of pins) {
        all.set(p.id, p);
        for (const m of p.members ?? []) all.set(m.id, m);
      }
      pending = collection(pins, colorOf);
      // several pins close together: one grey badge with their number
      for (const g of groupMarkers) g.remove();
      groupMarkers = [];
      for (const p of pins) {
        if (!p.members) continue;
        const badge = document.createElement("div");
        badge.className = "bm-group" + (p.members.length > 99 ? " is-wide" : "");
        badge.textContent = String(p.members.length);
        badge.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (!picking) handlers.click(p);
        });
        badge.addEventListener("dblclick", (ev) => ev.stopPropagation());
        badge.addEventListener("contextmenu", (ev) => (ev.preventDefault(), ev.stopPropagation()));
        badge.addEventListener("mouseenter", (ev) => {
          const r = host.getBoundingClientRect();
          handlers.hover(p, ev.clientX - r.left, ev.clientY - r.top);
        });
        badge.addEventListener("mouseleave", () => handlers.hover(null, 0, 0));
        groupMarkers.push(new Marker({ element: badge, anchor: "center" }).setLngLat([p.x, p.y]).addTo(map));
      }
      const src = loaded ? (map.getSource(PINS) as GeoJSONSource | undefined) : undefined;
      src?.setData(pending);
      if (selected) this.select(all.has(selected) ? selected : null);
    },
    fit(pins, animate = true) {
      fitTo(pins ?? lastPins, animate);
    },
    flyTo(pin) {
      map.easeTo({ center: [pin.x, pin.y], zoom: Math.max(map.getZoom(), 5), duration: 500 });
    },
    setPalette(p) {
      pal = p;
      map.setStyle(styleFor(basemap, pal, world));
      map.once("styledata", () => {
        addPinLayers();
        if (pending) (map.getSource(PINS) as GeoJSONSource | undefined)?.setData(pending);
        paintGrid();
      });
    },
    setGrid(g) {
      grid = g;
      paintGrid();
      settleLabels();
    },
    toScreen(x, y) {
      const c = map.project([x, y]);
      return { x: c.x, y: c.y };
    },
    setInset(i) {
      inset = i;
    },
    select(id) {
      selected = id;
      const src = loaded ? (map.getSource(SEL) as GeoJSONSource | undefined) : undefined;
      const p = id ? all.get(id) : undefined;
      src?.setData(p ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.x, p.y] } }] } : { type: "FeatureCollection", features: [] });
    },
    zoomBy(levels) {
      map.easeTo({ zoom: map.getZoom() + levels, duration: 220 });
    },
    setPick(on) {
      picking = on;
      map.getCanvas().style.cursor = on ? "crosshair" : "";
    },
    beginEdit(pin, color) {
      if (editing) return;
      const look = createEditPin(color);
      // above the grey badges of the pins still stacked beneath it
      look.el.style.zIndex = "6";
      const marker = new Marker({ element: look.el, draggable: true, anchor: "center" }).setLngLat([pin.x, pin.y]).addTo(map);
      let last = map.project(marker.getLngLat());
      const at = () => {
        const ll = marker.getLngLat();
        return { x: Math.round((((ll.lng + 540) % 360) - 180) * 1e5) / 1e5, y: Math.round(ll.lat * 1e5) / 1e5 };
      };
      marker.on("drag", () => {
        const now = map.project(marker.getLngLat());
        look.kick(now.x - last.x, now.y - last.y);
        last = now;
        handlers.moved?.(pin, at());
      });
      marker.on("dragend", () => handlers.moved?.(pin, at()));
      look.el.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        handlers.edit?.(pin);
      });
      look.el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        handlers.menu?.(pin, ev.clientX, ev.clientY);
      });
      editing = { pin, marker, look };
      this.setPins(lastPins, lastColor);
    },
    async endEdit() {
      const e = editing;
      if (!e) return;
      await e.look.drop();
      e.marker.remove();
      e.look.destroy();
      editing = null;
    },
    resize() {
      map.resize();
    },
    destroy() {
      for (const g of groupMarkers) g.remove();
      window.clearTimeout(labelTimer);
      map.remove();
      teardown();
    },
  };
}
