/**
 * SWG Terrain Service
 * 
 * Comprehensive terrain system implementation for Star Wars Galaxies
 * 
 * Features:
 *   - Full terrain file (.trn) parsing with all layer types
 *   - Baked terrain height map loading (1:1 accuracy)
 *   - Environment system (lighting, fog, skybox, weather)
 *   - Shader/texture per-tile system with blending
 *   - Flora rendering via appearance files
 *   - Music/ambient sound from environment datatables
 *   - Buildout and player building support
 * 
 * Based on:
 *   - TerrainGenerator.cpp
 *   - ProceduralTerrainAppearance.cpp
 *   - BakedTerrain.cpp
 *   - EnvironmentBlock.cpp
 *   - ShaderGroup.cpp
 *   - FloraGroup.cpp
 *   - GameMusicManager.cpp
 * 
 * Terrain File Structure:
 *   PTAT (Procedural Terrain Appearance Template)
 *     DATA (map dimensions, water height, flora distances)
 *     TGEN (Terrain Generator)
 *       SGRP (Shader Group - terrain textures)
 *       FGRP (Flora Group - static vegetation)
 *       RGRP (Radial Group - dynamic vegetation)
 *       EGRP (Environment Group - lighting/weather)
 *       MGRP (Fractal Group - procedural noise)
 *       BGRP (Bitmap Group - height/texture maps)
 *       LYRS (Layers)
 *         LAYR (Layer with boundaries, filters, affectors)
 */

import fs from 'fs';
import path from 'path';

// ======================================================================
// IFF Reader (inline for standalone use)
// ======================================================================

class IFFReader {
    constructor(buffer) {
        if (buffer instanceof Buffer) {
            this.buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        } else {
            this.buffer = buffer;
        }
        this.view = new DataView(this.buffer);
        this.data = new Uint8Array(this.buffer);
        this.offset = 0;
        this.formStack = [];
    }

    readTag() {
        const tag = String.fromCharCode(
            this.view.getUint8(this.offset),
            this.view.getUint8(this.offset + 1),
            this.view.getUint8(this.offset + 2),
            this.view.getUint8(this.offset + 3)
        );
        this.offset += 4;
        return tag;
    }

    peekTag() {
        return String.fromCharCode(
            this.view.getUint8(this.offset),
            this.view.getUint8(this.offset + 1),
            this.view.getUint8(this.offset + 2),
            this.view.getUint8(this.offset + 3)
        );
    }

    readUint32BE() {
        const value = this.view.getUint32(this.offset, false);
        this.offset += 4;
        return value;
    }

    readInt32() {
        const value = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readUint32() {
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readInt16() {
        const value = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return value;
    }

    readUint16() {
        const value = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return value;
    }

    readUint8() {
        return this.view.getUint8(this.offset++);
    }

    readFloat() {
        const value = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readVector3() {
        return {
            x: this.readFloat(),
            y: this.readFloat(),
            z: this.readFloat(),
        };
    }

    readString(length) {
        let str = '';
        const end = this.offset + length;
        while (this.offset < end) {
            const char = this.view.getUint8(this.offset++);
            if (char === 0) {
                this.offset = end;
                break;
            }
            str += String.fromCharCode(char);
        }
        return str;
    }

    readNullTerminatedString() {
        let str = '';
        while (this.offset < this.buffer.byteLength) {
            const char = this.view.getUint8(this.offset++);
            if (char === 0) break;
            str += String.fromCharCode(char);
        }
        return str;
    }

    enterForm(expectedTag = null) {
        const formTag = this.readTag();
        if (formTag !== 'FORM') {
            throw new Error(`Expected FORM, got ${formTag}`);
        }
        const size = this.readUint32BE();
        const formStartOffset = this.offset;
        const tag = this.readTag();

        const form = { formTag, tag, size, endOffset: formStartOffset + size };
        this.formStack.push(form);

        if (expectedTag && tag !== expectedTag) {
            console.warn(`Expected form tag ${expectedTag}, got ${tag}`);
        }

        return tag;
    }

    exitForm() {
        if (this.formStack.length > 0) {
            const form = this.formStack.pop();
            this.offset = form.endOffset;
        }
    }

    enterChunk(expectedTag = null) {
        const tag = this.readTag();
        const size = this.readUint32BE();
        const chunk = { tag, size, startOffset: this.offset, endOffset: this.offset + size };

        if (expectedTag && tag !== expectedTag) {
            console.warn(`Expected chunk tag ${expectedTag}, got ${tag}`);
        }

        return chunk;
    }

    exitChunk(chunk) {
        this.offset = chunk.endOffset;
    }

    skipChunk() {
        const tag = this.readTag();
        const size = this.readUint32BE();
        this.offset += size;
        return tag;
    }

    hasMore() {
        if (this.formStack.length === 0) return this.offset < this.buffer.byteLength;
        const currentForm = this.formStack[this.formStack.length - 1];
        return this.offset < currentForm.endOffset;
    }

    getChunkLengthLeft(chunk) {
        return chunk.endOffset - this.offset;
    }
}

export { IFFReader };

// ======================================================================
// MultiFractal Noise Generator (1:1 C++ Implementation)
// Based on MultiFractal.cpp - Perlin noise with multi-octave support
// ======================================================================

const B = 256;
const BM = 255;
const N = 4096;

/**
 * Perlin Noise Generator - exact C++ implementation
 * Based on MultiFractal::NoiseGenerator
 */
class NoiseGenerator {
    constructor(seed = 0) {
        this.p = new Int32Array(B + B + 2);
        this.g1 = new Float32Array(B + B + 2);
        this.g2 = new Array(B + B + 2);
        for (let i = 0; i < B + B + 2; i++) {
            this.g2[i] = new Float32Array(2);
        }
        this.init(seed);
    }

    // Simple random number generator matching C++ implementation
    random(seed) {
        // Use same RNG as SWG
        seed = (seed * 1103515245 + 12345) >>> 0;
        return seed;
    }

    init(seed) {
        let currentSeed = seed >>> 0;
        
        const nextRandom = () => {
            currentSeed = this.random(currentSeed);
            return currentSeed;
        };

        // Initialize permutation and gradient tables
        for (let i = 0; i < B; i++) {
            this.p[i] = i;
            this.g1[i] = ((nextRandom() % (B + B)) - B) / B;

            for (let j = 0; j < 2; j++) {
                this.g2[i][j] = ((nextRandom() % (B + B)) - B) / B;
            }
            this.normalize2(this.g2[i]);
        }

        // Shuffle permutation
        for (let i = B - 1; i > 0; i--) {
            const j = nextRandom() % B;
            const k = this.p[i];
            this.p[i] = this.p[j];
            this.p[j] = k;
        }

        // Extend tables
        for (let i = 0; i < B + 2; i++) {
            this.p[B + i] = this.p[i];
            this.g1[B + i] = this.g1[i];
            for (let j = 0; j < 2; j++) {
                this.g2[B + i][j] = this.g2[i][j];
            }
        }
    }

    normalize2(v) {
        const s = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
        if (s > 0) {
            v[0] /= s;
            v[1] /= s;
        }
    }

    // S-curve for smooth interpolation
    scurve(t) {
        return (3.0 - 2.0 * t) * t * t;
    }

    // Linear interpolation
    lerp(t, a, b) {
        return a + t * (b - a);
    }

    // 2D Perlin noise - exact C++ implementation
    getValue(x, y) {
        // Setup for x
        let t = x + N;
        let it = Math.floor(t);
        const bx0 = it & BM;
        const bx1 = (bx0 + 1) & BM;
        const rx0 = t - it;
        const rx1 = rx0 - 1;

        // Setup for y
        t = y + N;
        it = Math.floor(t);
        const by0 = it & BM;
        const by1 = (by0 + 1) & BM;
        const ry0 = t - it;
        const ry1 = ry0 - 1;

        const sx = this.scurve(rx0);
        const sy = this.scurve(ry0);

        const b00 = this.p[this.p[bx0] + by0];
        const b01 = this.p[this.p[bx0] + by1];
        const b10 = this.p[this.p[bx1] + by0];
        const b11 = this.p[this.p[bx1] + by1];

        // Dot products
        let u = rx0 * this.g2[b00][0] + ry0 * this.g2[b00][1];
        let v = rx1 * this.g2[b10][0] + ry0 * this.g2[b10][1];
        const a = this.lerp(sx, u, v);

        u = rx0 * this.g2[b01][0] + ry1 * this.g2[b01][1];
        v = rx1 * this.g2[b11][0] + ry1 * this.g2[b11][1];
        const b = this.lerp(sx, u, v);

        return this.lerp(sy, a, b);
    }
}

/**
 * MultiFractal - exact C++ implementation
 * Combines multiple octaves of noise with configurable combination rules
 */
class MultiFractal {
    static CR_add = 0;
    static CR_crest = 1;
    static CR_turbulence = 2;
    static CR_crestClamp = 3;
    static CR_turbulenceClamp = 4;

    constructor() {
        this.seed = 0;
        this.scaleX = 0.01;
        this.scaleY = 0.01;
        this.offsetX = 0;
        this.offsetY = 0;
        this.numberOfOctaves = 2;
        this.frequency = 4.0;
        this.amplitude = 0.5;
        this.ooTotalAmplitude = 1;
        this.useBias = false;
        this.bias = 0.5;
        this.useGain = false;
        this.gain = 0.7;
        this.useSin = false;
        this.combinationRule = MultiFractal.CR_add;
        this.noiseGenerator = new NoiseGenerator(0);
        this.initTotalAmplitude();
    }

    setSeed(seed) {
        this.seed = seed >>> 0;
        this.noiseGenerator.init(this.seed);
    }

    setScale(scaleX, scaleY) {
        this.scaleX = scaleX;
        this.scaleY = scaleY;
    }

    setOffset(offsetX, offsetY) {
        this.offsetX = offsetX;
        this.offsetY = offsetY;
    }

    setNumberOfOctaves(n) {
        this.numberOfOctaves = n;
        this.initTotalAmplitude();
    }

    setFrequency(f) {
        this.frequency = f;
    }

    setAmplitude(a) {
        this.amplitude = a;
        this.initTotalAmplitude();
    }

    setBias(useBias, bias) {
        this.useBias = useBias;
        this.bias = bias;
    }

    setGain(useGain, gain) {
        this.useGain = useGain;
        this.gain = gain;
    }

    setCombinationRule(rule) {
        this.combinationRule = rule;
    }

    initTotalAmplitude() {
        this.ooTotalAmplitude = 0;
        let amplitude = 1.0;
        for (let i = 0; i < this.numberOfOctaves; i++) {
            this.ooTotalAmplitude += amplitude;
            amplitude *= this.amplitude;
        }
        this.ooTotalAmplitude = 1.0 / this.ooTotalAmplitude;
    }

    // Bias function: bias(b, 0)=0, bias(b, 0.5)=b, bias(b, 1)=1
    static ngBias(a, b) {
        return Math.pow(a, Math.log(b) / Math.log(0.5));
    }

    // Gain function
    static ngGain(a, b) {
        if (a < 0.001) return 0;
        if (a > 0.999) return 1;
        const p = Math.log(1 - b) / Math.log(0.5);
        if (a < 0.5) {
            return Math.pow(2 * a, p) * 0.5;
        }
        return 1 - Math.pow(2 * (1 - a), p) * 0.5;
    }

    getValue(worldX, worldZ) {
        const x = (worldX + this.offsetX) * this.scaleX;
        const y = (worldZ + this.offsetY) * this.scaleY;

        let sum = 0;
        let frequency = 1.0;
        let amplitude = 1.0;

        switch (this.combinationRule) {
            case MultiFractal.CR_add:
                for (let i = 0; i < this.numberOfOctaves; i++) {
                    sum += amplitude * this.noiseGenerator.getValue(x * frequency, y * frequency);
                    frequency *= this.frequency;
                    amplitude *= this.amplitude;
                }
                if (this.useSin) sum = Math.sin(x + sum);
                sum = (sum * this.ooTotalAmplitude + 1.0) * 0.5;
                break;

            case MultiFractal.CR_crest:
                for (let i = 0; i < this.numberOfOctaves; i++) {
                    sum += amplitude * (1.0 - Math.abs(this.noiseGenerator.getValue(x * frequency, y * frequency)));
                    frequency *= this.frequency;
                    amplitude *= this.amplitude;
                }
                if (this.useSin) sum = Math.sin(x + sum);
                sum = sum * this.ooTotalAmplitude;
                break;

            case MultiFractal.CR_turbulence:
                for (let i = 0; i < this.numberOfOctaves; i++) {
                    sum += amplitude * Math.abs(this.noiseGenerator.getValue(x * frequency, y * frequency));
                    frequency *= this.frequency;
                    amplitude *= this.amplitude;
                }
                if (this.useSin) sum = Math.sin(x + sum);
                sum = sum * this.ooTotalAmplitude;
                break;

            case MultiFractal.CR_crestClamp:
                for (let i = 0; i < this.numberOfOctaves; i++) {
                    const noise = this.noiseGenerator.getValue(x * frequency, y * frequency);
                    sum += amplitude * (1.0 - Math.max(0, Math.min(1, noise)));
                    frequency *= this.frequency;
                    amplitude *= this.amplitude;
                }
                if (this.useSin) sum = Math.sin(x + sum);
                sum = sum * this.ooTotalAmplitude;
                break;

            case MultiFractal.CR_turbulenceClamp:
                for (let i = 0; i < this.numberOfOctaves; i++) {
                    const noise = this.noiseGenerator.getValue(x * frequency, y * frequency);
                    sum += amplitude * Math.max(0, Math.min(1, Math.abs(noise)));
                    frequency *= this.frequency;
                    amplitude *= this.amplitude;
                }
                if (this.useSin) sum = Math.sin(x + sum);
                sum = sum * this.ooTotalAmplitude;
                break;
        }

        // Apply bias and gain post-processing
        if (this.useBias) {
            sum = MultiFractal.ngBias(sum, this.bias);
        }
        if (this.useGain) {
            sum = MultiFractal.ngGain(sum, this.gain);
        }

        return Math.max(0, Math.min(1, sum));
    }
}

// ======================================================================
// Feather Functions (1:1 C++ Implementation)
// Based on Feather.cpp
// ======================================================================

/**
 * Feather class for smooth blending
 * Matches C++ Feather implementation
 */
class Feather {
    static TGFF_linear = 0;
    static TGFF_easeIn = 1;
    static TGFF_easeOut = 2;
    static TGFF_easeInOut = 3;

    constructor(featherFunction = Feather.TGFF_linear) {
        this.featherFunction = featherFunction;
    }

    feather(low, high, amount) {
        if (amount <= low) return 0;
        if (amount >= high) return 1;

        const t = (amount - low) / (high - low);

        switch (this.featherFunction) {
            case Feather.TGFF_linear:
                return t;
            case Feather.TGFF_easeIn:
                return t * t;
            case Feather.TGFF_easeOut:
                return 1 - (1 - t) * (1 - t);
            case Feather.TGFF_easeInOut:
                return t * t * (3 - 2 * t);
            default:
                return t;
        }
    }
}

// ======================================================================
// Boundary Classes (1:1 C++ Implementation)
// Based on Boundary.cpp
// ======================================================================

/**
 * Base Boundary class
 */
class Boundary {
    constructor(type) {
        this.type = type;
        this.active = true;
        this.name = '';
        this.featherFunction = Feather.TGFF_linear;
        this.featherDistance = 0;
    }

    setFeatherFunction(func) {
        this.featherFunction = func;
    }

    setFeatherDistance(dist) {
        this.featherDistance = Math.max(0, Math.min(1, dist));
    }

    getFeatherDistance() {
        return this.featherDistance;
    }

    isWithin(worldX, worldZ) {
        return 0;
    }
}

/**
 * Circle Boundary - exact C++ implementation
 */
class BoundaryCircle extends Boundary {
    constructor() {
        super('BCIR');
        this.centerX = 0;
        this.centerZ = 0;
        this.radius = 0;
        this.radiusSquared = 0;
    }

    setCircle(centerX, centerZ, radius) {
        this.centerX = centerX;
        this.centerZ = centerZ;
        this.radius = Math.abs(radius);
        this.radiusSquared = this.radius * this.radius;
    }

    isWithin(worldX, worldZ) {
        const distanceSquared = 
            (this.centerX - worldX) * (this.centerX - worldX) + 
            (this.centerZ - worldZ) * (this.centerZ - worldZ);

        if (distanceSquared > this.radiusSquared) {
            return 0;
        }

        // Calculate feathering
        const innerRadius = this.radius * (1 - this.getFeatherDistance());
        const innerRadiusSquared = innerRadius * innerRadius;

        if (distanceSquared <= innerRadiusSquared) {
            return 1;
        }

        return 1 - (distanceSquared - innerRadiusSquared) / (this.radiusSquared - innerRadiusSquared);
    }
}

/**
 * Rectangle Boundary - exact C++ implementation
 */
class BoundaryRectangle extends Boundary {
    constructor() {
        super('BREC');
        this.x0 = 0;
        this.y0 = 0; // z0 in world coords
        this.x1 = 0;
        this.y1 = 0; // z1 in world coords
        this.innerX0 = 0;
        this.innerY0 = 0;
        this.innerX1 = 0;
        this.innerY1 = 0;
        this.useTransform = false;
        this.transform = null; // 2D rotation/translation
        this.localWaterTable = false;
        this.localWaterTableHeight = 0;
        this.waterType = 0;
    }

    setRectangle(x0, y0, x1, y1) {
        this.x0 = Math.min(x0, x1);
        this.y0 = Math.min(y0, y1);
        this.x1 = Math.max(x0, x1);
        this.y1 = Math.max(y0, y1);
        this.recalculate();
    }

    recalculate() {
        const width = this.x1 - this.x0;
        const height = this.y1 - this.y0;
        const feather = 0.5 * Math.min(width, height) * this.getFeatherDistance();

        this.innerX0 = this.x0 + feather;
        this.innerY0 = this.y0 + feather;
        this.innerX1 = this.x1 - feather;
        this.innerY1 = this.y1 - feather;
    }

    setFeatherDistance(dist) {
        super.setFeatherDistance(dist);
        this.recalculate();
    }

    isWithin(worldX, worldZ) {
        let x = worldX;
        let z = worldZ;

        // Apply inverse transform if needed
        if (this.useTransform && this.transform) {
            // Transform point from world to local space
            const cos = Math.cos(-this.transform.rotation);
            const sin = Math.sin(-this.transform.rotation);
            const dx = worldX - this.transform.translateX;
            const dz = worldZ - this.transform.translateZ;
            x = dx * cos - dz * sin;
            z = dx * sin + dz * cos;
        }

        // Test outside
        if (x < this.x0 || x > this.x1 || z < this.y0 || z > this.y1) {
            return 0;
        }

        // No feathering needed
        if (this.getFeatherDistance() === 0) {
            return 1;
        }

        // Test inside inner rectangle
        if (x >= this.innerX0 && x <= this.innerX1 && z >= this.innerY0 && z <= this.innerY1) {
            return 1;
        }

        // Calculate feathered amount
        const left = x - this.x0;
        const right = this.x1 - x;
        const top = z - this.y0;
        const bottom = this.y1 - z;

        const width = this.x1 - this.x0;
        const height = this.y1 - this.y0;
        const feather = 0.5 * Math.min(width, height) * this.getFeatherDistance();

        let distance = feather;
        if (left < distance) distance = left;
        if (right < distance) distance = right;
        if (top < distance) distance = top;
        if (bottom < distance) distance = bottom;

        return distance / feather;
    }
}

/**
 * Polygon Boundary - exact C++ implementation
 */
class BoundaryPolygon extends Boundary {
    constructor() {
        super('BPOL');
        this.points = []; // Array of {x, z}
        this.extent = { x0: 0, y0: 0, x1: 0, y1: 0 };
    }

    setPoints(points) {
        this.points = points.slice();
        this.recalculateExtent();
    }

    recalculateExtent() {
        if (this.points.length === 0) return;

        this.extent.x0 = this.extent.x1 = this.points[0].x;
        this.extent.y0 = this.extent.y1 = this.points[0].z;

        for (let i = 1; i < this.points.length; i++) {
            this.extent.x0 = Math.min(this.extent.x0, this.points[i].x);
            this.extent.x1 = Math.max(this.extent.x1, this.points[i].x);
            this.extent.y0 = Math.min(this.extent.y0, this.points[i].z);
            this.extent.y1 = Math.max(this.extent.y1, this.points[i].z);
        }
    }

    isWithin(worldX, worldZ) {
        if (this.points.length < 3) return 0;

        // Quick extent test
        if (worldX < this.extent.x0 || worldX > this.extent.x1 ||
            worldZ < this.extent.y0 || worldZ > this.extent.y1) {
            return 0;
        }

        // Point in polygon test (ray casting)
        let inside = false;
        for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
            const xi = this.points[i].x, zi = this.points[i].z;
            const xj = this.points[j].x, zj = this.points[j].z;

            if (((zi > worldZ) !== (zj > worldZ)) &&
                (worldX < (xj - xi) * (worldZ - zi) / (zj - zi) + xi)) {
                inside = !inside;
            }
        }

        if (!inside) return 0;

        // Calculate distance to nearest edge for feathering
        if (this.getFeatherDistance() === 0) return 1;

        let minDist = Infinity;
        for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
            const dist = this.pointToSegmentDistance(
                worldX, worldZ,
                this.points[j].x, this.points[j].z,
                this.points[i].x, this.points[i].z
            );
            minDist = Math.min(minDist, dist);
        }

        // Calculate feather width
        const width = this.extent.x1 - this.extent.x0;
        const height = this.extent.y1 - this.extent.y0;
        const featherWidth = Math.min(width, height) * 0.5 * this.getFeatherDistance();

        if (minDist >= featherWidth) return 1;
        return minDist / featherWidth;
    }

    pointToSegmentDistance(px, pz, x1, z1, x2, z2) {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const lengthSquared = dx * dx + dz * dz;

        if (lengthSquared === 0) {
            return Math.sqrt((px - x1) * (px - x1) + (pz - z1) * (pz - z1));
        }

        let t = ((px - x1) * dx + (pz - z1) * dz) / lengthSquared;
        t = Math.max(0, Math.min(1, t));

        const nearestX = x1 + t * dx;
        const nearestZ = z1 + t * dz;

        return Math.sqrt((px - nearestX) * (px - nearestX) + (pz - nearestZ) * (pz - nearestZ));
    }
}

/**
 * Polyline Boundary - exact C++ implementation
 */
class BoundaryPolyline extends Boundary {
    constructor() {
        super('BPLN');
        this.points = [];
        this.width = 1;
        this.extent = { x0: 0, y0: 0, x1: 0, y1: 0 };
    }

    setPoints(points) {
        this.points = points.slice();
        this.recalculateExtent();
    }

    setWidth(width) {
        this.width = width;
        this.recalculateExtent();
    }

    recalculateExtent() {
        if (this.points.length === 0) return;

        const halfWidth = this.width / 2;
        this.extent.x0 = this.points[0].x - halfWidth;
        this.extent.x1 = this.points[0].x + halfWidth;
        this.extent.y0 = this.points[0].z - halfWidth;
        this.extent.y1 = this.points[0].z + halfWidth;

        for (let i = 1; i < this.points.length; i++) {
            this.extent.x0 = Math.min(this.extent.x0, this.points[i].x - halfWidth);
            this.extent.x1 = Math.max(this.extent.x1, this.points[i].x + halfWidth);
            this.extent.y0 = Math.min(this.extent.y0, this.points[i].z - halfWidth);
            this.extent.y1 = Math.max(this.extent.y1, this.points[i].z + halfWidth);
        }
    }

    isWithin(worldX, worldZ) {
        if (this.points.length < 2) return 0;

        // Quick extent test
        if (worldX < this.extent.x0 || worldX > this.extent.x1 ||
            worldZ < this.extent.y0 || worldZ > this.extent.y1) {
            return 0;
        }

        const halfWidth = this.width / 2;
        let minDist = Infinity;

        // Find minimum distance to any segment
        for (let i = 0; i < this.points.length - 1; i++) {
            const dist = this.pointToSegmentDistance(
                worldX, worldZ,
                this.points[i].x, this.points[i].z,
                this.points[i + 1].x, this.points[i + 1].z
            );
            minDist = Math.min(minDist, dist);
        }

        if (minDist > halfWidth) return 0;

        // Apply feathering
        const innerWidth = halfWidth * (1 - this.getFeatherDistance());
        if (minDist <= innerWidth) return 1;

        return 1 - (minDist - innerWidth) / (halfWidth - innerWidth);
    }

    pointToSegmentDistance(px, pz, x1, z1, x2, z2) {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const lengthSquared = dx * dx + dz * dz;

        if (lengthSquared === 0) {
            return Math.sqrt((px - x1) * (px - x1) + (pz - z1) * (pz - z1));
        }

        let t = ((px - x1) * dx + (pz - z1) * dz) / lengthSquared;
        t = Math.max(0, Math.min(1, t));

        const nearestX = x1 + t * dx;
        const nearestZ = z1 + t * dz;

        return Math.sqrt((px - nearestX) * (px - nearestX) + (pz - nearestZ) * (pz - nearestZ));
    }
}

// ======================================================================
// Filter Classes (1:1 C++ Implementation)
// Based on Filter.cpp
// ======================================================================

/**
 * Compute feathered interpolant for filters
 * Exact C++ implementation from Filter.cpp
 */
function computeFeatheredInterpolant(minimum, value, maximum, featherIn) {
    // Not within range at all
    if (value <= minimum || value >= maximum) {
        return 0;
    }

    const feather = featherIn * (maximum - minimum) * 0.5;

    if (value < minimum + feather) {
        return (value - minimum) / feather;
    } else if (value > maximum - feather) {
        return (maximum - value) / feather;
    }

    return 1;
}

/**
 * Base Filter class
 */
class Filter {
    constructor(type) {
        this.type = type;
        this.active = true;
        this.name = '';
        this.featherFunction = Feather.TGFF_linear;
        this.featherDistance = 0;
    }

    setFeatherFunction(func) {
        this.featherFunction = func;
    }

    setFeatherDistance(dist) {
        this.featherDistance = Math.max(0, Math.min(1, dist));
    }

    getFeatherDistance() {
        return this.featherDistance;
    }

    isWithin(worldX, worldZ, x, z, chunkData) {
        return 0;
    }

    needsNormals() {
        return false;
    }

    needsShaders() {
        return false;
    }
}

/**
 * Filter Height - exact C++ implementation
 */
class FilterHeight extends Filter {
    constructor() {
        super('FHGT');
        this.lowHeight = 0;
        this.highHeight = 0;
    }

    setHeightRange(low, high) {
        this.lowHeight = low;
        this.highHeight = high;
    }

    isWithin(worldX, worldZ, x, z, chunkData) {
        const height = chunkData.heightMap[z * chunkData.numberOfPoles + x];
        return computeFeatheredInterpolant(this.lowHeight, height, this.highHeight, this.getFeatherDistance());
    }
}

/**
 * Filter Slope - exact C++ implementation
 */
class FilterSlope extends Filter {
    constructor() {
        super('FSLP');
        this.minAngle = 0;
        this.maxAngle = 90;
    }

    setAngleRange(min, max) {
        this.minAngle = min;
        this.maxAngle = max;
    }

    needsNormals() {
        return true;
    }

    isWithin(worldX, worldZ, x, z, chunkData) {
        if (!chunkData.normalMap) return 1;

        const normalIndex = (z * chunkData.numberOfPoles + x) * 3;
        const normalY = chunkData.normalMap[normalIndex + 1]; // Y component

        // Calculate slope angle from normal Y component
        // normalY = 1 means flat (0 degrees), normalY = 0 means vertical (90 degrees)
        const slopeAngle = Math.acos(Math.abs(normalY)) * (180 / Math.PI);

        return computeFeatheredInterpolant(this.minAngle, slopeAngle, this.maxAngle, this.getFeatherDistance());
    }
}

/**
 * Filter Direction - exact C++ implementation
 */
class FilterDirection extends Filter {
    constructor() {
        super('FDIR');
        this.minAngle = 0;
        this.maxAngle = 360;
    }

    setDirectionRange(min, max) {
        this.minAngle = min;
        this.maxAngle = max;
    }

    needsNormals() {
        return true;
    }

    isWithin(worldX, worldZ, x, z, chunkData) {
        if (!chunkData.normalMap) return 1;

        const normalIndex = (z * chunkData.numberOfPoles + x) * 3;
        const normalX = chunkData.normalMap[normalIndex];
        const normalZ = chunkData.normalMap[normalIndex + 2];

        // Calculate direction angle from normal XZ components
        let angle = Math.atan2(normalX, normalZ) * (180 / Math.PI);
        if (angle < 0) angle += 360;

        return computeFeatheredInterpolant(this.minAngle, angle, this.maxAngle, this.getFeatherDistance());
    }
}

/**
 * Filter Fractal - exact C++ implementation
 */
class FilterFractal extends Filter {
    constructor() {
        super('FFRA');
        this.familyId = 0;
        this.lowFractalLimit = 0;
        this.highFractalLimit = 1;
        this.scaleY = 1;
        this.multiFractal = null;
    }

    setFamilyId(id) {
        this.familyId = id;
    }

    setFractalLimits(low, high) {
        this.lowFractalLimit = low;
        this.highFractalLimit = high;
    }

    setScaleY(scale) {
        this.scaleY = scale;
    }

    setMultiFractal(mf) {
        this.multiFractal = mf;
    }

    isWithin(worldX, worldZ, x, z, chunkData) {
        if (!this.multiFractal && chunkData.fractalGroup) {
            this.multiFractal = chunkData.fractalGroup.getFamilyMultiFractal(this.familyId);
        }

        if (!this.multiFractal) return 1;

        const fractalValue = this.multiFractal.getValue(worldX, worldZ) * this.scaleY;
        return computeFeatheredInterpolant(this.lowFractalLimit, fractalValue, this.highFractalLimit, this.getFeatherDistance());
    }
}

/**
 * Filter Shader - exact C++ implementation
 */
class FilterShader extends Filter {
    constructor() {
        super('FSHD');
        this.familyId = 0;
    }

    setFamilyId(id) {
        this.familyId = id;
    }

    needsShaders() {
        return true;
    }

    isWithin(worldX, worldZ, x, z, chunkData) {
        if (!chunkData.shaderMap) return 0;

        const shaderInfo = chunkData.shaderMap[z * chunkData.numberOfPoles + x];
        return shaderInfo && shaderInfo.familyId === this.familyId ? 1 : 0;
    }
}

/**
 * Filter Bitmap - exact C++ implementation
 */
class FilterBitmap extends Filter {
    constructor() {
        super('FBIT');
        this.familyId = 0;
        this.lowValue = 0;
        this.highValue = 1;
        this.gain = 1;
        this.extent = null; // Will be set from layer
    }

    setFamilyId(id) {
        this.familyId = id;
    }

    setExtent(extent) {
        this.extent = extent;
    }

    setValueRange(low, high) {
        this.lowValue = low;
        this.highValue = high;
    }

    isWithin(worldX, worldZ, x, z, chunkData) {
        if (!chunkData.bitmapGroup) return 0;

        const bitmap = chunkData.bitmapGroup.getFamilyBitmap(this.familyId);
        if (!bitmap) return 0;

        // Sample bitmap at world position
        // Map world position to bitmap UV coordinates
        let u, v;
        if (this.extent) {
            u = (worldX - this.extent.x0) / (this.extent.x1 - this.extent.x0);
            v = (worldZ - this.extent.y0) / (this.extent.y1 - this.extent.y0);
        } else {
            // Default mapping
            const halfMapWidth = chunkData.mapWidthInMeters / 2;
            u = (worldX + halfMapWidth) / chunkData.mapWidthInMeters;
            v = (worldZ + halfMapWidth) / chunkData.mapWidthInMeters;
        }

        if (u < 0 || u > 1 || v < 0 || v > 1) return 0;

        const bitmapValue = bitmap.sample(u, v) * this.gain;
        return computeFeatheredInterpolant(this.lowValue, bitmapValue, this.highValue, this.getFeatherDistance());
    }
}

// ======================================================================
// Affector Classes (1:1 C++ Implementation)
// Based on AffectorHeight.cpp, AffectorShader.cpp, AffectorFlora.cpp, etc.
// ======================================================================

/**
 * Base Affector class
 */
class Affector {
    constructor(type) {
        this.type = type;
        this.active = true;
        this.name = '';
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        // Override in subclasses
    }

    affectsHeight() {
        return false;
    }

    affectsShader() {
        return false;
    }

    getAffectedMaps() {
        return 0;
    }
}

/**
 * Affector Height Constant - exact C++ implementation
 */
class AffectorHeightConstant extends Affector {
    constructor() {
        super('AHCN');
        this.operation = TerrainOperation.REPLACE;
        this.height = 0;
    }

    setOperation(op) {
        this.operation = op;
    }

    setHeight(h) {
        this.height = h;
    }

    affectsHeight() {
        return true;
    }

    getAffectedMaps() {
        return TerrainMapFlags.TGM_height;
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        if (amount <= 0) return;

        const index = z * chunkData.numberOfPoles + x;
        const oldHeight = chunkData.heightMap[index];
        let newHeight;

        switch (this.operation) {
            case TerrainOperation.ADD:
                newHeight = oldHeight + amount * this.height;
                break;
            case TerrainOperation.SUBTRACT:
                newHeight = oldHeight - amount * this.height;
                break;
            case TerrainOperation.MULTIPLY:
                const desiredHeight = oldHeight * this.height;
                newHeight = oldHeight + amount * (desiredHeight - oldHeight);
                break;
            case TerrainOperation.REPLACE:
            default:
                newHeight = amount * this.height + (1 - amount) * oldHeight;
                break;
        }

        chunkData.heightMap[index] = newHeight;
    }
}

/**
 * Affector Height Fractal - exact C++ implementation
 */
class AffectorHeightFractal extends Affector {
    constructor() {
        super('AHFR');
        this.operation = TerrainOperation.REPLACE;
        this.familyId = 0;
        this.scaleY = 1;
        this.multiFractal = null;
    }

    setOperation(op) {
        this.operation = op;
    }

    setFamilyId(id) {
        this.familyId = id;
    }

    setScaleY(scale) {
        this.scaleY = scale;
    }

    setMultiFractal(mf) {
        this.multiFractal = mf;
    }

    affectsHeight() {
        return true;
    }

    getAffectedMaps() {
        return TerrainMapFlags.TGM_height;
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        if (amount <= 0) return;

        if (!this.multiFractal && chunkData.fractalGroup) {
            this.multiFractal = chunkData.fractalGroup.getFamilyMultiFractal(this.familyId);
        }

        if (!this.multiFractal) return;

        const fractalHeight = this.scaleY * this.multiFractal.getValue(worldX, worldZ);
        const index = z * chunkData.numberOfPoles + x;
        const oldHeight = chunkData.heightMap[index];
        let newHeight;

        switch (this.operation) {
            case TerrainOperation.ADD:
                newHeight = oldHeight + amount * fractalHeight;
                break;
            case TerrainOperation.SUBTRACT:
                newHeight = oldHeight - amount * fractalHeight;
                break;
            case TerrainOperation.MULTIPLY:
                const desiredHeight = oldHeight * fractalHeight;
                newHeight = oldHeight + amount * (desiredHeight - oldHeight);
                break;
            case TerrainOperation.REPLACE:
            default:
                newHeight = oldHeight + amount * (fractalHeight - oldHeight);
                break;
        }

        chunkData.heightMap[index] = newHeight;
    }
}

/**
 * Affector Height Terrace - exact C++ implementation
 */
class AffectorHeightTerrace extends Affector {
    constructor() {
        super('AHTR');
        this.height = 1;
        this.fraction = 0.5;
    }

    setHeight(h) {
        this.height = h;
    }

    setFraction(f) {
        this.fraction = f;
    }

    affectsHeight() {
        return true;
    }

    getAffectedMaps() {
        return TerrainMapFlags.TGM_height;
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        if (amount <= 0 || this.height === 0) return;

        const index = z * chunkData.numberOfPoles + x;
        const oldHeight = chunkData.heightMap[index];

        // Calculate terrace effect
        const terraceHeight = this.height;
        const normalizedHeight = oldHeight / terraceHeight;
        const terraceLevel = Math.floor(normalizedHeight);
        const fractionalPart = normalizedHeight - terraceLevel;

        let newFractionalPart;
        if (fractionalPart < this.fraction) {
            newFractionalPart = 0;
        } else {
            newFractionalPart = (fractionalPart - this.fraction) / (1 - this.fraction);
        }

        const desiredHeight = (terraceLevel + newFractionalPart) * terraceHeight;
        const newHeight = oldHeight + amount * (desiredHeight - oldHeight);

        chunkData.heightMap[index] = newHeight;
    }
}

/**
 * Affector Shader Constant - exact C++ implementation
 */
class AffectorShaderConstant extends Affector {
    constructor() {
        super('ASCN');
        this.familyId = 0;
        this.featherClamp = 0;
    }

    setFamilyId(id) {
        this.familyId = id;
    }

    setFeatherClamp(clamp) {
        this.featherClamp = clamp;
    }

    affectsShader() {
        return true;
    }

    getAffectedMaps() {
        return TerrainMapFlags.TGM_shader;
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        if (amount <= this.featherClamp) return;

        const index = z * chunkData.numberOfPoles + x;

        if (!chunkData.shaderMap[index]) {
            chunkData.shaderMap[index] = { familyId: 0, priority: 0, childChoice: 0 };
        }

        const currentPriority = chunkData.shaderMap[index].priority || 0;
        const newPriority = Math.floor(amount * 255);

        if (newPriority > currentPriority) {
            chunkData.shaderMap[index].familyId = this.familyId;
            chunkData.shaderMap[index].priority = newPriority;
            // Set child choice based on position hash for variety
            chunkData.shaderMap[index].childChoice = Math.floor(((worldX * 374761393 + worldZ * 668265263) >>> 0) % 256);
        }
    }
}

/**
 * Affector Flora Static Collidable - exact C++ implementation
 */
class AffectorFloraStaticCollidable extends Affector {
    constructor() {
        super('AFSC');
        this.familyId = 0;
        this.operation = TerrainOperation.REPLACE;
        this.removeAll = false;
        this.densityOverride = false;
        this.density = 1.0;
    }

    setFamilyId(id) {
        this.familyId = id;
    }

    setOperation(op) {
        this.operation = op;
    }

    setRemoveAll(remove) {
        this.removeAll = remove;
    }

    setDensityOverride(override, density) {
        this.densityOverride = override;
        this.density = density;
    }

    getAffectedMaps() {
        return TerrainMapFlags.TGM_floraStaticCollidable;
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        if (amount <= 0) return;

        const index = z * chunkData.numberOfPoles + x;

        if (!chunkData.floraStaticCollidableMap[index]) {
            chunkData.floraStaticCollidableMap[index] = { familyId: 0, childChoice: 0, density: 0 };
        }

        if (this.removeAll) {
            chunkData.floraStaticCollidableMap[index].familyId = 0;
            chunkData.floraStaticCollidableMap[index].density = 0;
            return;
        }

        switch (this.operation) {
            case TerrainOperation.ADD:
            case TerrainOperation.REPLACE:
            default:
                chunkData.floraStaticCollidableMap[index].familyId = this.familyId;
                chunkData.floraStaticCollidableMap[index].childChoice = Math.floor(((worldX * 374761393 + worldZ * 668265263) >>> 0) % 256);
                if (this.densityOverride) {
                    chunkData.floraStaticCollidableMap[index].density = amount * this.density;
                } else {
                    chunkData.floraStaticCollidableMap[index].density = amount;
                }
                break;
        }
    }
}

/**
 * Affector Flora Static Non-Collidable - exact C++ implementation
 */
class AffectorFloraStaticNonCollidable extends Affector {
    constructor() {
        super('AFSN');
        this.familyId = 0;
        this.operation = TerrainOperation.REPLACE;
        this.removeAll = false;
        this.densityOverride = false;
        this.density = 1.0;
    }

    setFamilyId(id) {
        this.familyId = id;
    }

    getAffectedMaps() {
        return TerrainMapFlags.TGM_floraStaticNonCollidable;
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        if (amount <= 0) return;

        const index = z * chunkData.numberOfPoles + x;

        if (!chunkData.floraStaticNonCollidableMap[index]) {
            chunkData.floraStaticNonCollidableMap[index] = { familyId: 0, childChoice: 0, density: 0 };
        }

        if (this.removeAll) {
            chunkData.floraStaticNonCollidableMap[index].familyId = 0;
            return;
        }

        chunkData.floraStaticNonCollidableMap[index].familyId = this.familyId;
        chunkData.floraStaticNonCollidableMap[index].childChoice = Math.floor(((worldX * 374761393 + worldZ * 668265263) >>> 0) % 256);
        chunkData.floraStaticNonCollidableMap[index].density = this.densityOverride ? amount * this.density : amount;
    }
}

/**
 * Affector Flora Dynamic Near - exact C++ implementation
 */
class AffectorFloraDynamicNear extends Affector {
    constructor() {
        super('AFDN');
        this.familyId = 0;
        this.operation = TerrainOperation.REPLACE;
        this.removeAll = false;
        this.densityOverride = false;
        this.density = 1.0;
    }

    setFamilyId(id) {
        this.familyId = id;
    }

    getAffectedMaps() {
        return TerrainMapFlags.TGM_floraDynamicNear;
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        if (amount <= 0) return;

        const index = z * chunkData.numberOfPoles + x;

        if (!chunkData.floraDynamicNearMap[index]) {
            chunkData.floraDynamicNearMap[index] = { familyId: 0, childChoice: 0, density: 0 };
        }

        if (this.removeAll) {
            chunkData.floraDynamicNearMap[index].familyId = 0;
            return;
        }

        chunkData.floraDynamicNearMap[index].familyId = this.familyId;
        chunkData.floraDynamicNearMap[index].childChoice = Math.floor(((worldX * 374761393 + worldZ * 668265263) >>> 0) % 256);
        chunkData.floraDynamicNearMap[index].density = this.densityOverride ? amount * this.density : amount;
    }
}

/**
 * Affector Environment - exact C++ implementation
 */
class AffectorEnvironment extends Affector {
    constructor() {
        super('AENV');
        this.familyId = 0;
        this.featherClamp = 0;
    }

    setFamilyId(id) {
        this.familyId = id;
    }

    setFeatherClamp(clamp) {
        this.featherClamp = clamp;
    }

    getAffectedMaps() {
        return TerrainMapFlags.TGM_environment;
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        if (amount <= this.featherClamp) return;

        const index = z * chunkData.numberOfPoles + x;

        if (!chunkData.environmentMap[index]) {
            chunkData.environmentMap[index] = { familyId: 0, amount: 0 };
        }

        if (amount > chunkData.environmentMap[index].amount) {
            chunkData.environmentMap[index].familyId = this.familyId;
            chunkData.environmentMap[index].amount = amount;
        }
    }
}

/**
 * Affector Exclude - exact C++ implementation
 */
class AffectorExclude extends Affector {
    constructor() {
        super('AEXC');
    }

    getAffectedMaps() {
        return TerrainMapFlags.TGM_exclude;
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        if (amount <= 0) return;

        const index = z * chunkData.numberOfPoles + x;
        chunkData.excludeMap[index] = Math.max(chunkData.excludeMap[index] || 0, amount);
    }
}

/**
 * Affector Passable - exact C++ implementation
 */
class AffectorPassable extends Affector {
    constructor() {
        super('APAS');
        this.passable = true;
        this.featherClamp = 0;
    }

    setPassable(p) {
        this.passable = p;
    }

    setFeatherClamp(clamp) {
        this.featherClamp = clamp;
    }

    getAffectedMaps() {
        return TerrainMapFlags.TGM_passable;
    }

    affect(worldX, worldZ, x, z, amount, chunkData) {
        if (amount <= this.featherClamp) return;

        const index = z * chunkData.numberOfPoles + x;
        chunkData.passableMap[index] = this.passable ? 1 : 0;
    }
}

// ======================================================================
// Constants
// ======================================================================

/**
 * Terrain Generator Operation Types
 */
const TerrainOperation = {
    REPLACE: 0,
    ADD: 1,
    SUBTRACT: 2,
    MULTIPLY: 3,
};

/**
 * Feather function types for blending
 */
const FeatherFunction = {
    LINEAR: 0,
    EASE_IN: 1,
    EASE_OUT: 2,
    EASE_IN_OUT: 3,
};

/**
 * Boundary types
 */
const BoundaryType = {
    CIRCLE: 'BCIR',
    RECTANGLE: 'BREC',
    POLYGON: 'BPOL',
    POLYLINE: 'BPLN',
};

/**
 * Filter types
 */
const FilterType = {
    HEIGHT: 'FHGT',
    FRACTAL: 'FFRA',
    BITMAP: 'FBIT',
    SLOPE: 'FSLP',
    DIRECTION: 'FDIR',
    SHADER: 'FSHD',
};

/**
 * Affector types
 */
const AffectorType = {
    HEIGHT_CONSTANT: 'AHCN',
    HEIGHT_FRACTAL: 'AHFR',
    HEIGHT_TERRACE: 'AHTR',
    COLOR_CONSTANT: 'ACCN',
    COLOR_RAMP_HEIGHT: 'ACRH',
    COLOR_RAMP_FRACTAL: 'ACRF',
    SHADER_CONSTANT: 'ASCN',
    SHADER_REPLACE: 'ASRP',
    FLORA_STATIC_COLLIDABLE: 'AFSC',
    FLORA_STATIC_NON_COLLIDABLE: 'AFSN',
    FLORA_DYNAMIC_NEAR: 'AFDN',
    FLORA_DYNAMIC_FAR: 'AFDF',
    ENVIRONMENT: 'AENV',
    EXCLUDE: 'AEXC',
    PASSABLE: 'APAS',
    ROAD: 'AROA',
    RIVER: 'ARIV',
    RIBBON: 'ARIB',
};

/**
 * Terrain map flags for what data to generate
 */
const TerrainMapFlags = {
    TGM_height: 0x0001,
    TGM_color: 0x0002,
    TGM_shader: 0x0004,
    TGM_floraStaticCollidable: 0x0008,
    TGM_floraStaticNonCollidable: 0x0010,
    TGM_floraDynamicNear: 0x0020,
    TGM_floraDynamicFar: 0x0040,
    TGM_environment: 0x0080,
    TGM_vertexPosition: 0x0100,
    TGM_vertexNormal: 0x0200,
    TGM_exclude: 0x0400,
    TGM_passable: 0x0800,
    TGM_ALL: 0x0FFF,
};

// ======================================================================
// Environment Data Structures
// ======================================================================

/**
 * Environment block data structure
 * Contains lighting, fog, skybox, clouds, and audio settings
 */
class EnvironmentBlockData {
    constructor() {
        this.name = '';
        this.familyId = 0;
        this.weatherIndex = 0;
        
        // Sky and clouds
        this.gradientSkyTextureName = '';
        this.cloudLayerBottomShaderTemplateName = '';
        this.cloudLayerBottomShaderSize = 0;
        this.cloudLayerBottomSpeed = 0;
        this.cloudLayerTopShaderTemplateName = '';
        this.cloudLayerTopShaderSize = 0;
        this.cloudLayerTopSpeed = 0;
        
        // Color ramp for day/night cycle
        this.colorRampFileName = '';
        
        // Fog and shadows
        this.shadowsEnabled = false;
        this.fogEnabled = false;
        this.minimumFogDensity = 0;
        this.maximumFogDensity = 0;
        
        // Camera effects
        this.cameraAppearanceTemplateName = '';
        
        // Environment cube maps
        this.dayEnvironmentTextureName = '';
        this.nightEnvironmentTextureName = '';
        
        // Audio - ambient sounds
        this.day1AmbientSoundTemplateName = '';
        this.day2AmbientSoundTemplateName = '';
        this.night1AmbientSoundTemplateName = '';
        this.night2AmbientSoundTemplateName = '';
        
        // Audio - music
        this.firstMusicSoundTemplateName = '';
        this.sunriseMusicSoundTemplateName = '';
        this.sunsetMusicSoundTemplateName = '';
        
        // Wind
        this.windSpeedScale = 0;
    }
}

/**
 * Interior environment block for buildings/caves
 */
class InteriorEnvironmentBlockData {
    constructor() {
        this.name = '';
        this.dayAmbientSoundTemplateName = '';
        this.nightAmbientSoundTemplateName = '';
        this.musicSoundTemplateName = '';
    }
}

// ======================================================================
// Shader/Texture Tile System
// ======================================================================

/**
 * Shader group info for a single tile
 */
class ShaderTileInfo {
    constructor() {
        this.priority = 0;
        this.familyId = 0;
        this.childChoice = 0; // 0-255 value for selecting child shader
    }
}

/**
 * Shader family with child textures
 */
class ShaderFamily {
    constructor() {
        this.familyId = 0;
        this.name = '';
        this.color = { r: 0, g: 0, b: 0 };
        this.featherClamp = 0;
        this.shaderSize = 8.0; // Meters per tile
        this.surfacePropertiesName = '';
        this.children = []; // Array of { shaderTemplateName, weight }
    }
    
    /**
     * Select a child shader based on random value
     */
    selectChild(randomValue) {
        if (this.children.length === 0) return null;
        if (this.children.length === 1) return this.children[0];
        
        let totalWeight = 0;
        for (const child of this.children) {
            totalWeight += child.weight;
        }
        
        let accumulated = 0;
        const target = randomValue * totalWeight;
        for (const child of this.children) {
            accumulated += child.weight;
            if (accumulated >= target) {
                return child;
            }
        }
        
        return this.children[this.children.length - 1];
    }
}

// ======================================================================
// Flora Data Structures
// ======================================================================

/**
 * Flora family child data
 */
class FloraChildData {
    constructor() {
        this.appearanceTemplateName = '';
        this.weight = 1.0;
        this.shouldSway = false;
        this.period = 2.0;
        this.displacement = 0.1;
        this.shouldScale = false;
        this.minimumScale = 1.0;
        this.maximumScale = 1.0;
        this.alignToTerrain = false;
        this.floats = false; // For water plants
    }
}

/**
 * Flora family (group of similar plants)
 */
class FloraFamily {
    constructor() {
        this.familyId = 0;
        this.name = '';
        this.color = { r: 0, g: 0, b: 0 };
        this.density = 1.0;
        this.children = []; // Array of FloraChildData
    }
    
    /**
     * Select a child flora based on random value
     */
    selectChild(randomValue) {
        if (this.children.length === 0) return null;
        if (this.children.length === 1) return this.children[0];
        
        let totalWeight = 0;
        for (const child of this.children) {
            totalWeight += child.weight;
        }
        
        let accumulated = 0;
        const target = randomValue * totalWeight;
        for (const child of this.children) {
            accumulated += child.weight;
            if (accumulated >= target) {
                return child;
            }
        }
        
        return this.children[this.children.length - 1];
    }
}

/**
 * Flora tile info
 */
class FloraTileInfo {
    constructor() {
        this.familyId = 0;
        this.childIndex = 0;
        this.density = 1.0;
    }
}

// ======================================================================
// Baked Terrain Height Map
// ======================================================================

/**
 * Parse a baked terrain height file (.hmap)
 * These are pre-computed height samples for 1:1 accuracy
 * 
 * File format (based on HeightSampler.cpp):
 *   Header:
 *     - mapWidthInMeters (int32)
 *     - numberOfPoles (uint16)
 *     - channel (uint16)
 *     - tileWidthInMeters (float)
 *     - startX, startZ (int32)
 *     - xStep, zStep (int32)
 *     - minHeight, maxHeight, avgHeight (float)
 *   Data:
 *     - float heights[numberOfPoles * numberOfPoles]
 * 
 * @param {string} hmapPath - Path to .hmap file
 * @returns {Object|null} Height map data
 */
export function parseBakedHeightMap(hmapPath) {
    try {
        console.log('parseBakedHeightMap: loading', { context: 'terrain-service', hmapPath });
        
        if (!fs.existsSync(hmapPath)) {
            console.warn('parseBakedHeightMap: file not found', { context: 'terrain-service', hmapPath });
            return null;
        }
        
        const buffer = fs.readFileSync(hmapPath);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        let offset = 0;
        
        // Read header
        const header = {
            mapWidthInMeters: view.getInt32(offset, true),
            numberOfPoles: view.getUint16(offset + 4, true),
            channel: view.getUint16(offset + 6, true),
            tileWidthInMeters: view.getFloat32(offset + 8, true),
            startX: view.getInt32(offset + 12, true),
            startZ: view.getInt32(offset + 16, true),
            xStep: view.getInt32(offset + 20, true),
            zStep: view.getInt32(offset + 24, true),
            minHeight: view.getFloat32(offset + 28, true),
            maxHeight: view.getFloat32(offset + 32, true),
            avgHeight: view.getFloat32(offset + 36, true),
        };
        offset = 40;
        
        console.log('parseBakedHeightMap: header', { context: 'terrain-service', header });
        
        // Calculate expected data size
        const totalPoles = header.numberOfPoles * header.numberOfPoles;
        const expectedDataSize = totalPoles * 4; // float per pole
        
        if (buffer.length < offset + expectedDataSize) {
            console.warn('parseBakedHeightMap: file too small', {
                context: 'terrain-service',
                fileSize: buffer.length,
                expectedSize: offset + expectedDataSize
            });
            return null;
        }
        
        // Read height data
        const heights = new Float32Array(totalPoles);
        for (let i = 0; i < totalPoles; i++) {
            heights[i] = view.getFloat32(offset + i * 4, true);
        }
        
        console.log('parseBakedHeightMap: loaded heights', {
            context: 'terrain-service',
            poles: header.numberOfPoles,
            minActual: Math.min(...heights),
            maxActual: Math.max(...heights)
        });
        
        return {
            header,
            heights,
            width: header.numberOfPoles,
            height: header.numberOfPoles,
            
            /**
             * Get height at world position
             */
            getHeight(worldX, worldZ) {
                const halfWidth = header.mapWidthInMeters / 2;
                const u = (worldX + halfWidth) / header.mapWidthInMeters;
                const v = (worldZ + halfWidth) / header.mapWidthInMeters;
                
                const x = Math.floor(u * (header.numberOfPoles - 1));
                const z = Math.floor(v * (header.numberOfPoles - 1));
                
                if (x < 0 || x >= header.numberOfPoles - 1 || z < 0 || z >= header.numberOfPoles - 1) {
                    return 0;
                }
                
                // Bilinear interpolation
                const fx = u * (header.numberOfPoles - 1) - x;
                const fz = v * (header.numberOfPoles - 1) - z;
                
                const h00 = heights[z * header.numberOfPoles + x];
                const h10 = heights[z * header.numberOfPoles + x + 1];
                const h01 = heights[(z + 1) * header.numberOfPoles + x];
                const h11 = heights[(z + 1) * header.numberOfPoles + x + 1];
                
                const h0 = h00 + fx * (h10 - h00);
                const h1 = h01 + fx * (h11 - h01);
                
                return h0 + fz * (h1 - h0);
            }
        };
    } catch (error) {
        console.error('parseBakedHeightMap: error', { context: 'terrain-service', error: error.message });
        return null;
    }
}

/**
 * Parse baked terrain water/slope map (.trn.baked or similar)
 * Based on BakedTerrain.cpp
 * 
 * @param {string} bakedPath - Path to baked terrain file
 * @returns {Object|null} Baked terrain data
 */
export function parseBakedTerrain(bakedPath) {
    try {
        console.log('parseBakedTerrain: loading', { context: 'terrain-service', bakedPath });
        
        if (!fs.existsSync(bakedPath)) {
            return null;
        }
        
        const buffer = fs.readFileSync(bakedPath);
        const reader = new IFFReader(buffer);
        
        // Check for BTRN form
        const rootTag = reader.enterForm();
        if (rootTag !== 'BTRN') {
            console.warn('parseBakedTerrain: not a BTRN file', { context: 'terrain-service', rootTag });
            return null;
        }
        
        const version = reader.enterForm();
        
        const bakedData = {
            version,
            mapWidthInMeters: 0,
            chunkWidthInMeters: 0,
            width: 0,
            height: 0,
            waterMap: null,
            slopeMap: null,
        };
        
        while (reader.hasMore()) {
            const tag = reader.peekTag();
            
            if (tag === 'DATA') {
                const chunk = reader.enterChunk('DATA');
                bakedData.mapWidthInMeters = reader.readFloat();
                bakedData.chunkWidthInMeters = reader.readFloat();
                bakedData.width = reader.readInt32();
                bakedData.height = reader.readInt32();
                reader.exitChunk(chunk);
            } else if (tag === 'WMAP') {
                const chunk = reader.enterChunk('WMAP');
                const size = bakedData.width * bakedData.height;
                bakedData.waterMap = new Uint8Array(size);
                for (let i = 0; i < size && reader.getChunkLengthLeft(chunk) > 0; i++) {
                    bakedData.waterMap[i] = reader.readUint8();
                }
                reader.exitChunk(chunk);
            } else if (tag === 'SMAP') {
                const chunk = reader.enterChunk('SMAP');
                const size = bakedData.width * bakedData.height;
                bakedData.slopeMap = new Uint8Array(size);
                for (let i = 0; i < size && reader.getChunkLengthLeft(chunk) > 0; i++) {
                    bakedData.slopeMap[i] = reader.readUint8();
                }
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }
        
        reader.exitForm();
        reader.exitForm();
        
        return bakedData;
    } catch (error) {
        console.error('parseBakedTerrain: error', { context: 'terrain-service', error: error.message });
        return null;
    }
}

// ======================================================================
// Environment Datatable Parser
// ======================================================================

/**
 * Parse environment datatable from terrain/environment/ folder
 * These define the lighting, fog, skybox, and audio for different areas
 * 
 * @param {string} datatablePath - Path to environment datatable
 * @returns {Array<EnvironmentBlockData>} Array of environment blocks
 */
export function parseEnvironmentDatatable(datatablePath) {
    try {
        console.log('parseEnvironmentDatatable: loading', { context: 'terrain-service', datatablePath });
        
        if (!fs.existsSync(datatablePath)) {
            return [];
        }
        
        const buffer = fs.readFileSync(datatablePath);
        const reader = new IFFReader(buffer);
        
        // Datatable format: DTII
        const rootTag = reader.enterForm();
        if (rootTag !== 'DTII') {
            console.warn('parseEnvironmentDatatable: not a DTII file', { context: 'terrain-service', rootTag });
            return [];
        }
        
        const version = reader.enterForm();
        
        const columns = [];
        const columnTypes = [];
        const rows = [];
        
        while (reader.hasMore()) {
            const tag = reader.peekTag();
            
            if (tag === 'COLS') {
                const chunk = reader.enterChunk('COLS');
                while (reader.getChunkLengthLeft(chunk) > 0) {
                    const colName = reader.readNullTerminatedString();
                    if (colName) columns.push(colName);
                }
                reader.exitChunk(chunk);
            } else if (tag === 'TYPE') {
                const chunk = reader.enterChunk('TYPE');
                while (reader.getChunkLengthLeft(chunk) > 0) {
                    const typeChar = String.fromCharCode(reader.readUint8());
                    columnTypes.push(typeChar);
                }
                reader.exitChunk(chunk);
            } else if (tag === 'ROWS') {
                const chunk = reader.enterChunk('ROWS');
                
                while (reader.getChunkLengthLeft(chunk) > 0) {
                    const row = {};
                    for (let i = 0; i < columns.length && reader.getChunkLengthLeft(chunk) > 0; i++) {
                        const colName = columns[i];
                        const colType = columnTypes[i] || 's';
                        
                        if (colType === 's' || colType === 'p') {
                            row[colName] = reader.readNullTerminatedString();
                        } else if (colType === 'i') {
                            row[colName] = reader.readInt32();
                        } else if (colType === 'f') {
                            row[colName] = reader.readFloat();
                        } else if (colType === 'b') {
                            row[colName] = reader.readUint8() !== 0;
                        } else {
                            row[colName] = reader.readNullTerminatedString();
                        }
                    }
                    if (Object.keys(row).length > 0) {
                        rows.push(row);
                    }
                }
                
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }
        
        reader.exitForm();
        reader.exitForm();
        
        // Convert rows to EnvironmentBlockData
        const environments = [];
        for (const row of rows) {
            const env = new EnvironmentBlockData();
            
            // Map datatable columns to EnvironmentBlockData fields
            env.name = row.name || row.NAME || '';
            env.familyId = parseInt(row.familyId || row.FAMILYID || 0);
            env.weatherIndex = parseInt(row.weatherIndex || row.WEATHERINDEX || 0);
            
            env.gradientSkyTextureName = row.gradientSkyTextureName || row.GRADIENTSKYFILENAME || '';
            env.cloudLayerBottomShaderTemplateName = row.cloudLayerBottomShaderTemplateName || row.CLOUDLAYERBOTTOMSHADERTEMPLATENAME || '';
            env.cloudLayerBottomShaderSize = parseFloat(row.cloudLayerBottomShaderSize || row.CLOUDLAYERBOTTOMSHADERSIZE || 0);
            env.cloudLayerBottomSpeed = parseFloat(row.cloudLayerBottomSpeed || row.CLOUDLAYERBOTTOMSPEED || 0);
            env.cloudLayerTopShaderTemplateName = row.cloudLayerTopShaderTemplateName || row.CLOUDLAYERTOPSHADERTEMPLATENAME || '';
            env.cloudLayerTopShaderSize = parseFloat(row.cloudLayerTopShaderSize || row.CLOUDLAYERTOPSHADERSIZE || 0);
            env.cloudLayerTopSpeed = parseFloat(row.cloudLayerTopSpeed || row.CLOUDLAYERTOPSPEED || 0);
            
            env.colorRampFileName = row.colorRampFileName || row.COLORRAMPFILENAME || '';
            
            env.shadowsEnabled = row.shadowsEnabled === true || row.SHADOWSENABLED === 1;
            env.fogEnabled = row.fogEnabled === true || row.FOGENABLED === 1;
            env.minimumFogDensity = parseFloat(row.minimumFogDensity || row.MINIMUMFOGDENSITY || 0);
            env.maximumFogDensity = parseFloat(row.maximumFogDensity || row.MAXIMUMFOGDENSITY || 0);
            
            env.dayEnvironmentTextureName = row.dayEnvironmentTextureName || row.DAYENVIRONMENTTEXTURENAME || '';
            env.nightEnvironmentTextureName = row.nightEnvironmentTextureName || row.NIGHTENVIRONMENTTEXTURENAME || '';
            
            // Audio
            env.day1AmbientSoundTemplateName = row.day1AmbientSoundTemplateName || row.DAY1AMBIENTSOUNDTEMPLATENAME || '';
            env.day2AmbientSoundTemplateName = row.day2AmbientSoundTemplateName || row.DAY2AMBIENTSOUNDTEMPLATENAME || '';
            env.night1AmbientSoundTemplateName = row.night1AmbientSoundTemplateName || row.NIGHT1AMBIENTSOUNDTEMPLATENAME || '';
            env.night2AmbientSoundTemplateName = row.night2AmbientSoundTemplateName || row.NIGHT2AMBIENTSOUNDTEMPLATENAME || '';
            
            env.firstMusicSoundTemplateName = row.firstMusicSoundTemplateName || row.FIRSTMUSICSOUNDTEMPLATENAME || '';
            env.sunriseMusicSoundTemplateName = row.sunriseMusicSoundTemplateName || row.SUNRISEMUSICSOUNDTEMPLATENAME || '';
            env.sunsetMusicSoundTemplateName = row.sunsetMusicSoundTemplateName || row.SUNSETMUSICSOUNDTEMPLATENAME || '';
            
            env.windSpeedScale = parseFloat(row.windSpeedScale || row.WINDSPEEDSCALE || 1);
            
            if (env.name) {
                environments.push(env);
            }
        }
        
        console.log('parseEnvironmentDatatable: loaded environments', {
            context: 'terrain-service',
            count: environments.length
        });
        
        return environments;
    } catch (error) {
        console.error('parseEnvironmentDatatable: error', { context: 'terrain-service', error: error.message });
        return [];
    }
}

/**
 * Load all environments for a planet
 * Checks both terrain/environment/ folder and datatables/environment/
 * 
 * @param {string} dataPath - Base data path
 * @param {string} planetName - Planet name (e.g., 'tatooine')
 * @returns {Object} Environment data with regions and defaults
 */
export function loadPlanetEnvironments(dataPath, planetName) {
    const result = {
        planetName,
        defaultEnvironment: null,
        environments: [],
        interiorEnvironments: [],
        musicTracks: [],
    };
    
    // Try different paths for environment data
    const possiblePaths = [
        path.join(dataPath, `terrain/environment/${planetName}.iff`),
        path.join(dataPath, `datatables/environment/${planetName}.iff`),
        path.join(dataPath, `terrain/${planetName}/${planetName}_environment.iff`),
    ];
    
    for (const envPath of possiblePaths) {
        if (fs.existsSync(envPath)) {
            const envs = parseEnvironmentDatatable(envPath);
            result.environments.push(...envs);
        }
    }
    
    // Load music playlist if available
    const musicPaths = [
        path.join(dataPath, `datatables/sound/${planetName}_music.iff`),
        path.join(dataPath, `sound/music/${planetName}.iff`),
    ];
    
    for (const musicPath of musicPaths) {
        if (fs.existsSync(musicPath)) {
            // Parse music datatable (similar format)
            // result.musicTracks = parseMusicDatatable(musicPath);
        }
    }
    
    // Set default environment (usually first one or one named 'default')
    if (result.environments.length > 0) {
        result.defaultEnvironment = result.environments.find(e => 
            e.name.toLowerCase().includes('default') || e.familyId === 0
        ) || result.environments[0];
    }
    
    return result;
}


// ======================================================================
// Terrain File Parser
// ======================================================================

/**
 * Parse a terrain file (.trn)
 * @param {string} trnPath - Path to the .trn file
 * @returns {Object|null} Parsed terrain data
 */
export function parseTerrainFile(trnPath) {
    try {
        console.log('parseTerrainFile: starting', { context: 'terrain-service', trnPath });

        if (!fs.existsSync(trnPath)) {
            console.warn('parseTerrainFile: file not found', { context: 'terrain-service', trnPath });
            return null;
        }

        const buffer = fs.readFileSync(trnPath);
        const reader = new IFFReader(buffer);

        const rootTag = reader.enterForm();
        console.log('parseTerrainFile: root tag', { context: 'terrain-service', rootTag });

        if (rootTag !== 'PTAT') {
            console.warn('parseTerrainFile: not a PTAT file', { context: 'terrain-service', rootTag });
            return null;
        }

        const version = reader.enterForm();
        console.log('parseTerrainFile: version', { context: 'terrain-service', version });

        const terrainData = {
            version,
            mapWidth: 0,
            chunkWidth: 0,
            tilesPerChunk: 0,
            globalWaterHeight: 0,
            waterShaderSize: 0,
            waterShaderTemplateName: '',
            environmentCycleTime: 0,
            collidableFloraMinDistance: 0,
            collidableFloraMaxDistance: 0,
            collidableFloraSlope: 0,
            nonCollidableFloraMinDistance: 0,
            nonCollidableFloraMaxDistance: 0,
            nonCollidableFloraSlope: 0,
            nearRadialFloraRadius: 0,
            farRadialFloraRadius: 0,
            generator: null,
        };

        // Parse the terrain data based on version
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'DATA') {
                const chunk = reader.enterChunk('DATA');
                const chunkSize = chunk.size;
                const chunkStart = chunk.startOffset;

                // Version 0015 has a different format - starts with a file path string
                // Detect by checking if first bytes look like ASCII path characters
                const firstByte = reader.view.getUint8(chunkStart);
                const isAsciiPath = (firstByte >= 0x41 && firstByte <= 0x5A) || // A-Z
                                   (firstByte >= 0x61 && firstByte <= 0x7A) || // a-z
                                   (firstByte >= 0x2F && firstByte <= 0x39);   // /, 0-9

                if (isAsciiPath && version === '0015') {
                    // Version 0015: Skip the source file path string first
                    const sourcePath = reader.readNullTerminatedString();
                    console.log('parseTerrainFile: version 0015 source path', {
                        context: 'terrain-service',
                        sourcePath
                    });
                }

                // Now read the actual terrain parameters
                if (reader.getChunkLengthLeft(chunk) >= 12) {
                    terrainData.mapWidth = reader.readFloat();
                    terrainData.chunkWidth = reader.readFloat();
                    terrainData.tilesPerChunk = reader.readInt32();

                    console.log('parseTerrainFile: parsed terrain params', {
                        context: 'terrain-service',
                        mapWidth: terrainData.mapWidth,
                        chunkWidth: terrainData.chunkWidth,
                        tilesPerChunk: terrainData.tilesPerChunk
                    });

                    // Check if there's more data (newer versions)
                    if (reader.getChunkLengthLeft(chunk) >= 4) {
                        terrainData.globalWaterHeight = reader.readFloat();
                    }
                    if (reader.getChunkLengthLeft(chunk) >= 4) {
                        terrainData.waterShaderSize = reader.readFloat();
                    }
                    if (reader.getChunkLengthLeft(chunk) > 0) {
                        terrainData.waterShaderTemplateName = reader.readNullTerminatedString();
                    }
                    if (reader.getChunkLengthLeft(chunk) >= 4) {
                        terrainData.environmentCycleTime = reader.readFloat();
                    }
                    // Flora distances
                    if (reader.getChunkLengthLeft(chunk) >= 12) {
                        terrainData.collidableFloraMinDistance = reader.readFloat();
                        terrainData.collidableFloraMaxDistance = reader.readFloat();
                        terrainData.collidableFloraSlope = reader.readFloat();
                    }
                    if (reader.getChunkLengthLeft(chunk) >= 12) {
                        terrainData.nonCollidableFloraMinDistance = reader.readFloat();
                        terrainData.nonCollidableFloraMaxDistance = reader.readFloat();
                        terrainData.nonCollidableFloraSlope = reader.readFloat();
                    }
                    if (reader.getChunkLengthLeft(chunk) >= 8) {
                        terrainData.nearRadialFloraRadius = reader.readFloat();
                        terrainData.farRadialFloraRadius = reader.readFloat();
                    }
                } else {
                    // Fallback defaults
                    console.warn('parseTerrainFile: DATA chunk too small, using defaults', {
                        context: 'terrain-service',
                        chunkSize,
                        remaining: reader.getChunkLengthLeft(chunk)
                    });
                    terrainData.mapWidth = 16384;
                    terrainData.chunkWidth = 256;
                    terrainData.tilesPerChunk = 8;
                }

                reader.exitChunk(chunk);
                console.log('parseTerrainFile: parsed DATA', {
                    context: 'terrain-service',
                    mapWidth: terrainData.mapWidth,
                    chunkWidth: terrainData.chunkWidth,
                    tilesPerChunk: terrainData.tilesPerChunk,
                    globalWaterHeight: terrainData.globalWaterHeight,
                });
            } else if (tag === 'FORM') {
                const formTag = reader.enterForm();
                
                if (formTag === 'TGEN') {
                    try {
                        terrainData.generator = parseTerrainGenerator(reader);
                    } catch (genError) {
                        console.warn('parseTerrainFile: failed to parse TGEN, continuing', {
                            context: 'terrain-service',
                            error: genError.message
                        });
                    }
                } else {
                    // Skip unknown forms
                    while (reader.hasMore()) {
                        reader.skipChunk();
                    }
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm(); // version
        reader.exitForm(); // PTAT

        console.log('parseTerrainFile: complete', {
            context: 'terrain-service',
            hasGenerator: !!terrainData.generator,
            layerCount: terrainData.generator?.layers?.length || 0,
        });

        return terrainData;
    } catch (error) {
        console.error(`Failed to parse terrain file ${trnPath}:`, error.message);

        // Return partial data with defaults if we have anything useful
        return {
            version: '0000',
            mapWidth: 16384,
            chunkWidth: 256,
            tilesPerChunk: 8,
            globalWaterHeight: 0,
            waterShaderSize: 8,
            waterShaderTemplateName: '',
            environmentCycleTime: 0,
            generator: null,
            parseError: error.message,
        };
    }
}

/**
 * Parse Terrain Generator (TGEN)
 */
function parseTerrainGenerator(reader) {
    const version = reader.enterForm();
    console.log('parseTerrainGenerator: version', { context: 'terrain-service', version });

    const generator = {
        version,
        shaderGroup: null,
        floraGroup: null,
        radialGroup: null,
        environmentGroup: null,
        fractalGroup: null,
        bitmapGroup: null,
        layers: [],
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'FORM') {
                const formTag = reader.enterForm();

                try {
                    if (formTag === 'SGRP') {
                        generator.shaderGroup = parseShaderGroup(reader);
                    } else if (formTag === 'FGRP') {
                        generator.floraGroup = parseFloraGroup(reader);
                    } else if (formTag === 'RGRP') {
                        generator.radialGroup = parseRadialGroup(reader);
                    } else if (formTag === 'EGRP') {
                        generator.environmentGroup = parseEnvironmentGroup(reader);
                    } else if (formTag === 'MGRP') {
                        generator.fractalGroup = parseFractalGroup(reader);
                    } else if (formTag === 'WGRP' || formTag === 'BGRP') {
                        generator.bitmapGroup = parseBitmapGroup(reader);
                    } else if (formTag === 'LYRS') {
                        generator.layers = parseLayers(reader);
                    } else {
                        // Skip unknown forms
                        while (reader.hasMore()) {
                            reader.skipChunk();
                        }
                    }
                } catch (innerError) {
                    console.warn('parseTerrainGenerator: failed to parse form', {
                        context: 'terrain-service',
                        formTag,
                        error: innerError.message
                    });
                    // Skip to end of current form
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseTerrainGenerator: error during parsing, returning partial result', {
            context: 'terrain-service',
            error: error.message
        });
    }

    try {
        reader.exitForm(); // version
    } catch (e) {
        // Ignore exit errors
    }

    console.log('parseTerrainGenerator: complete', {
        context: 'terrain-service',
        hasShaderGroup: !!generator.shaderGroup,
        hasFractalGroup: !!generator.fractalGroup,
        layerCount: generator.layers.length,
    });

    return generator;
}

/**
 * Parse Shader Group
 */
function parseShaderGroup(reader) {
    // SGRP may have a versioned form or direct content
    let version = null;

    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const shaderGroup = {
        version,
        families: [],
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'SFAM') {
                    try {
                        const family = parseShaderFamily(reader);
                        if (family) {
                            shaderGroup.families.push(family);
                        }
                    } catch (familyError) {
                        console.warn('parseShaderGroup: failed to parse SFAM', {
                            context: 'terrain-service',
                            error: familyError.message
                        });
                    }
                } else {
                    while (reader.hasMore()) reader.skipChunk();
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseShaderGroup: error during parsing', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        try {
            reader.exitForm();
        } catch (e) { /* ignore */ }
    }

    return shaderGroup;
}

/**
 * Parse Shader Family
 */
function parseShaderFamily(reader) {
    // SFAM may have a versioned form or direct content
    let version = null;

    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const family = {
        version,
        familyId: 0,
        name: '',
        color: { r: 0, g: 0, b: 0 },
        children: [],
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'DATA') {
                const chunk = reader.enterChunk('DATA');
                family.familyId = reader.readInt32();
                family.name = reader.readNullTerminatedString();

                // Read color if available
                if (reader.getChunkLengthLeft(chunk) >= 3) {
                    family.color.r = reader.view.getUint8(reader.offset++);
                    family.color.g = reader.view.getUint8(reader.offset++);
                    family.color.b = reader.view.getUint8(reader.offset++);
                }

                reader.exitChunk(chunk);
            } else if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'SCHD') {
                    try {
                        const child = parseShaderChild(reader);
                        if (child) {
                            family.children.push(child);
                        }
                    } catch (childError) {
                        console.warn('parseShaderFamily: failed to parse SCHD', {
                            context: 'terrain-service',
                            error: childError.message
                        });
                    }
                } else {
                    while (reader.hasMore()) reader.skipChunk();
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseShaderFamily: error during parsing', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        try {
            reader.exitForm();
        } catch (e) { /* ignore */ }
    }

    return family;
}

/**
 * Parse Shader Child
 */
function parseShaderChild(reader) {
    // SCHD may have a versioned form or direct content
    let version = null;

    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const child = {
        version,
        shaderTemplateName: '',
        weight: 1.0,
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'DATA') {
                const chunk = reader.enterChunk('DATA');
                child.weight = reader.readFloat();
                child.shaderTemplateName = reader.readNullTerminatedString();
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseShaderChild: error during parsing', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        try {
            reader.exitForm();
        } catch (e) { /* ignore */ }
    }

    return child;
}

/**
 * Parse Flora Group
 */
function parseFloraGroup(reader) {
    // FGRP may have a versioned form or direct content
    let version = null;

    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const floraGroup = {
        version,
        families: [],
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'FFAM') {
                    try {
                        const family = parseFloraFamily(reader);
                        if (family) {
                            floraGroup.families.push(family);
                        }
                    } catch (familyError) {
                        console.warn('parseFloraGroup: failed to parse FFAM', {
                            context: 'terrain-service',
                            error: familyError.message
                        });
                    }
                } else {
                    while (reader.hasMore()) reader.skipChunk();
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseFloraGroup: error during parsing', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        try {
            reader.exitForm();
        } catch (e) { /* ignore */ }
    }

    return floraGroup;
}

/**
 * Parse Flora Family
 */
function parseFloraFamily(reader) {
    // FFAM may have a versioned form or direct content
    let version = null;

    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const family = {
        version,
        familyId: 0,
        name: '',
        color: { r: 0, g: 0, b: 0 },
        density: 1.0,
        children: [],
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'DATA') {
                const chunk = reader.enterChunk('DATA');
                family.familyId = reader.readInt32();
                family.name = reader.readNullTerminatedString();

                if (reader.getChunkLengthLeft(chunk) >= 3) {
                    family.color.r = reader.view.getUint8(reader.offset++);
                    family.color.g = reader.view.getUint8(reader.offset++);
                    family.color.b = reader.view.getUint8(reader.offset++);
                }

                if (reader.getChunkLengthLeft(chunk) >= 4) {
                    family.density = reader.readFloat();
                }

                reader.exitChunk(chunk);
            } else if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'FLOR') {
                    try {
                        const child = parseFloraChild(reader);
                        if (child) {
                            family.children.push(child);
                        }
                    } catch (childError) {
                        console.warn('parseFloraFamily: failed to parse FLOR', {
                            context: 'terrain-service',
                            error: childError.message
                        });
                    }
                } else {
                    while (reader.hasMore()) reader.skipChunk();
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseFloraFamily: error during parsing', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        try {
            reader.exitForm();
        } catch (e) { /* ignore */ }
    }

    return family;
}

/**
 * Parse Flora Child
 */
function parseFloraChild(reader) {
    // FLOR may have a versioned form or direct content
    let version = null;

    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const child = {
        version,
        appearanceName: '',
        weight: 1.0,
        shouldSway: false,
        period: 0,
        displacement: 0,
        shouldScale: false,
        minimumScale: 1.0,
        maximumScale: 1.0,
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'DATA') {
                const chunk = reader.enterChunk('DATA');
                child.weight = reader.readFloat();
                child.appearanceName = reader.readNullTerminatedString();

                if (reader.getChunkLengthLeft(chunk) >= 1) {
                    child.shouldSway = reader.view.getUint8(reader.offset++) !== 0;
                }
                if (reader.getChunkLengthLeft(chunk) >= 4) {
                    child.period = reader.readFloat();
                }
                if (reader.getChunkLengthLeft(chunk) >= 4) {
                    child.displacement = reader.readFloat();
                }
                if (reader.getChunkLengthLeft(chunk) >= 1) {
                    child.shouldScale = reader.view.getUint8(reader.offset++) !== 0;
                }
                if (reader.getChunkLengthLeft(chunk) >= 8) {
                    child.minimumScale = reader.readFloat();
                    child.maximumScale = reader.readFloat();
                }

                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseFloraChild: error during parsing', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        try {
            reader.exitForm();
        } catch (e) { /* ignore */ }
    }

    return child;
}

/**
 * Parse Radial Group
 */
function parseRadialGroup(reader) {
    // RGRP may have a versioned form or direct content
    let version = null;

    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const radialGroup = {
        version,
        families: [],
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'RFAM') {
                    try {
                        const family = parseRadialFamily(reader);
                        if (family) {
                            radialGroup.families.push(family);
                        }
                    } catch (familyError) {
                        console.warn('parseRadialGroup: failed to parse RFAM', {
                            context: 'terrain-service',
                            error: familyError.message
                        });
                    }
                } else {
                    while (reader.hasMore()) reader.skipChunk();
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseRadialGroup: error during parsing', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        try {
            reader.exitForm();
        } catch (e) { /* ignore */ }
    }
    return radialGroup;
}

/**
 * Parse Radial Family
 */
function parseRadialFamily(reader) {
    const version = reader.enterForm();
    
    const family = {
        version,
        familyId: 0,
        name: '',
        color: { r: 0, g: 0, b: 0 },
        density: 1.0,
        children: [],
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'DATA') {
            const chunk = reader.enterChunk('DATA');
            family.familyId = reader.readInt32();
            family.name = reader.readNullTerminatedString();
            
            if (reader.getChunkLengthLeft(chunk) >= 3) {
                family.color.r = reader.view.getUint8(reader.offset++);
                family.color.g = reader.view.getUint8(reader.offset++);
                family.color.b = reader.view.getUint8(reader.offset++);
            }
            
            if (reader.getChunkLengthLeft(chunk) >= 4) {
                family.density = reader.readFloat();
            }
            
            reader.exitChunk(chunk);
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();
    return family;
}

/**
 * Parse Environment Group
 */
function parseEnvironmentGroup(reader) {
    // EGRP may be versioned or not
    let version = null;

    // Check if first thing is a version form
    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        // Versioned format
        version = reader.enterForm();
    }

    const environmentGroup = {
        version,
        families: [],
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'EFAM') {
                    const family = parseEnvironmentFamily(reader);
                    if (family) {
                        environmentGroup.families.push(family);
                    }
                } else {
                    // Skip unknown forms by reading past them
                    while (reader.hasMore()) reader.skipChunk();
                }

                reader.exitForm();
            } else if (tag === 'DATA') {
                // Some versions have DATA directly in EGRP
                reader.skipChunk();
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseEnvironmentGroup: error parsing, skipping rest', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        reader.exitForm();
    }

    return environmentGroup;
}

/**
 * Parse Environment Family
 */
function parseEnvironmentFamily(reader) {
    // EFAM may be versioned or not
    let version = null;

    // Check if first thing is a version form
    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const family = {
        version,
        familyId: 0,
        name: '',
        color: { r: 0, g: 0, b: 0 },
        featherClamp: 0,
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'DATA') {
                const chunk = reader.enterChunk('DATA');
                family.familyId = reader.readInt32();
                family.name = reader.readNullTerminatedString();

                if (reader.getChunkLengthLeft(chunk) >= 3) {
                    family.color.r = reader.view.getUint8(reader.offset++);
                    family.color.g = reader.view.getUint8(reader.offset++);
                    family.color.b = reader.view.getUint8(reader.offset++);
                }

                if (reader.getChunkLengthLeft(chunk) >= 4) {
                    family.featherClamp = reader.readFloat();
                }

                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseEnvironmentFamily: error parsing', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        reader.exitForm();
    }

    return family;
}


/**
 * Parse Fractal Group
 */
function parseFractalGroup(reader) {
    const version = reader.enterForm();
    
    const fractalGroup = {
        version,
        fractals: [],
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'FORM') {
            const formTag = reader.enterForm();
            
            if (formTag === 'MFAM') {
                const fractal = parseFractalFamily(reader);
                if (fractal) {
                    fractalGroup.fractals.push(fractal);
                }
            } else {
                while (reader.hasMore()) reader.skipChunk();
            }
            
            reader.exitForm();
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();
    return fractalGroup;
}

/**
 * Parse Fractal Family (MultiFractal)
 */
function parseFractalFamily(reader) {
    // MFAM may be versioned or not
    let version = null;

    // Check if first thing is a version form
    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const fractal = {
        version,
        familyId: 0,
        name: '',
        seed: 0,
        useBias: false,
        bias: 0,
        useGain: false,
        gain: 0,
        octaves: 1,
        amplitude: 1,
        frequency: 1,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        combinationRule: 0,
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'DATA') {
                const chunk = reader.enterChunk('DATA');
                fractal.familyId = reader.readInt32();
                fractal.name = reader.readNullTerminatedString();
                reader.exitChunk(chunk);
            } else if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'MFRC') {
                    // MultiFractal data - may be versioned
                    const mfrcPeek = reader.peekTag();
                    if (mfrcPeek === 'FORM') {
                        reader.enterForm(); // version form
                    }

                    while (reader.hasMore()) {
                        const mfrcTag = reader.peekTag();
                        if (mfrcTag === 'DATA') {
                            const mfrcChunk = reader.enterChunk('DATA');
                            fractal.seed = reader.readInt32();
                            fractal.useBias = reader.view.getUint8(reader.offset++) !== 0;
                            fractal.bias = reader.readFloat();
                            fractal.useGain = reader.view.getUint8(reader.offset++) !== 0;
                            fractal.gain = reader.readFloat();
                            fractal.octaves = reader.readInt32();
                            fractal.amplitude = reader.readFloat();
                            fractal.frequency = reader.readFloat();
                            fractal.scaleX = reader.readFloat();
                            fractal.scaleY = reader.readFloat();
                            fractal.offsetX = reader.readFloat();
                            fractal.offsetY = reader.readFloat();
                            fractal.combinationRule = reader.readInt32();
                            reader.exitChunk(mfrcChunk);
                        } else {
                            reader.skipChunk();
                        }
                    }

                    if (mfrcPeek === 'FORM') {
                        reader.exitForm(); // exit version form
                    }
                } else {
                    while (reader.hasMore()) reader.skipChunk();
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseFractalFamily: error parsing', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        reader.exitForm();
    }

    return fractal;
}

/**
 * Parse Bitmap Group
 */
function parseBitmapGroup(reader) {
    // WGRP/BGRP may be versioned or not
    let version = null;

    // Check if first thing is a version form
    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const bitmapGroup = {
        version,
        bitmaps: [],
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'WFAM' || formTag === 'BFAM') {
                    try {
                        const bitmap = parseBitmapFamily(reader);
                        if (bitmap) {
                            bitmapGroup.bitmaps.push(bitmap);
                        }
                    } catch (bitmapError) {
                        console.warn('parseBitmapGroup: failed to parse family', {
                            context: 'terrain-service',
                            error: bitmapError.message
                        });
                    }
                } else {
                    while (reader.hasMore()) reader.skipChunk();
                }

                reader.exitForm();
            } else if (tag === 'DATA') {
                // Some versions have DATA directly in group
                reader.skipChunk();
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseBitmapGroup: error parsing, skipping rest', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        reader.exitForm();
    }

    return bitmapGroup;
}

/**
 * Parse Bitmap Family
 */
function parseBitmapFamily(reader) {
    // WFAM/BFAM may be versioned or not
    let version = null;

    // Check if first thing is a version form
    const peekTag = reader.peekTag();
    if (peekTag === 'FORM') {
        version = reader.enterForm();
    }

    const bitmap = {
        version,
        familyId: 0,
        name: '',
        fileName: '',
    };

    try {
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'DATA') {
                const chunk = reader.enterChunk('DATA');
                bitmap.familyId = reader.readInt32();
                bitmap.name = reader.readNullTerminatedString();
                reader.exitChunk(chunk);
            } else if (tag === 'NAME' || tag === 'FILE') {
                const chunk = reader.enterChunk(tag);
                bitmap.fileName = reader.readNullTerminatedString();
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }
    } catch (error) {
        console.warn('parseBitmapFamily: error parsing', {
            context: 'terrain-service',
            error: error.message
        });
    }

    if (version !== null) {
        reader.exitForm();
    }

    return bitmap;
}

/**
 * Parse Layers
 */
function parseLayers(reader) {
    const layers = [];

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'FORM') {
            const formTag = reader.enterForm();
            
            if (formTag === 'LAYR') {
                const layer = parseLayer(reader);
                if (layer) {
                    layers.push(layer);
                }
            } else {
                while (reader.hasMore()) reader.skipChunk();
            }
            
            reader.exitForm();
        } else {
            reader.skipChunk();
        }
    }

    return layers;
}

/**
 * Parse Layer
 */
function parseLayer(reader) {
    const version = reader.enterForm();
    
    const layer = {
        version,
        name: '',
        active: true,
        invertBoundaries: false,
        invertFilters: false,
        useExtent: false,
        extent: { x0: 0, y0: 0, x1: 0, y1: 0 },
        boundaries: [],
        filters: [],
        affectors: [],
        subLayers: [],
        notes: '',
    };

    // Debug: log first layer's first few tags
    if (!parseLayer._loggedFirst) {
        parseLayer._loggedFirst = true;
        const tags = [];
        const savedOffset = reader.offset;
        for (let i = 0; i < 5 && reader.hasMore(); i++) {
            const t = reader.peekTag();
            tags.push(t);
            reader.skipChunk();
        }
        reader.offset = savedOffset;
        console.log('parseLayer: first layer tags', {
            context: 'terrain-service',
            version,
            firstTags: tags
        });
    }

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'IHDR') {
            const chunk = reader.enterChunk('IHDR');
            layer.active = reader.view.getUint8(reader.offset++) !== 0;
            layer.name = reader.readNullTerminatedString();
            reader.exitChunk(chunk);
        } else if (tag === 'DATA') {
            // Some layer versions store IHDR-like data in DATA chunk
            const chunk = reader.enterChunk('DATA');
            // Try to read as active + name
            if (chunk.size > 4) {
                const possibleActive = reader.readInt32();
                if (possibleActive === 0 || possibleActive === 1) {
                    layer.active = possibleActive !== 0;
                    layer.name = reader.readNullTerminatedString();
                }
            }
            reader.exitChunk(chunk);
        } else if (tag === 'ADTA') {
            const chunk = reader.enterChunk('ADTA');
            layer.invertBoundaries = reader.view.getUint8(reader.offset++) !== 0;
            layer.invertFilters = reader.view.getUint8(reader.offset++) !== 0;
            
            if (reader.getChunkLengthLeft(chunk) >= 1) {
                layer.useExtent = reader.view.getUint8(reader.offset++) !== 0;
            }
            if (reader.getChunkLengthLeft(chunk) >= 16) {
                layer.extent.x0 = reader.readFloat();
                layer.extent.y0 = reader.readFloat();
                layer.extent.x1 = reader.readFloat();
                layer.extent.y1 = reader.readFloat();
            }
            
            reader.exitChunk(chunk);
        } else if (tag === 'NOTE') {
            const chunk = reader.enterChunk('NOTE');
            layer.notes = reader.readString(chunk.size);
            reader.exitChunk(chunk);
        } else if (tag === 'FORM') {
            const formTag = reader.enterForm();
            
            // Check if this is a version/header form containing IHDR
            if (formTag === 'IHDR' || formTag.match(/^[0-9]+$/)) {
                // This is either IHDR form or a version form - look for actual IHDR inside
                while (reader.hasMore()) {
                    const innerTag = reader.peekTag();
                    if (innerTag === 'DATA' || innerTag === 'IHDR') {
                        // Found the header data
                        if (innerTag === 'DATA') {
                            const chunk = reader.enterChunk('DATA');
                            const possibleActive = reader.readInt32();
                            layer.active = possibleActive !== 0;
                            layer.name = reader.readNullTerminatedString();
                            reader.exitChunk(chunk);
                        } else {
                            const chunk = reader.enterChunk('IHDR');
                            layer.active = reader.view.getUint8(reader.offset++) !== 0;
                            layer.name = reader.readNullTerminatedString();
                            reader.exitChunk(chunk);
                        }
                    } else {
                        reader.skipChunk();
                    }
                }
            }
            // Check for boundaries
            else if (formTag === 'BCIR' || formTag === 'BREC' || formTag === 'BPOL' || formTag === 'BPLN') {
                const boundary = parseBoundary(reader, formTag);
                if (boundary) {
                    layer.boundaries.push(boundary);
                }
            }
            // Check for filters
            else if (formTag === 'FHGT' || formTag === 'FFRA' || formTag === 'FBIT' || formTag === 'FSLP' || formTag === 'FDIR' || formTag === 'FSHD') {
                const filter = parseFilter(reader, formTag);
                if (filter) {
                    layer.filters.push(filter);
                }
            }
            // Check for affectors
            else if (formTag.startsWith('A')) {
                const affector = parseAffector(reader, formTag);
                if (affector) {
                    layer.affectors.push(affector);
                }
            }
            // Check for sub-layers
            else if (formTag === 'LAYR') {
                const subLayer = parseLayer(reader);
                if (subLayer) {
                    layer.subLayers.push(subLayer);
                }
            }
            else {
                while (reader.hasMore()) reader.skipChunk();
            }
            
            reader.exitForm();
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();

    return layer;
}

/**
 * Parse Boundary
 */
function parseBoundary(reader, boundaryType) {
    const version = reader.enterForm();
    
    const boundary = {
        type: boundaryType,
        version,
        active: true,
        name: '',
        featherFunction: FeatherFunction.LINEAR,
        featherDistance: 0,
        // Type-specific data
        data: null,
    };

    // Helper to parse boundary data
    const parseBoundaryData = (reader, boundaryType) => {
        if (boundaryType === 'BCIR') {
            return {
                centerX: reader.readFloat(),
                centerZ: reader.readFloat(),
                radius: reader.readFloat(),
                featherType: reader.readInt32(),
                featherWidth: reader.readFloat(),
            };
        } else if (boundaryType === 'BREC') {
            return {
                x0: reader.readFloat(),
                z0: reader.readFloat(),
                x1: reader.readFloat(),
                z1: reader.readFloat(),
                featherType: reader.readInt32(),
                featherWidth: reader.readFloat(),
            };
        } else if (boundaryType === 'BPOL') {
            const pointCount = reader.readInt32();
            const points = [];
            for (let i = 0; i < pointCount; i++) {
                points.push({
                    x: reader.readFloat(),
                    z: reader.readFloat(),
                });
            }
            return {
                points,
                featherType: reader.readInt32(),
                featherWidth: reader.readFloat(),
            };
        } else if (boundaryType === 'BPLN') {
            const pointCount = reader.readInt32();
            const points = [];
            for (let i = 0; i < pointCount; i++) {
                points.push({
                    x: reader.readFloat(),
                    z: reader.readFloat(),
                });
            }
            return {
                points,
                width: reader.readFloat(),
                featherType: reader.readInt32(),
                featherWidth: reader.readFloat(),
            };
        }
        return null;
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'IHDR') {
            const chunk = reader.enterChunk('IHDR');
            boundary.active = reader.view.getUint8(reader.offset++) !== 0;
            boundary.name = reader.readNullTerminatedString();
            reader.exitChunk(chunk);
        } else if (tag === 'DATA') {
            const chunk = reader.enterChunk('DATA');
            try {
                boundary.data = parseBoundaryData(reader, boundaryType);
            } catch (e) {
                // Ignore parse errors
            }
            reader.exitChunk(chunk);
        } else if (tag === 'FORM') {
            // Nested version form - look for DATA inside
            const formTag = reader.enterForm();
            while (reader.hasMore()) {
                const innerTag = reader.peekTag();
                if (innerTag === 'DATA' && !boundary.data) {
                    const chunk = reader.enterChunk('DATA');
                    try {
                        boundary.data = parseBoundaryData(reader, boundaryType);
                    } catch (e) {
                        // Ignore parse errors
                    }
                    reader.exitChunk(chunk);
                } else if (innerTag === 'IHDR') {
                    const chunk = reader.enterChunk('IHDR');
                    boundary.active = reader.view.getUint8(reader.offset++) !== 0;
                    boundary.name = reader.readNullTerminatedString();
                    reader.exitChunk(chunk);
                } else {
                    reader.skipChunk();
                }
            }
            reader.exitForm();
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();
    return boundary;
}

/**
 * Parse Filter
 */
function parseFilter(reader, filterType) {
    const version = reader.enterForm();
    
    const filter = {
        type: filterType,
        version,
        active: true,
        name: '',
        featherFunction: FeatherFunction.LINEAR,
        featherDistance: 0,
        data: null,
    };

    // Helper to parse filter data based on type
    const parseFilterData = (reader, filterType, chunkSize) => {
        if (filterType === 'FHGT') {
            return {
                minHeight: reader.readFloat(),
                maxHeight: reader.readFloat(),
                featherFunction: reader.readInt32(),
                featherDistance: reader.readFloat(),
            };
        } else if (filterType === 'FSLP') {
            return {
                minSlope: reader.readFloat(),
                maxSlope: reader.readFloat(),
                featherFunction: reader.readInt32(),
                featherDistance: reader.readFloat(),
            };
        } else if (filterType === 'FDIR') {
            return {
                minAngle: reader.readFloat(),
                maxAngle: reader.readFloat(),
                featherFunction: reader.readInt32(),
                featherDistance: reader.readFloat(),
            };
        } else if (filterType === 'FFRA') {
            return {
                fractalId: reader.readInt32(),
                minFractal: reader.readFloat(),
                maxFractal: reader.readFloat(),
                featherFunction: reader.readInt32(),
                featherDistance: reader.readFloat(),
            };
        } else if (filterType === 'FSHD') {
            return {
                familyId: reader.readInt32(),
            };
        } else if (filterType === 'FBIT') {
            return {
                // Bitmap filter - would need bitmap data
            };
        }
        return null;
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'IHDR') {
            const chunk = reader.enterChunk('IHDR');
            filter.active = reader.view.getUint8(reader.offset++) !== 0;
            filter.name = reader.readNullTerminatedString();
            reader.exitChunk(chunk);
        } else if (tag === 'DATA') {
            const chunk = reader.enterChunk('DATA');
            try {
                filter.data = parseFilterData(reader, filterType, chunk.size);
            } catch (e) {
                // Ignore parse errors
            }
            reader.exitChunk(chunk);
        } else if (tag === 'FORM') {
            // Nested version form - look for DATA inside
            const formTag = reader.enterForm();
            while (reader.hasMore()) {
                const innerTag = reader.peekTag();
                if (innerTag === 'DATA' && !filter.data) {
                    const chunk = reader.enterChunk('DATA');
                    try {
                        filter.data = parseFilterData(reader, filterType, chunk.size);
                    } catch (e) {
                        // Ignore parse errors
                    }
                    reader.exitChunk(chunk);
                } else if (innerTag === 'IHDR') {
                    const chunk = reader.enterChunk('IHDR');
                    filter.active = reader.view.getUint8(reader.offset++) !== 0;
                    filter.name = reader.readNullTerminatedString();
                    reader.exitChunk(chunk);
                } else {
                    reader.skipChunk();
                }
            }
            reader.exitForm();
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();
    return filter;
}

/**
 * Helper to parse affector data based on type
 */
function parseAffectorData(reader, affectorType, chunkSize) {
    if (affectorType === 'AHCN') {
        return {
            operation: reader.readInt32(),
            height: reader.readFloat(),
        };
    } else if (affectorType === 'AHFR') {
        return {
            operation: reader.readInt32(),
            fractalId: reader.readInt32(),
            scaleY: reader.readFloat(),
        };
    } else if (affectorType === 'AHTR') {
        return {
            height: reader.readFloat(),
            fraction: reader.readFloat(),
        };
    } else if (affectorType === 'ASCN' || affectorType === 'AENV') {
        return {
            familyId: reader.readInt32(),
            featherClamp: reader.readFloat(),
        };
    } else if (affectorType === 'ASRP') {
        return {
            sourceFamilyId: reader.readInt32(),
            destFamilyId: reader.readInt32(),
            featherClamp: reader.readFloat(),
        };
    } else if (affectorType === 'ACCN') {
        return {
            operation: reader.readInt32(),
            r: reader.readFloat(),
            g: reader.readFloat(),
            b: reader.readFloat(),
        };
    } else if (affectorType === 'AFSC' || affectorType === 'AFSN' ||
               affectorType === 'AFDN' || affectorType === 'AFDF') {
        return {
            familyId: reader.readInt32(),
            operation: reader.readInt32(),
            removeAll: chunkSize > 8 ? reader.view.getUint8(reader.offset++) !== 0 : false,
            densityOverride: chunkSize > 9 ? reader.readFloat() : -1,
        };
    } else if (affectorType === 'AEXC') {
        return {
            excludeFlags: reader.readInt32(),
        };
    } else if (affectorType === 'APAS') {
        return {
            passable: reader.view.getUint8(reader.offset++) !== 0,
            featherClamp: chunkSize > 1 ? reader.readFloat() : 0,
        };
    }
    return null;
}

/**
 * Check if current position is a FORM tag
 */
function isFormTag(reader) {
    if (reader.offset + 4 > reader.buffer.byteLength) return false;
    const tag = String.fromCharCode(
        reader.view.getUint8(reader.offset),
        reader.view.getUint8(reader.offset + 1),
        reader.view.getUint8(reader.offset + 2),
        reader.view.getUint8(reader.offset + 3)
    );
    return tag === 'FORM';
}

/**
 * Parse Affector - handles all terrain affector types
 */
function parseAffector(reader, affectorType) {
    const version = reader.enterForm();

    const affector = {
        type: affectorType,
        version,
        active: true,
        name: '',
        data: null,
    };

    // Simple iterative parsing - handles nested FORMs by recursively entering them
    function parseLevel(maxDepth = 5) {
        if (maxDepth <= 0) return;

        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'FORM') {
                // Enter nested form and parse its contents
                const formTag = reader.enterForm();
                parseLevel(maxDepth - 1);
                reader.exitForm();
            } else if (tag === 'IHDR') {
                const chunk = reader.enterChunk('IHDR');
                affector.active = reader.view.getUint8(reader.offset++) !== 0;
                affector.name = reader.readNullTerminatedString();
                reader.exitChunk(chunk);
            } else if (tag === 'DATA') {
                const chunk = reader.enterChunk('DATA');

                // Debug: log first DATA chunk for height affectors
                if (!parseAffector._loggedDATA && (affectorType === 'AHFR' || affectorType === 'AHCN')) {
                    parseAffector._loggedDATA = true;
                    const startOffset = reader.offset;
                    const bytes = [];
                    for (let i = 0; i < Math.min(chunk.size, 32); i++) {
                        bytes.push(reader.view.getUint8(startOffset + i).toString(16).padStart(2, '0'));
                    }
                    console.log('parseAffector: DATA chunk', {
                        context: 'terrain-service',
                        affectorType,
                        chunkSize: chunk.size,
                        hexDump: bytes.join(' '),
                        asciiDump: bytes.map(b => {
                            const c = parseInt(b, 16);
                            return c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
                        }).join('')
                    });
                }

                // For most affector types with version 0003+, DATA chunk contains IHDR-style info
                // (active flag + name), NOT the actual parameters. Parameters are in PARM chunk.
                // Check if this looks like a name string (starts with int32 0 or 1, then ASCII)
                const firstInt = reader.view.getInt32(reader.offset, true);
                const fifthByte = reader.view.getUint8(reader.offset + 4);

                // If first int is 0 or 1 (active flag) and fifth byte is printable ASCII or null,
                // this is likely IHDR-style data
                if ((firstInt === 0 || firstInt === 1) && (fifthByte === 0 || (fifthByte >= 32 && fifthByte < 127))) {
                    // DATA contains: active (int32) + null-terminated name
                    const active = reader.readInt32();
                    affector.active = active !== 0;
                    affector.name = reader.readNullTerminatedString();
                    // Parameters will be in PARM chunk, not here
                }
                // Note: We don't parse DATA as parameters anymore - parameters are in PARM chunk
                // for modern terrain files. Older files that don't have PARM won't work correctly.
                reader.exitChunk(chunk);
            } else if (tag === 'PARM') {
                // PARM chunk contains the actual parameters for AHFR
                const chunk = reader.enterChunk('PARM');

                // Debug: log first PARM chunk contents
                if (!parseAffector._loggedPARM) {
                    parseAffector._loggedPARM = true;
                    const startOffset = reader.offset;
                    const bytes = [];
                    for (let i = 0; i < Math.min(chunk.size, 32); i++) {
                        bytes.push(reader.view.getUint8(startOffset + i).toString(16).padStart(2, '0'));
                    }
                    console.log('parseAffector: PARM chunk', {
                        context: 'terrain-service',
                        affectorType,
                        chunkSize: chunk.size,
                        hexDump: bytes.join(' '),
                        asciiDump: bytes.map(b => {
                            const c = parseInt(b, 16);
                            return c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
                        }).join('')
                    });
                }

                if (affectorType === 'AHFR' && !affector.data) {
                    try {
                        // PARM format for AHFR (12 bytes):
                        // - operation (int32 LE)
                        // - fractalId (int32 LE)
                        // - scaleY (float32 LE)
                        affector.data = {
                            operation: reader.readInt32(),
                            fractalId: reader.readInt32(),
                            scaleY: reader.readFloat(),
                        };
                    } catch (e) {
                        console.warn('parseAffector: PARM parse error', {
                            context: 'terrain-service',
                            error: e.message
                        });
                    }
                } else if (affectorType === 'AHCN' && !affector.data) {
                    try {
                        // PARM format for AHCN (8 bytes):
                        // - operation (int32 LE)
                        // - height (float32 LE)
                        affector.data = {
                            operation: reader.readInt32(),
                            height: reader.readFloat(),
                        };
                    } catch (e) {
                        console.warn('parseAffector: AHCN PARM parse error', {
                            context: 'terrain-service',
                            error: e.message
                        });
                    }
                } else if (affectorType === 'AHTR' && !affector.data) {
                    try {
                        // PARM format for AHTR (8 bytes):
                        // - height (float32 LE)
                        // - fraction (float32 LE)
                        affector.data = {
                            height: reader.readFloat(),
                            fraction: reader.readFloat(),
                        };
                    } catch (e) {
                        // Ignore
                    }
                } else if ((affectorType === 'ASCN' || affectorType === 'AENV') && !affector.data) {
                    try {
                        // PARM format for shader/environment affectors (8 bytes):
                        // - familyId (int32 LE)
                        // - featherClamp (float32 LE)
                        affector.data = {
                            familyId: reader.readInt32(),
                            featherClamp: reader.readFloat(),
                        };
                    } catch (e) {
                        // Ignore
                    }
                } else if ((affectorType === 'AFSC' || affectorType === 'AFSN' ||
                           affectorType === 'AFDN' || affectorType === 'AFDF') && !affector.data) {
                    try {
                        // Flora affector PARM format
                        affector.data = {
                            familyId: reader.readInt32(),
                            operation: reader.readInt32(),
                            removeAll: chunk.size > 8 ? reader.view.getUint8(reader.offset++) !== 0 : false,
                            densityOverride: chunk.size > 9 ? reader.readFloat() : -1,
                        };
                    } catch (e) {
                        // Ignore
                    }
                }
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }
    }

    try {
        parseLevel(5);
    } catch (error) {
        console.warn('parseAffector: error parsing', {
            context: 'terrain-service',
            affectorType,
            error: error.message
        });
    }

    reader.exitForm();
    return affector;
}

// ======================================================================
// Height Map Generator
// ======================================================================

/**
 * Generate a height map from terrain data
 * @param {Object} terrainData - Parsed terrain data
 * @param {number} resolution - Number of samples per axis
 * @param {Object} bounds - Optional bounds { x0, z0, x1, z1 }
 * @returns {Float32Array} Height map data
 */
export function generateHeightMap(terrainData, resolution, bounds = null) {
    if (!terrainData || !terrainData.generator) {
        console.warn('generateHeightMap: no terrain data or generator', { context: 'terrain-service' });
        return null;
    }

    const mapWidth = terrainData.mapWidth || 16384;
    const halfWidth = mapWidth / 2;
    
    const x0 = bounds?.x0 ?? -halfWidth;
    const z0 = bounds?.z0 ?? -halfWidth;
    const x1 = bounds?.x1 ?? halfWidth;
    const z1 = bounds?.z1 ?? halfWidth;
    
    const stepX = (x1 - x0) / (resolution - 1);
    const stepZ = (z1 - z0) / (resolution - 1);
    
    const heightMap = new Float32Array(resolution * resolution);
    
    // Initialize with base height (0)
    heightMap.fill(0);
    
    // Count layers recursively
    function countLayerStats(layers, depth = 0) {
        let stats = { layers: 0, boundaries: 0, filters: 0, affectors: 0, heightAffectors: 0 };
        for (const layer of layers) {
            if (!layer.active) continue;
            stats.layers++;
            stats.boundaries += layer.boundaries.filter(b => b.active).length;
            stats.filters += layer.filters.filter(f => f.active).length;
            stats.affectors += layer.affectors.filter(a => a.active).length;
            stats.heightAffectors += layer.affectors.filter(a =>
                a.active && (a.type === 'AHCN' || a.type === 'AHFR' || a.type === 'AHTR' || a.type === 'ARIV' || a.type === 'AROA')
            ).length;

            // Count sub-layers
            if (layer.subLayers && layer.subLayers.length > 0) {
                const subStats = countLayerStats(layer.subLayers, depth + 1);
                stats.layers += subStats.layers;
                stats.boundaries += subStats.boundaries;
                stats.filters += subStats.filters;
                stats.affectors += subStats.affectors;
                stats.heightAffectors += subStats.heightAffectors;
            }
        }
        return stats;
    }

    const stats = countLayerStats(terrainData.generator.layers);

    // Debug: collect height affector samples
    const heightAffectorSamples = [];
    function collectHeightAffectors(layers) {
        for (const layer of layers) {
            for (const affector of layer.affectors) {
                if (affector.type === 'AHCN' || affector.type === 'AHFR' || affector.type === 'AHTR') {
                    if (heightAffectorSamples.length < 5) {
                        heightAffectorSamples.push({
                            type: affector.type,
                            active: affector.active,
                            hasData: !!affector.data,
                            data: affector.data
                        });
                    }
                }
            }
            if (layer.subLayers) collectHeightAffectors(layer.subLayers);
        }
    }
    collectHeightAffectors(terrainData.generator.layers);

    console.log('generateHeightMap: terrain stats', {
        context: 'terrain-service',
        totalTopLevelLayers: terrainData.generator.layers.length,
        totalActiveLayers: stats.layers,
        totalBoundaries: stats.boundaries,
        totalFilters: stats.filters,
        totalAffectors: stats.affectors,
        totalHeightAffectors: stats.heightAffectors,
        heightAffectorSamples
    });

    // Apply layers in order - each layer's affectors, then sub-layers
    let layerIndex = 0;
    for (const layer of terrainData.generator.layers) {
        if (!layer.active) continue;

        // Log first few layers
        if (layerIndex < 3) {
            const layerHeightAffectors = layer.affectors.filter(a =>
                a.active && (a.type === 'AHCN' || a.type === 'AHFR' || a.type === 'AHTR')
            );
            console.log('generateHeightMap: applying layer', {
                context: 'terrain-service',
                layerIndex,
                layerName: layer.name || '(unnamed)',
                boundaryCount: layer.boundaries.length,
                filterCount: layer.filters.length,
                affectorCount: layer.affectors.length,
                subLayerCount: layer.subLayers.length,
                heightAffectorCount: layerHeightAffectors.length,
                firstHeightAffector: layerHeightAffectors[0] ? {
                    type: layerHeightAffectors[0].type,
                    hasData: !!layerHeightAffectors[0].data,
                    data: layerHeightAffectors[0].data
                } : null
            });
        }

        applyLayer(heightMap, layer, resolution, x0, z0, stepX, stepZ, terrainData.generator);
        layerIndex++;
    }
    
    // Calculate final stats
    let minHeight = Infinity, maxHeight = -Infinity;
    for (let i = 0; i < heightMap.length; i++) {
        const h = heightMap[i];
        if (h < minHeight) minHeight = h;
        if (h > maxHeight) maxHeight = h;
    }

    console.log('generateHeightMap: complete', {
        context: 'terrain-service',
        resolution,
        minHeight: minHeight === Infinity ? 0 : minHeight,
        maxHeight: maxHeight === -Infinity ? 0 : maxHeight
    });

    return heightMap;
}

/**
 * Apply a layer to the height map
 */
function applyLayer(heightMap, layer, resolution, x0, z0, stepX, stepZ, generator) {

    for (let z = 0; z < resolution; z++) {
        for (let x = 0; x < resolution; x++) {
            const worldX = x0 + x * stepX;
            const worldZ = z0 + z * stepZ;
            
            // Check boundaries
            let boundaryAmount = layer.boundaries.length === 0 ? 1 : 0;
            
            for (const boundary of layer.boundaries) {
                if (!boundary.active) continue;
                
                const amount = evaluateBoundary(boundary, worldX, worldZ);
                boundaryAmount = Math.max(boundaryAmount, amount);
                if (boundaryAmount >= 1) break;
            }
            
            if (layer.invertBoundaries) {
                boundaryAmount = 1 - boundaryAmount;
            }
            
            if (boundaryAmount <= 0) continue;
            
            // Apply filters
            let filterAmount = layer.filters.length === 0 ? 1 : 1;
            
            for (const filter of layer.filters) {
                if (!filter.active) continue;
                
                const idx = z * resolution + x;
                const currentHeight = heightMap[idx];
                // Pass additional parameters for slope/direction filters
                const amount = evaluateFilter(filter, worldX, worldZ, currentHeight, generator, heightMap, resolution, x, z);
                filterAmount = Math.min(filterAmount, amount);
                if (filterAmount <= 0) break;
            }
            
            if (layer.invertFilters) {
                filterAmount = 1 - filterAmount;
            }
            
            const totalAmount = boundaryAmount * filterAmount;
            if (totalAmount <= 0) continue;
            
            // Apply affectors
            for (const affector of layer.affectors) {
                if (!affector.active) continue;
                
                applyAffector(heightMap, affector, x, z, resolution, worldX, worldZ, totalAmount, generator);
            }
        }
    }
    
    // Apply sub-layers
    for (const subLayer of layer.subLayers) {
        if (!subLayer.active) continue;
        
        applyLayer(heightMap, subLayer, resolution, x0, z0, stepX, stepZ, generator);
    }
}

/**
 * Evaluate boundary
 */
function evaluateBoundary(boundary, worldX, worldZ) {
    if (!boundary.data) return 1;
    
    if (boundary.type === 'BCIR') {
        const dx = worldX - boundary.data.centerX;
        const dz = worldZ - boundary.data.centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const radius = boundary.data.radius;
        const feather = boundary.data.featherWidth || 0;

        if (dist <= radius) {
            return 1;
        } else if (feather > 0 && dist <= radius + feather) {
            return 1 - (dist - radius) / feather;
        }
        return 0;
    }
    
    if (boundary.type === 'BREC') {
        const { x0, z0, x1, z1, featherWidth } = boundary.data;
        const feather = featherWidth || 0;

        // Check if inside the expanded rectangle (including feather zone)
        if (worldX >= x0 - feather && worldX <= x1 + feather &&
            worldZ >= z0 - feather && worldZ <= z1 + feather) {

            // Check if inside the core rectangle
            if (worldX >= x0 && worldX <= x1 && worldZ >= z0 && worldZ <= z1) {
                return 1;
            }

            // In feather zone - calculate distance to core rectangle
            if (feather > 0) {
                const distX = Math.max(x0 - worldX, 0, worldX - x1);
                const distZ = Math.max(z0 - worldZ, 0, worldZ - z1);
                const dist = Math.sqrt(distX * distX + distZ * distZ);

                if (dist < feather) {
                    return 1 - dist / feather;
                }
            }
        }
        return 0;
    }
    
    if (boundary.type === 'BPOL') {
        // Polygon point-in-polygon test
        const points = boundary.data.points;
        if (!points || points.length < 3) return 0;

        let inside = false;
        
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            if (((points[i].z > worldZ) !== (points[j].z > worldZ)) &&
                (worldX < (points[j].x - points[i].x) * (worldZ - points[i].z) / (points[j].z - points[i].z) + points[i].x)) {
                inside = !inside;
            }
        }
        
        if (inside) {
            // Apply feathering if specified
            const feather = boundary.data.featherWidth || 0;
            if (feather > 0) {
                // Find distance to nearest edge
                let minDist = Infinity;
                for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                    const dist = distanceToLineSegment(worldX, worldZ,
                        points[j].x, points[j].z, points[i].x, points[i].z);
                    minDist = Math.min(minDist, dist);
                }

                if (minDist < feather) {
                    return minDist / feather;
                }
            }
            return 1;
        }
        return 0;
    }
    
    if (boundary.type === 'BPLN') {
        // Polyline boundary - corridor along a path
        const points = boundary.data.points;
        const width = boundary.data.width || 0;
        const feather = boundary.data.featherWidth || 0;

        if (!points || points.length < 2 || width <= 0) return 0;

        // Find minimum distance to any line segment
        let minDist = Infinity;
        for (let i = 0; i < points.length - 1; i++) {
            const dist = distanceToLineSegment(worldX, worldZ,
                points[i].x, points[i].z, points[i + 1].x, points[i + 1].z);
            minDist = Math.min(minDist, dist);
        }

        const halfWidth = width / 2;
        if (minDist <= halfWidth) {
            return 1;
        } else if (feather > 0 && minDist <= halfWidth + feather) {
            return 1 - (minDist - halfWidth) / feather;
        }
        return 0;
    }

    return 1;
}

/**
 * Calculate distance from point to line segment
 */
function distanceToLineSegment(px, pz, x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lenSq = dx * dx + dz * dz;

    if (lenSq === 0) {
        // Segment is a point
        return Math.sqrt((px - x1) ** 2 + (pz - z1) ** 2);
    }

    // Project point onto line
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
    const nearestX = x1 + t * dx;
    const nearestZ = z1 + t * dz;

    return Math.sqrt((px - nearestX) ** 2 + (pz - nearestZ) ** 2);
}

/**
 * Evaluate filter
 */
function evaluateFilter(filter, worldX, worldZ, currentHeight, generator, heightMap, resolution, x, z) {
    if (!filter.data) return 1;
    
    if (filter.type === 'FHGT') {
        const { minHeight, maxHeight, featherDistance } = filter.data;
        
        if (currentHeight >= minHeight && currentHeight <= maxHeight) {
            return 1;
        }
        
        if (featherDistance > 0) {
            if (currentHeight < minHeight) {
                const dist = minHeight - currentHeight;
                if (dist < featherDistance) {
                    return 1 - dist / featherDistance;
                }
            } else {
                const dist = currentHeight - maxHeight;
                if (dist < featherDistance) {
                    return 1 - dist / featherDistance;
                }
            }
        }
        
        return 0;
    }
    
    if (filter.type === 'FFRA') {
        const { fractalId, minFractal, maxFractal } = filter.data;
        const fractalValue = evaluateFractal(generator.fractalGroup, fractalId, worldX, worldZ);
        
        if (fractalValue >= minFractal && fractalValue <= maxFractal) {
            return 1;
        }
        return 0;
    }

    if (filter.type === 'FSLP' && heightMap && resolution) {
        // Slope filter
        const { minSlope, maxSlope, featherDistance } = filter.data;
        const slope = calculateSlope(heightMap, resolution, x, z);

        if (slope >= minSlope && slope <= maxSlope) {
            return 1;
        }
        if (featherDistance > 0) {
            if (slope < minSlope && minSlope - slope < featherDistance) {
                return 1 - (minSlope - slope) / featherDistance;
            }
            if (slope > maxSlope && slope - maxSlope < featherDistance) {
                return 1 - (slope - maxSlope) / featherDistance;
            }
        }
        return 0;
    }

    return 1;
}

/**
 * Calculate slope at a position
 */
function calculateSlope(heightMap, resolution, x, z) {
    const idx = z * resolution + x;
    const h = heightMap[idx];

    const hLeft = x > 0 ? heightMap[idx - 1] : h;
    const hRight = x < resolution - 1 ? heightMap[idx + 1] : h;
    const hUp = z > 0 ? heightMap[idx - resolution] : h;
    const hDown = z < resolution - 1 ? heightMap[idx + resolution] : h;

    const dx = (hRight - hLeft) / 2;
    const dz = (hDown - hUp) / 2;

    return Math.atan(Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;
}

/**
 * Apply affector
 */
function applyAffector(heightMap, affector, x, z, resolution, worldX, worldZ, amount, generator) {
    const idx = z * resolution + x;
    
    // Skip if affector has no data
    if (!affector.data) {
        return;
    }

    if (affector.type === 'AHCN') {
        // Height Constant
        const { operation, height } = affector.data;
        const currentHeight = heightMap[idx];
        
        let newHeight;
        switch (operation) {
            case TerrainOperation.ADD:
                newHeight = currentHeight + amount * height;
                break;
            case TerrainOperation.SUBTRACT:
                newHeight = currentHeight - amount * height;
                break;
            case TerrainOperation.MULTIPLY:
                newHeight = currentHeight + amount * (currentHeight * height - currentHeight);
                break;
            case TerrainOperation.REPLACE:
            default:
                newHeight = amount * height + (1 - amount) * currentHeight;
                break;
        }
        
        // Debug: log first height change
        if (!applyAffector._loggedAHCN && newHeight !== currentHeight) {
            applyAffector._loggedAHCN = true;
            console.log('applyAffector: AHCN applied', {
                context: 'terrain-service',
                operation,
                height,
                amount,
                currentHeight,
                newHeight,
                worldX,
                worldZ
            });
        }

        heightMap[idx] = newHeight;
    }
    
    if (affector.type === 'AHFR') {
        // Height Fractal
        const { operation, fractalId, scaleY } = affector.data;
        const fractalValue = evaluateFractal(generator.fractalGroup, fractalId, worldX, worldZ);
        const heightDelta = fractalValue * scaleY;
        
        const currentHeight = heightMap[idx];
        let newHeight;
        
        switch (operation) {
            case TerrainOperation.ADD:
                newHeight = currentHeight + amount * heightDelta;
                break;
            case TerrainOperation.SUBTRACT:
                newHeight = currentHeight - amount * heightDelta;
                break;
            case TerrainOperation.MULTIPLY:
                newHeight = currentHeight + amount * (currentHeight * heightDelta - currentHeight);
                break;
            case TerrainOperation.REPLACE:
            default:
                newHeight = amount * heightDelta + (1 - amount) * currentHeight;
                break;
        }
        
        // Debug: log first height change
        if (!applyAffector._loggedAHFR && newHeight !== currentHeight) {
            applyAffector._loggedAHFR = true;
            console.log('applyAffector: AHFR applied', {
                context: 'terrain-service',
                operation,
                fractalId,
                scaleY,
                fractalValue,
                heightDelta,
                amount,
                currentHeight,
                newHeight,
                worldX,
                worldZ
            });
        }

        heightMap[idx] = newHeight;
    }
    
    if (affector.type === 'AHTR') {
        // Height Terrace
        const { height: terraceHeight, fraction } = affector.data;
        const currentHeight = heightMap[idx];
        
        if (terraceHeight > 0) {
            const terraceIndex = Math.floor(currentHeight / terraceHeight);
            const terraceBase = terraceIndex * terraceHeight;
            const terraceTop = terraceBase + terraceHeight;
            const heightInTerrace = currentHeight - terraceBase;
            const fractionPoint = terraceHeight * fraction;
            
            let newHeight;
            if (heightInTerrace < fractionPoint) {
                newHeight = terraceBase;
            } else {
                const t = (heightInTerrace - fractionPoint) / (terraceHeight - fractionPoint);
                newHeight = terraceBase + t * terraceHeight;
            }
            
            heightMap[idx] = amount * newHeight + (1 - amount) * currentHeight;
        }
    }
}

/**
 * Evaluate fractal at position
 */
function evaluateFractal(fractalGroup, fractalId, worldX, worldZ) {
    if (!fractalGroup || !fractalGroup.fractals) {
        return 0;
    }
    
    const fractal = fractalGroup.fractals.find(f => f.familyId === fractalId);
    if (!fractal) {
        return 0;
    }
    
    // Simple noise implementation (Perlin-like)
    const x = (worldX * fractal.frequency + fractal.offsetX) * fractal.scaleX;
    const z = (worldZ * fractal.frequency + fractal.offsetY) * fractal.scaleY;
    
    let value = 0;
    let amplitude = fractal.amplitude;
    let frequency = 1;
    
    for (let octave = 0; octave < fractal.octaves; octave++) {
        value += noise2D(x * frequency + fractal.seed, z * frequency + fractal.seed) * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    
    if (fractal.useBias) {
        value = Math.pow(value * 0.5 + 0.5, fractal.bias) * 2 - 1;
    }
    
    if (fractal.useGain) {
        const t = value * 0.5 + 0.5;
        if (t < 0.5) {
            value = Math.pow(2 * t, fractal.gain) * 0.5;
        } else {
            value = 1 - Math.pow(2 - 2 * t, fractal.gain) * 0.5;
        }
        value = value * 2 - 1;
    }
    
    return value;
}

/**
 * Simple 2D noise function
 */
function noise2D(x, y) {
    // Simple hash-based noise
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    
    const hash = (x, y) => {
        let h = x * 374761393 + y * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        return (h ^ (h >> 16)) / 4294967296;
    };
    
    const v00 = hash(xi, yi);
    const v10 = hash(xi + 1, yi);
    const v01 = hash(xi, yi + 1);
    const v11 = hash(xi + 1, yi + 1);
    
    // Smooth interpolation
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    
    const v0 = v00 + sx * (v10 - v00);
    const v1 = v01 + sx * (v11 - v01);
    
    return (v0 + sy * (v1 - v0)) * 2 - 1;
}

// ======================================================================
// Buildout Data Loader
// ======================================================================

/**
 * Load buildout areas for a scene
 * @param {string} sceneName - Scene name (e.g., 'tatooine')
 * @param {string} dataPath - Path to data directory
 * @returns {Object} Buildout data
 */
export function loadBuildoutAreas(sceneName, dataPath) {
    const buildoutData = {
        sceneName,
        areas: [],
        objects: [],
    };

    // Load areas table
    const areasPath = path.join(dataPath, `datatables/buildout/areas_${sceneName}.iff`);
    if (fs.existsSync(areasPath)) {
        // Parse datatable IFF file
        const areas = parseDataTable(areasPath);
        if (areas) {
            buildoutData.areas = areas;
        }
    }

    return buildoutData;
}

/**
 * Parse a datatable IFF file
 */
function parseDataTable(tablePath) {
    try {
        const buffer = fs.readFileSync(tablePath);
        const reader = new IFFReader(buffer);

        const rootTag = reader.enterForm();
        if (rootTag !== 'DTII') {
            return null;
        }

        const version = reader.enterForm();
        const rows = [];
        const columns = [];

        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'COLS') {
                const chunk = reader.enterChunk('COLS');
                while (reader.getChunkLengthLeft(chunk) > 0) {
                    const colName = reader.readNullTerminatedString();
                    if (colName) {
                        columns.push(colName);
                    }
                }
                reader.exitChunk(chunk);
            } else if (tag === 'TYPE') {
                reader.skipChunk();
            } else if (tag === 'ROWS') {
                const chunk = reader.enterChunk('ROWS');
                const rowCount = reader.readInt32();
                
                for (let i = 0; i < rowCount && reader.getChunkLengthLeft(chunk) > 0; i++) {
                    const row = {};
                    for (const col of columns) {
                        row[col] = reader.readNullTerminatedString();
                    }
                    rows.push(row);
                }
                
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm();
        reader.exitForm();

        return rows;
    } catch (error) {
        console.error(`Failed to parse datatable ${tablePath}:`, error.message);
        return null;
    }
}

// ======================================================================
// Comprehensive Terrain System
// ======================================================================

/**
 * SWGTerrainSystem - Unified terrain management
 * Handles height maps, shaders, flora, environments, and audio
 */
export class SWGTerrainSystem {
    constructor(dataPath) {
        this.dataPath = dataPath;
        this.planetName = null;
        
        // Terrain data
        this.terrainData = null;
        this.bakedHeightMap = null;
        this.bakedTerrain = null;
        
        // Groups from terrain file
        this.shaderGroup = null;
        this.floraGroup = null;
        this.radialGroup = null;
        this.environmentGroup = null;
        this.fractalGroup = null;
        this.bitmapGroup = null;
        
        // Environment data
        this.environments = [];
        this.currentEnvironment = null;
        
        // Shader textures cache
        this.shaderTextureCache = new Map();
        
        // Flora instances
        this.floraInstances = [];
        
        // Audio state
        this.currentMusic = null;
        this.currentAmbient = null;
        
        // Map dimensions
        this.mapWidth = 16384;
        this.chunkWidth = 64;
        this.tilesPerChunk = 16;
        this.tileWidth = 4; // meters
    }
    
    /**
     * Load terrain for a planet
     * @param {string} planetName - Planet name (e.g., 'tatooine')
     */
    async loadPlanet(planetName) {
        console.log('SWGTerrainSystem: loading planet', { context: 'terrain-service', planetName });
        
        this.planetName = planetName;
        
        // Find terrain file
        const trnPaths = [
            path.join(this.dataPath, `terrain/${planetName}.trn`),
            path.join(this.dataPath, `terrain/${planetName}/${planetName}.trn`),
        ];
        
        for (const trnPath of trnPaths) {
            if (fs.existsSync(trnPath)) {
                this.terrainData = parseTerrainFile(trnPath);
                if (this.terrainData) {
                    this.mapWidth = this.terrainData.mapWidth || 16384;
                    this.chunkWidth = this.terrainData.chunkWidth || 64;
                    this.tilesPerChunk = this.terrainData.tilesPerChunk || 16;
                    this.tileWidth = this.chunkWidth / this.tilesPerChunk;
                    
                    // Extract groups
                    if (this.terrainData.generator) {
                        this.shaderGroup = this.terrainData.generator.shaderGroup;
                        this.floraGroup = this.terrainData.generator.floraGroup;
                        this.radialGroup = this.terrainData.generator.radialGroup;
                        this.environmentGroup = this.terrainData.generator.environmentGroup;
                        this.fractalGroup = this.terrainData.generator.fractalGroup;
                        this.bitmapGroup = this.terrainData.generator.bitmapGroup;
                    }
                    break;
                }
            }
        }
        
        // Load baked height map for 1:1 accuracy
        const hmapPaths = [
            path.join(this.dataPath, `terrain/${planetName}.hmap`),
            path.join(this.dataPath, `terrain/${planetName}/${planetName}.hmap`),
            path.join(this.dataPath, `terrain/${planetName}_height.dat`),
        ];
        
        for (const hmapPath of hmapPaths) {
            if (fs.existsSync(hmapPath)) {
                this.bakedHeightMap = parseBakedHeightMap(hmapPath);
                if (this.bakedHeightMap) break;
            }
        }
        
        // Load baked terrain (water/slope maps)
        const bakedPaths = [
            path.join(this.dataPath, `terrain/${planetName}.btrn`),
            path.join(this.dataPath, `terrain/${planetName}/${planetName}.btrn`),
        ];
        
        for (const bakedPath of bakedPaths) {
            if (fs.existsSync(bakedPath)) {
                this.bakedTerrain = parseBakedTerrain(bakedPath);
                if (this.bakedTerrain) break;
            }
        }
        
        // Load environments
        const envData = loadPlanetEnvironments(this.dataPath, planetName);
        this.environments = envData.environments;
        this.currentEnvironment = envData.defaultEnvironment;
        
        console.log('SWGTerrainSystem: planet loaded', {
            context: 'terrain-service',
            hasTerrain: !!this.terrainData,
            hasBakedHeight: !!this.bakedHeightMap,
            hasBakedTerrain: !!this.bakedTerrain,
            environmentCount: this.environments.length,
            mapWidth: this.mapWidth
        });
        
        return this;
    }
    
    /**
     * Get terrain height at world position
     * Uses baked height map for 1:1 accuracy, falls back to procedural
     */
    getHeight(worldX, worldZ) {
        // Prefer baked height map for accuracy
        if (this.bakedHeightMap) {
            return this.bakedHeightMap.getHeight(worldX, worldZ);
        }
        
        // Fall back to procedural generation
        if (this.terrainData) {
            return this.generateProceduralHeight(worldX, worldZ);
        }
        
        return 0;
    }
    
    /**
     * Generate height map for a region
     * @param {number} x0 - Start X
     * @param {number} z0 - Start Z
     * @param {number} x1 - End X
     * @param {number} z1 - End Z
     * @param {number} resolution - Samples per axis
     */
    generateHeightMap(x0, z0, x1, z1, resolution) {
        const heights = new Float32Array(resolution * resolution);
        const stepX = (x1 - x0) / (resolution - 1);
        const stepZ = (z1 - z0) / (resolution - 1);
        
        for (let z = 0; z < resolution; z++) {
            for (let x = 0; x < resolution; x++) {
                const worldX = x0 + x * stepX;
                const worldZ = z0 + z * stepZ;
                heights[z * resolution + x] = this.getHeight(worldX, worldZ);
            }
        }
        
        return {
            heights,
            width: resolution,
            height: resolution,
            bounds: { x0, z0, x1, z1 },
            stepX,
            stepZ
        };
    }
    
    /**
     * Get shader info for a tile position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     */
    getShaderAtPosition(worldX, worldZ) {
        if (!this.shaderGroup || !this.terrainData?.generator?.layers) {
            return null;
        }
        
        // Find which shader family applies at this position
        // by evaluating layers from bottom to top
        let familyId = 0;
        let priority = 0;
        
        for (const layer of this.terrainData.generator.layers) {
            if (!layer.active) continue;
            
            const amount = this.evaluateLayerAtPosition(layer, worldX, worldZ);
            if (amount > 0) {
                for (const affector of layer.affectors) {
                    if (!affector.active) continue;
                    if (affector.type === 'ASCN' && affector.data) {
                        const newFamilyId = affector.data.familyId;
                        const family = this.shaderGroup.families?.find(f => f.familyId === newFamilyId);
                        if (family) {
                            familyId = newFamilyId;
                        }
                    }
                }
            }
        }
        
        // Get family details
        const family = this.shaderGroup.families?.find(f => f.familyId === familyId);
        if (!family) {
            return { familyId: 0, shaderTemplate: null, texturePath: null };
        }
        
        // Select child shader based on position hash (for variation)
        const hash = this.hashPosition(worldX, worldZ);
        const child = family.children?.[0]; // Simplified - select first child
        
        return {
            familyId,
            familyName: family.name,
            shaderTemplate: child?.shaderTemplateName,
            shaderSize: family.shaderSize || 8,
            color: family.color,
            texturePath: this.resolveShaderTexture(child?.shaderTemplateName)
        };
    }
    
    /**
     * Resolve shader template to texture path
     */
    resolveShaderTexture(shaderTemplateName) {
        if (!shaderTemplateName) return null;
        
        // Check cache
        if (this.shaderTextureCache.has(shaderTemplateName)) {
            return this.shaderTextureCache.get(shaderTemplateName);
        }
        
        // Shader templates are in shader/ folder, textures in texture/
        // shader/terrain/naboo_grass.sht -> texture/terrain/naboo_grass.dds
        let texturePath = shaderTemplateName
            .replace(/^shader\//, 'texture/')
            .replace(/\.sht$/, '.dds');
        
        // Try to find the actual texture file
        const possiblePaths = [
            path.join(this.dataPath, texturePath),
            path.join(this.dataPath, texturePath.replace('.dds', '.tga')),
            path.join(this.dataPath, texturePath.replace('.dds', '.png')),
        ];
        
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                this.shaderTextureCache.set(shaderTemplateName, p);
                return p;
            }
        }
        
        // Return relative path even if not found
        this.shaderTextureCache.set(shaderTemplateName, texturePath);
        return texturePath;
    }
    
    /**
     * Generate shader map for a chunk
     * Returns shader family IDs for each tile
     */
    generateShaderMap(chunkX, chunkZ, tilesPerChunk = 16) {
        const shaderMap = new Uint8Array(tilesPerChunk * tilesPerChunk);
        const chunkWorldX = chunkX * this.chunkWidth;
        const chunkWorldZ = chunkZ * this.chunkWidth;
        
        for (let tz = 0; tz < tilesPerChunk; tz++) {
            for (let tx = 0; tx < tilesPerChunk; tx++) {
                const worldX = chunkWorldX + tx * this.tileWidth + this.tileWidth / 2;
                const worldZ = chunkWorldZ + tz * this.tileWidth + this.tileWidth / 2;
                
                const shaderInfo = this.getShaderAtPosition(worldX, worldZ);
                shaderMap[tz * tilesPerChunk + tx] = shaderInfo?.familyId || 0;
            }
        }
        
        return {
            data: shaderMap,
            width: tilesPerChunk,
            height: tilesPerChunk,
            chunkX,
            chunkZ
        };
    }
    
    /**
     * Get flora placements for a region
     * @param {number} x0 - Start X
     * @param {number} z0 - Start Z
     * @param {number} x1 - End X
     * @param {number} z1 - End Z
     * @param {number} density - Placement density (0-1)
     */
    getFloraInRegion(x0, z0, x1, z1, density = 1.0) {
        const flora = [];
        
        if (!this.floraGroup?.families || this.floraGroup.families.length === 0) {
            return flora;
        }
        
        // Sample flora at regular intervals based on density
        const step = 4 / density; // Base 4m spacing
        
        for (let z = z0; z < z1; z += step) {
            for (let x = x0; x < x1; x += step) {
                // Add some random offset
                const hash = this.hashPosition(x, z);
                const offsetX = (hash % 100) / 100 * step - step / 2;
                const offsetZ = ((hash >> 8) % 100) / 100 * step - step / 2;
                
                const worldX = x + offsetX;
                const worldZ = z + offsetZ;
                
                // Check if flora should be placed here
                const floraInfo = this.getFloraAtPosition(worldX, worldZ);
                if (floraInfo) {
                    const height = this.getHeight(worldX, worldZ);
                    
                    // Get rotation from hash
                    const rotation = (hash % 360) * Math.PI / 180;
                    
                    // Get scale
                    let scale = 1.0;
                    if (floraInfo.shouldScale) {
                        const scaleRange = floraInfo.maximumScale - floraInfo.minimumScale;
                        scale = floraInfo.minimumScale + ((hash >> 16) % 100) / 100 * scaleRange;
                    }
                    
                    flora.push({
                        x: worldX,
                        y: height,
                        z: worldZ,
                        rotation,
                        scale,
                        familyId: floraInfo.familyId,
                        familyName: floraInfo.familyName,
                        appearanceTemplate: floraInfo.appearanceTemplate,
                        shouldSway: floraInfo.shouldSway,
                        period: floraInfo.period,
                        displacement: floraInfo.displacement
                    });
                }
            }
        }
        
        return flora;
    }
    
    /**
     * Get flora info at a specific position
     */
    getFloraAtPosition(worldX, worldZ) {
        if (!this.floraGroup?.families || !this.terrainData?.generator?.layers) {
            return null;
        }
        
        // Evaluate layers to find flora family
        for (const layer of this.terrainData.generator.layers) {
            if (!layer.active) continue;
            
            const amount = this.evaluateLayerAtPosition(layer, worldX, worldZ);
            if (amount > 0) {
                for (const affector of layer.affectors) {
                    if (!affector.active) continue;
                    
                    if ((affector.type === 'AFSC' || affector.type === 'AFSN' || 
                         affector.type === 'AFDN' || affector.type === 'AFDF') && 
                        affector.data) {
                        
                        const familyId = affector.data.familyId;
                        const family = this.floraGroup.families.find(f => f.familyId === familyId);
                        
                        if (family && family.children?.length > 0) {
                            // Use position hash to select child
                            const hash = this.hashPosition(worldX, worldZ);
                            const childIndex = hash % family.children.length;
                            const child = family.children[childIndex];
                            
                            // Density check
                            const densityCheck = ((hash >> 24) % 100) / 100;
                            if (densityCheck > (family.density || 1.0)) {
                                continue;
                            }
                            
                            return {
                                familyId,
                                familyName: family.name,
                                appearanceTemplate: child.appearanceName,
                                shouldSway: child.shouldSway,
                                period: child.period,
                                displacement: child.displacement,
                                shouldScale: child.shouldScale,
                                minimumScale: child.minimumScale,
                                maximumScale: child.maximumScale
                            };
                        }
                    }
                }
            }
        }
        
        return null;
    }
    
    /**
     * Get environment at a position
     */
    getEnvironmentAtPosition(worldX, worldZ) {
        if (!this.environmentGroup?.families || !this.terrainData?.generator?.layers) {
            return this.currentEnvironment;
        }
        
        let environmentFamilyId = 0;
        
        for (const layer of this.terrainData.generator.layers) {
            if (!layer.active) continue;
            
            const amount = this.evaluateLayerAtPosition(layer, worldX, worldZ);
            if (amount > 0) {
                for (const affector of layer.affectors) {
                    if (!affector.active) continue;
                    if (affector.type === 'AENV' && affector.data) {
                        environmentFamilyId = affector.data.familyId;
                    }
                }
            }
        }
        
        // Find matching environment
        const env = this.environments.find(e => e.familyId === environmentFamilyId);
        return env || this.currentEnvironment;
    }
    
    /**
     * Get music track for current environment
     */
    getMusicForEnvironment(environment, isDay = true, event = null) {
        if (!environment) return null;
        
        // Priority: event music > time-based music > first music
        if (event === 'sunrise') {
            return environment.sunriseMusicSoundTemplateName || null;
        }
        if (event === 'sunset') {
            return environment.sunsetMusicSoundTemplateName || null;
        }
        
        // First music plays when entering area
        if (environment.firstMusicSoundTemplateName) {
            return environment.firstMusicSoundTemplateName;
        }
        
        return null;
    }
    
    /**
     * Get ambient sound for current environment
     */
    getAmbientForEnvironment(environment, isDay = true, slot = 1) {
        if (!environment) return null;
        
        if (isDay) {
            return slot === 1 
                ? environment.day1AmbientSoundTemplateName 
                : environment.day2AmbientSoundTemplateName;
        } else {
            return slot === 1 
                ? environment.night1AmbientSoundTemplateName 
                : environment.night2AmbientSoundTemplateName;
        }
    }
    
    /**
     * Evaluate a layer at a position (simplified)
     */
    evaluateLayerAtPosition(layer, worldX, worldZ) {
        // Check extent
        if (layer.useExtent) {
            if (worldX < layer.extent.x0 || worldX > layer.extent.x1 ||
                worldZ < layer.extent.y0 || worldZ > layer.extent.y1) {
                return 0;
            }
        }
        
        // Evaluate boundaries
        let boundaryAmount = layer.boundaries.length === 0 ? 1 : 0;
        
        for (const boundary of layer.boundaries) {
            if (!boundary.active) continue;
            
            const amount = this.evaluateBoundary(boundary, worldX, worldZ);
            boundaryAmount = Math.max(boundaryAmount, amount);
            if (boundaryAmount >= 1) break;
        }
        
        if (layer.invertBoundaries) {
            boundaryAmount = 1 - boundaryAmount;
        }
        
        return boundaryAmount;
    }
    
    /**
     * Evaluate a boundary
     */
    evaluateBoundary(boundary, worldX, worldZ) {
        if (!boundary.data) return 1;
        
        if (boundary.type === 'BCIR') {
            const dx = worldX - boundary.data.centerX;
            const dz = worldZ - boundary.data.centerZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const radius = boundary.data.radius;
            const feather = boundary.data.featherWidth || 0;
            
            if (dist <= radius) return 1;
            if (dist <= radius + feather && feather > 0) {
                return 1 - (dist - radius) / feather;
            }
            return 0;
        }
        
        if (boundary.type === 'BREC') {
            const { x0, z0, x1, z1, featherWidth } = boundary.data;
            
            if (worldX >= x0 && worldX <= x1 && worldZ >= z0 && worldZ <= z1) {
                if (featherWidth > 0) {
                    const distX = Math.min(worldX - x0, x1 - worldX);
                    const distZ = Math.min(worldZ - z0, z1 - worldZ);
                    const dist = Math.min(distX, distZ);
                    
                    if (dist < featherWidth) {
                        return dist / featherWidth;
                    }
                }
                return 1;
            }
            return 0;
        }
        
        if (boundary.type === 'BPOL') {
            const points = boundary.data.points;
            if (!points || points.length < 3) return 0;
            
            // Point in polygon test
            let inside = false;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                if (((points[i].z > worldZ) !== (points[j].z > worldZ)) &&
                    (worldX < (points[j].x - points[i].x) * (worldZ - points[i].z) / 
                     (points[j].z - points[i].z) + points[i].x)) {
                    inside = !inside;
                }
            }
            return inside ? 1 : 0;
        }
        
        return 1;
    }
    
    /**
     * Generate procedural height (fallback when no baked data)
     */
    generateProceduralHeight(worldX, worldZ) {
        if (!this.terrainData?.generator?.layers) return 0;
        
        let height = 0;
        
        for (const layer of this.terrainData.generator.layers) {
            if (!layer.active) continue;
            
            const amount = this.evaluateLayerAtPosition(layer, worldX, worldZ);
            if (amount > 0) {
                for (const affector of layer.affectors) {
                    if (!affector.active) continue;
                    
                    if (affector.type === 'AHCN' && affector.data) {
                        const { operation, height: affectorHeight } = affector.data;
                        
                        switch (operation) {
                            case TerrainOperation.ADD:
                                height += amount * affectorHeight;
                                break;
                            case TerrainOperation.SUBTRACT:
                                height -= amount * affectorHeight;
                                break;
                            case TerrainOperation.MULTIPLY:
                                height *= amount * affectorHeight;
                                break;
                            case TerrainOperation.REPLACE:
                            default:
                                height = amount * affectorHeight + (1 - amount) * height;
                                break;
                        }
                    }
                    
                    if (affector.type === 'AHFR' && affector.data && this.fractalGroup) {
                        const { operation, fractalId, scaleY } = affector.data;
                        const fractalValue = this.evaluateFractal(fractalId, worldX, worldZ);
                        const delta = fractalValue * scaleY;
                        
                        switch (operation) {
                            case TerrainOperation.ADD:
                                height += amount * delta;
                                break;
                            case TerrainOperation.SUBTRACT:
                                height -= amount * delta;
                                break;
                            case TerrainOperation.REPLACE:
                            default:
                                height = amount * delta + (1 - amount) * height;
                                break;
                        }
                    }
                }
            }
        }
        
        return height;
    }
    
    /**
     * Evaluate fractal noise
     */
    evaluateFractal(fractalId, worldX, worldZ) {
        if (!this.fractalGroup?.fractals) return 0;
        
        const fractal = this.fractalGroup.fractals.find(f => f.familyId === fractalId);
        if (!fractal) return 0;
        
        const x = (worldX * fractal.frequency + fractal.offsetX) * fractal.scaleX;
        const z = (worldZ * fractal.frequency + fractal.offsetY) * fractal.scaleY;
        
        let value = 0;
        let amplitude = fractal.amplitude;
        let frequency = 1;
        
        for (let octave = 0; octave < fractal.octaves; octave++) {
            value += this.noise2D(x * frequency + fractal.seed, z * frequency + fractal.seed) * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        
        return value;
    }
    
    /**
     * Simple 2D noise
     */
    noise2D(x, y) {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const xf = x - xi;
        const yf = y - yi;
        
        const hash = (x, y) => {
            let h = x * 374761393 + y * 668265263;
            h = (h ^ (h >> 13)) * 1274126177;
            return (h ^ (h >> 16)) / 4294967296;
        };
        
        const v00 = hash(xi, yi);
        const v10 = hash(xi + 1, yi);
        const v01 = hash(xi, yi + 1);
        const v11 = hash(xi + 1, yi + 1);
        
        const sx = xf * xf * (3 - 2 * xf);
        const sy = yf * yf * (3 - 2 * yf);
        
        const v0 = v00 + sx * (v10 - v00);
        const v1 = v01 + sx * (v11 - v01);
        
        return (v0 + sy * (v1 - v0)) * 2 - 1;
    }
    
    /**
     * Hash position for deterministic randomness
     */
    hashPosition(x, z) {
        const ix = Math.floor(x * 100);
        const iz = Math.floor(z * 100);
        let h = ix * 374761393 + iz * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        return Math.abs(h ^ (h >> 16));
    }
    
    /**
     * Get complete terrain data for a chunk
     */
    getChunkData(chunkX, chunkZ) {
        const chunkWorldX = chunkX * this.chunkWidth - this.mapWidth / 2;
        const chunkWorldZ = chunkZ * this.chunkWidth - this.mapWidth / 2;
        
        const resolution = this.tilesPerChunk + 1; // +1 for edge vertices
        
        // Generate height map
        const heightData = this.generateHeightMap(
            chunkWorldX,
            chunkWorldZ,
            chunkWorldX + this.chunkWidth,
            chunkWorldZ + this.chunkWidth,
            resolution
        );
        
        // Generate shader map
        const shaderMap = this.generateShaderMap(chunkX, chunkZ);
        
        // Get flora for this chunk
        const flora = this.getFloraInRegion(
            chunkWorldX,
            chunkWorldZ,
            chunkWorldX + this.chunkWidth,
            chunkWorldZ + this.chunkWidth,
            0.5 // Reduced density for performance
        );
        
        // Get environment
        const centerX = chunkWorldX + this.chunkWidth / 2;
        const centerZ = chunkWorldZ + this.chunkWidth / 2;
        const environment = this.getEnvironmentAtPosition(centerX, centerZ);
        
        return {
            chunkX,
            chunkZ,
            worldX: chunkWorldX,
            worldZ: chunkWorldZ,
            width: this.chunkWidth,
            heightMap: heightData,
            shaderMap,
            flora,
            environment,
            water: this.terrainData?.globalWaterHeight || 0
        };
    }
    
    /**
     * Export terrain data for client
     */
    exportForClient() {
        return {
            planetName: this.planetName,
            mapWidth: this.mapWidth,
            chunkWidth: this.chunkWidth,
            tilesPerChunk: this.tilesPerChunk,
            tileWidth: this.tileWidth,
            waterHeight: this.terrainData?.globalWaterHeight || 0,
            
            // Shader families for texture mapping
            shaderFamilies: this.shaderGroup?.families?.map(f => ({
                familyId: f.familyId,
                name: f.name,
                color: f.color,
                shaderSize: f.shaderSize || 8,
                children: f.children?.map(c => ({
                    shaderTemplateName: c.shaderTemplateName,
                    texturePath: this.resolveShaderTexture(c.shaderTemplateName),
                    weight: c.weight
                }))
            })) || [],
            
            // Flora families
            floraFamilies: this.floraGroup?.families?.map(f => ({
                familyId: f.familyId,
                name: f.name,
                density: f.density,
                children: f.children?.map(c => ({
                    appearanceName: c.appearanceName,
                    weight: c.weight,
                    shouldSway: c.shouldSway,
                    shouldScale: c.shouldScale,
                    minimumScale: c.minimumScale,
                    maximumScale: c.maximumScale
                }))
            })) || [],
            
            // Environment data
            environments: this.environments.map(e => ({
                name: e.name,
                familyId: e.familyId,
                weatherIndex: e.weatherIndex,
                gradientSkyTexture: e.gradientSkyTextureName,
                fogEnabled: e.fogEnabled,
                minimumFogDensity: e.minimumFogDensity,
                maximumFogDensity: e.maximumFogDensity,
                shadowsEnabled: e.shadowsEnabled,
                dayEnvironmentTexture: e.dayEnvironmentTextureName,
                nightEnvironmentTexture: e.nightEnvironmentTextureName,
                windSpeedScale: e.windSpeedScale,
                
                // Audio
                music: {
                    first: e.firstMusicSoundTemplateName,
                    sunrise: e.sunriseMusicSoundTemplateName,
                    sunset: e.sunsetMusicSoundTemplateName
                },
                ambient: {
                    day1: e.day1AmbientSoundTemplateName,
                    day2: e.day2AmbientSoundTemplateName,
                    night1: e.night1AmbientSoundTemplateName,
                    night2: e.night2AmbientSoundTemplateName
                },
                
                // Clouds
                clouds: {
                    bottom: {
                        shader: e.cloudLayerBottomShaderTemplateName,
                        size: e.cloudLayerBottomShaderSize,
                        speed: e.cloudLayerBottomSpeed
                    },
                    top: {
                        shader: e.cloudLayerTopShaderTemplateName,
                        size: e.cloudLayerTopShaderSize,
                        speed: e.cloudLayerTopSpeed
                    }
                }
            })),
            
            currentEnvironment: this.currentEnvironment ? {
                name: this.currentEnvironment.name,
                familyId: this.currentEnvironment.familyId
            } : null
        };
    }
}

// ======================================================================
// Chunk Generation System (1:1 C++ Implementation)
// Based on TerrainGenerator::createChunk
// ======================================================================

/**
 * Chunk data buffer for terrain generation
 * Matches TerrainGenerator::CreateChunkBuffer
 */
class ChunkDataBuffer {
    constructor(numberOfPoles) {
        this.numberOfPoles = numberOfPoles;
        const size = numberOfPoles * numberOfPoles;
        
        this.heightMap = new Float32Array(size);
        this.colorMap = new Uint32Array(size);
        this.shaderMap = new Array(size).fill(null).map(() => ({ familyId: 0, priority: 0, childChoice: 0 }));
        this.floraStaticCollidableMap = new Array(size).fill(null).map(() => ({ familyId: 0, childChoice: 0, density: 0 }));
        this.floraStaticNonCollidableMap = new Array(size).fill(null).map(() => ({ familyId: 0, childChoice: 0, density: 0 }));
        this.floraDynamicNearMap = new Array(size).fill(null).map(() => ({ familyId: 0, childChoice: 0, density: 0 }));
        this.floraDynamicFarMap = new Array(size).fill(null).map(() => ({ familyId: 0, childChoice: 0, density: 0 }));
        this.environmentMap = new Array(size).fill(null).map(() => ({ familyId: 0, amount: 0 }));
        this.normalMap = new Float32Array(size * 3);
        this.excludeMap = new Float32Array(size);
        this.passableMap = new Uint8Array(size);
        
        // Set passable to true by default
        this.passableMap.fill(1);
    }
}

/**
 * Generator chunk data for layer processing
 * Matches TerrainGenerator::GeneratorChunkData
 */
class GeneratorChunkData {
    constructor(buffer, chunkExtent, distanceBetweenPoles) {
        this.numberOfPoles = buffer.numberOfPoles;
        this.distanceBetweenPoles = distanceBetweenPoles;
        this.chunkExtent = chunkExtent;
        this.start = { x: chunkExtent.x0, z: chunkExtent.y0 };
        
        // Map references
        this.heightMap = buffer.heightMap;
        this.colorMap = buffer.colorMap;
        this.shaderMap = buffer.shaderMap;
        this.floraStaticCollidableMap = buffer.floraStaticCollidableMap;
        this.floraStaticNonCollidableMap = buffer.floraStaticNonCollidableMap;
        this.floraDynamicNearMap = buffer.floraDynamicNearMap;
        this.floraDynamicFarMap = buffer.floraDynamicFarMap;
        this.environmentMap = buffer.environmentMap;
        this.normalMap = buffer.normalMap;
        this.excludeMap = buffer.excludeMap;
        this.passableMap = buffer.passableMap;
        
        // State flags
        this.normalsDirty = true;
        this.shadersDirty = true;
        
        // Group references (set by terrain system)
        this.fractalGroup = null;
        this.bitmapGroup = null;
        this.shaderGroup = null;
        this.floraGroup = null;
        this.radialGroup = null;
        this.environmentGroup = null;
        
        // Map dimensions
        this.mapWidthInMeters = 16384;
    }
}

/**
 * Layer processing class - exact C++ implementation
 * Matches TerrainGenerator::Layer::affect
 */
class LayerProcessor {
    constructor() {
        // Empty - stateless processor
    }

    /**
     * Process a layer at all pole positions
     * @param {Object} layer - Layer definition with boundaries, filters, affectors, sublayers
     * @param {Float32Array} previousAmountMap - Amount map from parent layer
     * @param {GeneratorChunkData} chunkData - Chunk generation data
     */
    processLayer(layer, previousAmountMap, chunkData) {
        if (!layer.active) return;

        const numberOfPoles = chunkData.numberOfPoles;
        const hasActiveBoundaries = layer.boundaries && layer.boundaries.some(b => b.active);
        const hasActiveFilters = layer.filters && layer.filters.some(f => f.active);
        const hasActiveAffectors = layer.affectors && layer.affectors.some(a => a.active);
        const hasActiveSublayers = layer.sublayers && layer.sublayers.some(l => l.active);

        // Check if this layer only has sublayers
        const onlyHasSubLayers = !hasActiveBoundaries && !hasActiveFilters && !hasActiveAffectors;

        // Generate normals if any filter needs them
        if (hasActiveFilters && chunkData.normalsDirty) {
            for (const filter of layer.filters) {
                if (filter.active && filter.needsNormals && filter.needsNormals()) {
                    this.generateNormals(chunkData);
                    chunkData.normalsDirty = false;
                    break;
                }
            }
        }

        // Allocate amount map for sublayers if needed
        let amountMap = null;
        if (hasActiveSublayers && !onlyHasSubLayers) {
            amountMap = new Float32Array(numberOfPoles * numberOfPoles);
        }

        let shouldAffectSubLayers = onlyHasSubLayers;

        if (!onlyHasSubLayers) {
            // Precompute boundary map
            let boundaryMap = null;
            if (hasActiveBoundaries) {
                boundaryMap = new Float32Array(numberOfPoles * numberOfPoles);
                for (const boundary of layer.boundaries) {
                    if (!boundary.active) continue;
                    this.scanConvertBoundary(boundary, boundaryMap, chunkData);
                }
            }

            const invertBoundaries = layer.invertBoundaries || false;
            const invertFilters = layer.invertFilters || false;
            const distanceBetweenPoles = chunkData.distanceBetweenPoles;

            // Process each pole
            for (let z = 0; z < numberOfPoles; z++) {
                const rowIndex = z * numberOfPoles;
                const worldZ = chunkData.start.z + z * distanceBetweenPoles;

                for (let x = 0; x < numberOfPoles; x++) {
                    const worldX = chunkData.start.x + x * distanceBetweenPoles;
                    const previousAmount = previousAmountMap ? previousAmountMap[rowIndex + x] : 1;

                    // Get boundary test result
                    let fuzzyTest = boundaryMap ? boundaryMap[rowIndex + x] : 1;

                    if (invertBoundaries) {
                        fuzzyTest = 1 - fuzzyTest;
                    }

                    if (fuzzyTest > 0) {
                        // Apply filters
                        if (hasActiveFilters) {
                            for (const filter of layer.filters) {
                                if (!filter.active) continue;

                                const feather = new Feather(filter.featherFunction);
                                const amount = filter.isWithin(worldX, worldZ, x, z, chunkData);
                                fuzzyTest = Math.min(fuzzyTest, feather.feather(0, 1, amount));

                                if (fuzzyTest === 0) break;
                            }
                        }

                        if (invertFilters) {
                            fuzzyTest = 1 - fuzzyTest;
                        }

                        if (fuzzyTest > 0) {
                            shouldAffectSubLayers = true;

                            // Run all affectors
                            if (hasActiveAffectors) {
                                for (const affector of layer.affectors) {
                                    if (!affector.active) continue;
                                    affector.affect(worldX, worldZ, x, z, fuzzyTest * previousAmount, chunkData);

                                    if (affector.affectsHeight && affector.affectsHeight()) {
                                        chunkData.normalsDirty = true;
                                    }
                                    if (affector.affectsShader && affector.affectsShader()) {
                                        chunkData.shadersDirty = true;
                                    }
                                }
                            }
                        }
                    }

                    // Store amount for sublayers
                    if (amountMap) {
                        amountMap[rowIndex + x] = fuzzyTest * previousAmount;
                    }
                }
            }
        }

        // Process sublayers
        if (shouldAffectSubLayers && hasActiveSublayers) {
            for (const sublayer of layer.sublayers) {
                if (!sublayer.active) continue;
                this.processLayer(sublayer, onlyHasSubLayers ? previousAmountMap : amountMap, chunkData);
            }
        }
    }

    /**
     * Scan convert a boundary to a coverage map
     */
    scanConvertBoundary(boundary, boundaryMap, chunkData) {
        const numberOfPoles = chunkData.numberOfPoles;
        const distanceBetweenPoles = chunkData.distanceBetweenPoles;

        for (let z = 0; z < numberOfPoles; z++) {
            const worldZ = chunkData.start.z + z * distanceBetweenPoles;
            const rowIndex = z * numberOfPoles;

            for (let x = 0; x < numberOfPoles; x++) {
                const worldX = chunkData.start.x + x * distanceBetweenPoles;
                const amount = boundary.isWithin(worldX, worldZ);

                // Use fuzzy OR to combine boundaries
                boundaryMap[rowIndex + x] = Math.max(boundaryMap[rowIndex + x], amount);
            }
        }
    }

    /**
     * Generate vertex normals from height map
     */
    generateNormals(chunkData) {
        const numberOfPoles = chunkData.numberOfPoles;
        const heightMap = chunkData.heightMap;
        const normalMap = chunkData.normalMap;
        const distanceBetweenPoles = chunkData.distanceBetweenPoles;

        for (let z = 0; z < numberOfPoles; z++) {
            for (let x = 0; x < numberOfPoles; x++) {
                const index = z * numberOfPoles + x;
                const normalIndex = index * 3;

                // Get neighboring heights
                const h = heightMap[index];
                const hLeft = x > 0 ? heightMap[z * numberOfPoles + (x - 1)] : h;
                const hRight = x < numberOfPoles - 1 ? heightMap[z * numberOfPoles + (x + 1)] : h;
                const hUp = z > 0 ? heightMap[(z - 1) * numberOfPoles + x] : h;
                const hDown = z < numberOfPoles - 1 ? heightMap[(z + 1) * numberOfPoles + x] : h;

                // Calculate normal using central differences
                const dx = (hRight - hLeft) / (2 * distanceBetweenPoles);
                const dz = (hDown - hUp) / (2 * distanceBetweenPoles);

                // Normal = normalize(cross(tangentX, tangentZ))
                // tangentX = (1, dx, 0)
                // tangentZ = (0, dz, 1)
                // cross = (-dx, 1, -dz)
                const nx = -dx;
                const ny = 1;
                const nz = -dz;

                const length = Math.sqrt(nx * nx + ny * ny + nz * nz);

                normalMap[normalIndex] = nx / length;
                normalMap[normalIndex + 1] = ny / length;
                normalMap[normalIndex + 2] = nz / length;
            }
        }
    }
}

/**
 * Complete terrain chunk generator
 * Creates all terrain data for a chunk position
 */
class TerrainChunkGenerator {
    constructor(terrainData) {
        this.terrainData = terrainData;
        this.layerProcessor = new LayerProcessor();
        
        // Extract generator data
        this.generator = terrainData?.generator || null;
        this.mapWidth = terrainData?.mapWidth || 16384;
        this.chunkWidth = terrainData?.chunkWidth || 64;
        this.tilesPerChunk = terrainData?.tilesPerChunk || 16;
        
        // Calculate pole count (tiles + 1 vertices per axis, * 2 for half-tile spacing)
        this.numberOfPoles = this.tilesPerChunk * 2;
        this.distanceBetweenPoles = this.chunkWidth / this.numberOfPoles;
    }

    /**
     * Generate chunk data at specified chunk coordinates
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {ChunkDataBuffer} Generated chunk data
     */
    generateChunk(chunkX, chunkZ) {
        // Calculate world position of chunk
        const halfMapWidth = this.mapWidth / 2;
        const chunkWorldX = chunkX * this.chunkWidth - halfMapWidth;
        const chunkWorldZ = chunkZ * this.chunkWidth - halfMapWidth;

        // Create chunk data buffer
        const buffer = new ChunkDataBuffer(this.numberOfPoles);

        // Create extent for this chunk
        const chunkExtent = {
            x0: chunkWorldX,
            y0: chunkWorldZ,
            x1: chunkWorldX + this.chunkWidth,
            y1: chunkWorldZ + this.chunkWidth
        };

        // Create generator chunk data
        const chunkData = new GeneratorChunkData(buffer, chunkExtent, this.distanceBetweenPoles);
        chunkData.mapWidthInMeters = this.mapWidth;

        // Set group references
        if (this.generator) {
            chunkData.fractalGroup = this.generator.fractalGroup;
            chunkData.bitmapGroup = this.generator.bitmapGroup;
            chunkData.shaderGroup = this.generator.shaderGroup;
            chunkData.floraGroup = this.generator.floraGroup;
            chunkData.radialGroup = this.generator.radialGroup;
            chunkData.environmentGroup = this.generator.environmentGroup;
        }

        // Initialize with full coverage amount map
        const initialAmountMap = new Float32Array(this.numberOfPoles * this.numberOfPoles);
        initialAmountMap.fill(1);

        // Process all layers
        if (this.generator && this.generator.layers) {
            for (const layer of this.generator.layers) {
                this.layerProcessor.processLayer(layer, initialAmountMap, chunkData);
            }
        }

        // Final normal generation if still dirty
        if (chunkData.normalsDirty) {
            this.layerProcessor.generateNormals(chunkData);
        }

        return buffer;
    }

    /**
     * Get height at specific world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Height at position
     */
    getHeightAt(worldX, worldZ) {
        // Determine which chunk
        const halfMapWidth = this.mapWidth / 2;
        const chunkX = Math.floor((worldX + halfMapWidth) / this.chunkWidth);
        const chunkZ = Math.floor((worldZ + halfMapWidth) / this.chunkWidth);

        // Generate chunk
        const buffer = this.generateChunk(chunkX, chunkZ);

        // Calculate position within chunk
        const chunkWorldX = chunkX * this.chunkWidth - halfMapWidth;
        const chunkWorldZ = chunkZ * this.chunkWidth - halfMapWidth;

        const localX = worldX - chunkWorldX;
        const localZ = worldZ - chunkWorldZ;

        // Convert to pole indices
        const poleX = Math.floor(localX / this.distanceBetweenPoles);
        const poleZ = Math.floor(localZ / this.distanceBetweenPoles);

        // Clamp to valid range
        const x = Math.max(0, Math.min(this.numberOfPoles - 1, poleX));
        const z = Math.max(0, Math.min(this.numberOfPoles - 1, poleZ));

        return buffer.heightMap[z * this.numberOfPoles + x];
    }
}

// ======================================================================
// Exports
// ======================================================================

export {
    // Core classes
    NoiseGenerator,
    MultiFractal,
    Feather,
    
    // Boundary classes
    Boundary,
    BoundaryCircle,
    BoundaryRectangle,
    BoundaryPolygon,
    BoundaryPolyline,
    
    // Filter classes
    Filter,
    FilterHeight,
    FilterSlope,
    FilterDirection,
    FilterFractal,
    FilterShader,
    FilterBitmap,
    
    // Affector classes
    Affector,
    AffectorHeightConstant,
    AffectorHeightFractal,
    AffectorHeightTerrace,
    AffectorShaderConstant,
    AffectorFloraStaticCollidable,
    AffectorFloraStaticNonCollidable,
    AffectorFloraDynamicNear,
    AffectorEnvironment,
    AffectorExclude,
    AffectorPassable,
    
    // Chunk generation
    ChunkDataBuffer,
    GeneratorChunkData,
    LayerProcessor,
    TerrainChunkGenerator,
    
    // Constants
    TerrainOperation,
    FeatherFunction,
    BoundaryType,
    FilterType,
    AffectorType,
    TerrainMapFlags,
    
    // Data classes
    EnvironmentBlockData,
    InteriorEnvironmentBlockData,
    ShaderTileInfo,
    ShaderFamily,
    FloraChildData,
    FloraFamily,
    FloraTileInfo,
    
    // Utility
    parseDataTable,
    computeFeatheredInterpolant,
};
