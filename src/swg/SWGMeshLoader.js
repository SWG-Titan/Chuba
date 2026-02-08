class SWGMeshLoader {
    constructor() {
        this.textureLoader = new THREE.TextureLoader();
        this. ddsLoader = new THREE.DDSLoader(); // You need DDSLoader from Three.js examples
    }

    async load(aptUrl, baseTexturePath = '') {
        // Step 1: Load APT to get MSH path
        const mshPath = await APTLoader. load(aptUrl);

        // Step 2: Load MSH file
        const meshData = await MSHLoader.load(mshPath);

        // Step 3: Create Three.js geometry and materials
        const group = new THREE.Group();

        for (const primitive of meshData.primitives) {
            const geometry = new THREE.BufferGeometry();

            // Set vertices
            const positions = [];
            const normals = [];
            const uvs = [];

            primitive.vertices.forEach(v => {
                // SWG uses right-handed coords, Three.js uses right-handed
                // But SWG has different axis conventions (may need to swap Y/Z)
                positions.push(-v.position.x, v.position.y, v.position.z); // Note the X flip

                if (v.normal) {
                    normals.push(-v.normal.x, v. normal.y, v.normal. z);
                }

                if (v.uvs && v.uvs.length > 0) {
                    uvs.push(v.uvs[0].u, v.uvs[0].v);
                }
            });

            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            if (normals.length > 0) {
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            }
            if (uvs.length > 0) {
                geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            }

            // Set indices
            if (primitive.indices. length > 0) {
                geometry.setIndex(primitive.indices);
            }

            // Load texture from shader template name
            const texturePath = this.resolveTexture(primitive.shaderTemplateName, baseTexturePath);
            const texture = await this.loadTexture(texturePath);

            const material = new THREE.MeshStandardMaterial({
                map:  texture,
                side: THREE.DoubleSide
            });

            const mesh = new THREE.Mesh(geometry, material);
            group.add(mesh);
        }

        return group;
    }

    resolveTexture(shaderTemplateName, basePath) {
        // SWG shader template names often reference . dds files
        // You'll need to parse the shader template or use a naming convention
        // For now, simple heuristic:
        const textureName = shaderTemplateName.replace('.sht', '. dds');
        return basePath + textureName;
    }

    async loadTexture(path) {
        return new Promise((resolve, reject) => {
            if (path.endsWith('.dds')) {
                this.ddsLoader.load(path, resolve, undefined, reject);
            } else {
                this.textureLoader. load(path, resolve, undefined, reject);
            }
        });
    }
}