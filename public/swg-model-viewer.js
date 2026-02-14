/**
 * Model Viewer (Three.js)
 *
 * Consumes model JSON from the API only (GET /api/models/template/* or /api/models/schematic/:id).
 * Expects: { primitives: [{ positions, normals?, uvs?, colors?, indices?, primitiveType?, textureInfo?, shaderTemplate? }] }
 * No dependency on SWG/Titan types; coordinate conversion (left-handed → right-handed) applied here.
 *
 * Aligned with Titan C++: MeshAppearanceTemplate, ShaderPrimitiveSet, Iff (sharedFile).
 */

// Left-handed (e.g. DirectX) → Right-handed (Three.js): negate Z

class SWGModelViewer {
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.getElementById(container)
      : container;

    this.options = {
      width: options.width || 300,
      height: options.height || 300,
      backgroundColor: options.backgroundColor || 0x1a1a2e,
      autoRotate: options.autoRotate !== false,
      loadTextures: options.loadTextures !== false,
      // SWG rendering options
      showWireframe: options.showWireframe || false,
      showBoundingBox: options.showBoundingBox || false,
      lightingMode: options.lightingMode || 'default', // 'default', 'bright', 'dark', 'unlit'
      ...options
    };

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.model = null;
    this.animationId = null;
    this.textureCache = new Map();
    this.textureLoader = null;
    /** Stored original UVs per primitive (for UV transform sliders) */
    this._originalUvs = [];
    /** UV transform: offset and flip (so you can find values to bake in) */
    this.uvOffsetU = 0;
    this.uvOffsetV = 0;
    this.uvFlipU = false;
    this.uvFlipV = false; // default V flip for DirectX→OpenGL

    // Lighting
    this.lights = [];
    this.ambientLight = null;

    console.log('[SWGModelViewer] Initializing viewer');
    this.init();
  }

  init() {
    if (!this.container) {
      console.error('[SWGModelViewer] No container element');
      return;
    }
    if (typeof THREE === 'undefined') {
      console.error('[SWGModelViewer] Three.js not loaded');
      return;
    }

    console.log('[SWGModelViewer] Creating scene');

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.options.backgroundColor);

    // Camera - wider FOV for better model visibility in small viewports
    this.camera = new THREE.PerspectiveCamera(
      60,
      this.options.width / this.options.height,
      0.1,
      1000
    );
    this.camera.position.set(0, 0.5, 3.5);

    // Renderer with proper gamma correction for SWG textures
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    this.renderer.setSize(this.options.width, this.options.height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // Linear output to match source data (r128: outputEncoding, r150+: outputColorSpace)
    if (this.renderer.outputEncoding !== undefined) {
      this.renderer.outputEncoding = THREE.LinearEncoding;
    } else if (this.renderer.outputColorSpace !== undefined) {
      this.renderer.outputColorSpace = (THREE.LinearSRGBColorSpace !== undefined)
        ? THREE.LinearSRGBColorSpace
        : THREE.SRGBColorSpace;
    }

    // Clear existing content; use a wrapper so canvas + UV controls both fit and stay visible
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'swg-model-viewer-wrapper';
    wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;width:100%;';
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'flex:1 1 0;min-height:0;display:flex;align-items:center;justify-content:center;';
    canvasWrap.appendChild(this.renderer.domElement);
    wrapper.appendChild(canvasWrap);
    const showUvControls = this.options.showUvControls !== false && this.options.height >= 200;
    if (showUvControls) {
      this.uvControlsEl = this.createUvControls();
      wrapper.appendChild(this.uvControlsEl);
    } else {
      this.uvControlsEl = null;
    }
    this.container.appendChild(wrapper);

    // Setup lighting based on mode
    this.setupLighting(this.options.lightingMode);

    // Grid helper (optional)
    if (this.options.showGrid) {
      const gridHelper = new THREE.GridHelper(10, 10);
      this.scene.add(gridHelper);
    }

    // Controls (if OrbitControls available)
    if (typeof THREE.OrbitControls !== 'undefined') {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.autoRotate = this.options.autoRotate;
      this.controls.autoRotateSpeed = 2;
    }

    // Texture loader
    this.textureLoader = new THREE.TextureLoader();

    console.log('[SWGModelViewer] Scene initialized');
    this.animate();
  }

  /**
   * Create UV offset/transform controls and value display (so you can see what to bake in)
   */
  createUvControls() {
    const wrap = document.createElement('div');
    wrap.className = 'swg-model-viewer-uv-controls';
    wrap.style.cssText = 'flex:0 0 auto;min-height:0;margin:0;padding:8px;background:#2a2a3e;border:1px solid #4a4a6a;border-radius:6px;font-size:0.8rem;font-family:sans-serif;color:#e0e0e0;overflow:visible;';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:6px 12px;align-items:center;';
    const label = (t) => { const e = document.createElement('label'); e.textContent = t; e.style.gridColumn = '1'; return e; };
    const valueSpan = (id) => { const e = document.createElement('span'); e.id = id; e.style.fontFamily = 'var(--font-mono, monospace)'; e.textContent = '0'; return e; };
    const makeSlider = (id, min, max, step, value, onChange) => {
      const s = document.createElement('input');
      s.type = 'range';
      s.id = id;
      s.min = String(min);
      s.max = String(max);
      s.step = String(step);
      s.value = String(value);
      s.style.width = '100%';
      s.style.gridColumn = '2';
      s.addEventListener('input', () => { onChange(Number(s.value)); });
      return s;
    };
    const makeCheck = (id, checked, onChange) => {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.id = id;
      c.checked = !!checked;
      c.style.gridColumn = '2';
      c.addEventListener('change', () => { onChange(c.checked); });
      return c;
    };
    const row = (els) => { const r = document.createElement('div'); r.style.cssText = 'display:contents'; els.forEach(e => grid.appendChild(e)); };
    const uValEl = valueSpan('swg-viewer-uv-offset-u-value');
    const vValEl = valueSpan('swg-viewer-uv-offset-v-value');
    grid.appendChild(label('U offset'));
    grid.appendChild(makeSlider('swg-viewer-uv-offset-u', -1, 1, 0.01, this.uvOffsetU, (v) => { this.uvOffsetU = v; uValEl.textContent = v.toFixed(3); this.applyUvTransform(); }));
    grid.appendChild(uValEl);
    grid.appendChild(label('V offset'));
    grid.appendChild(makeSlider('swg-viewer-uv-offset-v', -1, 1, 0.01, this.uvOffsetV, (v) => { this.uvOffsetV = v; vValEl.textContent = v.toFixed(3); this.applyUvTransform(); }));
    grid.appendChild(vValEl);
    grid.appendChild(label('Flip U'));
    grid.appendChild(makeCheck('swg-viewer-uv-flip-u', this.uvFlipU, (v) => { this.uvFlipU = v; this.applyUvTransform(); }));
    grid.appendChild(document.createElement('span'));
    grid.appendChild(label('Flip V'));
    grid.appendChild(makeCheck('swg-viewer-uv-flip-v', this.uvFlipV, (v) => { this.uvFlipV = v; this.applyUvTransform(); }));
    grid.appendChild(document.createElement('span'));
    const copyRow = document.createElement('div');
    copyRow.style.cssText = 'grid-column:1/-1;margin-top:6px;font-size:0.75rem;color:#999;';
    copyRow.textContent = 'Values (use in code): offsetU=' + this.uvOffsetU.toFixed(3) + ', offsetV=' + this.uvOffsetV.toFixed(3) + ', flipU=' + this.uvFlipU + ', flipV=' + this.uvFlipV;
    const updateCopy = () => { copyRow.textContent = 'Values (use in code): offsetU=' + this.uvOffsetU.toFixed(3) + ', offsetV=' + this.uvOffsetV.toFixed(3) + ', flipU=' + this.uvFlipU + ', flipV=' + this.uvFlipV; };
    wrap.appendChild(grid);
    wrap.appendChild(copyRow);
    this._uvCopyRow = copyRow;
    this._uvUpdateCopy = updateCopy;
    uValEl.textContent = this.uvOffsetU.toFixed(3);
    vValEl.textContent = this.uvOffsetV.toFixed(3);
    updateCopy();
    return wrap;
  }

  /**
   * Apply current UV offset/flip to all meshes (from stored original UVs)
   */
  applyUvTransform() {
    if (!this.model || !this._originalUvs.length) return;
    const children = this.model.children;
    for (let idx = 0; idx < children.length; idx++) {
      const obj = children[idx];
      if (!obj.isMesh || !obj.geometry?.attributes?.uv) continue;
      const src = this._originalUvs[idx];
      if (!src || src.length < 2) continue;
      const arr = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 2) {
        let u = src[i];
        let v = src[i + 1];
        if (this.uvFlipU) u = 1 - u;
        if (this.uvFlipV) v = 1 - v;
        arr[i] = u + this.uvOffsetU;
        arr[i + 1] = v + this.uvOffsetV;
      }
      obj.geometry.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
      obj.geometry.attributes.uv.needsUpdate = true;
    }
    if (this._uvUpdateCopy) this._uvUpdateCopy();
  }

  /**
   * Setup lighting to match SWG in-game appearance
   * SWG used a combination of ambient + directional lights
   */
  setupLighting(mode) {
    // Clear existing lights
    for (const light of this.lights) {
      this.scene.remove(light);
    }
    this.lights = [];

    switch (mode) {
      case 'bright':
        // Bright lighting for detail inspection
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(this.ambientLight);
        this.lights.push(this.ambientLight);

        const brightKey = new THREE.DirectionalLight(0xffffff, 1.0);
        brightKey.position.set(5, 10, 7);
        this.scene.add(brightKey);
        this.lights.push(brightKey);
        break;

      case 'dark':
        // Dark/moody lighting
        this.ambientLight = new THREE.AmbientLight(0x404060, 0.4);
        this.scene.add(this.ambientLight);
        this.lights.push(this.ambientLight);

        const darkKey = new THREE.DirectionalLight(0x6080ff, 0.5);
        darkKey.position.set(5, 10, 7);
        this.scene.add(darkKey);
        this.lights.push(darkKey);
        break;

      case 'unlit':
        // No lighting - show textures at full brightness
        this.ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        this.scene.add(this.ambientLight);
        this.lights.push(this.ambientLight);
        break;

      default:
        // Default SWG-like lighting
        // Matches typical outdoor daylight in SWG
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);
        this.lights.push(this.ambientLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
        keyLight.position.set(5, 10, 7);
        this.scene.add(keyLight);
        this.lights.push(keyLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-5, -5, -5);
        this.scene.add(fillLight);
        this.lights.push(fillLight);
        break;
    }
  }

  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    if (this.controls) {
      this.controls.update();
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Load a texture from the API
   * @param {string} texturePath - Path to texture
   * @returns {Promise<THREE.Texture|null>}
   */
  async loadTexture(texturePath) {
    if (!texturePath) return null;

    // Check cache first
    if (this.textureCache.has(texturePath)) {
      return this.textureCache.get(texturePath);
    }

    try {
      const response = await fetch(`/api/models/texture/${encodeURIComponent(texturePath)}`);
      const result = await response.json();

      if (!result.success || !result.data) {
        console.warn('[SWGModelViewer] Failed to load texture:', texturePath, result.error);
        return null;
      }

      const { width, height, format, data } = result.data;

      console.log('[SWGModelViewer] Loaded texture:', { path: texturePath, width, height, format });

      // Create texture from base64 data
      const texture = this.createTextureFromDDS(data, width, height, format);

      if (texture) {
        this.textureCache.set(texturePath, texture);
      }

      return texture;
    } catch (error) {
      console.error('[SWGModelViewer] Error loading texture:', texturePath, error.message);
      return null;
    }
  }

  /**
   * Create Three.js texture from DDS data
   * @param {string} base64Data - Base64 encoded pixel data (RGBA format from backend)
   * @param {number} width - Texture width
   * @param {number} height - Texture height
   * @param {string} format - Format (always 'rgba' from backend after decompression)
   * @returns {THREE.Texture|null}
   */
  createTextureFromDDS(base64Data, width, height, format) {
    try {
      // Decode base64 to Uint8Array
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Backend always sends decompressed RGBA data
      const texture = new THREE.DataTexture(
        bytes,
        width,
        height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      );

      // UVs are already flipped in loadModel (V' = 1 - V), so don't flip texture
      texture.flipY = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      texture.generateMipmaps = true;

      return texture;
    } catch (error) {
      console.error('[SWGModelViewer] Failed to create texture:', error);
      return null;
    }
  }

  /**
   * Create material for a primitive, optionally with textures
   * Matches SWG shader system - StaticShader rendering
   * @param {Object} primitive - Primitive data
   * @param {THREE.Texture|null} diffuseTexture - Diffuse texture
   * @param {THREE.Texture|null} normalTexture - Normal map (optional)
   * @param {THREE.Texture|null} specularTexture - Specular map (optional)
   * @returns {THREE.Material}
   */
  createMaterial(primitive, diffuseTexture = null, normalTexture = null, specularTexture = null) {
    const shaderName = (primitive.shaderTemplate || '').toLowerCase();

    // Check for special shader types
    const isAlpha = shaderName.includes('alpha') || shaderName.includes('blend');
    const isAdditive = shaderName.includes('additive') || shaderName.includes('glow');
    const isUnlit = shaderName.includes('unlit') || shaderName.includes('emissive') || shaderName.includes('terrain');
    const isTransparent = shaderName.includes('transparent') || shaderName.includes('glass');
    const isCustomizable = shaderName.includes('cshd') || primitive.textureInfo?.type === 'customizable';
    const hasNormalMap = normalTexture !== null;

    const defaultColor = diffuseTexture ? 0xffffff : 0xaaaaaa;

    const materialOptions = {
      color: defaultColor,
      side: THREE.DoubleSide,
      flatShading: false,
      transparent: isAlpha || isTransparent,
      alphaTest: isAlpha ? 0.5 : 0,
    };

    let material;

    if (isUnlit || this.options.lightingMode === 'unlit') {
      material = new THREE.MeshBasicMaterial({
        ...materialOptions,
        map: diffuseTexture,
      });
    } else if (hasNormalMap && !isCustomizable) {
      material = new THREE.MeshStandardMaterial({
        ...materialOptions,
        map: diffuseTexture,
        normalMap: normalTexture,
        normalScale: new THREE.Vector2(1, 1),
        metalnessMap: specularTexture,
        roughnessMap: specularTexture,
        metalness: specularTexture ? 0.5 : 0.1,
        roughness: specularTexture ? 0.5 : 0.7,
      });
    } else if (isCustomizable) {
      material = new THREE.MeshStandardMaterial({
        ...materialOptions,
        map: diffuseTexture,
        metalness: 0.0,
        roughness: 0.8,
      });
    } else {
      material = new THREE.MeshStandardMaterial({
        ...materialOptions,
        map: diffuseTexture,
        metalness: 0.1,
        roughness: 0.7,
      });
    }

    if (isAdditive) {
      material.blending = THREE.AdditiveBlending;
      material.depthWrite = false;
    }

    if (this.options.showWireframe) {
      material.wireframe = true;
    }

    return material;
  }

  /**
   * Load model data from API response
   * Implements 1:1 rendering matching SWG's MeshAppearance
   * @param {Object} modelData - Model data with primitives array
   */
  /**
   * Load model from API response only. Expects { primitives: Array }.
   * Each primitive: positions (required), normals?, uvs?, colors?, indices?, primitiveType?, textureInfo?, shaderTemplate?
   */
  async loadModel(modelData) {
    console.log('[SWGModelViewer] Loading model', modelData);

    if (this.model) {
      this.scene.remove(this.model);
      this.model = null;
    }

    const primitives = modelData?.primitives;
    if (!Array.isArray(primitives) || primitives.length === 0) {
      console.warn('[SWGModelViewer] No primitives in model data');
      this.showPlaceholder();
      return;
    }

    this._originalUvs = [];
    const group = new THREE.Group();

    for (const primitive of primitives) {
      const positions = primitive.positions;
      if (!positions || positions.length === 0) {
        console.warn('[SWGModelViewer] Primitive has no positions');
        continue;
      }

      const geometry = new THREE.BufferGeometry();

      // SWG uses left-handed coordinate system, Three.js uses right-handed
      // SWG: X=right, Y=up, Z=into screen (left-handed DirectX style)
      // Three.js: X=right, Y=up, Z=out of screen (right-handed OpenGL style)
      // 
      // Negate Z for left-handed → right-handed
      const srcPositions = positions;
      const positionArray = new Float32Array(srcPositions.length);
      for (let i = 0; i < srcPositions.length; i += 3) {
        positionArray[i] = srcPositions[i];       // X stays X
        positionArray[i + 1] = srcPositions[i + 1]; // Y stays Y (already Y-up)
        positionArray[i + 2] = -srcPositions[i + 2]; // Negate Z for handedness
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));

      // Convert normals similarly - negate Z
      if (primitive.normals && primitive.normals.length > 0) {
        const srcNormals = primitive.normals;
        const normals = new Float32Array(srcNormals.length);
        for (let i = 0; i < srcNormals.length; i += 3) {
          normals[i] = srcNormals[i];
          normals[i + 1] = srcNormals[i + 1];
          normals[i + 2] = -srcNormals[i + 2];
        }
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      } else {
        geometry.computeVertexNormals();
      }

      // Set UVs if available (using current offset/flip so sliders match)
      if (primitive.uvs && primitive.uvs.length >= 2) {
        const src = primitive.uvs;
        this._originalUvs.push(Array.from(src));
        const uvArray = new Float32Array(src.length);
        for (let i = 0; i < src.length; i += 2) {
          let u = src[i];
          let v = src[i + 1];
          if (this.uvFlipU) u = 1 - u;
          if (this.uvFlipV) v = 1 - v;
          uvArray[i] = u + this.uvOffsetU;
          uvArray[i + 1] = v + this.uvOffsetV;
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
      } else {
        this._originalUvs.push(null);
      }

      // Set vertex colors if available
      if (primitive.colors && primitive.colors.length > 0) {
        const colors = new Float32Array(primitive.colors);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      }

      // Set indices if available - use Uint32Array for large meshes
      if (primitive.indices && primitive.indices.length > 0) {
        let indices = [...primitive.indices]; // Clone to avoid modifying original
        const vertexCount = primitive.vertexCount || (primitive.positions.length / 3);

        console.log('[SWGModelViewer] Processing indices', {
          indexCount: indices.length,
          vertexCount: vertexCount,
          primitiveType: primitive.primitiveType,
          isDivisibleBy3: indices.length % 3 === 0,
          sampleIndices: indices.slice(0, 10)
        });

        // Determine if we need to convert from triangle strip
        const isTriangleStrip = primitive.primitiveType === 'triangleStrip';
        const isTriangleFan = primitive.primitiveType === 'triangleFan';
        
        if (isTriangleStrip) {
          console.log('[SWGModelViewer] Converting triangle strip to list');
          indices = this.convertTriangleStripToList(indices, vertexCount);
        } else if (isTriangleFan) {
          console.log('[SWGModelViewer] Converting triangle fan to list');
          indices = this.convertTriangleFanToList(indices, vertexCount);
        }

        // Reverse winding order due to handedness change (Z negation)
        // SWG uses CW winding, Three.js uses CCW for front faces
        for (let i = 0; i < indices.length; i += 3) {
          const temp = indices[i + 1];
          indices[i + 1] = indices[i + 2];
          indices[i + 2] = temp;
        }

        if (indices.length >= 3) {
          const maxIndex = Math.max(...indices);
          const IndexArray = maxIndex > 65535 ? Uint32Array : Uint16Array;
          const indexArray = new IndexArray(indices);
          geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
        } else {
          console.warn('[SWGModelViewer] Not enough valid indices for triangles');
        }
      }

      // Load textures if available and option is enabled
      let diffuseTexture = null;
      let normalTexture = null;
      let specularTexture = null;
      
      if (this.options.loadTextures && primitive.textureInfo) {
        try {
          if (primitive.textureInfo.diffuse) {
            diffuseTexture = await this.loadTexture(primitive.textureInfo.diffuse);
          }
          if (primitive.textureInfo.normal) {
            normalTexture = await this.loadTexture(primitive.textureInfo.normal);
          }
          if (primitive.textureInfo.specular) {
            specularTexture = await this.loadTexture(primitive.textureInfo.specular);
          }
        } catch (e) {
          console.warn('[SWGModelViewer] Failed to load textures:', e);
        }
      }

      // Create material with texture if available
      const material = this.createMaterial(primitive, diffuseTexture, normalTexture, specularTexture);
      
      // Enable vertex colors if present
      if (primitive.colors && primitive.colors.length > 0) {
        material.vertexColors = true;
      }
      
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
    }

    // Center and scale the model
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 2 / maxDim : 1;

    group.scale.setScalar(scale);
    group.position.sub(center.multiplyScalar(scale));

    // Add bounding box helper if option enabled (Box3Helper in r150+, BoxHelper in r128)
    if (this.options.showBoundingBox) {
      try {
        if (typeof THREE.Box3Helper !== 'undefined') {
          const box = new THREE.Box3().setFromObject(group);
          const boxHelper = new THREE.Box3Helper(box, 0x00ff00);
          this.scene.add(boxHelper);
        } else {
          const boxHelper = new THREE.BoxHelper(group, 0x00ff00);
          this.scene.add(boxHelper);
        }
      } catch (e) {
        console.warn('[SWGModelViewer] Box helper not available', e);
      }
    }

    this.model = group;
    this.scene.add(this.model);

    console.log('[SWGModelViewer] Model loaded', {
      primitiveCount: modelData.primitives.length,
      boundingBox: { size, center }
    });
  }

  /**
   * Convert triangle strip indices to triangle list
   * Based on Graphics::drawIndexedTriangleStrip
   * @param {Array} indices - Strip indices
   * @param {number} vertexCount - Total vertex count for validation
   * @returns {Array} Triangle list indices
   */
  convertTriangleStripToList(indices, vertexCount) {
    const triangleList = [];

    for (let i = 2; i < indices.length; i++) {
      const i0 = indices[i - 2];
      const i1 = indices[i - 1];
      const i2 = indices[i];

      // Skip degenerate triangles (strip separators)
      if (i0 === i1 || i1 === i2 || i0 === i2) {
        continue;
      }

      // Skip invalid indices
      if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) {
        continue;
      }

      // Alternate winding order for proper face culling
      if ((i - 2) % 2 === 0) {
        triangleList.push(i0, i1, i2);
      } else {
        triangleList.push(i0, i2, i1);
      }
    }

    console.log('[SWGModelViewer] Converted strip to list', {
      originalCount: indices.length,
      newCount: triangleList.length,
      triangleCount: triangleList.length / 3
    });

    return triangleList;
  }

  /**
   * Convert triangle fan indices to triangle list
   * Based on Graphics::drawIndexedTriangleFan
   * @param {Array} indices - Fan indices
   * @param {number} vertexCount - Total vertex count for validation
   * @returns {Array} Triangle list indices
   */
  convertTriangleFanToList(indices, vertexCount) {
    const triangleList = [];

    if (indices.length < 3) return triangleList;

    const center = indices[0];

    for (let i = 2; i < indices.length; i++) {
      const i1 = indices[i - 1];
      const i2 = indices[i];

      // Skip degenerate triangles
      if (center === i1 || i1 === i2 || center === i2) {
        continue;
      }

      // Skip invalid indices
      if (center >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) {
        continue;
      }

      triangleList.push(center, i1, i2);
    }

    console.log('[SWGModelViewer] Converted fan to list', {
      originalCount: indices.length,
      newCount: triangleList.length,
      triangleCount: triangleList.length / 3
    });

    return triangleList;
  }

  /**
   * Show placeholder when no model available
   */
  showPlaceholder() {
    console.log('[SWGModelViewer] Showing placeholder');

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a4a6a,
      wireframe: true
    });

    this.model = new THREE.Mesh(geometry, material);
    this.scene.add(this.model);
  }

  /**
   * Load model from API for a schematic
   * @param {string} schematicId - Schematic ID
   */
  async loadSchematicModel(schematicId) {
    console.log('[SWGModelViewer] Loading model for schematic:', schematicId);
    this.clearModel();

    try {
      const response = await fetch(`/api/models/schematic/${schematicId}`);
      const result = await response.json();

      if (result.success && result.data) {
        await this.loadModel(result.data);
      } else {
        console.warn('[SWGModelViewer] Failed to load model:', result.error);
        this.showPlaceholder();
      }
    } catch (error) {
      console.error('[SWGModelViewer] Error loading model:', error);
      this.showPlaceholder();
    }
  }

  /**
   * Load model from API for a template path
   * @param {string} templatePath - Template path
   */
  async loadTemplateModel(templatePath) {
    console.log('[SWGModelViewer] Loading model for template:', templatePath);

    try {
      const response = await fetch(`/api/models/template/${encodeURIComponent(templatePath)}`);
      const result = await response.json();

      if (result.success && result.data) {
        await this.loadModel(result.data);
      } else {
        console.warn('[SWGModelViewer] Failed to load model:', result.error);
        this.showPlaceholder();
      }
    } catch (error) {
      console.error('[SWGModelViewer] Error loading model:', error);
      this.showPlaceholder();
    }
  }

  /**
   * Resize the viewer
   */
  resize(width, height) {
    this.options.width = width;
    this.options.height = height;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Clear current model from scene (keeps viewer usable for next load)
   */
  clearModel() {
    if (this.model && this.scene) {
      this.scene.remove(this.model);
      this.model = null;
    }
    this._originalUvs = [];
  }

  /**
   * Dispose of resources and remove viewer from container
   */
  dispose() {
    console.log('[SWGModelViewer] Disposing viewer');

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    this.clearModel();

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }

    if (this.container && this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }
}

// Make available globally
window.SWGModelViewer = SWGModelViewer;

