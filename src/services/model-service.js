/**
 * SWG 3D Model Service
 *
 * Loads and parses SWG appearance files (.apt, .sat, .mgn) and mesh files (.msh)
 * for rendering with Three.js. Includes shader and DDS texture support.
 *
 * Based on C++ implementations:
 *   - MeshAppearanceTemplate.cpp
 *   - DetailAppearanceTemplate.cpp
 *   - ShaderPrimitiveSetTemplate.cpp
 *   - VertexBuffer.cpp
 *   - VertexBufferFormat.h
 *   - SkeletalAppearanceTemplate.cpp
 *   - SkeletalMeshGeneratorTemplate.cpp
 *   - StaticShaderTemplate.cpp
 *   - Dds.h
 */
import fs from 'fs';
import path from 'path';

// ======================================================================
// DDS Texture Format Constants (from Dds.h)
// ======================================================================

const DDS_MAGIC = 0x20534444; // "DDS "

const DDS_FLAGS = {
    ALPHA: 0x00000001,
    FOURCC: 0x00000004,
    RGB: 0x00000040,
    LUMINANCE: 0x00000080,
};

const DDS_HEADER_FLAGS = {
    TEXTURE: 0x00001007,
    MIPMAP: 0x00020000,
    VOLUME: 0x00800000,
    PITCH: 0x00000008,
    LINEARSIZE: 0x00080000,
};

const DDS_SURFACE_FLAGS = {
    TEXTURE: 0x00001000,
    MIPMAP: 0x00400008,
    COMPLEX: 0x00000008,
    CUBEMAP: 0x00000200,
};

/**
 * Make FourCC code from string
 */
function makeFourCC(str) {
    return (
        str.charCodeAt(0) |
        (str.charCodeAt(1) << 8) |
        (str.charCodeAt(2) << 16) |
        (str.charCodeAt(3) << 24)
    );
}

const FOURCC_DXT1 = makeFourCC('DXT1');
const FOURCC_DXT3 = makeFourCC('DXT3');
const FOURCC_DXT5 = makeFourCC('DXT5');

/**
 * Parse a DDS texture file
 * Returns raw pixel data suitable for Three.js texture creation
 *
 * @param {string} ddsPath - Path to .dds file
 * @returns {Object|null} { width, height, format, mipmaps, data }
 */
export function parseDDSFile(ddsPath) {
    try {
        if (!fs.existsSync(ddsPath)) {
            console.warn('parseDDSFile: file not found', { context: 'model-service', ddsPath });
            return null;
        }

        const buffer = fs.readFileSync(ddsPath);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        let offset = 0;

        // Read magic number
        const magic = view.getUint32(offset, true);
        offset += 4;
        if (magic !== DDS_MAGIC) {
            console.warn(`parseDDSFile: Invalid DDS magic: ${magic.toString(16)}`, { context: 'model-service', ddsPath });
            return null;
        }

        // Read DDS header (124 bytes)
        const headerSize = view.getUint32(offset, true);
        offset += 4;
        if (headerSize !== 124) {
            console.warn(`parseDDSFile: Invalid DDS header size: ${headerSize}`, { context: 'model-service', ddsPath });
            return null;
        }

        const flags = view.getUint32(offset, true);
        offset += 4;
        const height = view.getUint32(offset, true);
        offset += 4;
        const width = view.getUint32(offset, true);
        offset += 4;
        const pitchOrLinearSize = view.getUint32(offset, true);
        offset += 4;
        const depth = view.getUint32(offset, true);
        offset += 4;
        const mipmapCount = view.getUint32(offset, true);
        offset += 4;

        // Skip reserved1[11]
        offset += 11 * 4;

        // Read pixel format (32 bytes)
        const pfSize = view.getUint32(offset, true);
        offset += 4;
        const pfFlags = view.getUint32(offset, true);
        offset += 4;
        const fourCC = view.getUint32(offset, true);
        offset += 4;
        const rgbBitCount = view.getUint32(offset, true);
        offset += 4;
        const rMask = view.getUint32(offset, true);
        offset += 4;
        const gMask = view.getUint32(offset, true);
        offset += 4;
        const bMask = view.getUint32(offset, true);
        offset += 4;
        const aMask = view.getUint32(offset, true);
        offset += 4;

        // Skip caps1, caps2, caps3, caps4, reserved2
        offset += 5 * 4;

        // Determine format
        let format = 'unknown';
        let blockSize = 0;
        let isCompressed = false;

        if (pfFlags & DDS_FLAGS.FOURCC) {
            isCompressed = true;
            switch (fourCC) {
                case FOURCC_DXT1:
                    format = 'dxt1';
                    blockSize = 8;
                    break;
                case FOURCC_DXT3:
                    format = 'dxt3';
                    blockSize = 16;
                    break;
                case FOURCC_DXT5:
                    format = 'dxt5';
                    blockSize = 16;
                    break;
                default:
                    console.warn(`Unknown DDS FourCC: ${fourCC.toString(16)}`);
                    return null;
            }
        } else if (pfFlags & DDS_FLAGS.RGB) {
            isCompressed = false;
            if (rgbBitCount === 32) {
                format = aMask ? 'rgba' : 'rgbx';
            } else if (rgbBitCount === 24) {
                format = 'rgb';
            } else if (rgbBitCount === 16) {
                format = 'rgb565';
            }
        } else if (pfFlags & DDS_FLAGS.LUMINANCE) {
            format = aMask ? 'la' : 'l';
        } else if (pfFlags & DDS_FLAGS.ALPHA) {
            format = 'a';
        }

        const result = {
            width,
            height,
            format,
            isCompressed,
            mipmapCount: mipmapCount || 1,
            mipmaps: [],
        };

        // Read mipmap data
        let mipWidth = width;
        let mipHeight = height;
        const dataStart = offset;

        for (let i = 0; i < result.mipmapCount; i++) {
            let dataSize;

            if (isCompressed) {
                // Compressed format: size = max(1, width/4) * max(1, height/4) * blockSize
                const blocksX = Math.max(1, Math.floor((mipWidth + 3) / 4));
                const blocksY = Math.max(1, Math.floor((mipHeight + 3) / 4));
                dataSize = blocksX * blocksY * blockSize;
            } else {
                // Uncompressed format
                const bytesPerPixel = rgbBitCount / 8;
                dataSize = mipWidth * mipHeight * bytesPerPixel;
            }

            if (offset + dataSize > buffer.length) {
                break; // Not enough data for this mipmap
            }

            const data = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, dataSize);
            result.mipmaps.push({
                width: mipWidth,
                height: mipHeight,
                data: new Uint8Array(data), // Copy to avoid buffer issues
            });

            offset += dataSize;
            mipWidth = Math.max(1, mipWidth >> 1);
            mipHeight = Math.max(1, mipHeight >> 1);
        }

        // Decode compressed textures to RGBA for Three.js compatibility
        if (isCompressed && result.mipmaps.length > 0) {
            result.mipmaps = result.mipmaps.map((mip) => ({
                width: mip.width,
                height: mip.height,
                data: decompressDXT(mip.data, mip.width, mip.height, format),
            }));
            result.format = 'rgba';
            result.isCompressed = false;
        }

        // Convert uncompressed formats to RGBA
        if (!isCompressed && result.mipmaps.length > 0) {
            result.mipmaps = result.mipmaps.map((mip) => ({
                width: mip.width,
                height: mip.height,
                data: convertToRGBA(mip.data, mip.width, mip.height, format, rMask, gMask, bMask, aMask),
            }));
            result.format = 'rgba';
        }

        // Set primary data from first mipmap
        if (result.mipmaps.length > 0) {
            result.data = result.mipmaps[0].data;
        }

        console.log('parseDDSFile: success', {
            context: 'model-service',
            ddsPath,
            width: result.width,
            height: result.height,
            format: result.format,
            dataLength: result.data?.length || 0,
            mipmapCount: result.mipmaps.length
        });

        return result;
    } catch (error) {
        console.error(`Failed to parse DDS file ${ddsPath}:`, error.message);
        return null;
    }
}

/**
 * Decompress DXT compressed texture to RGBA
 */
function decompressDXT(data, width, height, format) {
    const output = new Uint8Array(width * height * 4);
    const blocksX = Math.max(1, Math.floor((width + 3) / 4));
    const blocksY = Math.max(1, Math.floor((height + 3) / 4));

    let dataOffset = 0;

    for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
            let alphaData = null;

            // Read alpha block for DXT3/DXT5
            if (format === 'dxt3') {
                alphaData = decompressDXT3Alpha(data, dataOffset);
                dataOffset += 8;
            } else if (format === 'dxt5') {
                alphaData = decompressDXT5Alpha(data, dataOffset);
                dataOffset += 8;
            }

            // Read color block
            const colors = decompressDXTColorBlock(data, dataOffset, format === 'dxt1');
            dataOffset += 8;

            // Write to output
            for (let py = 0; py < 4; py++) {
                for (let px = 0; px < 4; px++) {
                    const x = bx * 4 + px;
                    const y = by * 4 + py;

                    if (x < width && y < height) {
                        const srcIdx = py * 4 + px;
                        const dstIdx = (y * width + x) * 4;

                        output[dstIdx] = colors[srcIdx * 4];
                        output[dstIdx + 1] = colors[srcIdx * 4 + 1];
                        output[dstIdx + 2] = colors[srcIdx * 4 + 2];

                        if (alphaData) {
                            output[dstIdx + 3] = alphaData[srcIdx];
                        } else {
                            output[dstIdx + 3] = colors[srcIdx * 4 + 3];
                        }
                    }
                }
            }
        }
    }

    return output;
}

/**
 * Decompress a single DXT color block
 */
function decompressDXTColorBlock(data, offset, isDXT1) {
    const output = new Uint8Array(64); // 4x4 pixels * 4 components

    // Read two 16-bit colors
    const c0 = data[offset] | (data[offset + 1] << 8);
    const c1 = data[offset + 2] | (data[offset + 3] << 8);

    // Expand to RGB - DDS uses RGB565 format where bits are: RRRRR GGGGGG BBBBB
    // But stored in little-endian, so we need to extract correctly
    const colors = new Uint8Array(16);

    // Color 0 - Extract RGB from 565 format
    // In DDS RGB565: bits 15-11 = R, bits 10-5 = G, bits 4-0 = B
    colors[0] = ((c0 >> 11) & 0x1f) * 255 / 31; // R
    colors[1] = ((c0 >> 5) & 0x3f) * 255 / 63;  // G
    colors[2] = (c0 & 0x1f) * 255 / 31;         // B
    colors[3] = 255;                             // A

    // Color 1
    colors[4] = ((c1 >> 11) & 0x1f) * 255 / 31; // R
    colors[5] = ((c1 >> 5) & 0x3f) * 255 / 63;  // G
    colors[6] = (c1 & 0x1f) * 255 / 31;         // B
    colors[7] = 255;

    // Interpolated colors
    if (c0 > c1 || !isDXT1) {
        // 4-color block
        colors[8] = (2 * colors[0] + colors[4]) / 3;
        colors[9] = (2 * colors[1] + colors[5]) / 3;
        colors[10] = (2 * colors[2] + colors[6]) / 3;
        colors[11] = 255;

        colors[12] = (colors[0] + 2 * colors[4]) / 3;
        colors[13] = (colors[1] + 2 * colors[5]) / 3;
        colors[14] = (colors[2] + 2 * colors[6]) / 3;
        colors[15] = 255;
    } else {
        // 3-color block with transparency (DXT1 only)
        colors[8] = (colors[0] + colors[4]) / 2;
        colors[9] = (colors[1] + colors[5]) / 2;
        colors[10] = (colors[2] + colors[6]) / 2;
        colors[11] = 255;

        colors[12] = 0;
        colors[13] = 0;
        colors[14] = 0;
        colors[15] = 0; // Transparent
    }

    // Read indices
    const indices =
        data[offset + 4] |
        (data[offset + 5] << 8) |
        (data[offset + 6] << 16) |
        (data[offset + 7] << 24);

    // Write pixels
    for (let i = 0; i < 16; i++) {
        const colorIdx = (indices >> (i * 2)) & 0x03;
        output[i * 4] = colors[colorIdx * 4];
        output[i * 4 + 1] = colors[colorIdx * 4 + 1];
        output[i * 4 + 2] = colors[colorIdx * 4 + 2];
        output[i * 4 + 3] = colors[colorIdx * 4 + 3];
    }

    return output;
}

/**
 * Decompress DXT3 alpha block
 */
function decompressDXT3Alpha(data, offset) {
    const output = new Uint8Array(16);

    for (let i = 0; i < 8; i++) {
        const byte = data[offset + i];
        output[i * 2] = (byte & 0x0f) * 17;
        output[i * 2 + 1] = ((byte >> 4) & 0x0f) * 17;
    }

    return output;
}

/**
 * Decompress DXT5 alpha block
 */
function decompressDXT5Alpha(data, offset) {
    const output = new Uint8Array(16);

    const a0 = data[offset];
    const a1 = data[offset + 1];

    const alphas = new Uint8Array(8);
    alphas[0] = a0;
    alphas[1] = a1;

    if (a0 > a1) {
        alphas[2] = (6 * a0 + 1 * a1) / 7;
        alphas[3] = (5 * a0 + 2 * a1) / 7;
        alphas[4] = (4 * a0 + 3 * a1) / 7;
        alphas[5] = (3 * a0 + 4 * a1) / 7;
        alphas[6] = (2 * a0 + 5 * a1) / 7;
        alphas[7] = (1 * a0 + 6 * a1) / 7;
    } else {
        alphas[2] = (4 * a0 + 1 * a1) / 5;
        alphas[3] = (3 * a0 + 2 * a1) / 5;
        alphas[4] = (2 * a0 + 3 * a1) / 5;
        alphas[5] = (1 * a0 + 4 * a1) / 5;
        alphas[6] = 0;
        alphas[7] = 255;
    }

    // Read 48-bit indices (6 bytes)
    const indices =
        BigInt(data[offset + 2]) |
        (BigInt(data[offset + 3]) << 8n) |
        (BigInt(data[offset + 4]) << 16n) |
        (BigInt(data[offset + 5]) << 24n) |
        (BigInt(data[offset + 6]) << 32n) |
        (BigInt(data[offset + 7]) << 40n);

    for (let i = 0; i < 16; i++) {
        const alphaIdx = Number((indices >> BigInt(i * 3)) & 0x07n);
        output[i] = alphas[alphaIdx];
    }

    return output;
}

/**
 * Convert uncompressed formats to RGBA
 */
function convertToRGBA(data, width, height, format, rMask, gMask, bMask, aMask) {
    const output = new Uint8Array(width * height * 4);

    if (format === 'rgba' || format === 'rgbx') {
        // 32-bit ARGB/XRGB - need to handle mask positions
        const rShift = countTrailingZeros(rMask);
        const gShift = countTrailingZeros(gMask);
        const bShift = countTrailingZeros(bMask);
        const aShift = aMask ? countTrailingZeros(aMask) : 24;

        for (let i = 0; i < width * height; i++) {
            const pixel =
                data[i * 4] | (data[i * 4 + 1] << 8) | (data[i * 4 + 2] << 16) | (data[i * 4 + 3] << 24);

            output[i * 4] = (pixel >> rShift) & 0xff;
            output[i * 4 + 1] = (pixel >> gShift) & 0xff;
            output[i * 4 + 2] = (pixel >> bShift) & 0xff;
            output[i * 4 + 3] = aMask ? (pixel >> aShift) & 0xff : 255;
        }
    } else if (format === 'rgb') {
        // 24-bit RGB
        for (let i = 0; i < width * height; i++) {
            output[i * 4] = data[i * 3 + 2]; // R (BGR order)
            output[i * 4 + 1] = data[i * 3 + 1]; // G
            output[i * 4 + 2] = data[i * 3]; // B
            output[i * 4 + 3] = 255;
        }
    } else if (format === 'rgb565') {
        // 16-bit RGB565
        for (let i = 0; i < width * height; i++) {
            const pixel = data[i * 2] | (data[i * 2 + 1] << 8);
            output[i * 4] = ((pixel >> 11) & 0x1f) * 255 / 31;
            output[i * 4 + 1] = ((pixel >> 5) & 0x3f) * 255 / 63;
            output[i * 4 + 2] = (pixel & 0x1f) * 255 / 31;
            output[i * 4 + 3] = 255;
        }
    } else if (format === 'l') {
        // Luminance
        for (let i = 0; i < width * height; i++) {
            const l = data[i];
            output[i * 4] = l;
            output[i * 4 + 1] = l;
            output[i * 4 + 2] = l;
            output[i * 4 + 3] = 255;
        }
    } else if (format === 'la') {
        // Luminance + Alpha
        for (let i = 0; i < width * height; i++) {
            const l = data[i * 2];
            const a = data[i * 2 + 1];
            output[i * 4] = l;
            output[i * 4 + 1] = l;
            output[i * 4 + 2] = l;
            output[i * 4 + 3] = a;
        }
    } else if (format === 'a') {
        // Alpha only
        for (let i = 0; i < width * height; i++) {
            output[i * 4] = 255;
            output[i * 4 + 1] = 255;
            output[i * 4 + 2] = 255;
            output[i * 4 + 3] = data[i];
        }
    } else {
        // Unknown format - just copy as grayscale
        const bytesPerPixel = data.length / (width * height);
        for (let i = 0; i < width * height; i++) {
            const v = data[i * bytesPerPixel];
            output[i * 4] = v;
            output[i * 4 + 1] = v;
            output[i * 4 + 2] = v;
            output[i * 4 + 3] = 255;
        }
    }

    return output;
}

/**
 * Count trailing zeros in a 32-bit integer
 */
function countTrailingZeros(n) {
    if (n === 0) return 32;
    let count = 0;
    while ((n & 1) === 0) {
        n >>= 1;
        count++;
    }
    return count;
}

// ======================================================================
// Vertex Buffer Format Flags (from VertexBufferFormat.h)
// ======================================================================

const VertexBufferFlags = {
    F_none: 0x00000000,
    F_position: 0x00000001,
    F_transformed: 0x00000002,
    F_normal: 0x00000004,
    F_color0: 0x00000008,
    F_color1: 0x00000010,
    F_pointSize: 0x00000020,

    // Texture coordinate set count is bits 8-11
    TextureCoordinateSetCountShift: 8,
    TextureCoordinateSetCountMask: 0x0F,

    // Texture coordinate set dimensions are bits 12-27 (2 bits per set)
    TextureCoordinateSetDimensionBaseShift: 12,
    TextureCoordinateSetDimensionPerSetShift: 2,
    TextureCoordinateSetDimensionMask: 0x03,
};

/**
 * Parse vertex buffer format flags
 * @param {number} flags - Format flags from INFO chunk
 * @returns {Object} Parsed format info
 */
function parseVertexBufferFormat(flags) {
    const format = {
        hasPosition: (flags & VertexBufferFlags.F_position) !== 0,
        isTransformed: (flags & VertexBufferFlags.F_transformed) !== 0,
        hasNormal: (flags & VertexBufferFlags.F_normal) !== 0,
        hasColor0: (flags & VertexBufferFlags.F_color0) !== 0,
        hasColor1: (flags & VertexBufferFlags.F_color1) !== 0,
        hasPointSize: (flags & VertexBufferFlags.F_pointSize) !== 0,
        numberOfTextureCoordinateSets: 0,
        textureCoordinateSetDimensions: [],
        vertexSize: 0,
    };

    // Get number of texture coordinate sets
    format.numberOfTextureCoordinateSets =
        (flags >> VertexBufferFlags.TextureCoordinateSetCountShift) &
        VertexBufferFlags.TextureCoordinateSetCountMask;

    // Get dimensions for each texture coordinate set
    for (let i = 0; i < format.numberOfTextureCoordinateSets; i++) {
        const shift =
            VertexBufferFlags.TextureCoordinateSetDimensionBaseShift +
            i * VertexBufferFlags.TextureCoordinateSetDimensionPerSetShift;
        // Dimension is stored as (dimension - 1), so add 1
        const dim = ((flags >> shift) & VertexBufferFlags.TextureCoordinateSetDimensionMask) + 1;
        format.textureCoordinateSetDimensions.push(dim);
    }

    // Calculate vertex size in bytes
    if (format.hasPosition) format.vertexSize += 12; // 3 floats
    if (format.isTransformed) format.vertexSize += 4; // 1 float (ooz/rhw)
    if (format.hasNormal) format.vertexSize += 12; // 3 floats
    if (format.hasColor0) format.vertexSize += 4; // 1 uint32
    if (format.hasColor1) format.vertexSize += 4; // 1 uint32
    if (format.hasPointSize) format.vertexSize += 4; // 1 float

    for (const dim of format.textureCoordinateSetDimensions) {
        format.vertexSize += dim * 4; // dim floats
    }

    return format;
}

// ======================================================================
// IFF Reader (inline implementation)
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

    readInt32BE() {
        const value = this.view.getInt32(this.offset, false);
        this.offset += 4;
        return value;
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

    readUint16() {
        const value = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return value;
    }

    readInt16() {
        const value = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return value;
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
        const formStartOffset = this.offset; // Offset right after reading size, before reading tag
        const tag = this.readTag();

        // Size includes the 4-byte tag, so form content ends at formStartOffset + size
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

    atEndOfForm() {
        if (this.formStack.length === 0) return this.offset >= this.buffer.byteLength;
        const currentForm = this.formStack[this.formStack.length - 1];
        return this.offset >= currentForm.endOffset;
    }

    getChunkLengthLeft(chunk) {
        return chunk.endOffset - this.offset;
    }

    getCurrentFormName() {
        if (this.formStack.length === 0) return null;
        return this.formStack[this.formStack.length - 1].tag;
    }
}

// ======================================================================
// APT (Appearance Template) Parser
// ======================================================================

/**
 * Parse an APT (Appearance Template) file to get mesh path
 * APT files reference the actual mesh/LOD file to render
 *
 * @param {string} aptPath - Path to .apt file
 * @returns {Object|null} { path, type } - Path to mesh/lod file and its type
 */
export function parseAPTFile(aptPath) {
    try {
        if (!fs.existsSync(aptPath)) {
            return null;
        }

        const buffer = fs.readFileSync(aptPath);
        const reader = new IFFReader(buffer);

        // APT files are simple - they just contain a NAME chunk with the path
        const rootTag = reader.enterForm();

        // Could be APT, APPR, or version tag
        if (rootTag !== 'APT ' && rootTag !== 'APPR') {
            // Try to find the actual appearance path
            const version = reader.enterForm();

            while (reader.hasMore()) {
                const tag = reader.peekTag();

                if (tag === 'NAME') {
                    const chunk = reader.enterChunk('NAME');
                    const meshPath = reader.readString(chunk.size);
                    reader.exitChunk(chunk);

                    if (meshPath) {
                        const ext = path.extname(meshPath).toLowerCase();
                        return { path: meshPath, type: ext };
                    }
                } else if (tag === 'FORM') {
                    reader.enterForm();
                    reader.exitForm();
                } else {
                    reader.skipChunk();
                }
            }

            reader.exitForm();
        }

        // Standard APT structure
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'NAME') {
                const chunk = reader.enterChunk('NAME');
                const meshPath = reader.readString(chunk.size);
                reader.exitChunk(chunk);

                if (meshPath) {
                    const ext = path.extname(meshPath).toLowerCase();
                    return { path: meshPath, type: ext };
                }
            } else if (tag === 'FORM') {
                const formTag = reader.enterForm();
                // Check for version forms (0000, 0001, etc.)
                if (/^\d{4}$/.test(formTag)) {
                    while (reader.hasMore()) {
                        const innerTag = reader.peekTag();
                        if (innerTag === 'NAME') {
                            const chunk = reader.enterChunk('NAME');
                            const meshPath = reader.readString(chunk.size);
                            reader.exitChunk(chunk);

                            if (meshPath) {
                                const ext = path.extname(meshPath).toLowerCase();
                                return { path: meshPath, type: ext };
                            }
                        } else if (innerTag === 'FORM') {
                            reader.enterForm();
                            reader.exitForm();
                        } else {
                            reader.skipChunk();
                        }
                    }
                }
                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }

        return null;
    } catch (error) {
        console.error(`Failed to parse APT file ${aptPath}:`, error.message);
        return null;
    }
}

// ======================================================================
// DTLA (Detail Appearance / LOD) Parser
// ======================================================================

/**
 * Parse a DTLA (Detail Appearance / LOD) file to get the highest detail mesh
 * Based on DetailAppearanceTemplate.cpp
 *
 * @param {string} dtlaPath - Path to .lmg, .lod or similar LOD file
 * @param {string} basePath - Base path for resolving relative mesh paths
 * @returns {string|null} Path to highest detail mesh file
 */
export function parseDTLAFile(dtlaPath, basePath) {
    try {
        if (!fs.existsSync(dtlaPath)) {
            return null;
        }

        const buffer = fs.readFileSync(dtlaPath);
        const reader = new IFFReader(buffer);

        const formTag = reader.enterForm();

        // Handle different LOD container types
        if (formTag !== 'DTLA' && formTag !== 'MLOD') {
            // Not a standard LOD file, try to parse as mesh directly
            reader.exitForm();
            return null;
        }

        const version = reader.enterForm();

        const childList = [];

        // Parse INFO chunk for child entries (from loadEntries in C++)
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'INFO') {
                const chunk = reader.enterChunk('INFO');
                // Read child info entries
                while (reader.getChunkLengthLeft(chunk) > 0) {
                    const id = reader.readInt32();
                    const nearDistance = reader.readFloat();
                    const farDistance = reader.readFloat();
                    childList.push({ id, nearDistance, farDistance, appearanceTemplateName: null });
                }
                reader.exitChunk(chunk);
            } else if (tag === 'FORM') {
                const subFormTag = reader.enterForm();

                if (subFormTag === 'DATA') {
                    // Read CHLD chunks with appearance template names
                    while (reader.hasMore()) {
                        const childTag = reader.peekTag();
                        if (childTag === 'CHLD') {
                            const childChunk = reader.enterChunk('CHLD');
                            const id = reader.readInt32();
                            const name = reader.readNullTerminatedString();

                            // Find the child entry and set its name
                            const child = childList.find((c) => c.id === id);
                            if (child) {
                                child.appearanceTemplateName = name;
                            }
                            reader.exitChunk(childChunk);
                        } else {
                            reader.skipChunk();
                        }
                    }
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm();
        reader.exitForm();

        console.log('DTLA parsed', {
            context: 'model-service',
            dtlaPath,
            childCount: childList.length,
            children: childList.map(c => ({ id: c.id, name: c.appearanceTemplateName, near: c.nearDistance, far: c.farDistance }))
        });

        // Return the highest detail mesh (last in list, or first with _l0)
        if (childList.length > 0) {
            // Sort by farDistance descending to get highest detail first
            childList.sort((a, b) => b.farDistance - a.farDistance);

            // Look for _l0 (highest detail) first
            for (const child of childList) {
                if (child.appearanceTemplateName && child.appearanceTemplateName.includes('_l0')) {
                    return child.appearanceTemplateName;
                }
            }

            // Otherwise return the first valid mesh
            for (const child of childList) {
                if (child.appearanceTemplateName) {
                    return child.appearanceTemplateName;
                }
            }
        }

        // Fallback: try to derive from filename
        const lodFilename = path.basename(dtlaPath, path.extname(dtlaPath));
        console.log('DTLA fallback - looking for mesh by filename', {
            context: 'model-service',
            lodFilename,
            childCount: childList.length
        });

        const possibleMeshNames = [
            `appearance/mesh/${lodFilename}_l0.msh`,
            `appearance/mesh/${lodFilename}_s0.msh`,
            `appearance/mesh/${lodFilename}.msh`,
            `mesh/${lodFilename}_l0.msh`,
            `mesh/${lodFilename}_s0.msh`,
            `mesh/${lodFilename}.msh`,
        ];

        for (const meshName of possibleMeshNames) {
            const fullPath = path.join(basePath, meshName);
            if (fs.existsSync(fullPath)) {
                console.log('DTLA fallback - found mesh', { context: 'model-service', meshName });
                return meshName;
            }
        }

        return null;
    } catch (error) {
        console.error(`Failed to parse DTLA file ${dtlaPath}:`, error.message);
        return null;
    }
}

// ======================================================================
// Shader Template Parser
// ======================================================================

/**
 * Texture address modes from StaticShaderTemplate.h
 */
const TextureAddress = {
    WRAP: 0,
    MIRROR: 1,
    CLAMP: 2,
    BORDER: 3,
    MIRROR_ONCE: 4,
};

/**
 * Texture filter modes from StaticShaderTemplate.h
 */
const TextureFilter = {
    NONE: 0,
    POINT: 1,
    LINEAR: 2,
    ANISOTROPIC: 3,
    FLAT_CUBIC: 4,
    GAUSSIAN_CUBIC: 5,
};

/**
 * Common texture tags from SWG shaders
 */
const TextureTags = {
    MAIN: 'MAIN', // Diffuse/albedo texture
    NRML: 'NRML', // Normal map
    SPEC: 'SPEC', // Specular map
    ENVM: 'ENVM', // Environment map (cubemap)
    DOT3: 'DOT3', // Dot3 normal mapping
    HMAP: 'HMAP', // Height map
    MASK: 'MASK', // Mask texture
    DTEX: 'DTEX', // Detail texture
};

/**
 * Parse a Shader Template file to get texture references
 * Supports multiple shader types: SSHT (Static), CSHD (Custom), etc.
 * Based on StaticShaderTemplate.cpp and CustomizableShaderTemplate.cpp
 *
 * @param {string} shaderPath - Path to .sht file
 * @returns {Object|null} Shader data with texture references
 */
export function parseShaderTemplateFile(shaderPath) {
    try {
        if (!fs.existsSync(shaderPath)) {
            console.warn('parseShaderTemplateFile: file not found', { context: 'model-service', shaderPath });
            return null;
        }

        const buffer = fs.readFileSync(shaderPath);
        const reader = new IFFReader(buffer);

        const rootTag = reader.enterForm();
        console.log('parseShaderTemplateFile: root tag', { context: 'model-service', rootTag, shaderPath });

        // Handle different shader types
        if (rootTag === 'SSHT') {
            return parseStaticShaderTemplate(reader, shaderPath);
        } else if (rootTag === 'CSHD') {
            return parseCustomizableShaderTemplate(reader, shaderPath);
        } else {
            // Try generic texture extraction for unknown shader types
            console.log('parseShaderTemplateFile: trying generic parse for', { context: 'model-service', rootTag, shaderPath });
            return parseGenericShaderTemplate(reader, rootTag, shaderPath);
        }
    } catch (error) {
        console.error(`Failed to parse shader template ${shaderPath}:`, error.message);
        return null;
    }
}

/**
 * Generic shader parser - tries to extract textures from any IFF structure
 * Looks for TXMS forms and NAME chunks that might contain texture paths
 */
function parseGenericShaderTemplate(reader, rootTag, shaderPath) {
    const shaderData = {
        type: rootTag.toLowerCase(),
        version: 'unknown',
        textures: [],
        materials: [],
        effectFile: null,
        textureCoordinateSets: {},
        textureFactors: {},
    };

    try {
        // Try to enter a version form if present
        const tag = reader.peekTag();
        if (tag === 'FORM' || /^\d{4}$/.test(tag)) {
            try {
                const versionTag = reader.enterForm();
                shaderData.version = versionTag;
            } catch (e) {
                // Not a versioned form, continue
            }
        }

        // Scan for texture references
        scanForTextures(reader, shaderData, 0);
    } catch (error) {
        console.warn('parseGenericShaderTemplate: error during scan', {
            context: 'model-service',
            error: error.message,
            shaderPath
        });
    }

    // Clean up reader state
    try {
        while (reader.formStack.length > 0) {
            reader.exitForm();
        }
    } catch (e) {
        // Ignore cleanup errors
    }

    console.log('parseGenericShaderTemplate: complete', {
        context: 'model-service',
        rootTag,
        textureCount: shaderData.textures.length,
        textures: shaderData.textures.map(t => ({ tag: t.tag, path: t.texturePath }))
    });

    return shaderData.textures.length > 0 ? shaderData : null;
}

/**
 * Recursively scan IFF structure for texture references
 */
function scanForTextures(reader, shaderData, depth) {
    if (depth > 10) return; // Prevent infinite recursion

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'FORM') {
            const formTag = reader.enterForm();

            if (formTag === 'TXMS') {
                // Found texture maps section
                parseTextureMapSection(reader, shaderData);
            } else if (formTag === 'TXM ') {
                // Direct texture map
                const texture = parseShaderTexture(reader);
                if (texture) {
                    shaderData.textures.push(texture);
                }
            } else if (formTag === 'MATS') {
                // Materials section
                parseMaterialsSection(reader, shaderData);
            } else if (formTag === 'EFCT') {
                // Effect file
                while (reader.hasMore()) {
                    const efctTag = reader.peekTag();
                    if (efctTag === 'NAME') {
                        const chunk = reader.enterChunk('NAME');
                        shaderData.effectFile = reader.readString(chunk.size);
                        reader.exitChunk(chunk);
                    } else {
                        reader.skipChunk();
                    }
                }
            } else {
                // Recurse into other forms
                scanForTextures(reader, shaderData, depth + 1);
            }

            reader.exitForm();
        } else if (tag === 'NAME') {
            // Might be a texture name at root level
            const chunk = reader.enterChunk('NAME');
            const name = reader.readString(chunk.size);
            reader.exitChunk(chunk);

            // Check if it looks like a texture path
            if (name && (name.includes('texture/') || name.endsWith('.dds'))) {
                shaderData.textures.push({
                    tag: 'MAIN',
                    placeholder: false,
                    texturePath: name,
                    addressU: TextureAddress.WRAP,
                    addressV: TextureAddress.WRAP,
                    addressW: TextureAddress.WRAP,
                    minFilter: TextureFilter.LINEAR,
                    magFilter: TextureFilter.LINEAR,
                    mipFilter: TextureFilter.LINEAR,
                    maxAnisotropy: 1,
                });
            }
        } else {
            reader.skipChunk();
        }
    }
}

/**
 * Parse TXMS (texture maps) section
 */
function parseTextureMapSection(reader, shaderData) {
    while (reader.hasMore()) {
        const tag = reader.peekTag();
        if (tag === 'FORM') {
            const formTag = reader.enterForm();
            if (formTag === 'TXM ') {
                const texture = parseShaderTexture(reader);
                if (texture) {
                    shaderData.textures.push(texture);
                }
            } else {
                // Skip other forms
                while (reader.hasMore()) {
                    reader.skipChunk();
                }
            }
            reader.exitForm();
        } else {
            reader.skipChunk();
        }
    }
}

/**
 * Parse MATS (materials) section
 */
function parseMaterialsSection(reader, shaderData) {
    // Enter the version form inside MATS
    if (!reader.hasMore()) return;

    const versionTag = reader.peekTag();
    if (versionTag === 'FORM' || /^\d{4}$/.test(versionTag)) {
        const version = reader.enterForm();

        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'TAG ') {
                // Material tag
                const chunk = reader.enterChunk('TAG ');
                const materialTag = reader.readTag();
                reader.exitChunk(chunk);

                // Next should be material data
                if (reader.hasMore()) {
                    const material = parseMaterial(reader, materialTag);
                    if (material) {
                        shaderData.materials.push(material);
                    }
                }
            } else if (tag === 'FORM') {
                // Material data form
                const material = parseMaterial(reader, 'MAIN');
                if (material) {
                    shaderData.materials.push(material);
                }
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm();
    }
}

/**
 * Parse a single material
 */
function parseMaterial(reader, materialTag) {
    const material = {
        tag: materialTag,
        ambient: { r: 0.2, g: 0.2, b: 0.2, a: 1.0 },
        diffuse: { r: 0.8, g: 0.8, b: 0.8, a: 1.0 },
        emissive: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        specular: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        shininess: 0,
    };

    // Material data is typically in a MATL form or direct chunks
    const tag = reader.peekTag();

    if (tag === 'FORM') {
        const formTag = reader.enterForm();
        // Could be version form or MATL
        while (reader.hasMore()) {
            const innerTag = reader.peekTag();
            if (innerTag === 'DATA' || innerTag === 'MATL') {
                const chunk = reader.enterChunk();
                // Read material colors (4 colors + shininess)
                // Ambient (ARGB format)
                material.ambient.a = reader.readFloat();
                material.ambient.r = reader.readFloat();
                material.ambient.g = reader.readFloat();
                material.ambient.b = reader.readFloat();
                // Diffuse
                material.diffuse.a = reader.readFloat();
                material.diffuse.r = reader.readFloat();
                material.diffuse.g = reader.readFloat();
                material.diffuse.b = reader.readFloat();
                // Emissive
                material.emissive.a = reader.readFloat();
                material.emissive.r = reader.readFloat();
                material.emissive.g = reader.readFloat();
                material.emissive.b = reader.readFloat();
                // Specular
                material.specular.a = reader.readFloat();
                material.specular.r = reader.readFloat();
                material.specular.g = reader.readFloat();
                material.specular.b = reader.readFloat();
                // Shininess
                if (reader.getChunkLengthLeft(chunk) >= 4) {
                    material.shininess = reader.readFloat();
                }
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }
        reader.exitForm();
    }

    return material;
}

/**
 * Parse Static Shader Template (SSHT)
 * Based on StaticShaderTemplate::load_0000 and load_0001
 */
function parseStaticShaderTemplate(reader, shaderPath) {
    const version = reader.enterForm();
    console.log('parseStaticShaderTemplate: version', { context: 'model-service', version });

    const shaderData = {
        type: 'static',
        version,
        effectFile: null,
        textures: [],
        textureCoordinateSets: {},
        textureFactors: {},
        textureScrolls: {},
        alphaTestReferenceValues: {},
        stencilReferenceValues: {},
        materials: [],
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'FORM') {
            const formTag = reader.enterForm();

            if (formTag === 'EFCT') {
                // Effect file reference
                while (reader.hasMore()) {
                    const efctTag = reader.peekTag();
                    if (efctTag === 'NAME') {
                        const chunk = reader.enterChunk('NAME');
                        shaderData.effectFile = reader.readString(chunk.size);
                        reader.exitChunk(chunk);
                    } else {
                        reader.skipChunk();
                    }
                }
            } else if (formTag === 'MATS') {
                // Materials
                parseMaterialsSection(reader, shaderData);
            } else if (formTag === 'TXMS') {
                // Texture maps
                while (reader.hasMore()) {
                    const txmsTag = reader.peekTag();
                    if (txmsTag === 'FORM') {
                        const txmForm = reader.enterForm();
                        if (txmForm === 'TXM ') {
                            const texture = parseShaderTexture(reader);
                            if (texture) {
                                shaderData.textures.push(texture);
                            }
                        } else {
                            reader.exitForm();
                        }
                    } else {
                        reader.skipChunk();
                    }
                }
            } else if (formTag === 'TCSS') {
                // Texture coordinate sets - parse the chunk inside
                while (reader.hasMore()) {
                    const tcssTag = reader.peekTag();
                    if (tcssTag === '0000') {
                        const chunk = reader.enterChunk('0000');
                        while (reader.getChunkLengthLeft(chunk) >= 5) {
                            const texTag = reader.readTag();
                            const tcIndex = reader.view.getUint8(reader.offset++);
                            shaderData.textureCoordinateSets[texTag] = tcIndex;
                        }
                        reader.exitChunk(chunk);
                    } else {
                        reader.skipChunk();
                    }
                }
            } else if (formTag === 'TFNS') {
                // Texture factors
                while (reader.hasMore()) {
                    const tfnsTag = reader.peekTag();
                    if (tfnsTag === '0000') {
                        const chunk = reader.enterChunk('0000');
                        while (reader.getChunkLengthLeft(chunk) >= 8) {
                            const texTag = reader.readTag();
                            const factor = reader.readUint32();
                            shaderData.textureFactors[texTag] = factor;
                        }
                        reader.exitChunk(chunk);
                    } else {
                        reader.skipChunk();
                    }
                }
            } else if (formTag === 'TSNS') {
                // Texture scroll values
                while (reader.hasMore()) {
                    const tsnsTag = reader.peekTag();
                    if (tsnsTag === '0000') {
                        const chunk = reader.enterChunk('0000');
                        while (reader.getChunkLengthLeft(chunk) >= 20) {
                            const texTag = reader.readTag();
                            const scroll = {
                                u1: reader.readFloat(),
                                v1: reader.readFloat(),
                                u2: reader.readFloat(),
                                v2: reader.readFloat(),
                            };
                            shaderData.textureScrolls[texTag] = scroll;
                        }
                        reader.exitChunk(chunk);
                    } else {
                        reader.skipChunk();
                    }
                }
            } else if (formTag === 'ARVS') {
                // Alpha test reference values
                while (reader.hasMore()) {
                    const arvsTag = reader.peekTag();
                    if (arvsTag === '0000') {
                        const chunk = reader.enterChunk('0000');
                        while (reader.getChunkLengthLeft(chunk) >= 5) {
                            const texTag = reader.readTag();
                            const value = reader.view.getUint8(reader.offset++);
                            shaderData.alphaTestReferenceValues[texTag] = value;
                        }
                        reader.exitChunk(chunk);
                    } else {
                        reader.skipChunk();
                    }
                }
            } else if (formTag === 'SRVS') {
                // Stencil reference values
                while (reader.hasMore()) {
                    const srvsTag = reader.peekTag();
                    if (srvsTag === '0000') {
                        const chunk = reader.enterChunk('0000');
                        while (reader.getChunkLengthLeft(chunk) >= 8) {
                            const texTag = reader.readTag();
                            const value = reader.readUint32();
                            shaderData.stencilReferenceValues[texTag] = value;
                        }
                        reader.exitChunk(chunk);
                    } else {
                        reader.skipChunk();
                    }
                }
            } else {
                // Unknown form, skip
                while (reader.hasMore()) {
                    reader.skipChunk();
                }
            }

            reader.exitForm();
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();
    reader.exitForm();

    console.log('parseStaticShaderTemplate: complete', {
        context: 'model-service',
        textureCount: shaderData.textures.length,
        materialCount: shaderData.materials.length,
        textures: shaderData.textures.map(t => ({ tag: t.tag, path: t.texturePath }))
    });

    return shaderData;
}

/**
 * Parse Customizable Shader Template (CSHD)
 * These shaders reference a base shader and may have customizable textures
 */
function parseCustomizableShaderTemplate(reader, shaderPath) {
    const version = reader.enterForm();
    console.log('parseCustomizableShaderTemplate: version', { context: 'model-service', version });

    const shaderData = {
        type: 'customizable',
        version,
        baseShader: null,
        textures: [],
        textureCoordinateSets: {},
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'NAME') {
            // Base shader name
            const chunk = reader.enterChunk('NAME');
            shaderData.baseShader = reader.readString(chunk.size);
            console.log('parseCustomizableShaderTemplate: base shader', { context: 'model-service', baseShader: shaderData.baseShader });
            reader.exitChunk(chunk);
        } else if (tag === 'FORM') {
            const formTag = reader.enterForm();

            if (formTag === 'TXMS' || formTag === 'PALS' || formTag === 'ARVS' || formTag === 'HUES') {
                // Texture maps, palettes, ranged int values, hue values
                while (reader.hasMore()) {
                    const innerTag = reader.peekTag();
                    if (innerTag === 'FORM') {
                        const innerForm = reader.enterForm();
                        if (innerForm === 'TXM ') {
                            const texture = parseShaderTexture(reader);
                            if (texture) {
                                shaderData.textures.push(texture);
                            }
                        } else {
                            // Skip other forms
                            while (reader.hasMore()) {
                                reader.skipChunk();
                            }
                        }
                        reader.exitForm();
                    } else {
                        reader.skipChunk();
                    }
                }
            } else {
                // Unknown form, skip contents
                while (reader.hasMore()) {
                    reader.skipChunk();
                }
            }

            reader.exitForm();
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();
    reader.exitForm();

    // If we have a base shader and no textures, try to get textures from base shader
    if (shaderData.baseShader && shaderData.textures.length === 0) {
        console.log('parseCustomizableShaderTemplate: no textures, trying base shader', {
            context: 'model-service',
            baseShader: shaderData.baseShader
        });
        // Note: We could recursively load the base shader here, but that might cause issues
        // For now, just return what we have
    }

    console.log('parseCustomizableShaderTemplate: complete', {
        context: 'model-service',
        baseShader: shaderData.baseShader,
        textureCount: shaderData.textures.length,
        textures: shaderData.textures.map(t => ({ tag: t.tag, path: t.texturePath }))
    });

    return shaderData;
}

/**
 * Parse texture entry from shader template
 * Based on StaticShaderTemplate::load_texture_0000/0001/0002
 */
function parseShaderTexture(reader) {
    const version = reader.enterForm();

    const texture = {
        tag: null,
        placeholder: false,
        texturePath: null,
        // Texture addressing and filtering (version 0001+)
        addressU: TextureAddress.WRAP,
        addressV: TextureAddress.WRAP,
        addressW: TextureAddress.WRAP,
        mipFilter: TextureFilter.LINEAR,
        minFilter: TextureFilter.LINEAR,
        magFilter: TextureFilter.LINEAR,
        maxAnisotropy: 1,
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'DATA') {
            const chunk = reader.enterChunk('DATA');

            if (version === '0000') {
                // Version 0000: placeholder (bool), tag
                texture.placeholder = reader.view.getUint8(reader.offset++) !== 0;
                texture.tag = reader.readTag();
                // ENVM tag forces placeholder
                if (texture.tag === 'ENVM') {
                    texture.placeholder = true;
                }
            } else if (version === '0001') {
                // Version 0001: tag, placeholder (bool), addressU, addressV, addressW, mipFilter, minFilter, magFilter
                texture.tag = reader.readTag();
                texture.placeholder = reader.view.getUint8(reader.offset++) !== 0;
                if (texture.tag === 'ENVM') {
                    texture.placeholder = true;
                }
                texture.addressU = reader.view.getUint8(reader.offset++);
                texture.addressV = reader.view.getUint8(reader.offset++);
                texture.addressW = reader.view.getUint8(reader.offset++);
                texture.mipFilter = reader.view.getUint8(reader.offset++);
                texture.minFilter = reader.view.getUint8(reader.offset++);
                texture.magFilter = reader.view.getUint8(reader.offset++);
            } else if (version === '0002') {
                // Version 0002: tag, placeholder, addressU, addressV, addressW, mipFilter, minFilter, magFilter, maxAnisotropy
                texture.tag = reader.readTag();
                texture.placeholder = reader.view.getUint8(reader.offset++) !== 0;
                if (texture.tag === 'ENVM') {
                    texture.placeholder = true;
                }
                texture.addressU = reader.view.getUint8(reader.offset++);
                texture.addressV = reader.view.getUint8(reader.offset++);
                texture.addressW = reader.view.getUint8(reader.offset++);
                texture.mipFilter = reader.view.getUint8(reader.offset++);
                texture.minFilter = reader.view.getUint8(reader.offset++);
                texture.magFilter = reader.view.getUint8(reader.offset++);
                texture.maxAnisotropy = reader.view.getUint8(reader.offset++);
            } else {
                // Default: try to read tag and placeholder
                texture.tag = reader.readTag();
                texture.placeholder = reader.view.getUint8(reader.offset++) !== 0;
            }

            reader.exitChunk(chunk);
        } else if (tag === 'NAME') {
            const chunk = reader.enterChunk('NAME');
            texture.texturePath = reader.readString(chunk.size);
            reader.exitChunk(chunk);
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();

    // Return texture if it has a path or is a valid placeholder
    return (texture.texturePath || texture.placeholder) ? texture : null;
}

/**
 * Resolve shader template path to actual texture paths and full shader data
 * @param {string} shaderTemplateName - Shader template path (e.g., "shader/cloth_a.sht")
 * @param {string} clientDataPath - Base client data path
 * @param {boolean} loadBaseShader - Whether to recursively load base shader for customizable shaders
 * @returns {Object|null} Complete shader data with textures, materials, and settings
 */
export function resolveShaderTextures(shaderTemplateName, clientDataPath, loadBaseShader = true) {
    if (!shaderTemplateName || !clientDataPath) {
        return null;
    }

    try {
        // Shader templates are in the shader directory
        let shaderPath = shaderTemplateName;
        if (!shaderPath.endsWith('.sht')) {
            shaderPath += '.sht';
        }

        // Try multiple possible paths for the shader
        const possiblePaths = [
            path.join(clientDataPath, shaderPath),
            // Also try serverdata path
            clientDataPath.replace('data/sku.0/sys.client/compiled/game', 'serverdata').replace('data\\sku.0\\sys.client\\compiled\\game', 'serverdata'),
        ];

        // If path includes serverdata, add it directly
        if (!clientDataPath.includes('serverdata')) {
            const serverdataPath = path.join(path.dirname(clientDataPath.replace(/[/\\]data[/\\]sku\.0.*/, '')), 'serverdata', shaderPath);
            possiblePaths.push(serverdataPath);
        }

        let fullPath = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                fullPath = p;
                break;
            }
        }

        console.log('resolveShaderTextures: loading shader', {
            context: 'model-service',
            shaderTemplateName,
            triedPaths: possiblePaths,
            foundPath: fullPath
        });

        if (!fullPath) {
            console.warn('resolveShaderTextures: shader not found', { context: 'model-service', shaderTemplateName });
            return null;
        }

        const shaderData = parseShaderTemplateFile(fullPath);

        if (!shaderData) {
            console.warn('resolveShaderTextures: failed to parse shader', { context: 'model-service', fullPath });
            return null;
        }

        // If it's a customizable shader with a base shader, load base shader textures
        if (loadBaseShader && shaderData.type === 'customizable' && shaderData.baseShader) {
            const baseShaderData = resolveShaderTextures(shaderData.baseShader, clientDataPath, false);
            if (baseShaderData) {
                // Merge base shader textures (customizable overrides base)
                const baseTextureMap = {};
                for (const tex of baseShaderData.all || []) {
                    if (tex.tag && tex.texturePath) {
                        baseTextureMap[tex.tag] = tex;
                    }
                }
                // Override with customizable textures
                for (const tex of shaderData.textures) {
                    if (tex.tag) {
                        baseTextureMap[tex.tag] = tex;
                    }
                }
                shaderData.textures = Object.values(baseTextureMap);

                // Merge materials if not defined
                if ((!shaderData.materials || shaderData.materials.length === 0) && baseShaderData.materials) {
                    shaderData.materials = baseShaderData.materials;
                }
            }
        }

        console.log('resolveShaderTextures: parsed shader', {
            context: 'model-service',
            type: shaderData.type,
            textureCount: shaderData.textures.length,
            materialCount: shaderData.materials?.length || 0,
            textures: shaderData.textures.map(t => ({ tag: t.tag, path: t.texturePath }))
        });

        const result = {
            diffuse: null,
            normal: null,
            specular: null,
            environment: null,
            detail: null,
            all: shaderData.textures,
            materials: shaderData.materials || [],
            textureCoordinateSets: shaderData.textureCoordinateSets || {},
            textureFactors: shaderData.textureFactors || {},
            effectFile: shaderData.effectFile,
            type: shaderData.type,
        };

        // Map texture tags to types
        // Normalize paths to use forward slashes for cross-platform compatibility
        for (const tex of shaderData.textures) {
            if (!tex.texturePath) continue;

            // Normalize backslashes to forward slashes
            const normalizedPath = tex.texturePath.replace(/\\/g, '/');
            tex.texturePath = normalizedPath; // Update in-place

            const tagStr = tex.tag;
            if (tagStr === 'MAIN' || tagStr === 'main') {
                result.diffuse = normalizedPath;
            } else if (tagStr === 'NRML' || tagStr === 'nrml') {
                result.normal = normalizedPath;
            } else if (tagStr === 'SPEC' || tagStr === 'spec') {
                result.specular = normalizedPath;
            } else if (tagStr === 'ENVM' || tagStr === 'envm') {
                result.environment = normalizedPath;
            } else if (tagStr === 'DTEX' || tagStr === 'dtex') {
                result.detail = normalizedPath;
            } else if (!result.diffuse) {
                // First non-null texture as fallback diffuse
                result.diffuse = normalizedPath;
            }
        }

        return result;
    } catch (error) {
        console.error(`Failed to resolve shader textures for ${shaderTemplateName}:`, error.message);
        return null;
    }
}

/**
 * Resolve a texture path with fallbacks
 * Tries multiple directories and file extensions
 *
 * @param {string} texturePath - Relative texture path (e.g., "texture/creature/wookiee/wookiee_body_d.dds")
 * @param {string} clientDataPath - Base client data path
 * @returns {string|null} Full resolved path or null if not found
 */
export function resolveTexturePath(texturePath, clientDataPath) {
    if (!texturePath || !clientDataPath) {
        return null;
    }

    // Normalize path
    let normalizedPath = texturePath.replace(/\\/g, '/');

    // Ensure .dds extension
    if (!normalizedPath.toLowerCase().endsWith('.dds')) {
        normalizedPath += '.dds';
    }

    // Try multiple base paths
    const basePaths = [
        clientDataPath,
        // Try serverdata path
        clientDataPath.replace(/data[/\\]sku\.0[/\\]sys\.client[/\\]compiled[/\\]game/g, 'serverdata'),
    ];

    // Try variations of the path
    const pathVariations = [
        normalizedPath,
        // Without texture/ prefix
        normalizedPath.replace(/^texture[/\\]/, ''),
        // With texture/ prefix
        normalizedPath.startsWith('texture/') ? normalizedPath : `texture/${normalizedPath}`,
    ];

    for (const basePath of basePaths) {
        for (const variation of pathVariations) {
            const fullPath = path.join(basePath, variation);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
    }

    return null;
}

/**
 * Load a texture file and return its data
 *
 * @param {string} texturePath - Relative texture path
 * @param {string} clientDataPath - Base client data path
 * @returns {Object|null} Texture data { path, width, height, format, data, mipmaps }
 */
export function loadTexture(texturePath, clientDataPath) {
    const fullPath = resolveTexturePath(texturePath, clientDataPath);
    if (!fullPath) {
        console.warn('loadTexture: texture not found', { context: 'model-service', texturePath });
        return null;
    }

    const ddsData = parseDDSFile(fullPath);
    if (!ddsData) {
        console.warn('loadTexture: failed to parse DDS', { context: 'model-service', fullPath });
        return null;
    }

    return {
        path: texturePath,
        fullPath,
        width: ddsData.width,
        height: ddsData.height,
        format: ddsData.format,
        data: ddsData.data,
        mipmaps: ddsData.mipmaps,
    };
}

/**
 * Get all textures for a shader with full texture data loaded
 *
 * @param {string} shaderTemplateName - Shader template path
 * @param {string} clientDataPath - Base client data path
 * @returns {Object|null} Shader data with loaded texture data
 */
export function loadShaderWithTextures(shaderTemplateName, clientDataPath) {
    const shaderData = resolveShaderTextures(shaderTemplateName, clientDataPath);
    if (!shaderData) {
        return null;
    }

    // Load each texture
    const loadedTextures = {};

    for (const tex of shaderData.all || []) {
        if (tex.texturePath && !tex.placeholder) {
            const textureData = loadTexture(tex.texturePath, clientDataPath);
            if (textureData) {
                loadedTextures[tex.tag] = {
                    ...tex,
                    textureData,
                };
            }
        }
    }

    return {
        ...shaderData,
        loadedTextures,
    };
}

// ======================================================================
// CMP (Component Appearance Template) Parser
// ======================================================================

/**
 * Parse a CMP (Component Appearance Template) file
 * Component appearances combine multiple sub-appearances with transforms
 * Based on ComponentAppearanceTemplate.cpp
 *
 * @param {string} cmpPath - Path to .cmp file
 * @returns {Object|null} Component appearance data with parts
 */
export function parseCMPFile(cmpPath) {
    try {
        console.log('parseCMPFile: starting', { context: 'model-service', cmpPath });

        if (!fs.existsSync(cmpPath)) {
            console.warn('parseCMPFile: file not found', { context: 'model-service', cmpPath });
            return null;
        }

        const buffer = fs.readFileSync(cmpPath);
        const reader = new IFFReader(buffer);

        const rootTag = reader.enterForm();
        console.log('parseCMPFile: root tag', { context: 'model-service', rootTag });

        if (rootTag !== 'CMPA') {
            console.warn('parseCMPFile: not a CMPA file', { context: 'model-service', rootTag });
            reader.exitForm();
            return null;
        }

        const version = reader.enterForm();
        console.log('parseCMPFile: version', { context: 'model-service', version });

        const cmpData = {
            version,
            components: [],
            radarShape: null,
            extent: null,
        };

        // Version 3+ has appearance template data first
        if (version === '0003' || version === '0004' || version === '0005') {
            // Parse base appearance template data (extent, etc.)
            while (reader.hasMore()) {
                const tag = reader.peekTag();
                if (tag === 'FORM') {
                    const formTag = reader.enterForm();
                    if (formTag === 'APPR') {
                        // Base appearance data - skip for now
                        reader.exitForm();
                        break;
                    } else if (formTag === 'EXBX' || formTag === 'EXSP') {
                        // Extent box or sphere
                        reader.exitForm();
                    } else {
                        reader.exitForm();
                    }
                } else if (tag === 'PART') {
                    // Found parts section
                    break;
                } else {
                    reader.skipChunk();
                }
            }
        }

        // Version 5 has radar shape before parts
        if (version === '0005') {
            while (reader.hasMore()) {
                const tag = reader.peekTag();
                if (tag === 'FORM') {
                    const formTag = reader.enterForm();
                    if (formTag === 'RADR') {
                        // Radar shape data - skip for now
                        reader.exitForm();
                    } else {
                        reader.exitForm();
                    }
                } else if (tag === 'PART') {
                    break;
                } else {
                    reader.skipChunk();
                }
            }
        }

        // Parse component parts
        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'PART') {
                const chunk = reader.enterChunk('PART');

                const component = {
                    appearancePath: reader.readNullTerminatedString(),
                    transform: null,
                };

                // Read transform based on version
                if (version === '0001') {
                    // Old format: position + yaw/pitch/roll in degrees
                    const pos = reader.readVector3();
                    const yaw = reader.readFloat() * Math.PI / 180;
                    const pitch = reader.readFloat() * Math.PI / 180;
                    const roll = reader.readFloat() * Math.PI / 180;

                    component.transform = {
                        position: pos,
                        rotation: { yaw, pitch, roll },
                        matrix: null,
                    };
                } else {
                    // New format: full 4x3 transform matrix (12 floats)
                    const matrix = [];
                    for (let i = 0; i < 12; i++) {
                        matrix.push(reader.readFloat());
                    }
                    component.transform = {
                        position: { x: matrix[9], y: matrix[10], z: matrix[11] },
                        rotation: null,
                        matrix: matrix,
                    };
                }

                cmpData.components.push(component);
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm(); // version
        reader.exitForm(); // CMPA

        console.log('parseCMPFile: complete', {
            context: 'model-service',
            componentCount: cmpData.components.length,
            components: cmpData.components.map(c => c.appearancePath)
        });

        return cmpData;
    } catch (error) {
        console.error(`Failed to parse CMP file ${cmpPath}:`, error.message);
        return null;
    }
}

// ======================================================================
// SKT (Skeleton Template) Parser
// ======================================================================

/**
 * Parse a SKT (Skeleton Template) file
 * Contains bone hierarchy and bind pose data
 * Based on BasicSkeletonTemplate.cpp
 *
 * @param {string} sktPath - Path to .skt file
 * @returns {Object|null} Skeleton data with joints and bind poses
 */
export function parseSKTFile(sktPath) {
    try {
        console.log('parseSKTFile: starting', { context: 'model-service', sktPath });

        if (!fs.existsSync(sktPath)) {
            console.warn('parseSKTFile: file not found', { context: 'model-service', sktPath });
            return null;
        }

        const buffer = fs.readFileSync(sktPath);
        const reader = new IFFReader(buffer);

        const rootTag = reader.enterForm();
        console.log('parseSKTFile: root tag', { context: 'model-service', rootTag });

        if (rootTag !== 'SKTM') {
            console.warn('parseSKTFile: not a SKTM file', { context: 'model-service', rootTag });
            reader.exitForm();
            return null;
        }

        const version = reader.enterForm();
        console.log('parseSKTFile: version', { context: 'model-service', version });

        const sktData = {
            version,
            jointCount: 0,
            joints: [],
        };

        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'INFO') {
                const chunk = reader.enterChunk('INFO');
                sktData.jointCount = reader.readInt32();
                reader.exitChunk(chunk);
            } else if (tag === 'NAME') {
                // Joint names
                const chunk = reader.enterChunk('NAME');
                for (let i = 0; i < sktData.jointCount && reader.getChunkLengthLeft(chunk) > 0; i++) {
                    const name = reader.readNullTerminatedString();
                    if (!sktData.joints[i]) {
                        sktData.joints[i] = { name };
                    } else {
                        sktData.joints[i].name = name;
                    }
                }
                reader.exitChunk(chunk);
            } else if (tag === 'PRNT') {
                // Parent indices
                const chunk = reader.enterChunk('PRNT');
                for (let i = 0; i < sktData.jointCount && reader.getChunkLengthLeft(chunk) >= 4; i++) {
                    if (!sktData.joints[i]) {
                        sktData.joints[i] = {};
                    }
                    sktData.joints[i].parentIndex = reader.readInt32();
                }
                reader.exitChunk(chunk);
            } else if (tag === 'RPRE') {
                // Pre-multiply rotations (quaternions)
                const chunk = reader.enterChunk('RPRE');
                for (let i = 0; i < sktData.jointCount && reader.getChunkLengthLeft(chunk) >= 16; i++) {
                    if (!sktData.joints[i]) {
                        sktData.joints[i] = {};
                    }
                    sktData.joints[i].preRotation = {
                        x: reader.readFloat(),
                        y: reader.readFloat(),
                        z: reader.readFloat(),
                        w: reader.readFloat(),
                    };
                }
                reader.exitChunk(chunk);
            } else if (tag === 'RPST') {
                // Post-multiply rotations (quaternions)
                const chunk = reader.enterChunk('RPST');
                for (let i = 0; i < sktData.jointCount && reader.getChunkLengthLeft(chunk) >= 16; i++) {
                    if (!sktData.joints[i]) {
                        sktData.joints[i] = {};
                    }
                    sktData.joints[i].postRotation = {
                        x: reader.readFloat(),
                        y: reader.readFloat(),
                        z: reader.readFloat(),
                        w: reader.readFloat(),
                    };
                }
                reader.exitChunk(chunk);
            } else if (tag === 'BPTR') {
                // Bind pose translations
                const chunk = reader.enterChunk('BPTR');
                for (let i = 0; i < sktData.jointCount && reader.getChunkLengthLeft(chunk) >= 12; i++) {
                    if (!sktData.joints[i]) {
                        sktData.joints[i] = {};
                    }
                    sktData.joints[i].bindPoseTranslation = reader.readVector3();
                }
                reader.exitChunk(chunk);
            } else if (tag === 'BPRO') {
                // Bind pose rotations (quaternions)
                const chunk = reader.enterChunk('BPRO');
                for (let i = 0; i < sktData.jointCount && reader.getChunkLengthLeft(chunk) >= 16; i++) {
                    if (!sktData.joints[i]) {
                        sktData.joints[i] = {};
                    }
                    sktData.joints[i].bindPoseRotation = {
                        x: reader.readFloat(),
                        y: reader.readFloat(),
                        z: reader.readFloat(),
                        w: reader.readFloat(),
                    };
                }
                reader.exitChunk(chunk);
            } else if (tag === 'BPMJ') {
                // Bind pose model-to-joint transforms (4x3 matrices, 12 floats each)
                const chunk = reader.enterChunk('BPMJ');
                for (let i = 0; i < sktData.jointCount && reader.getChunkLengthLeft(chunk) >= 48; i++) {
                    if (!sktData.joints[i]) {
                        sktData.joints[i] = {};
                    }
                    const matrix = [];
                    for (let j = 0; j < 12; j++) {
                        matrix.push(reader.readFloat());
                    }
                    sktData.joints[i].bindPoseMatrix = matrix;
                }
                reader.exitChunk(chunk);
            } else if (tag === 'JROR') {
                // Joint rotation order
                const chunk = reader.enterChunk('JROR');
                for (let i = 0; i < sktData.jointCount && reader.getChunkLengthLeft(chunk) >= 4; i++) {
                    if (!sktData.joints[i]) {
                        sktData.joints[i] = {};
                    }
                    sktData.joints[i].rotationOrder = reader.readUint32();
                }
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm(); // version
        reader.exitForm(); // SKTM

        console.log('parseSKTFile: complete', {
            context: 'model-service',
            jointCount: sktData.jointCount,
            joints: sktData.joints.map(j => j.name)
        });

        return sktData;
    } catch (error) {
        console.error(`Failed to parse SKT file ${sktPath}:`, error.message);
        return null;
    }
}

// ======================================================================
// POB (Portal Object/Building) Parser
// ======================================================================

/**
 * Parse a POB (Portal Object) file
 * Contains building interiors with cells connected by portals
 * Based on PortalPropertyTemplate.cpp
 *
 * @param {string} pobPath - Path to .pob file
 * @returns {Object|null} Portal object data with cells
 */
export function parsePOBFile(pobPath) {
    try {
        console.log('parsePOBFile: starting', { context: 'model-service', pobPath });

        if (!fs.existsSync(pobPath)) {
            console.warn('parsePOBFile: file not found', { context: 'model-service', pobPath });
            return null;
        }

        const buffer = fs.readFileSync(pobPath);
        const reader = new IFFReader(buffer);

        const rootTag = reader.enterForm();
        console.log('parsePOBFile: root tag', { context: 'model-service', rootTag });

        if (rootTag !== 'PRTO') {
            console.warn('parsePOBFile: not a PRTO file', { context: 'model-service', rootTag });
            reader.exitForm();
            return null;
        }

        const version = reader.enterForm();
        console.log('parsePOBFile: version', { context: 'model-service', version });

        const pobData = {
            version,
            cells: [],
            portals: [],
            crc: null,
        };

        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'CELL' || formTag === '0000' || formTag === '0001' || formTag === '0002') {
                    // Cell form
                    const cell = parsePOBCell(reader, formTag);
                    if (cell) {
                        pobData.cells.push(cell);
                    }
                } else if (formTag === 'PRTL') {
                    // Portal form
                    while (reader.hasMore()) {
                        const portalTag = reader.peekTag();
                        if (portalTag === 'PRTL') {
                            const chunk = reader.enterChunk('PRTL');
                            const portal = {
                                cell1: reader.readInt32(),
                                cell2: reader.readInt32(),
                                vertices: [],
                            };
                            const vertexCount = reader.readInt32();
                            for (let i = 0; i < vertexCount && reader.getChunkLengthLeft(chunk) >= 12; i++) {
                                portal.vertices.push(reader.readVector3());
                            }
                            pobData.portals.push(portal);
                            reader.exitChunk(chunk);
                        } else {
                            reader.skipChunk();
                        }
                    }
                }

                reader.exitForm();
            } else if (tag === 'CRC ') {
                const chunk = reader.enterChunk('CRC ');
                pobData.crc = reader.readUint32();
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm(); // version
        reader.exitForm(); // PRTO

        console.log('parsePOBFile: complete', {
            context: 'model-service',
            cellCount: pobData.cells.length,
            portalCount: pobData.portals.length
        });

        return pobData;
    } catch (error) {
        console.error(`Failed to parse POB file ${pobPath}:`, error.message);
        return null;
    }
}

/**
 * Parse a cell from POB file
 */
function parsePOBCell(reader, formTag) {
    const cell = {
        name: null,
        appearancePath: null,
        floorPath: null,
        canSeeWorldCell: false,
        portals: [],
        lights: [],
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'DATA') {
            const chunk = reader.enterChunk('DATA');
            cell.canSeeWorldCell = reader.view.getUint8(reader.offset++) !== 0;
            cell.name = reader.readNullTerminatedString();
            cell.appearancePath = reader.readNullTerminatedString();
            if (reader.getChunkLengthLeft(chunk) > 0) {
                cell.floorPath = reader.readNullTerminatedString();
            }
            reader.exitChunk(chunk);
        } else if (tag === 'PRTL') {
            // Portal indices for this cell
            const chunk = reader.enterChunk('PRTL');
            while (reader.getChunkLengthLeft(chunk) >= 4) {
                cell.portals.push(reader.readInt32());
            }
            reader.exitChunk(chunk);
        } else if (tag === 'LGHT') {
            // Lights
            const chunk = reader.enterChunk('LGHT');
            while (reader.getChunkLengthLeft(chunk) >= 32) {
                const light = {
                    type: reader.readInt32(),
                    diffuseColor: {
                        r: reader.readFloat(),
                        g: reader.readFloat(),
                        b: reader.readFloat(),
                        a: reader.readFloat(),
                    },
                    position: reader.readVector3(),
                    constantAttenuation: reader.readFloat(),
                    linearAttenuation: reader.readFloat(),
                    quadraticAttenuation: reader.readFloat(),
                };
                cell.lights.push(light);
            }
            reader.exitChunk(chunk);
        } else if (tag === 'FORM') {
            const subFormTag = reader.enterForm();
            // Skip nested forms for now
            reader.exitForm();
        } else {
            reader.skipChunk();
        }
    }

    return cell;
}

// ======================================================================
// SAT (Skeletal Appearance Template) Parser
// ======================================================================

/**
 * Parse a SAT (Skeletal Appearance Template) file
 * Based on SkeletalAppearanceTemplate.cpp
 *
 * @param {string} satPath - Path to .sat file
 * @returns {Object|null} Skeletal appearance data
 */
export function parseSATFile(satPath) {
    try {
        console.log('parseSATFile: starting', { context: 'model-service', satPath });

        if (!fs.existsSync(satPath)) {
            console.warn('parseSATFile: file not found', { context: 'model-service', satPath });
            return null;
        }

        const buffer = fs.readFileSync(satPath);
        const reader = new IFFReader(buffer);

        const rootTag = reader.enterForm();
        console.log('parseSATFile: root tag', { context: 'model-service', rootTag });

        if (rootTag !== 'SMAT') {
            console.warn('parseSATFile: not a SMAT file', { context: 'model-service', rootTag });
            reader.exitForm();
            return null;
        }

        const version = reader.enterForm();
        console.log('parseSATFile: version', { context: 'model-service', version });

        const satData = {
            version,
            meshGeneratorNames: [],
            skeletonTemplates: [],
            animationStateGraph: null,
            latMappings: {},
        };

        while (reader.hasMore()) {
            const tag = reader.peekTag();
            console.log('parseSATFile: found tag', { context: 'model-service', tag });

            if (tag === 'INFO') {
                const chunk = reader.enterChunk('INFO');

                if (version === '0001' || version === '0002') {
                    const meshGeneratorCount = reader.readInt32();
                    const skeletonTemplateCount = reader.readInt32();

                    if (version === '0002') {
                        satData.animationStateGraph = reader.readNullTerminatedString();
                    }

                    // Store counts for later
                    satData._meshCount = meshGeneratorCount;
                    satData._skelCount = skeletonTemplateCount;
                } else if (version === '0003' || version === '0004') {
                    const meshGeneratorCount = reader.readInt32();
                    const skeletonTemplateCount = reader.readInt32();
                    const createAnimationController = reader.view.getUint8(reader.offset++) !== 0;

                    satData._meshCount = meshGeneratorCount;
                    satData._skelCount = skeletonTemplateCount;
                    satData.createAnimationController = createAnimationController;
                }

                reader.exitChunk(chunk);
            } else if (tag === 'MSGN') {
                // Mesh generator names
                const chunk = reader.enterChunk('MSGN');
                const count = satData._meshCount || 0;
                console.log('parseSATFile: reading MSGN', { context: 'model-service', expectedCount: count, chunkSize: chunk.size });

                for (let i = 0; i < count && reader.getChunkLengthLeft(chunk) > 0; i++) {
                    const name = reader.readNullTerminatedString();
                    if (name) {
                        satData.meshGeneratorNames.push(name);
                        console.log('parseSATFile: found mesh generator', { context: 'model-service', name });
                    }
                }

                reader.exitChunk(chunk);
                console.log('parseSATFile: MSGN complete', { context: 'model-service', foundCount: satData.meshGeneratorNames.length });
            } else if (tag === 'SKTI') {
                // Skeleton template info
                const chunk = reader.enterChunk('SKTI');
                const count = satData._skelCount || 0;

                for (let i = 0; i < count && reader.getChunkLengthLeft(chunk) > 0; i++) {
                    const skeletonTemplateName = reader.readNullTerminatedString();
                    const attachmentTransformName = reader.readNullTerminatedString();

                    satData.skeletonTemplates.push({
                        skeletonTemplateName,
                        attachmentTransformName,
                    });
                }

                reader.exitChunk(chunk);
            } else if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'LATX') {
                    // LAT mappings (skeleton to animation mappings)
                    while (reader.hasMore()) {
                        const latTag = reader.peekTag();
                        if (latTag === 'LMAP') {
                            const latChunk = reader.enterChunk('LMAP');
                            const sktName = reader.readNullTerminatedString();
                            const latName = reader.readNullTerminatedString();
                            satData.latMappings[sktName] = latName;
                            reader.exitChunk(latChunk);
                        } else {
                            reader.skipChunk();
                        }
                    }
                } else if (formTag === 'LDTB') {
                    // LOD distance table - skip for now
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm();
        reader.exitForm();

        // Clean up internal count fields
        delete satData._meshCount;
        delete satData._skelCount;

        return satData;
    } catch (error) {
        console.error(`Failed to parse SAT file ${satPath}:`, error.message);
        return null;
    }
}

// ======================================================================
// MGN (Skeletal Mesh Generator) Parser
// ======================================================================

/**
 * Parse a MGN (Skeletal Mesh Generator) file
 * Based on SkeletalMeshGeneratorTemplate.cpp
 *
 * @param {string} mgnPath - Path to .mgn file
 * @returns {Object|null} Mesh generator data with positions, normals, uvs, indices
 */
export function parseMGNFile(mgnPath) {
    try {
        console.log('parseMGNFile: starting', { context: 'model-service', mgnPath });

        if (!fs.existsSync(mgnPath)) {
            console.warn('parseMGNFile: file not found', { context: 'model-service', mgnPath });
            return null;
        }

        const buffer = fs.readFileSync(mgnPath);
        const reader = new IFFReader(buffer);

        const rootTag = reader.enterForm();
        console.log('parseMGNFile: root tag', { context: 'model-service', rootTag });

        if (rootTag !== 'SKMG') {
            console.warn('parseMGNFile: not a SKMG file', { context: 'model-service', rootTag });
            reader.exitForm();
            return null;
        }

        const version = reader.enterForm();
        console.log('parseMGNFile: version', { context: 'model-service', version });

        const mgnData = {
            version,
            positions: [],
            normals: [],
            transformNames: [],
            transformWeights: [],
            blendTargets: [],
            perShaderData: [],
            hardpoints: [],
            occlusionZones: [],
        };

        // Track position/normal counts
        let positionCount = 0;
        let normalCount = 0;

        while (reader.hasMore()) {
            const tag = reader.peekTag();

            if (tag === 'INFO') {
                const chunk = reader.enterChunk('INFO');

                // Version 0001-0003 have slightly different formats
                const maxTransformsPerVertex = reader.readInt32();
                positionCount = reader.readInt32();
                const transformWeightDataCount = reader.readInt32();
                normalCount = reader.readInt32();
                const perShaderDataCount = reader.readInt32();
                const blendTargetCount = reader.readInt32();

                console.log('parseMGNFile: INFO', {
                    context: 'model-service',
                    positionCount,
                    normalCount,
                    perShaderDataCount
                });

                // Version 0002+ adds occlusion zone count
                if (version !== '0001') {
                    const occlusionZoneCount = reader.readInt32();
                }

                // Version 0003+ has additional fields
                if (version === '0003' || version === '0004') {
                    const occludedZoneCombinationCount = reader.readInt32();
                    const fullyOccludedZoneCombinationCount = reader.readInt32();
                }

                mgnData._perShaderDataCount = perShaderDataCount;

                reader.exitChunk(chunk);
            } else if (tag === 'XFNM') {
                // Transform names
                const chunk = reader.enterChunk('XFNM');
                while (reader.getChunkLengthLeft(chunk) > 0) {
                    const name = reader.readNullTerminatedString();
                    if (name) {
                        mgnData.transformNames.push(name);
                    }
                }
                reader.exitChunk(chunk);
            } else if (tag === 'POSN') {
                // Positions
                const chunk = reader.enterChunk('POSN');
                for (let i = 0; i < positionCount && reader.getChunkLengthLeft(chunk) >= 12; i++) {
                    const pos = reader.readVector3();
                    mgnData.positions.push(pos.x, pos.y, pos.z);
                }
                reader.exitChunk(chunk);
            } else if (tag === 'NORM') {
                // Normals
                const chunk = reader.enterChunk('NORM');
                for (let i = 0; i < normalCount && reader.getChunkLengthLeft(chunk) >= 12; i++) {
                    const norm = reader.readVector3();
                    mgnData.normals.push(norm.x, norm.y, norm.z);
                }
                reader.exitChunk(chunk);
            } else if (tag === 'TWHD') {
                // Transform weight headers
                const chunk = reader.enterChunk('TWHD');
                while (reader.getChunkLengthLeft(chunk) >= 4) {
                    const count = reader.readInt32();
                    mgnData.transformWeights.push({ count, weights: [] });
                }
                reader.exitChunk(chunk);
            } else if (tag === 'TWDT') {
                // Transform weight data
                const chunk = reader.enterChunk('TWDT');
                let weightIdx = 0;

                for (const tw of mgnData.transformWeights) {
                    for (let i = 0; i < tw.count && reader.getChunkLengthLeft(chunk) >= 8; i++) {
                        const transformIndex = reader.readInt32();
                        const weight = reader.readFloat();
                        tw.weights.push({ transformIndex, weight });
                    }
                }

                reader.exitChunk(chunk);
            } else if (tag === 'FORM') {
                const formTag = reader.enterForm();

                if (formTag === 'BLTS') {
                    // Blend targets
                    while (reader.hasMore()) {
                        const bltsTag = reader.peekTag();
                        if (bltsTag === 'FORM') {
                            const bltTag = reader.enterForm();
                            if (bltTag === 'BLT ') {
                                const blendTarget = parseBlendTarget(reader, version);
                                if (blendTarget) {
                                    mgnData.blendTargets.push(blendTarget);
                                }
                            } else {
                                reader.exitForm();
                            }
                        } else {
                            reader.skipChunk();
                        }
                    }
                } else if (formTag === 'PSDT') {
                    // Per-shader data
                    const perShaderData = parsePerShaderData(reader, version, mgnData.positions);
                    if (perShaderData) {
                        mgnData.perShaderData.push(perShaderData);
                    }
                } else if (formTag === 'HPTS') {
                    // Hardpoints
                    while (reader.hasMore()) {
                        const hptsTag = reader.peekTag();
                        if (hptsTag === 'HPT ') {
                            const chunk = reader.enterChunk('HPT ');
                            const name = reader.readNullTerminatedString();
                            // Skip transform matrix for now (16 floats)
                            reader.offset += 16 * 4;
                            mgnData.hardpoints.push({ name });
                            reader.exitChunk(chunk);
                        } else {
                            reader.skipChunk();
                        }
                    }
                }

                reader.exitForm();
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm();
        reader.exitForm();

        // Clean up internal fields
        delete mgnData._perShaderDataCount;

        return mgnData;
    } catch (error) {
        console.error(`Failed to parse MGN file ${mgnPath}:`, error.message);
        return null;
    }
}

/**
 * Parse blend target from MGN file
 */
function parseBlendTarget(reader, version) {
    const blendTarget = {
        name: null,
        positions: [],
        normals: [],
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'INFO') {
            const chunk = reader.enterChunk('INFO');
            const positionCount = reader.readInt32();
            const normalCount = reader.readInt32();
            const name = reader.readNullTerminatedString();

            blendTarget.name = `/shared_owner/${name}`;
            blendTarget._posCount = positionCount;
            blendTarget._normCount = normalCount;

            reader.exitChunk(chunk);
        } else if (tag === 'POSN') {
            const chunk = reader.enterChunk('POSN');
            const count = blendTarget._posCount || 0;

            for (let i = 0; i < count && reader.getChunkLengthLeft(chunk) >= 16; i++) {
                const index = reader.readInt32();
                const delta = reader.readVector3();
                blendTarget.positions.push({ index, delta });
            }

            reader.exitChunk(chunk);
        } else if (tag === 'NORM') {
            const chunk = reader.enterChunk('NORM');
            const count = blendTarget._normCount || 0;

            for (let i = 0; i < count && reader.getChunkLengthLeft(chunk) >= 16; i++) {
                const index = reader.readInt32();
                const delta = reader.readVector3();
                blendTarget.normals.push({ index, delta });
            }

            reader.exitChunk(chunk);
        } else {
            reader.skipChunk();
        }
    }

    delete blendTarget._posCount;
    delete blendTarget._normCount;

    return blendTarget;
}

/**
 * Parse per-shader data from MGN file
 */
function parsePerShaderData(reader, version, positions) {
    const psd = {
        shaderTemplate: null,
        vertexCount: 0,
        positionIndices: [],
        normalIndices: [],
        colors: [],
        textureCoordinateSets: [],
        primitives: [],
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();

        if (tag === 'NAME') {
            const chunk = reader.enterChunk('NAME');
            psd.shaderTemplate = reader.readString(chunk.size);
            reader.exitChunk(chunk);
        } else if (tag === 'PIDX') {
            const chunk = reader.enterChunk('PIDX');
            psd.vertexCount = reader.readInt32();

            for (let i = 0; i < psd.vertexCount && reader.getChunkLengthLeft(chunk) >= 4; i++) {
                psd.positionIndices.push(reader.readInt32());
            }

            reader.exitChunk(chunk);
        } else if (tag === 'NIDX') {
            const chunk = reader.enterChunk('NIDX');

            for (let i = 0; i < psd.vertexCount && reader.getChunkLengthLeft(chunk) >= 4; i++) {
                psd.normalIndices.push(reader.readInt32());
            }

            reader.exitChunk(chunk);
        } else if (tag === 'DOT3') {
            // Dot3 data - skip for now
            reader.skipChunk();
        } else if (tag === 'VDCL') {
            // Vertex diffuse colors
            const chunk = reader.enterChunk('VDCL');

            for (let i = 0; i < psd.vertexCount && reader.getChunkLengthLeft(chunk) >= 4; i++) {
                const a = reader.view.getUint8(reader.offset++);
                const r = reader.view.getUint8(reader.offset++);
                const g = reader.view.getUint8(reader.offset++);
                const b = reader.view.getUint8(reader.offset++);
                psd.colors.push(r / 255, g / 255, b / 255, a / 255);
            }

            reader.exitChunk(chunk);
        } else if (tag === 'TXCI') {
            // Texture coordinate info
            const chunk = reader.enterChunk('TXCI');
            const tcSetCount = reader.readInt32();

            psd._tcDimensions = [];
            for (let i = 0; i < tcSetCount && reader.getChunkLengthLeft(chunk) >= 4; i++) {
                psd._tcDimensions.push(reader.readInt32());
            }

            reader.exitChunk(chunk);
        } else if (tag === 'FORM') {
            const formTag = reader.enterForm();

            if (formTag === 'TCSF') {
                // Texture coordinate set form
                let tcSetIndex = 0;

                while (reader.hasMore()) {
                    const tcsTag = reader.peekTag();
                    if (tcsTag === 'TCSD') {
                        const chunk = reader.enterChunk('TCSD');
                        const dim = (psd._tcDimensions && psd._tcDimensions[tcSetIndex]) || 2;
                        const tcSet = [];

                        for (let i = 0; i < psd.vertexCount && reader.getChunkLengthLeft(chunk) >= dim * 4; i++) {
                            const coords = [];
                            for (let d = 0; d < dim; d++) {
                                coords.push(reader.readFloat());
                            }
                            // Store as flat array with u,v
                            if (coords.length >= 2) {
                                tcSet.push(coords[0], coords[1]);
                            } else if (coords.length === 1) {
                                tcSet.push(coords[0], 0);
                            }
                        }

                        psd.textureCoordinateSets.push(tcSet);
                        reader.exitChunk(chunk);
                        tcSetIndex++;
                    } else {
                        reader.skipChunk();
                    }
                }
            } else if (formTag === 'PRIM') {
                // Primitive data
                while (reader.hasMore()) {
                    const primTag = reader.peekTag();

                    if (primTag === 'INFO') {
                        const chunk = reader.enterChunk('INFO');
                        const primitiveCount = reader.readInt32();
                        reader.exitChunk(chunk);
                    } else if (primTag === 'ITL ' || primTag === 'OITL') {
                        // Indexed triangle list
                        const chunk = reader.enterChunk();
                        const triangleCount = reader.readInt32();
                        const indices = [];

                        for (let t = 0; t < triangleCount && reader.getChunkLengthLeft(chunk) >= 12; t++) {
                            indices.push(reader.readInt32());
                            indices.push(reader.readInt32());
                            indices.push(reader.readInt32());
                        }

                        psd.primitives.push({
                            type: primTag === 'OITL' ? 'occluded' : 'normal',
                            triangleCount,
                            indices,
                        });

                        reader.exitChunk(chunk);
                    } else {
                        reader.skipChunk();
                    }
                }
            }

            reader.exitForm();
        } else {
            reader.skipChunk();
        }
    }

    delete psd._tcDimensions;

    return psd;
}

// ======================================================================
// LMG (LOD Mesh Generator) Parser
// ======================================================================

/**
 * Parse a LMG (LOD Mesh Generator) file to get mesh generator references
 * Based on LodMeshGeneratorTemplate.cpp
 * 
 * MLOD format (version 0000):
 *   FORM MLOD
 *     FORM 0000
 *       CHUNK INFO (int16 lodCount)
 *       CHUNK NAME (string pathName) - repeated for each LOD level
 *
 * @param {string} lmgPath - Path to .lmg file
 * @param {string} basePath - Base path for resolving relative paths
 * @returns {string|null} Path to highest detail MGN file
 */
export function parseLMGFile(lmgPath, basePath) {
    try {
        console.log('parseLMGFile: starting', { context: 'model-service', lmgPath });

        if (!fs.existsSync(lmgPath)) {
            console.warn('parseLMGFile: file not found', { context: 'model-service', lmgPath });
            return null;
        }

        const buffer = fs.readFileSync(lmgPath);
        const reader = new IFFReader(buffer);

        const rootTag = reader.enterForm();
        console.log('parseLMGFile: root tag', { context: 'model-service', rootTag });

        if (rootTag !== 'MLOD') {
            console.warn('parseLMGFile: not a MLOD file', { context: 'model-service', rootTag });
            reader.exitForm();
            return null;
        }

        const version = reader.enterForm();
        console.log('parseLMGFile: version', { context: 'model-service', version });

        const pathNames = [];
        let lodCount = 0;

        while (reader.hasMore()) {
            const tag = reader.peekTag();
            console.log('parseLMGFile: found tag', { context: 'model-service', tag });

            if (tag === 'INFO') {
                const chunk = reader.enterChunk('INFO');
                // INFO chunk contains int16 lodCount
                lodCount = reader.readInt16();
                console.log('parseLMGFile: lodCount', { context: 'model-service', lodCount });
                reader.exitChunk(chunk);
            } else if (tag === 'NAME') {
                // NAME chunk contains a path to the mesh generator for this LOD level
                const chunk = reader.enterChunk('NAME');
                const pathName = reader.readNullTerminatedString();
                if (pathName) {
                    pathNames.push(pathName);
                    console.log('parseLMGFile: found path', { context: 'model-service', pathName, index: pathNames.length - 1 });
                }
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm(); // version
        reader.exitForm(); // MLOD

        console.log('parseLMGFile: complete', {
            context: 'model-service',
            lodCount,
            pathCount: pathNames.length,
            paths: pathNames
        });

        // Return highest detail (LOD 0 = first entry)
        // The first NAME entry is the highest detail mesh
        if (pathNames.length > 0) {
            // Prefer _l0 or _s0 (highest detail) if multiple entries
            for (const name of pathNames) {
                if (name.includes('_l0') || name.includes('_s0')) {
                    console.log('parseLMGFile: returning highest detail', { context: 'model-service', path: name });
                    return name;
                }
            }
            
            // Otherwise return the first entry (should be highest detail)
            console.log('parseLMGFile: returning first entry', { context: 'model-service', path: pathNames[0] });
            return pathNames[0];
        }

        console.warn('parseLMGFile: no paths found', { context: 'model-service' });
        return null;
    } catch (error) {
        console.error(`Failed to parse LMG file ${lmgPath}:`, error.message, error.stack);
        return null;
    }
}

// ======================================================================
// MSH (Mesh) Parser
// ======================================================================

/**
 * Parse a MSH (Mesh) file
 * Based on MeshAppearanceTemplate.cpp
 *
 * @param {string} mshPath - Path to .msh file
 * @returns {Object|null} Mesh data with primitives
 */
export function parseMSHFile(mshPath) {
    try {
        if (!fs.existsSync(mshPath)) {
            return null;
        }

        const buffer = fs.readFileSync(mshPath);
        const reader = new IFFReader(buffer);

        const rootTag = reader.peekTag();
        if (rootTag !== 'FORM') {
            return null;
        }

        const formType = reader.enterForm();

        // Handle different mesh container types
        if (formType === 'DTLA' || formType === 'MLOD') {
            reader.exitForm();
            return { version: formType, primitives: [], isLOD: true };
        }

        if (formType !== 'MESH') {
            reader.exitForm();
            return { version: formType, primitives: [] };
        }

        // Enter version form (0002, 0003, 0004, 0005)
        const version = reader.enterForm();
        console.log('parseMSHFile: mesh version', { context: 'model-service', version });

        const meshData = {
            version,
            primitives: [],
            sphere: null,
            extent: null,
        };

        // Parse based on version
        while (reader.hasMore()) {
            const tag = reader.peekTag();
            console.log('parseMSHFile: found tag', { context: 'model-service', tag });

            if (tag === 'FORM') {
                const subFormTag = reader.enterForm();
                console.log('parseMSHFile: subform', { context: 'model-service', subFormTag });

                if (subFormTag === 'SPS ') {
                    // Shader Primitive Set
                    meshData.primitives = parseShaderPrimitiveSet(reader);
                } else if (subFormTag === 'EXSP') {
                    // Extent Sphere - skip for now
                    reader.exitForm();
                } else if (subFormTag === 'EXBX') {
                    // Extent Box - skip for now
                    reader.exitForm();
                } else if (subFormTag === 'HPTS' || subFormTag === 'FLOR') {
                    // Hardpoints or Floor - skip
                    reader.exitForm();
                } else if (subFormTag === 'APPR') {
                    // Appearance data - may contain SPS (possibly inside a version form)
                    console.log('parseMSHFile: entering APPR form', { context: 'model-service' });
                    while (reader.hasMore()) {
                        const apprTag = reader.peekTag();
                        if (apprTag === 'FORM') {
                            const apprSubTag = reader.enterForm();
                            console.log('parseMSHFile: APPR subform', { context: 'model-service', apprSubTag });
                            if (apprSubTag === 'SPS ') {
                                meshData.primitives = parseShaderPrimitiveSet(reader);
                            } else if (/^\d{4}$/.test(apprSubTag)) {
                                // Version form inside APPR - look for SPS inside
                                console.log('parseMSHFile: APPR version form, looking for SPS', { context: 'model-service', apprSubTag });
                                while (reader.hasMore()) {
                                    const versionTag = reader.peekTag();
                                    if (versionTag === 'FORM') {
                                        const versionSubTag = reader.enterForm();
                                        console.log('parseMSHFile: APPR version subform', { context: 'model-service', versionSubTag });
                                        if (versionSubTag === 'SPS ') {
                                            meshData.primitives = parseShaderPrimitiveSet(reader);
                                        } else {
                                            reader.exitForm();
                                        }
                                    } else {
                                        reader.skipChunk();
                                    }
                                }
                                reader.exitForm();
                            } else {
                                reader.exitForm();
                            }
                        } else {
                            reader.skipChunk();
                        }
                    }
                    reader.exitForm();
                } else if (/^\d{4}$/.test(subFormTag)) {
                    // Version form at MSH level - might contain additional primitive data
                    // Try to parse it as a shader primitive
                    console.log('parseMSHFile: parsing version form as potential primitive', { context: 'model-service', subFormTag });
                    const primitive = parseShaderPrimitiveContent(reader);
                    if (primitive && (primitive.positions.length > 0 || primitive.indices.length > 0)) {
                        console.log('parseMSHFile: found additional primitive in version form', {
                            context: 'model-service',
                            positionCount: primitive.positions.length,
                            indexCount: primitive.indices.length
                        });
                        meshData.primitives.push(primitive);
                    }
                    reader.exitForm();
                } else {
                    reader.exitForm();
                }
            } else if (tag === 'CNTR') {
                // Center chunk (sphere center)
                const chunk = reader.enterChunk('CNTR');
                meshData.sphere = { center: reader.readVector3() };
                reader.exitChunk(chunk);
            } else if (tag === 'RADI') {
                // Radius chunk (sphere radius)
                const chunk = reader.enterChunk('RADI');
                if (meshData.sphere) {
                    meshData.sphere.radius = reader.readFloat();
                }
                reader.exitChunk(chunk);
            } else if (tag === 'SPHR') {
                // Combined sphere chunk
                const chunk = reader.enterChunk('SPHR');
                meshData.sphere = {
                    center: reader.readVector3(),
                    radius: reader.readFloat(),
                };
                reader.exitChunk(chunk);
            } else {
                reader.skipChunk();
            }
        }

        reader.exitForm(); // version
        reader.exitForm(); // MESH

        return meshData;
    } catch (error) {
        console.error(`Failed to parse MSH file ${mshPath}:`, error.message);
        return null;
    }
}

/**
 * Parse Shader Primitive Set (SPS) from mesh
 * Based on ShaderPrimitiveSetTemplate.cpp
 *
 * @param {IFFReader} reader
 * @returns {Array} Array of primitives
 */
function parseShaderPrimitiveSet(reader) {
    const version = reader.enterForm();
    console.log('parseShaderPrimitiveSet: version', { context: 'model-service', version });

    const primitives = [];
    let expectedCount = 0;

    while (reader.hasMore()) {
        const tag = reader.peekTag();
        console.log('parseShaderPrimitiveSet: found tag', { context: 'model-service', tag });

        if (tag === 'CNT ') {
            const chunk = reader.enterChunk('CNT ');
            expectedCount = reader.readInt32();
            console.log('parseShaderPrimitiveSet: expected count', { context: 'model-service', expectedCount });
            reader.exitChunk(chunk);
        } else if (tag === 'FORM') {
            const formTag = reader.enterForm();
            console.log('parseShaderPrimitiveSet: subform', { context: 'model-service', formTag });

            if (formTag === 'SPTR' || formTag === 'SPST') {
                // Shader Primitive Template (direct)
                const primitive = parseShaderPrimitive(reader, formTag);
                if (primitive) {
                    console.log('parseShaderPrimitiveSet: parsed primitive', {
                        context: 'model-service',
                        positionCount: primitive.positions?.length || 0,
                        indexCount: primitive.indices?.length || 0
                    });
                    primitives.push(primitive);
                }
            } else if (/^\d{4}$/.test(formTag)) {
                // Version form (0001, 0002, etc.) - contains the actual primitive data
                // This is a versioned shader primitive, parse it directly
                console.log('parseShaderPrimitiveSet: parsing versioned primitive', { context: 'model-service', formTag });
                const primitive = parseShaderPrimitiveContent(reader);
                if (primitive) {
                    console.log('parseShaderPrimitiveSet: parsed versioned primitive', {
                        context: 'model-service',
                        positionCount: primitive.positions?.length || 0,
                        indexCount: primitive.indices?.length || 0
                    });
                    primitives.push(primitive);
                }
                reader.exitForm();
            } else {
                reader.exitForm();
            }
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();
    console.log('parseShaderPrimitiveSet: total primitives', { context: 'model-service', count: primitives.length });

    return primitives;
}

/**
 * Parse shader primitive content (inside version form)
 * @param {IFFReader} reader
 * @returns {Object} Primitive data
 */
function parseShaderPrimitiveContent(reader) {
    const primitive = {
        shaderTemplate: '',
        positions: [],
        normals: [],
        colors: [],
        uvs: [],
        indices: [],
        format: null,
        primitiveType: 'triangleList', // Default to triangle list, could be 'triangleStrip'
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();
        console.log('parseShaderPrimitiveContent: found tag', { context: 'model-service', tag });

        if (tag === 'NAME') {
            const chunk = reader.enterChunk('NAME');
            primitive.shaderTemplate = reader.readString(chunk.size);
            console.log('parseShaderPrimitiveContent: shader', { context: 'model-service', shader: primitive.shaderTemplate });
            reader.exitChunk(chunk);
        } else if (tag === 'INFO') {
            const chunk = reader.enterChunk('INFO');
            // INFO chunk contains primitive type info
            // DirectX primitive types: 4 = triangle list, 5 = triangle strip, 6 = triangle fan
            if (chunk.size >= 4) {
                const primitiveTypeValue = reader.readUint32();
                console.log('parseShaderPrimitiveContent: INFO primitive type', {
                    context: 'model-service',
                    primitiveTypeValue,
                    hex: primitiveTypeValue.toString(16)
                });

                // Map DirectX primitive types
                if (primitiveTypeValue === 5) {
                    primitive.primitiveType = 'triangleStrip';
                    console.log('parseShaderPrimitiveContent: detected triangle strip', { context: 'model-service' });
                } else if (primitiveTypeValue === 6) {
                    primitive.primitiveType = 'triangleFan';
                    console.log('parseShaderPrimitiveContent: detected triangle fan', { context: 'model-service' });
                } else {
                    // Default to triangle list (type 4) or any other value
                    primitive.primitiveType = 'triangleList';
                }
            }
            reader.exitChunk(chunk);
        } else if (tag === 'FORM') {
            const subFormTag = reader.enterForm();
            console.log('parseShaderPrimitiveContent: subform', { context: 'model-service', subFormTag });

            if (subFormTag === 'VTXA') {
                parseVertexArray(reader, primitive);
                console.log('parseShaderPrimitiveContent: after VTXA', {
                    context: 'model-service',
                    positionCount: primitive.positions.length,
                    normalCount: primitive.normals.length
                });
            } else if (subFormTag === 'INDX' || subFormTag === 'SIDX') {
                parseIndexForm(reader, primitive);
                console.log('parseShaderPrimitiveContent: after INDX', {
                    context: 'model-service',
                    indexCount: primitive.indices.length
                });
            } else if (subFormTag === 'OITL') {
                reader.exitForm();
            } else if (/^\d{4}$/.test(subFormTag)) {
                // Nested version form - parse contents for VTXA/INDX
                console.log('parseShaderPrimitiveContent: parsing nested version form', { context: 'model-service', subFormTag });
                while (reader.hasMore()) {
                    const innerTag = reader.peekTag();
                    console.log('parseShaderPrimitiveContent: nested tag', { context: 'model-service', innerTag });

                    if (innerTag === 'INFO') {
                        // Skip INFO chunk in nested form
                        const chunk = reader.enterChunk('INFO');
                        reader.exitChunk(chunk);
                    } else if (innerTag === 'FORM') {
                        const innerFormTag = reader.enterForm();
                        console.log('parseShaderPrimitiveContent: nested subform', { context: 'model-service', innerFormTag });

                        if (innerFormTag === 'VTXA') {
                            parseVertexArray(reader, primitive);
                            console.log('parseShaderPrimitiveContent: after nested VTXA', {
                                context: 'model-service',
                                positionCount: primitive.positions.length,
                                normalCount: primitive.normals.length
                            });
                        } else if (innerFormTag === 'INDX' || innerFormTag === 'SIDX') {
                            parseIndexForm(reader, primitive);
                            console.log('parseShaderPrimitiveContent: after nested INDX form', {
                                context: 'model-service',
                                indexCount: primitive.indices.length
                            });
                        } else {
                            reader.exitForm();
                        }
                    } else if (innerTag === 'INDX') {
                        // Direct INDX chunk - format: 4 bytes count + indices
                        const chunk = reader.enterChunk('INDX');
                        const indexCount = reader.readUint32();
                        const remainingBytes = chunk.size - 4;
                        const actualCount = Math.min(indexCount, Math.floor(remainingBytes / 2));
                        console.log('parseShaderPrimitiveContent: nested INDX chunk', {
                            context: 'model-service',
                            indexCount,
                            actualCount
                        });
                        for (let i = 0; i < actualCount; i++) {
                            primitive.indices.push(reader.readUint16());
                        }
                        reader.exitChunk(chunk);
                    } else {
                        reader.skipChunk();
                    }
                }
                reader.exitForm();
            } else {
                reader.exitForm();
            }
        } else if (tag === 'INDX') {
            const chunk = reader.enterChunk('INDX');
            // INDX chunk format: 4 bytes count + indices
            // First read the count (32-bit)
            const indexCount = reader.readUint32();
            const expectedBytes = indexCount * 2;
            const remainingBytes = chunk.size - 4;

            console.log('parseShaderPrimitiveContent: reading INDX chunk', {
                context: 'model-service',
                indexCount,
                chunkSize: chunk.size,
                expectedBytes,
                remainingBytes
            });

            // Read the actual indices
            const actualCount = Math.min(indexCount, Math.floor(remainingBytes / 2));
            for (let i = 0; i < actualCount; i++) {
                primitive.indices.push(reader.readUint16());
            }
            // Log sample of indices for debugging
            console.log('parseShaderPrimitiveContent: INDX sample', {
                context: 'model-service',
                first10: primitive.indices.slice(0, 10),
                last10: primitive.indices.slice(-10),
                min: Math.min(...primitive.indices),
                max: Math.max(...primitive.indices)
            });
            reader.exitChunk(chunk);
        } else {
            reader.skipChunk();
        }
    }

    console.log('parseShaderPrimitiveContent: final', {
        context: 'model-service',
        positionCount: primitive.positions.length,
        indexCount: primitive.indices.length
    });

    return primitive;
}

/**
 * Parse individual shader primitive
 * Based on ShaderPrimitiveSetTemplate.cpp LocalShaderPrimitiveTemplate
 *
 * @param {IFFReader} reader
 * @param {string} formType - SPTR or SPST
 * @returns {Object} Primitive data
 */
function parseShaderPrimitive(reader, formType) {
    const version = reader.enterForm();
    console.log('parseShaderPrimitive: version', { context: 'model-service', version });

    const primitive = {
        shaderTemplate: '',
        positions: [],
        normals: [],
        colors: [],
        uvs: [], // Array of UV sets
        indices: [],
        format: null,
    };

    while (reader.hasMore()) {
        const tag = reader.peekTag();
        console.log('parseShaderPrimitive: found tag', { context: 'model-service', tag });

        if (tag === 'NAME') {
            const chunk = reader.enterChunk('NAME');
            primitive.shaderTemplate = reader.readString(chunk.size);
            console.log('parseShaderPrimitive: shader', { context: 'model-service', shader: primitive.shaderTemplate });
            reader.exitChunk(chunk);
        } else if (tag === 'INFO') {
            const chunk = reader.enterChunk('INFO');
            // Skip INFO chunk for now
            reader.exitChunk(chunk);
        } else if (tag === 'FORM') {
            const subFormTag = reader.enterForm();
            console.log('parseShaderPrimitive: subform', { context: 'model-service', subFormTag });

            if (subFormTag === 'VTXA') {
                parseVertexArray(reader, primitive);
                console.log('parseShaderPrimitive: after VTXA', {
                    context: 'model-service',
                    positionCount: primitive.positions.length,
                    normalCount: primitive.normals.length
                });
            } else if (subFormTag === 'INDX' || subFormTag === 'SIDX') {
                parseIndexForm(reader, primitive);
                console.log('parseShaderPrimitive: after INDX', {
                    context: 'model-service',
                    indexCount: primitive.indices.length
                });
            } else if (subFormTag === 'OITL') {
                // Optional index triangle list - collision data
                reader.exitForm();
            } else {
                reader.exitForm();
            }
        } else if (tag === 'INDX') {
            // Direct index chunk (not in form)
            const chunk = reader.enterChunk('INDX');
            const indexCount = chunk.size / 2;
            for (let i = 0; i < indexCount; i++) {
                primitive.indices.push(reader.readUint16());
            }
            reader.exitChunk(chunk);
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();
    console.log('parseShaderPrimitive: final', {
        context: 'model-service',
        positionCount: primitive.positions.length,
        indexCount: primitive.indices.length
    });

    return primitive;
}

/**
 * Parse vertex array (VTXA) form
 * Based on VertexBuffer::load_0002 and load_0003
 *
 * @param {IFFReader} reader
 * @param {Object} primitive - Primitive to populate
 */
function parseVertexArray(reader, primitive) {
    const version = reader.enterForm();
    console.log('parseVertexArray: version', { context: 'model-service', version });

    let format = null;
    let numberOfVertices = 0;

    while (reader.hasMore()) {
        const tag = reader.peekTag();
        console.log('parseVertexArray: found tag', { context: 'model-service', tag });

        if (tag === 'INFO') {
            const chunk = reader.enterChunk('INFO');

            if (version === '0001') {
                // Old format: vertices, uvSets, flags
                numberOfVertices = reader.readInt32();
                const numberOfUVSets = reader.readInt32();
                const flags = reader.readUint32();
                console.log('parseVertexArray: INFO v0001', {
                    context: 'model-service',
                    numberOfVertices,
                    numberOfUVSets,
                    flags: flags.toString(16)
                });

                // Convert old flags to new format
                format = {
                    hasPosition: true, // Always has position
                    isTransformed: (flags & 0x01) !== 0,
                    hasNormal: (flags & 0x02) !== 0,
                    hasColor0: (flags & 0x04) !== 0,
                    hasColor1: false,
                    numberOfTextureCoordinateSets: numberOfUVSets,
                    textureCoordinateSetDimensions: new Array(numberOfUVSets).fill(2), // All 2D
                };
            } else {
                // New format: flags contain everything
                const flags = reader.readUint32();
                numberOfVertices = reader.readInt32();
                format = parseVertexBufferFormat(flags);
                console.log('parseVertexArray: INFO new format', {
                    context: 'model-service',
                    numberOfVertices,
                    flags: flags.toString(16),
                    format
                });
            }

            reader.exitChunk(chunk);
        } else if (tag === 'DATA') {
            const chunk = reader.enterChunk('DATA');
            console.log('parseVertexArray: DATA chunk', {
                context: 'model-service',
                chunkSize: chunk.size,
                numberOfVertices,
                hasFormat: !!format
            });

            if (!format) {
                // Default format if INFO wasn't read
                format = parseVertexBufferFormat(
                    VertexBufferFlags.F_position | VertexBufferFlags.F_normal | 0x0100 | 0x1000
                );
                numberOfVertices = Math.floor(chunk.size / 32); // Estimate based on common vertex size
                console.log('parseVertexArray: using default format', {
                    context: 'model-service',
                    estimatedVertices: numberOfVertices
                });
            }

            primitive.format = format;

            // Initialize UV arrays
            for (let i = 0; i < format.numberOfTextureCoordinateSets; i++) {
                primitive.uvs.push([]);
            }

            // Read vertex data
            for (let v = 0; v < numberOfVertices && reader.offset < chunk.endOffset; v++) {
                // Position (3 floats)
                if (format.hasPosition) {
                    const pos = reader.readVector3();
                    primitive.positions.push(pos.x, pos.y, pos.z);
                }

                // OOZ/RHW for transformed vertices
                if (format.isTransformed) {
                    reader.readFloat(); // Skip
                }

                // Normal (3 floats)
                if (format.hasNormal) {
                    const normal = reader.readVector3();
                    primitive.normals.push(normal.x, normal.y, normal.z);
                }

                // Point size
                if (format.hasPointSize) {
                    reader.readFloat(); // Skip
                }

                // Color0 (ARGB uint32)
                if (format.hasColor0) {
                    const color = reader.readUint32();
                    // Convert ARGB to RGBA normalized floats
                    const a = ((color >> 24) & 0xff) / 255;
                    const r = ((color >> 16) & 0xff) / 255;
                    const g = ((color >> 8) & 0xff) / 255;
                    const b = (color & 0xff) / 255;
                    primitive.colors.push(r, g, b, a);
                }

                // Color1
                if (format.hasColor1) {
                    reader.readUint32(); // Skip
                }

                // Texture coordinates
                for (let tc = 0; tc < format.numberOfTextureCoordinateSets; tc++) {
                    const dim = format.textureCoordinateSetDimensions[tc];
                    const coords = [];
                    for (let d = 0; d < dim; d++) {
                        coords.push(reader.readFloat());
                    }
                    // Store just u,v for Three.js
                    // Don't flip V here - we'll use texture.flipY instead for consistency
                    if (coords.length >= 2) {
                        primitive.uvs[tc].push(coords[0], coords[1]);
                    } else if (coords.length === 1) {
                        primitive.uvs[tc].push(coords[0], 0);
                    }
                }
            }

            reader.exitChunk(chunk);
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();
    console.log('parseVertexArray: complete', {
        context: 'model-service',
        positionCount: primitive.positions.length,
        normalCount: primitive.normals.length,
        colorCount: primitive.colors.length,
        uvSetCount: primitive.uvs.length,
        uvSet0Count: primitive.uvs[0]?.length || 0,
        uvSample: primitive.uvs[0]?.slice(0, 8) || []
    });
}

/**
 * Parse index form (INDX or SIDX)
 *
 * @param {IFFReader} reader
 * @param {Object} primitive - Primitive to populate
 */
function parseIndexForm(reader, primitive) {
    const version = reader.enterForm();
    console.log('parseIndexForm: version', { context: 'model-service', version });

    while (reader.hasMore()) {
        const tag = reader.peekTag();
        console.log('parseIndexForm: found tag', { context: 'model-service', tag });

        if (tag === 'DATA') {
            const chunk = reader.enterChunk('DATA');
            // Check if first 4 bytes could be a count
            // If chunk size > 4 and first uint32 * 2 + 4 == chunk size, it has a count header
            const potentialCount = reader.view.getUint32(reader.offset, true);
            const hasCountHeader = (potentialCount * 2 + 4) === chunk.size;

            let indexCount;
            if (hasCountHeader) {
                indexCount = reader.readUint32();
                console.log('parseIndexForm: reading indices with count header', {
                    context: 'model-service',
                    indexCount,
                    chunkSize: chunk.size
                });
            } else {
                indexCount = chunk.size / 2;
                console.log('parseIndexForm: reading indices without header', {
                    context: 'model-service',
                    indexCount,
                    chunkSize: chunk.size
                });
            }

            for (let i = 0; i < indexCount; i++) {
                primitive.indices.push(reader.readUint16());
            }
            reader.exitChunk(chunk);
        } else {
            reader.skipChunk();
        }
    }

    reader.exitForm();
    console.log('parseIndexForm: complete', { context: 'model-service', totalIndices: primitive.indices.length });
}

// ======================================================================
// High-Level API
// ======================================================================

/**
 * Get 3D model data for a game object
 *
 * @param {string} appearanceFile - Path to appearance file (APT, MSH, SAT, MGN, etc.)
 * @param {string} clientDataPath - Base path for client data files
 * @param {Object} options - Loading options
 * @param {boolean} options.loadTextures - Whether to load textures (default: false)
 * @returns {Object|null} Model data for Three.js rendering
 */
export function loadModel(appearanceFile, clientDataPath, options = {}) {
    console.log('loadModel called', {
        context: 'model-service',
        appearanceFile,
        clientDataPath
    });

    if (!appearanceFile || !clientDataPath) {
        console.warn('loadModel: missing params', {
            context: 'model-service',
            appearanceFile,
            clientDataPath
        });
        return null;
    }

    const { loadTextures = false } = options;

    try {
        // Try multiple possible paths
        const possiblePaths = [
            path.join(clientDataPath, appearanceFile),
        ];

        // Add serverdata path as fallback
        const serverdataPath = clientDataPath.replace(/data[/\\]sku\.0[/\\]sys\.client[/\\]compiled[/\\]game/g, 'serverdata');
        if (serverdataPath !== clientDataPath) {
            possiblePaths.push(path.join(serverdataPath, appearanceFile));
        }

        let fullPath = null;
        let effectiveClientPath = clientDataPath;

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                fullPath = p;
                // Update effective client path based on which path worked
                if (p.includes('serverdata')) {
                    effectiveClientPath = serverdataPath;
                }
                break;
            }
        }

        console.log('loadModel: checking file', {
            context: 'model-service',
            triedPaths: possiblePaths,
            foundPath: fullPath,
            effectiveClientPath
        });

        if (!fullPath) {
            console.warn(`Appearance file not found in any path`, { context: 'model-service', appearanceFile, triedPaths: possiblePaths });
            return null;
        }

        const ext = path.extname(appearanceFile).toLowerCase();
        console.log('loadModel: file type', { context: 'model-service', ext });

        // Parse based on file type
        if (ext === '.apt') {
            // Appearance template - get the mesh path from it
            console.log('Parsing APT file', { context: 'model-service', fullPath });
            const meshInfo = parseAPTFile(fullPath);
            console.log('APT parse result', {
                context: 'model-service',
                meshInfo
            });
            if (!meshInfo) {
                return null;
            }

            return loadModel(meshInfo.path, effectiveClientPath, options);
        }

        if (ext === '.sat') {
            // Skeletal appearance template
            return loadSkeletalModel(fullPath, effectiveClientPath, options);
        }

        if (ext === '.mgn') {
            // Skeletal mesh generator - direct MGN file
            return loadMGNModel(fullPath, effectiveClientPath, appearanceFile, options);
        }

        if (ext === '.lmg') {
            // LOD mesh generator - get highest detail MGN
            const mgnPath = parseLMGFile(fullPath, effectiveClientPath);
            if (mgnPath) {
                return loadModel(mgnPath, effectiveClientPath, options);
            }
            return null;
        }

        if (ext === '.lod') {
            // LOD container - get highest detail mesh
            console.log('Parsing LOD file', { context: 'model-service', lodPath: fullPath });
            const meshPath = parseDTLAFile(fullPath, effectiveClientPath);
            if (!meshPath) {
                console.warn('Could not extract mesh path from LOD', { context: 'model-service', lodPath: fullPath });
                return null;
            }

            // The mesh path from LOD is relative to appearance directory
            // e.g., "mesh/eqp_tool_datapad_l0.msh" -> "appearance/mesh/eqp_tool_datapad_l0.msh"
            let resolvedMeshPath = meshPath;
            if (!meshPath.startsWith('appearance/') && !meshPath.startsWith('appearance\\')) {
                resolvedMeshPath = `appearance/${meshPath}`;
            }

            console.log('LOD resolved to mesh', { context: 'model-service', meshPath, resolvedMeshPath });
            return loadModel(resolvedMeshPath, effectiveClientPath, options);
        }

        if (ext === '.msh') {
            // Direct mesh file
            console.log('Parsing MSH file', { context: 'model-service', fullPath });
            const meshData = parseMSHFile(fullPath);

            console.log('MSH parse result', {
                context: 'model-service',
                hasMeshData: !!meshData,
                isLOD: meshData?.isLOD,
                primitiveCount: meshData?.primitives?.length || 0,
                version: meshData?.version
            });

            if (!meshData) {
                return null;
            }

            // Check if it's actually a LOD container
            if (meshData.isLOD) {
                console.log('MSH is LOD container, extracting mesh path', { context: 'model-service' });
                const meshPath = parseDTLAFile(fullPath, effectiveClientPath);
                if (meshPath) {
                    // The mesh path from LOD is relative to appearance directory
                    let resolvedMeshPath = meshPath;
                    if (!meshPath.startsWith('appearance/') && !meshPath.startsWith('appearance\\')) {
                        resolvedMeshPath = `appearance/${meshPath}`;
                    }
                    console.log('LOD resolved mesh path', { context: 'model-service', meshPath, resolvedMeshPath });
                    return loadModel(resolvedMeshPath, effectiveClientPath, options);
                }
                return null;
            }

            const result = buildModelResult(appearanceFile, meshData, effectiveClientPath, loadTextures);
            console.log('Built model result', {
                context: 'model-service',
                primitiveCount: result?.primitives?.length || 0
            });
            return result;
        }

        if (ext === '.cmp') {
            // Component appearance - composite model
            return loadComponentModel(fullPath, effectiveClientPath, options);
        }

        if (ext === '.skt') {
            // Skeleton template - bone hierarchy
            const sktData = parseSKTFile(fullPath);
            if (sktData) {
                return {
                    type: 'skeleton',
                    appearanceFilename: appearanceFile,
                    skeleton: sktData,
                    primitives: [], // Skeletons don't have geometry on their own
                };
            }
            return null;
        }

        if (ext === '.pob') {
            // Portal object (building interior)
            return loadPortalModel(fullPath, effectiveClientPath, options);
        }

        console.warn(`Unknown appearance file type: ${ext}`);
        return null;
    } catch (error) {
        console.error(`Failed to load model ${appearanceFile}:`, error.message);
        return null;
    }
}

/**
 * Load skeletal model from SAT file
 */
function loadSkeletalModel(satPath, clientDataPath, options) {
    console.log('loadSkeletalModel: loading SAT', { context: 'model-service', satPath });

    const satData = parseSATFile(satPath);
    if (!satData) {
        console.warn('loadSkeletalModel: failed to parse SAT file', { context: 'model-service', satPath });
        return null;
    }

    console.log('loadSkeletalModel: parsed SAT data', {
        context: 'model-service',
        skeletonTemplates: satData.skeletonTemplates,
        meshGeneratorNames: satData.meshGeneratorNames
    });

    const result = {
        type: 'skeletal',
        appearanceFilename: path.relative(clientDataPath, satPath),
        skeletonTemplates: satData.skeletonTemplates,
        meshGeneratorNames: satData.meshGeneratorNames,
        primitives: [],
    };

    // Build list of possible base paths to search
    const searchPaths = [clientDataPath];
    const serverdataPath = clientDataPath.replace(/data[/\\]sku\.0[/\\]sys\.client[/\\]compiled[/\\]game/g, 'serverdata');
    if (serverdataPath !== clientDataPath) {
        searchPaths.push(serverdataPath);
    }

    // Load each mesh generator
    for (const mgnName of satData.meshGeneratorNames) {
        let mgnPath = mgnName;
        let mgnFullPath = null;
        let effectiveBasePath = clientDataPath;

        // Check if it's an LMG reference
        const ext = path.extname(mgnName).toLowerCase();
        if (ext === '.lmg') {
            // Try to find LMG file in different paths
            let lmgFullPath = null;
            for (const basePath of searchPaths) {
                const testPath = path.join(basePath, mgnName);
                if (fs.existsSync(testPath)) {
                    lmgFullPath = testPath;
                    effectiveBasePath = basePath;
                    break;
                }
            }

            if (!lmgFullPath) {
                console.warn('loadSkeletalModel: LMG file not found', { 
                    context: 'model-service', 
                    mgnName,
                    searchPaths 
                });
                continue;
            }

            console.log('loadSkeletalModel: resolving LMG', { 
                context: 'model-service', 
                lmgPath: lmgFullPath 
            });
            
            const highestDetailMgn = parseLMGFile(lmgFullPath, effectiveBasePath);
            if (highestDetailMgn) {
                mgnPath = highestDetailMgn;
                console.log('loadSkeletalModel: LMG resolved to MGN', { 
                    context: 'model-service', 
                    mgnPath 
                });
            } else {
                console.warn('loadSkeletalModel: LMG resolution failed (no paths in file)', { 
                    context: 'model-service', 
                    lmgPath: lmgFullPath 
                });
                continue;
            }
        }

        // Find the MGN file in search paths
        for (const basePath of searchPaths) {
            const testPath = path.join(basePath, mgnPath);
            if (fs.existsSync(testPath)) {
                mgnFullPath = testPath;
                effectiveBasePath = basePath;
                break;
            }
        }

        if (!mgnFullPath) {
            console.warn('loadSkeletalModel: MGN file not found in any path', { 
                context: 'model-service', 
                mgnPath,
                searchPaths 
            });
            continue;
        }

        console.log('loadSkeletalModel: loading MGN', { 
            context: 'model-service', 
            mgnPath,
            mgnFullPath
        });

        const mgnModel = loadMGNModel(mgnFullPath, effectiveBasePath, mgnPath, options);
        if (mgnModel && mgnModel.primitives) {
            console.log('loadSkeletalModel: adding primitives from MGN', {
                context: 'model-service',
                mgnPath,
                primitiveCount: mgnModel.primitives.length
            });
            result.primitives.push(...mgnModel.primitives);
        } else {
            console.warn('loadSkeletalModel: MGN model had no primitives', {
                context: 'model-service',
                mgnPath
            });
        }
    }

    console.log('loadSkeletalModel: complete', {
        context: 'model-service',
        totalPrimitives: result.primitives.length
    });

    return result;
}

/**
 * Load model from MGN file
 */
function loadMGNModel(mgnPath, clientDataPath, relativePath, options) {
    const { loadTextures = false } = options || {};

    console.log('loadMGNModel: loading', { context: 'model-service', mgnPath, relativePath });

    const mgnData = parseMGNFile(mgnPath);
    if (!mgnData) {
        console.warn('loadMGNModel: failed to parse MGN file', { context: 'model-service', mgnPath });
        return null;
    }

    console.log('loadMGNModel: parsed MGN data', {
        context: 'model-service',
        positionCount: mgnData.positions.length / 3,
        normalCount: mgnData.normals.length / 3,
        perShaderDataCount: mgnData.perShaderData.length
    });

    const result = {
        type: 'skeletal_mesh',
        appearanceFilename: relativePath,
        meshPath: relativePath,
        transformNames: mgnData.transformNames,
        blendTargets: mgnData.blendTargets,
        primitives: [],
    };

    // Convert per-shader data to primitives
    for (const psd of mgnData.perShaderData) {
        // Build positions and normals from indices
        const positions = [];
        const normals = [];

        for (let i = 0; i < psd.positionIndices.length; i++) {
            const posIdx = psd.positionIndices[i] * 3;
            if (posIdx >= 0 && posIdx + 2 < mgnData.positions.length) {
                positions.push(
                    mgnData.positions[posIdx],
                    mgnData.positions[posIdx + 1],
                    mgnData.positions[posIdx + 2]
                );
            } else {
                positions.push(0, 0, 0);
            }

            if (psd.normalIndices.length > i) {
                const normIdx = psd.normalIndices[i] * 3;
                if (normIdx >= 0 && normIdx + 2 < mgnData.normals.length) {
                    normals.push(
                        mgnData.normals[normIdx],
                        mgnData.normals[normIdx + 1],
                        mgnData.normals[normIdx + 2]
                    );
                } else {
                    normals.push(0, 1, 0);
                }
            }
        }

        // Flatten all primitive indices
        const indices = [];
        for (const prim of psd.primitives) {
            indices.push(...prim.indices);
        }

        // Don't flip V here - we'll use texture.flipY instead for consistency
        const uvs = [];
        if (psd.textureCoordinateSets.length > 0) {
            const srcUvs = psd.textureCoordinateSets[0];
            for (let i = 0; i < srcUvs.length; i += 2) {
                uvs.push(srcUvs[i], srcUvs[i + 1]);
            }
        }

        const primitive = {
            shaderTemplate: psd.shaderTemplate,
            positions,
            normals,
            colors: psd.colors,
            uvs: uvs,
            uvSets: psd.textureCoordinateSets,
            indices,
            vertexCount: positions.length / 3,
            indexCount: indices.length,
            primitiveType: 'triangleList', // MGN files use triangle lists
            textureInfo: null,
        };

        // Resolve texture info
        if (psd.shaderTemplate) {
            try {
                const textures = resolveShaderTextures(psd.shaderTemplate, clientDataPath);
                if (textures) {
                    primitive.textureInfo = {
                        diffuse: textures.diffuse,
                        normal: textures.normal,
                        specular: textures.specular,
                    };
                }
            } catch (e) {
                // Ignore texture resolution errors
            }
        }

        // Load full texture data if requested
        if (loadTextures && psd.shaderTemplate) {
            primitive.texture = loadTextureForShader(psd.shaderTemplate, clientDataPath);
        }

        console.log('loadMGNModel: built primitive', {
            context: 'model-service',
            shaderTemplate: psd.shaderTemplate,
            positionCount: positions.length / 3,
            indexCount: indices.length,
            uvCount: uvs.length / 2,
            hasTextureInfo: !!primitive.textureInfo
        });

        result.primitives.push(primitive);
    }

    console.log('loadMGNModel: complete', {
        context: 'model-service',
        primitiveCount: result.primitives.length
    });

    return result;
}

/**
 * Build model result from mesh data
 */
function buildModelResult(appearanceFile, meshData, clientDataPath, loadTextures) {
    const primitives = meshData.primitives.map((p) => {
        const primitive = {
            shaderTemplate: p.shaderTemplate,
            positions: p.positions,
            normals: p.normals,
            colors: p.colors,
            uvs: p.uvs.length > 0 ? p.uvs[0] : [],
            uvSets: p.uvs,
            indices: p.indices,
            vertexCount: p.positions.length / 3,
            indexCount: p.indices.length,
            primitiveType: p.primitiveType || 'triangleList',
            textureInfo: null,
        };

        // Always try to resolve texture paths for the frontend
        if (p.shaderTemplate) {
            try {
                const textures = resolveShaderTextures(p.shaderTemplate, clientDataPath);
                if (textures) {
                    primitive.textureInfo = {
                        diffuse: textures.diffuse,
                        normal: textures.normal,
                        specular: textures.specular,
                        type: textures.type, // 'static', 'customizable', etc.
                    };
                }
            } catch (e) {
                // Ignore texture resolution errors
            }
        }

        // Load full texture data if requested
        if (loadTextures && p.shaderTemplate) {
            primitive.texture = loadTextureForShader(p.shaderTemplate, clientDataPath);
        }

        return primitive;
    });

    return {
        type: 'mesh',
        appearanceFilename: appearanceFile,
        meshPath: appearanceFile,
        sphere: meshData.sphere,
        primitives,
    };
}

/**
 * Load texture data for a shader template
 */
function loadTextureForShader(shaderTemplateName, clientDataPath) {
    try {
        const textures = resolveShaderTextures(shaderTemplateName, clientDataPath);
        if (!textures || !textures.diffuse) {
            return null;
        }

        // Load the diffuse texture
        let texturePath = textures.diffuse;
        if (!texturePath.endsWith('.dds')) {
            texturePath += '.dds';
        }

        const fullTexturePath = path.join(clientDataPath, texturePath);
        const ddsData = parseDDSFile(fullTexturePath);

        if (!ddsData) {
            return null;
        }

        return {
            path: texturePath,
            width: ddsData.width,
            height: ddsData.height,
            format: ddsData.format,
            data: ddsData.data,
            mipmaps: ddsData.mipmaps,
        };
    } catch (error) {
        console.error(`Failed to load texture for shader ${shaderTemplateName}:`, error.message);
        return null;
    }
}

/**
 * Load component model from CMP file
 * Recursively loads all sub-appearances and combines them
 */
function loadComponentModel(cmpPath, clientDataPath, options) {
    console.log('loadComponentModel: loading CMP', { context: 'model-service', cmpPath });

    const cmpData = parseCMPFile(cmpPath);
    if (!cmpData) {
        console.warn('loadComponentModel: failed to parse CMP file', { context: 'model-service', cmpPath });
        return null;
    }

    console.log('loadComponentModel: parsed CMP data', {
        context: 'model-service',
        componentCount: cmpData.components.length,
        components: cmpData.components.map(c => c.appearancePath)
    });

    const result = {
        type: 'component',
        appearanceFilename: path.relative(clientDataPath, cmpPath),
        components: [],
        primitives: [],
    };

    // Load each component
    for (const component of cmpData.components) {
        if (!component.appearancePath) continue;

        const componentModel = loadModel(component.appearancePath, clientDataPath, options);
        if (componentModel && componentModel.primitives) {
            // Transform primitives according to component transform
            const transformedPrimitives = componentModel.primitives.map(prim => {
                const transformed = { ...prim };

                // Apply transform to positions if we have a matrix
                if (component.transform && component.transform.matrix) {
                    transformed.positions = transformPositions(
                        prim.positions,
                        component.transform.matrix
                    );
                    // Also transform normals (rotation only, no translation)
                    if (prim.normals && prim.normals.length > 0) {
                        transformed.normals = transformNormals(
                            prim.normals,
                            component.transform.matrix
                        );
                    }
                } else if (component.transform && component.transform.position) {
                    // Simple position offset
                    transformed.positions = offsetPositions(
                        prim.positions,
                        component.transform.position
                    );
                }

                return transformed;
            });

            result.primitives.push(...transformedPrimitives);
            result.components.push({
                path: component.appearancePath,
                transform: component.transform,
                primitiveCount: componentModel.primitives.length,
            });
        }
    }

    console.log('loadComponentModel: complete', {
        context: 'model-service',
        totalPrimitives: result.primitives.length,
        componentCount: result.components.length
    });

    return result;
}

/**
 * Load portal object (building) model from POB file
 * Loads all cell appearances
 */
function loadPortalModel(pobPath, clientDataPath, options) {
    console.log('loadPortalModel: loading POB', { context: 'model-service', pobPath });

    const pobData = parsePOBFile(pobPath);
    if (!pobData) {
        console.warn('loadPortalModel: failed to parse POB file', { context: 'model-service', pobPath });
        return null;
    }

    console.log('loadPortalModel: parsed POB data', {
        context: 'model-service',
        cellCount: pobData.cells.length,
        portalCount: pobData.portals.length
    });

    const result = {
        type: 'portal',
        appearanceFilename: path.relative(clientDataPath, pobPath),
        cells: [],
        portals: pobData.portals,
        primitives: [],
    };

    // Load appearance for each cell
    for (const cell of pobData.cells) {
        const cellResult = {
            name: cell.name,
            lights: cell.lights,
            primitives: [],
        };

        if (cell.appearancePath) {
            const cellModel = loadModel(cell.appearancePath, clientDataPath, options);
            if (cellModel && cellModel.primitives) {
                cellResult.primitives.push(...cellModel.primitives);
                result.primitives.push(...cellModel.primitives);
            }
        }

        result.cells.push(cellResult);
    }

    console.log('loadPortalModel: complete', {
        context: 'model-service',
        totalPrimitives: result.primitives.length,
        cellCount: result.cells.length
    });

    return result;
}

/**
 * Transform positions by a 4x3 matrix (12 floats: 3 rows of 4, column-major)
 * Matrix format: [m00, m01, m02, m10, m11, m12, m20, m21, m22, tx, ty, tz]
 */
function transformPositions(positions, matrix) {
    const result = new Array(positions.length);

    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];

        // Apply 3x3 rotation + translation
        result[i] = matrix[0] * x + matrix[3] * y + matrix[6] * z + matrix[9];
        result[i + 1] = matrix[1] * x + matrix[4] * y + matrix[7] * z + matrix[10];
        result[i + 2] = matrix[2] * x + matrix[5] * y + matrix[8] * z + matrix[11];
    }

    return result;
}

/**
 * Transform normals by a 4x3 matrix (rotation only, no translation)
 */
function transformNormals(normals, matrix) {
    const result = new Array(normals.length);

    for (let i = 0; i < normals.length; i += 3) {
        const x = normals[i];
        const y = normals[i + 1];
        const z = normals[i + 2];

        // Apply 3x3 rotation only
        result[i] = matrix[0] * x + matrix[3] * y + matrix[6] * z;
        result[i + 1] = matrix[1] * x + matrix[4] * y + matrix[7] * z;
        result[i + 2] = matrix[2] * x + matrix[5] * y + matrix[8] * z;

        // Renormalize
        const len = Math.sqrt(
            result[i] * result[i] +
            result[i + 1] * result[i + 1] +
            result[i + 2] * result[i + 2]
        );
        if (len > 0.0001) {
            result[i] /= len;
            result[i + 1] /= len;
            result[i + 2] /= len;
        }
    }

    return result;
}

/**
 * Offset positions by a simple translation
 */
function offsetPositions(positions, offset) {
    const result = new Array(positions.length);

    for (let i = 0; i < positions.length; i += 3) {
        result[i] = positions[i] + offset.x;
        result[i + 1] = positions[i + 1] + offset.y;
        result[i + 2] = positions[i + 2] + offset.z;
    }

    return result;
}

/**
 * Load model with textures - convenience function
 *
 * @param {string} appearanceFile - Path to appearance file
 * @param {string} clientDataPath - Base path for client data files
 * @returns {Object|null} Model data with loaded textures
 */
export function loadModelWithTextures(appearanceFile, clientDataPath) {
    return loadModel(appearanceFile, clientDataPath, { loadTextures: true });
}

/**
 * Get 3D model data for a crafted object template
 *
 * @param {string} craftedObjectTemplate - Path like "object/tangible/dice/eqp_chance_cube.iff"
 * @param {string} sharedBasePath - Shared base path (sys.shared)
 * @param {string} clientDataPath - Client data path for appearance files (sys.client)
 * @param {Function} parseTPFStringRefs - Function to parse TPF string refs
 * @returns {Object|null} Model data for Three.js rendering
 */
export function getModelForTemplate(
    craftedObjectTemplate,
    sharedBasePath,
    clientDataPath,
    parseTPFStringRefs
) {
    console.log('getModelForTemplate called', {
        context: 'model-service',
        craftedObjectTemplate,
        sharedBasePath,
        clientDataPath
    });

    if (!craftedObjectTemplate || !sharedBasePath) {
        console.warn('getModelForTemplate: missing required params', {
            context: 'model-service',
            craftedObjectTemplate,
            sharedBasePath
        });
        return null;
    }

    try {
        // Convert .iff to shared .tpf path
        let templatePath = craftedObjectTemplate;
        if (templatePath.endsWith('.iff')) {
            templatePath = templatePath.slice(0, -4);
        }

        const lastSlash = templatePath.lastIndexOf('/');
        const dir = lastSlash >= 0 ? templatePath.substring(0, lastSlash) : '';
        const basename = lastSlash >= 0 ? templatePath.substring(lastSlash + 1) : templatePath;

        const sharedFilename = `shared_${basename}.tpf`;
        const sharedRelativePath = dir ? `${dir}/${sharedFilename}` : sharedFilename;
        const sharedPath = path.join(sharedBasePath, sharedRelativePath);

        console.log('getModelForTemplate: resolved shared path', {
            context: 'model-service',
            sharedPath,
            exists: fs.existsSync(sharedPath)
        });

        if (!fs.existsSync(sharedPath)) {
            console.warn('getModelForTemplate: shared template not found', {
                context: 'model-service',
                sharedPath
            });
            return null;
        }

        // Parse shared template for appearance filename
        if (!parseTPFStringRefs) {
            console.warn('getModelForTemplate: parseTPFStringRefs function not provided', { context: 'model-service' });
            return null;
        }

        const stringRefs = parseTPFStringRefs(sharedPath);
        console.log('getModelForTemplate: parsed string refs', {
            context: 'model-service',
            stringRefs
        });

        if (!stringRefs || !stringRefs.appearanceFilename) {
            console.warn('getModelForTemplate: no appearance filename in template', {
                context: 'model-service',
                stringRefs
            });
            return null;
        }

        // Resolve appearance file path
        const effectiveClientPath =
            clientDataPath ||
            sharedBasePath.replace('sys.shared', 'sys.client').replace('/dsrc/', '/data/');

        console.log('getModelForTemplate: loading model', {
            context: 'model-service',
            appearanceFilename: stringRefs.appearanceFilename,
            effectiveClientPath
        });

        const result = loadModel(stringRefs.appearanceFilename, effectiveClientPath);
        console.log('getModelForTemplate: loadModel result', {
            context: 'model-service',
            hasResult: !!result,
            primitiveCount: result?.primitives?.length || 0
        });

        return result;
    } catch (error) {
        console.error(`Failed to get model for template ${craftedObjectTemplate}:`, error.message);
        return null;
    }
}

// ======================================================================
// Exports
// ======================================================================

export {
    IFFReader,
    parseVertexBufferFormat,
    VertexBufferFlags,
    // Texture constants
    TextureAddress,
    TextureFilter,
    TextureTags,
    // DDS texture parsing
    //parseDDSFile,
    // Shader template parsing
    //parseShaderTemplateFile,
    //resolveShaderTextures,
    // Texture utilities
    //resolveTexturePath,
    //loadTexture,
    // loadShaderWithTextures is already exported at definition
    // SAT (Skeletal Appearance Template) parsing
    //parseSATFile,
    // MGN (Skeletal Mesh Generator) parsing
    //parseMGNFile,
    // LMG (LOD Mesh Generator) parsing
    //parseLMGFile,
    // CMP (Component Appearance Template) parsing
    //parseCMPFile,
    // SKT (Skeleton Template) parsing
    //parseSKTFile,
    // POB (Portal Object/Building) parsing
    //parsePOBFile
};
