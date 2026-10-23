import type { Coordinate, GeoBounds, GeoShape } from "./types";
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export class MercatorProjector {
  scale: number;
  padX: number;
  padY: number;
  northMerc: number;
  constructor(public width: number, public height: number, public bounds: GeoBounds) {
    this.width = width;
    this.height = height;
    this.bounds = bounds;
    const spanLng = bounds.east - bounds.west;
    const spanLat = (this._latToMerc(bounds.north) - this._latToMerc(bounds.south)) * RAD_TO_DEG;
    this.scale = Math.min(width / spanLng, height / spanLat);
    this.padX = (width - spanLng * this.scale) * 0.5;
    this.padY = (height - spanLat * this.scale) * 0.5;
    this.northMerc = this._latToMerc(bounds.north);
  }

  _latToMerc(lat: number) {
    return Math.log(Math.tan(Math.PI * 0.25 + (lat * DEG_TO_RAD) * 0.5));
  }

  toScreen(lng: number, lat: number): Coordinate {
    const x = (lng - this.bounds.west) * this.scale + this.padX;
    const y = (this.northMerc - this._latToMerc(lat)) * RAD_TO_DEG * this.scale + this.padY;
    return [x, y];
  }

  toGeo(x: number, y: number): Coordinate {
    const lng = (x - this.padX) / this.scale + this.bounds.west;
    const merc = this.northMerc - (y - this.padY) / (this.scale * RAD_TO_DEG);
    const lat = (2 * Math.atan(Math.exp(merc)) - Math.PI * 0.5) * RAD_TO_DEG;
    return [lng, lat];
  }

  greatCircleKm(coordA: Coordinate, coordB: Coordinate) {
    const dLat = (coordB[1] - coordA[1]) * DEG_TO_RAD;
    const dLng = (coordB[0] - coordA[0]) * DEG_TO_RAD;
    const a =
      Math.sin(dLat * 0.5) ** 2 +
      Math.cos(coordA[1] * DEG_TO_RAD) *
        Math.cos(coordB[1] * DEG_TO_RAD) *
        Math.sin(dLng * 0.5) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  }

  ringToSvgPath(ring: Coordinate[]) {
    let out = '';
    for (let i = 0; i < ring.length; i++) {
      const [px, py] = this.toScreen(ring[i][0], ring[i][1]);
      out += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1);
    }
    return out ? out + 'Z' : '';
  }

  smoothRingToSvgPath(ring: Coordinate[]) {
    if (!ring || ring.length < 3) return '';
    let n = ring.length;
    if (
      n > 3 &&
      Math.abs(ring[0][0] - ring[n - 1][0]) < 1e-6 &&
      Math.abs(ring[0][1] - ring[n - 1][1]) < 1e-6
    ) {
      n--;
    }
    if (n < 3) return this.ringToSvgPath(ring);

    const pts = new Array(n);
    for (let i = 0; i < n; i++) {
      pts[i] = this.toScreen(ring[i][0], ring[i][1]);
    }

    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    const ex = new Float64Array(n);
    const ey = new Float64Array(n);
    const curved = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const len = Math.hypot(dx, dy);
      if (len >= 1.6) {
        const t = Math.min(0.28, 4.2 / len);
        sx[i] = p0[0] + dx * t;
        sy[i] = p0[1] + dy * t;
        ex[i] = p1[0] - dx * t;
        ey[i] = p1[1] - dy * t;
        curved[i] = 1;
      } else {
        sx[i] = p0[0];
        sy[i] = p0[1];
        ex[i] = p1[0];
        ey[i] = p1[1];
      }
    }

    let out = `M${sx[0].toFixed(1)} ${sy[0].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      if (curved[i]) {
        out += `L${ex[i].toFixed(1)} ${ey[i].toFixed(1)}`;
      }
      const vx = pts[next][0];
      const vy = pts[next][1];
      if (curved[i] && curved[next]) {
        out += `Q${vx.toFixed(1)} ${vy.toFixed(1)} ${sx[next].toFixed(1)} ${sy[next].toFixed(1)}`;
      } else {
        out += `L${sx[next].toFixed(1)} ${sy[next].toFixed(1)}`;
      }
    }
    return out + 'Z';
  }

  _orientRing(ring: Coordinate[], isHole = false) {
    if (!ring || ring.length < 3) return ring;
    let area2 = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area2 += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    if (area2 === 0) return ring;
    const wantPositive = !isHole;
    if ((area2 > 0) !== wantPositive) {
      return ring.slice().reverse();
    }
    return ring;
  }

  multiRingsToSvgPath(polygons: Coordinate[][][]) {
    return polygons
      .map((poly) =>
        poly.map((r, idx) => this.ringToSvgPath(this._orientRing(r, idx > 0))).join('')
      )
      .join('');
  }

  shapeToPath(shapeObj: GeoShape | null, smooth = true) {
    if (!shapeObj) return '';
    const cacheKey = smooth ? '_smoothPathCommands' : '_pathCommands';
    if (shapeObj[cacheKey] !== undefined) return shapeObj[cacheKey];
    const fn = (r: Coordinate[], idx: number) => {
      const oriented = this._orientRing(r, idx > 0);
      return smooth ? this.smoothRingToSvgPath(oriented) : this.ringToSvgPath(oriented);
    };
    let d = '';
    if (shapeObj.type === 'Polygon') {
      d = shapeObj.coordinates.map((r, idx) => fn(r, idx)).join('');
    } else if (shapeObj.type === 'MultiPolygon') {
      d = shapeObj.coordinates.map((poly) => poly.map((r, idx) => fn(r, idx)).join('')).join('');
    }
    Object.defineProperty(shapeObj, cacheKey, {
      value: d,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    return d;
  }

  static pointInRing(lng: number, lat: number, ring: Coordinate[]) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  static pointInPolygonRings(lng: number, lat: number, rings: Coordinate[][]) {
    if (!rings || !rings.length || !MercatorProjector.pointInRing(lng, lat, rings[0])) {
      return false;
    }
    for (let k = 1; k < rings.length; k++) {
      if (MercatorProjector.pointInRing(lng, lat, rings[k])) return false;
    }
    return true;
  }

  static pointInShape(lng: number, lat: number, shapeObj: GeoShape | null) {
    if (!shapeObj) return false;
    if (shapeObj.type === 'Polygon') {
      return MercatorProjector.pointInPolygonRings(lng, lat, shapeObj.coordinates);
    }
    if (shapeObj.type === 'MultiPolygon') {
      return shapeObj.coordinates.some((p) =>
        MercatorProjector.pointInPolygonRings(lng, lat, p)
      );
    }
    return false;
  }
}
