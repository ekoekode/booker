import * as L from "leaflet";
import leafletCss from "leaflet/dist/leaflet.css";
import type { MapPin } from "../project/mapData";
import { boundsOf } from "../project/geo";
import { boundsXY } from "../project/mapCoords";
import { gridLines, graticule, type GridSettings, type GridLine, type View } from "../project/mapGrid";
import { LIGHT, type Basemap, type Inset, type MapController, type MapSpec, type Palette, type PinHandlers } from "./mapTypes";
import { createEditPin, type EditPin } from "./pinEdit";
import { stackAround } from "../project/mapFan";

/**
 * The compatible engine: Leaflet on a canvas. It needs no WebGL, so it draws the picture maps on every computer and the real world
 * when WebGL is missing or too slow. Fewer frills than MapLibre: pins are not clustered, and the real world is the lighter 1:50m data.
 * No tile layers are used and nothing goes online: pictures load from a blob URL and the basemap is a file in the plugin folder.
 */

// Leaflet's canvas redraws on the next frame; if the map is removed first it reads a context that is gone and logs an error. Skip that redraw.
const canvasProto = (L.Canvas as unknown as { prototype: { _redraw: () => void; _ctx?: unknown; __booker?: boolean } }).prototype;
if (!canvasProto.__booker) {
  const redraw = canvasProto._redraw;
  canvasProto._redraw = function (this: { _ctx?: unknown }) {
    if (!this._ctx) return;
    redraw.call(this);
  };
  canvasProto.__booker = true;
}

let cssEl: HTMLStyleElement | null = null;
let users = 0;

function setup() {
  if (!cssEl) {
    cssEl = document.head.createEl("style", { attr: { "data-booker": "leaflet" } });
    cssEl.textContent = leafletCss;
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

const wrapLng = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180;
const round = (n: number, d: number): number => Math.round(n * 10 ** d) / 10 ** d;

export function createLeaflet(host: HTMLElement, spec: MapSpec, palette: Palette, handlers: PinHandlers): MapController {
  setup();
  const flat = spec.kind === "flat";
  const coords = flat ? spec.map.coords : null;

  // internal space: Leaflet's latitude is "up". A map whose y grows downward is stored flipped.
  const yIn = (y: number) => (coords && !coords.yUp ? -y : y);
  const toLL = (x: number, y: number): L.LatLng => (flat ? L.latLng(yIn(y), x) : L.latLng(y, x));
  const fromLL = (ll: L.LatLng): { x: number; y: number } => (flat ? { x: ll.lng, y: coords!.yUp ? ll.lat : -ll.lat } : { x: wrapLng(ll.lng), y: ll.lat });
  const pickDecimals = flat ? coords!.decimals + 2 : 5;

  const map = L.map(host, {
    crs: flat ? L.CRS.Simple : L.CRS.EPSG3857,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 80,
    attributionControl: false,
    zoomControl: false,
    preferCanvas: true,
    worldCopyJump: !flat,
    minZoom: flat ? -20 : 1,
    maxZoom: flat ? 20 : 12,
  });
  const el = map.getContainer();
  el.addClass("booker-leaflet");

  let pal = palette ?? LIGHT;
  let grid: GridSettings | null = null;
  let picking = false;
  let lastPins: MapPin[] = [];
  const pinLayer = L.layerGroup().addTo(map);
  // the pin being edited is drawn as a draggable marker instead of a dot
  let editing: { pin: MapPin; marker: L.Marker; look: EditPin } | null = null;
  let lastColor: (p: MapPin) => string = () => "#534ab7";
  let inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
  let selected: string | null = null;
  const selLayer = L.layerGroup().addTo(map);
  // a double click on a pin must not zoom the map
  map.doubleClickZoom.disable();
  let pendingFit: { pins: MapPin[]; animate: boolean } | null = null;

  // ---- the map itself
  let mapBounds: L.LatLngBounds | null = null;
  const worldLayers: Array<{ layer: L.GeoJSON; minZoom: number; style: (p: Palette) => L.PathOptions }> = [];

  if (spec.kind === "flat") {
    const c = spec.map.coords;
    mapBounds = L.latLngBounds(toLL(c.xMin, c.yMin), toLL(c.xMax, c.yMax));
    el.style.background = spec.map.background;
    // the picture sits on the map's own pane under everything; the colour behind it is the container's background
    map.createPane("bookerPicture").style.zIndex = "250";
    if (spec.imageUrl) L.imageOverlay(spec.imageUrl, mapBounds, { interactive: false, opacity: spec.map.image?.opacity ?? 1, pane: "bookerPicture" }).addTo(map);
    L.rectangle(mapBounds, { interactive: false, stroke: true, color: "#00000055", weight: 1, fill: false }).addTo(map);
    // Leaflet needs a view before anything asks for bounds; the real fit comes once the pane has a size
    map.setView(mapBounds.getCenter(), 0, { animate: false });
    map.setMaxBounds(mapBounds.pad(0.6));
  } else {
    const b: Basemap | null = spec.basemap;
    el.style.background = pal.ocean;
    map.setView([25, 10], 1.5);
    if (b) {
      const add = (data: GeoJSON.FeatureCollection, minZoom: number, style: (p: Palette) => L.PathOptions) => {
        const layer = L.geoJSON(data, { style: style(pal), interactive: false });
        worldLayers.push({ layer, minZoom, style });
      };
      add(b.land, 0, (p) => ({ fillColor: p.land, fillOpacity: 1, color: p.coast, weight: 0.6 }));
      add(b.lakes, 0, (p) => ({ fillColor: p.water, fillOpacity: 1, color: p.coast, weight: 0.5 }));
      if (spec.world.rivers) add(b.rivers, 3, (p) => ({ color: p.water, weight: 0.8, fill: false }));
      if (spec.world.states) add(b.states, 3.5, (p) => ({ color: p.state, weight: 0.6, dashArray: "3 2", fill: false }));
      if (spec.world.borders) add(b.borders, 0, (p) => ({ color: p.border, weight: 0.9, fill: false }));
    }
    L.control.scale({ imperial: spec.world.units === "imperial", metric: spec.world.units === "metric", position: "bottomleft" }).addTo(map);
  }

  const syncWorldLayers = () => {
    const z = map.getZoom();
    for (const w of worldLayers) {
      const want = z >= w.minZoom;
      if (want && !map.hasLayer(w.layer)) w.layer.addTo(map).bringToBack();
      else if (!want && map.hasLayer(w.layer)) map.removeLayer(w.layer);
    }
  };
  // keep the base layers under the pins and grid: add in order, land first
  if (worldLayers.length) {
    for (const w of worldLayers) if (w.minZoom === 0) w.layer.addTo(map);
    syncWorldLayers();
    map.on("zoomend", syncWorldLayers);
  }

  // ---- zoom limits and first fit for a picture map (they depend on the size on screen)
  const sized = () => el.clientWidth > 0 && el.clientHeight > 0;
  const fitZoom = (): number => (mapBounds && sized() ? map.getBoundsZoom(mapBounds, false, L.point(24, 24)) : 0);
  let limited = false;
  const limitZoom = () => {
    if (!mapBounds || limited || !sized()) return;
    const z = fitZoom();
    map.setMinZoom(z - 1.5);
    map.setMaxZoom(z + 7);
    limited = true;
  };

  // ---- grid
  // One canvas for the whole grid (not a shape and a label element per line), a little larger than the view so a short drag still
  // shows lines, drawn once the map has stopped moving. While the map zooms the grid is hidden, so scrolling stays smooth.
  const GRID_PAD = 0.35;
  map.createPane("bookerGrid").style.zIndex = "300";
  map.getPane("bookerGrid")!.style.pointerEvents = "none";
  const canvas = L.DomUtil.create("canvas", "booker-map-gridcanvas") as HTMLCanvasElement;
  map.getPane("bookerGrid")!.appendChild(canvas);
  const g2 = canvas.getContext("2d");
  let settle = 0;
  let frame = 0;

  const view = (px: { x: number; y: number }, py: { x: number; y: number }): View => {
    const a = fromLL(map.containerPointToLatLng(L.point(px.x, px.y)));
    const b = fromLL(map.containerPointToLatLng(L.point(py.x, py.y)));
    return { xMin: Math.min(a.x, b.x), xMax: Math.max(a.x, b.x), yMin: Math.min(a.y, b.y), yMax: Math.max(a.y, b.y) };
  };
  const world180 = (v: View): View => ({ xMin: Math.max(-180, v.xMin), xMax: Math.min(180, v.xMax), yMin: v.yMin, yMax: v.yMax });

  const drawGrid = () => {
    frame = 0;
    if (!g2) return;
    if (!grid?.show || !sized()) {
      canvas.style.display = "none";
      return;
    }
    const size = map.getSize();
    const padX = Math.round(size.x * GRID_PAD);
    const padY = Math.round(size.y * GRID_PAD);
    const w = size.x + 2 * padX;
    const h = size.y + 2 * padY;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    // the canvas sits in the map's own pane, so it moves with the map; put its corner at the view's corner minus the padding
    const origin = map.containerPointToLayerPoint(L.point(-padX, -padY));
    L.DomUtil.setPosition(canvas, origin);
    canvas.style.display = "";
    canvas.style.opacity = "1";
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, w, h);

    const v = view({ x: -padX, y: -padY }, { x: size.x + padX, y: size.y + padY });
    const target = Math.max(3, Math.min(14, Math.round(size.x / 110)));
    const lines: GridLine[] = coords ? gridLines(coords, v, grid, target) : graticule(world180(v), grid, target);
    const lim = coords ?? { xMin: -180, xMax: 180, yMin: -85, yMax: 85 };
    const at = (x: number, y: number) => {
      const c = map.latLngToContainerPoint(toLL(x, y));
      return { x: c.x + padX, y: c.y + padY };
    };
    g2.strokeStyle = grid.color;
    for (const major of [false, true]) {
      g2.globalAlpha = grid.opacity * (major ? 1 : 0.6);
      g2.lineWidth = major ? 1 : 0.5;
      g2.beginPath();
      for (const l of lines) {
        if (l.major !== major) continue;
        const [p, q] = l.axis === "v" ? [at(l.value, lim.yMin), at(l.value, lim.yMax)] : [at(lim.xMin, l.value), at(lim.xMax, l.value)];
        // half a pixel keeps one-pixel lines crisp
        g2.moveTo(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5);
        g2.lineTo(Math.round(q.x) + 0.5, Math.round(q.y) + 0.5);
      }
      g2.stroke();
    }
    if (grid.labels) {
      g2.globalAlpha = 0.9;
      g2.font = "10px sans-serif";
      g2.textBaseline = "top";
      g2.fillStyle = grid.color;
      g2.lineWidth = 2.5;
      g2.lineJoin = "round";
      // a halo in the map's own colour keeps the numbers readable over lines and pictures without a heavy outline
      g2.strokeStyle = spec.kind === "flat" ? spec.map.background : pal.ocean;
      for (const l of lines) {
        if (!l.label) continue;
        const p = l.axis === "v" ? at(l.value, lim.yMin) : at(lim.xMin, l.value);
        // vertical lines are labelled along the top of what is on screen, horizontal ones along the left
        const x = l.axis === "v" ? p.x + 3 : padX + 4;
        const y = l.axis === "v" ? padY + 3 : p.y - 12;
        if (x < padX - 40 || x > padX + size.x || y < padY - 12 || y > padY + size.y) continue;
        g2.strokeText(l.label, x, y);
        g2.fillText(l.label, x, y);
      }
    }
    g2.globalAlpha = 1;
  };
  const scheduleGrid = (delay = 110) => {
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      if (!frame) frame = requestAnimationFrame(drawGrid);
    }, delay);
  };
  // while zooming the old grid would be the wrong size: hide it, and draw the new one when everything has settled
  map.on("zoomstart", () => {
    window.clearTimeout(settle);
    canvas.style.opacity = "0";
  });
  map.on("zoomend moveend resize", () => scheduleGrid());
  const paintGrid = () => scheduleGrid(0);

  // ---- pointer and picking
  map.on("mousemove", (e: L.LeafletMouseEvent) => handlers.pointer?.(fromLL(e.latlng)));
  el.addEventListener("mouseleave", () => handlers.pointer?.(null));
  map.on("contextmenu", (e: L.LeafletMouseEvent) => {
    if (picking) return;
    L.DomEvent.preventDefault(e.originalEvent);
    const p = fromLL(e.latlng);
    handlers.mapMenu?.({ x: round(p.x, pickDecimals), y: round(p.y, pickDecimals) }, e.originalEvent.clientX, e.originalEvent.clientY);
  });
  map.on("dragstart zoomstart", () => handlers.moving?.());
  map.on("moveend zoomend", () => handlers.settled?.());
  map.on("click", (e: L.LeafletMouseEvent) => {
    if (!picking) {
      handlers.blank?.();
      return;
    }
    const p = fromLL(e.latlng);
    handlers.pick?.({ x: round(p.x, pickDecimals), y: round(p.y, pickDecimals) });
  });

  const doFit = (pins: MapPin[], animate: boolean) => {
    if (!sized()) {
      pendingFit = { pins, animate };
      return;
    }
    limitZoom();
    const pts = pins.map((p) => ({ x: p.x, y: p.y }));
    const tl = L.point(inset.left + 30, inset.top + 30);
    const br = L.point(inset.right + 30, inset.bottom + 30);
    if (!pts.length) {
      if (mapBounds) map.fitBounds(mapBounds, { paddingTopLeft: tl, paddingBottomRight: br, animate });
      else map.setView([25, 10], 1.5, { animate });
      return;
    }
    // one pin, or several on exactly the same spot: centre on it (a box with no size has no zoom to fit)
    if (pts.every((q) => q.x === pts[0].x && q.y === pts[0].y)) {
      const ll = toLL(pts[0].x, pts[0].y);
      return void map.fitBounds(L.latLngBounds(ll, ll), { paddingTopLeft: tl, paddingBottomRight: br, animate, maxZoom: flat ? fitZoom() + 2 : 5 });
    }
    if (flat) {
      const b = boundsXY(pts)!;
      map.fitBounds(L.latLngBounds(toLL(b.xMin, b.yMin), toLL(b.xMax, b.yMax)), { paddingTopLeft: tl.add([40, 40]), paddingBottomRight: br.add([40, 40]), animate, maxZoom: fitZoom() + 4 });
    } else {
      const b = boundsOf(pts.map((p) => ({ lat: p.y, lng: p.x })))!;
      map.fitBounds(L.latLngBounds([b.south, b.west], [b.north, b.east]), { paddingTopLeft: tl.add([40, 40]), paddingBottomRight: br.add([40, 40]), animate, maxZoom: 8 });
    }
  };

  return {
    setPins(pins, colorOf) {
      lastPins = pins;
      lastColor = colorOf;
      pinLayer.clearLayers();
      for (const p of pins) {
        if (editing && editing.pin.id === p.id) continue;
        if (p.members) {
          // several pins close together: one grey badge with their number
          const badge = document.createElement("div");
          badge.className = "bm-group" + (p.members.length > 99 ? " is-wide" : "");
          badge.textContent = String(p.members.length);
          const g = L.marker(toLL(p.x, p.y), { keyboard: false, icon: L.divIcon({ className: "bm-group-holder", html: badge, iconSize: [0, 0] }) });
          g.on("click", (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e);
            if (picking) return;
            handlers.click(p);
          });
          g.on("dblclick", (e: L.LeafletMouseEvent) => L.DomEvent.stop(e));
          g.on("contextmenu", (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e));
          g.on("mouseover", (e: L.LeafletMouseEvent) => handlers.hover(p, e.containerPoint.x, e.containerPoint.y));
          g.on("mouseout", () => handlers.hover(null, 0, 0));
          g.addTo(pinLayer);
          continue;
        }
        const m = L.circleMarker(toLL(p.x, p.y), { radius: 7, fillColor: colorOf(p), fillOpacity: 0.95, color: "#ffffff", weight: 1.5, bubblingMouseEvents: false });
        m.on("dblclick", (e: L.LeafletMouseEvent) => {
          L.DomEvent.stop(e);
          if (!picking) handlers.open?.(p);
        });
        m.on("contextmenu", (e: L.LeafletMouseEvent) => {
          L.DomEvent.preventDefault(e.originalEvent);
          L.DomEvent.stopPropagation(e);
          if (!picking) handlers.menu?.(p, e.originalEvent.clientX, e.originalEvent.clientY);
        });
        m.on("mouseover", (e: L.LeafletMouseEvent) => handlers.hover(p, e.containerPoint.x, e.containerPoint.y));
        m.on("mouseout", () => handlers.hover(null, 0, 0));
        m.on("click", (e: L.LeafletMouseEvent) => {
          if (picking) {
            const q = fromLL(e.latlng);
            handlers.pick?.({ x: round(q.x, pickDecimals), y: round(q.y, pickDecimals) });
            return;
          }
          // pins on top of each other fan out instead of the top one hiding the rest
          const screen = (q: MapPin) => map.latLngToContainerPoint(toLL(q.x, q.y));
          const stack = stackAround(p, lastPins.filter((q) => !q.members), screen, 9);
          if (stack.length > 1) {
            const c = screen(p);
            handlers.stack?.(stack, c.x, c.y);
          } else handlers.click(p);
        });
        m.addTo(pinLayer);
      }
      if (selected) this.select(lastPins.some((x) => x.id === selected) ? selected : null);
    },
    fit(pins, animate = true) {
      doFit(pins ?? lastPins, animate);
    },
    flyTo(pin) {
      map.setView(toLL(pin.x, pin.y), Math.max(map.getZoom(), flat ? fitZoom() + 2 : 5), { animate: true });
    },
    setPalette(p) {
      pal = p;
      if (flat) return;
      el.style.background = pal.ocean;
      for (const w of worldLayers) w.layer.setStyle(w.style(pal));
    },
    setGrid(g) {
      grid = g;
      paintGrid();
    },
    toScreen(x, y) {
      const c = map.latLngToContainerPoint(toLL(x, y));
      return { x: c.x, y: c.y };
    },
    setInset(i) {
      inset = i;
    },
    select(id) {
      selected = id;
      selLayer.clearLayers();
      const p = id ? lastPins.flatMap((x) => [x, ...(x.members ?? [])]).find((x) => x.id === id) : undefined;
      if (p) L.circleMarker(toLL(p.x, p.y), { radius: 12, fill: false, color: "#8b7cff", weight: 3, interactive: false }).addTo(selLayer);
    },
    zoomBy(levels) {
      map.setZoom(map.getZoom() + levels);
    },
    setPick(on) {
      picking = on;
      el.toggleClass("booker-map-picking", on);
    },
    beginEdit(pin, color) {
      if (editing) return;
      const look = createEditPin(color);
      const marker = L.marker(toLL(pin.x, pin.y), { draggable: true, autoPan: true, keyboard: false, zIndexOffset: 5000, icon: L.divIcon({ className: "booker-pin-holder", html: look.el, iconSize: [0, 0] }) });
      let last = map.latLngToContainerPoint(marker.getLatLng());
      marker.on("drag", () => {
        const now = map.latLngToContainerPoint(marker.getLatLng());
        look.kick(now.x - last.x, now.y - last.y);
        last = now;
        const q = fromLL(marker.getLatLng());
        handlers.moved?.(pin, { x: round(q.x, pickDecimals), y: round(q.y, pickDecimals) });
      });
      marker.on("dragend", () => {
        const q = fromLL(marker.getLatLng());
        handlers.moved?.(pin, { x: round(q.x, pickDecimals), y: round(q.y, pickDecimals) });
      });
      marker.on("dblclick", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e);
        handlers.edit?.(pin);
      });
      marker.on("contextmenu", (e: L.LeafletMouseEvent) => {
        L.DomEvent.preventDefault(e.originalEvent);
        L.DomEvent.stopPropagation(e);
        handlers.menu?.(pin, e.originalEvent.clientX, e.originalEvent.clientY);
      });
      marker.addTo(map);
      editing = { pin, marker, look };
      // hide its dot while the draggable one is up
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
      map.invalidateSize();
      limitZoom();
      if (pendingFit && sized()) {
        const f = pendingFit;
        pendingFit = null;
        doFit(f.pins, false);
      }
      paintGrid();
    },
    destroy() {
      window.clearTimeout(settle);
      if (frame) cancelAnimationFrame(frame);
      // a zoom still animating when the map goes would touch panes that are gone
      try {
        map.stop();
      } catch {
        /* already stopped */
      }
      map.remove();
      teardown();
    },
  };
}
