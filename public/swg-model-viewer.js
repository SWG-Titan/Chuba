/**
 * SWG Model Viewer
 *
 * Three.js-based 3D model viewer for SWG objects
 * Implements 1:1 rendering to match in-game appearance
 * 
 * Based on C++ implementations:
 *   - MeshAppearance.cpp
 *   - ShaderPrimitiveSet.cpp
 *   - StaticShader.cpp
 *   - Graphics.cpp
 */

// SWG uses left-handed coordinate system with Y-up
// Three.js uses right-handed coordinate system with Y-up
// SWG: X=right, Y=up, Z=into screen (left-handed)
// Three.js: X=right, Y=up, Z=out of screen (right-handed)

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
    
    // Lighting
    this.lights = [];
    this.ambientLight = null;

    console.log('[SWGModelViewer] Initializing viewer');
    this.init();
  }

  init() {
    // Check for Three.js
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
    this.camera.position.set(0, 0.5, 2.5);

    // Renderer with proper gamma correction for SWG textures
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    this.renderer.setSize(this.options.width, this.options.height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // SWG used DirectX which doesn't do gamma correction by default
    // Keep linear output to match original look
    this.renderer.outputEncoding = THREE.LinearEncoding;

    // Clear existing content (like loading text) before adding canvas
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

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

      // Flip Y for DirectX->OpenGL coordinate system conversion
      texture.flipY = true;
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
  async loadModel(modelData) {
    console.log('[SWGModelViewer] Loading model', modelData);

    // Remove existing model
    if (this.model) {
      this.scene.remove(this.model);
      this.model = null;
    }

    if (!modelData || !modelData.primitives || modelData.primitives.length === 0) {
      console.warn('[SWGModelViewer] No primitives in model data');
      this.showPlaceholder();
      return;
    }

    const group = new THREE.Group();

    for (const primitive of modelData.primitives) {
      console.log('[SWGModelViewer] Processing primitive', {
        shaderTemplate: primitive.shaderTemplate,
        vertexCount: primitive.vertexCount,
        indexCount: primitive.indexCount,
        hasPositions: primitive.positions?.length > 0,
        hasNormals: primitive.normals?.length > 0,
        hasUVs: primitive.uvs?.length > 0,
        textureInfo: primitive.textureInfo
      });

      if (!primitive.positions || primitive.positions.length === 0) {
        console.warn('[SWGModelViewer] Primitive has no positions');
        continue;
      }

      const geometry = new THREE.BufferGeometry();

      // SWG uses left-handed coordinate system, Three.js uses right-handed
      // SWG: X=right, Y=up, Z=into screen (left-handed DirectX style)
      // Three.js: X=right, Y=up, Z=out of screen (right-handed OpenGL style)
      // 
      // To convert: negate Z axis
      // This maintains Y-up orientation while flipping handedness
      const srcPositions = primitive.positions;
      const positions = new Float32Array(srcPositions.length);
      for (let i = 0; i < srcPositions.length; i += 3) {
        positions[i] = srcPositions[i];       // X stays X
        positions[i + 1] = srcPositions[i + 1]; // Y stays Y (already Y-up)
        positions[i + 2] = -srcPositions[i + 2]; // Negate Z for handedness
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

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

      // Set UVs if available
      if (primitive.uvs && primitive.uvs.length > 0) {
        const uvs = new Float32Array(primitive.uvs);
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
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

    // Add bounding box helper if option enabled
    if (this.options.showBoundingBox) {
      const boxHelper = new THREE.BoxHelper(group, 0x00ff00);
      this.scene.add(boxHelper);
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
   * Dispose of resources
   */
  dispose() {
    console.log('[SWGModelViewer] Disposing viewer');

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }

    if (this.model) {
      this.scene.remove(this.model);
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

// Make available globally
window.SWGModelViewer = SWGModelViewer;

