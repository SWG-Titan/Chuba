class MSHLoader {
    static async load(url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const reader = new IFFReader(arrayBuffer);

        reader.enterForm('MESH');
        const version = reader.enterForm(); // '0004' or '0005'

        const meshData = {
            extent: null,
            hardpoints: [],
            primitives: []
        };

        // Parse appearance template data (APPR form if present in newer versions)
        if (version === '0004' || version === '0005') {
            // Load extents and hardpoints from AppearanceTemplate:: load()
            meshData.extent = this.loadExtent(reader);
            meshData.hardpoints = this.loadHardpoints(reader);
        }

        // Load ShaderPrimitiveSetTemplate
        meshData.primitives = this.loadShaderPrimitiveSet(reader);

        reader.exitForm();
        reader.exitForm();

        return meshData;
    }

    static loadExtent(reader) {
        // Implementation depends on extent type (BOX, SPHR, etc.)
        // For now, return null or basic sphere
        return null;
    }

    static loadHardpoints(reader) {
        // Hardpoints are attachment points for other objects
        return [];
    }

    static loadShaderPrimitiveSet(reader) {
        reader.enterForm('SPS '); // ShaderPrimitiveSetTemplate
        const spsVersion = reader.enterForm();

        const primitives = [];
        const primitiveCount = reader.readInt32();

        for (let i = 0; i < primitiveCount; i++) {
            primitives.push(this.loadLocalShaderPrimitive(reader));
        }

        reader.exitForm();
        reader.exitForm();

        return primitives;
    }

    static loadLocalShaderPrimitive(reader) {
        reader.enterForm('LSPT');
        const version = reader.enterForm(); // Usually '0000' or '0001'

        const primitive = {
            shaderTemplateName: '',
            vertices: [],
            indices: [],
            normals: [],
            colors: [],
            uvs: []
        };

        // Read INFO chunk
        const infoChunk = reader.enterChunk('INFO');
        const primitiveType = reader.readInt32(); // 0=pointList, 4=indexedTriangleList, etc.
        const hasIndices = reader.readInt32() !== 0;
        const hasSortedIndices = reader.readInt32() !== 0;
        reader.exitChunk(infoChunk);

        // Read shader template name
        const nameChunk = reader.enterChunk('NAME');
        primitive.shaderTemplateName = reader.readString(nameChunk.size);
        reader.exitChunk(nameChunk);

        // Load vertex buffer
        primitive.vertices = this.loadVertexBuffer(reader, primitive);

        // Load index buffer (if present)
        if (hasIndices) {
            const indexChunk = reader.enterChunk('INDX');
            const indexCount = indexChunk.size / (version === '0001' ? 2 : 4);

            for (let i = 0; i < indexCount; i++) {
                primitive.indices.push(
                    version === '0001' ? reader.view.getUint16(reader.offset, true) : reader.readInt32()
                );
                reader.offset += version === '0001' ? 2 : 4;
            }

            reader.exitChunk(indexChunk);
        }

        reader.exitForm();
        reader.exitForm();

        return primitive;
    }

    static loadVertexBuffer(reader, primitive) {
        reader.enterForm('VBUF');
        reader.enterForm(); // version

        const formatChunk = reader.enterChunk('FMT ');
        const hasPosition = reader.readInt32() !== 0;
        const hasNormal = reader.readInt32() !== 0;
        const hasColor0 = reader.readInt32() !== 0;
        const hasColor1 = reader.readInt32() !== 0;
        const numTexCoordSets = reader.readInt32();

        const texCoordDims = [];
        for (let i = 0; i < numTexCoordSets; i++) {
            texCoordDims.push(reader.readInt32()); // Usually 2 for UVs
        }
        reader.exitChunk(formatChunk);

        // Read vertex data
        const dataChunk = reader.enterChunk('DATA');
        const vertexSize = this.calculateVertexSize(hasPosition, hasNormal, hasColor0, hasColor1, texCoordDims);
        const vertexCount = dataChunk.size / vertexSize;

        const vertices = [];

        for (let i = 0; i < vertexCount; i++) {
            const vertex = {};

            if (hasPosition) {
                vertex.position = reader.readVector();
            }
            if (hasNormal) {
                vertex.normal = reader.readVector();
            }
            if (hasColor0) {
                vertex.color0 = reader.readInt32(); // ARGB packed
            }
            if (hasColor1) {
                vertex.color1 = reader.readInt32();
            }

            vertex.uvs = [];
            for (let j = 0; j < numTexCoordSets; j++) {
                if (texCoordDims[j] === 2) {
                    vertex.uvs.push({
                        u: reader.readFloat(),
                        v: reader.readFloat()
                    });
                } else if (texCoordDims[j] === 4) {
                    // For DOT3 or other special coordinates
                    vertex.uvs.push({
                        u: reader.readFloat(),
                        v: reader.readFloat(),
                        w: reader.readFloat(),
                        q: reader.readFloat()
                    });
                }
            }

            vertices.push(vertex);
        }

        reader.exitChunk(dataChunk);
        reader.exitForm();
        reader.exitForm();

        return vertices;
    }

    static calculateVertexSize(hasPosition, hasNormal, hasColor0, hasColor1, texCoordDims) {
        let size = 0;
        if (hasPosition) size += 12; // 3 floats
        if (hasNormal) size += 12;
        if (hasColor0) size += 4; // 1 int32
        if (hasColor1) size += 4;
        texCoordDims.forEach(dim => {
            size += dim * 4; // dim floats
        });
        return size;
    }
}