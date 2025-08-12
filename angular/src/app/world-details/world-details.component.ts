import { environment } from '../../environments/environment';
import { Component, OnInit, AfterViewInit, Input, OnDestroy, OnChanges, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import { addBlendingToMaterials } from '../helpers/gltf-helper'


@Component({
  selector: 'world-details',
  templateUrl: './world-details.component.html',
  styleUrls: ['./world-details.component.css']
})
export class WorldDetailsComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {

  @Input() worldType: string; // 'overground', 'underwater', 'glacier'
  
  public environment = environment;
  public SCENE_WIDTH = 1200;
  public SCENE_HEIGHT = 800;
  public fetchStatus = "NONE"; // NONE, FETCHING, SUCCESS, ERROR
  
  // World map metadata
  public worldMapMetadata: any = null;
  public walkmeshTypes: any = null; // Store fetched walkmesh types data
  public loadedBlocks: Map<number, THREE.Object3D> = new Map();
  public wireframeBlocks: Map<number, THREE.LineSegments> = new Map();
  public showWireframes = false;
  public loadingProgress = { loaded: 0, total: 0 };
  
  // Camera persistence
  private cameraStorageKey: string;
  private saveInterval: any;
  private isWorldTypeSwitching: boolean = false;
  
  // Triangle inspection
  public triangleInfo: any = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private isPointerLocked = false;
  
  // UV Debug panel
  public showUVDebugPanel = false;
  public uvDebugData: any = null;
  private debugTriangleMesh: THREE.Mesh | null = null;
  private debugTriangleIndex: number = 0;
  private originalMaterial: THREE.Material | null = null;
  public availableTextures: string[] = [];
  public currentTexture: string = '';
  
  // UV Visualizer
  private uvVisualizerCanvas: HTMLCanvasElement | null = null;
  private uvVisualizerContext: CanvasRenderingContext2D | null = null;
  private isDraggingUVPoint = false;
  private draggedVertex: 'uv1' | 'uv2' | 'uv3' | null = null;
  private uvVisualizerSize = 200;
  
  // Visualization modes
  public visualizationMode: string = 'textured';
  public visualizationModes = [
    { value: 'textured', label: 'Textured' },
    { value: 'terrain', label: 'Terrain' },
    { value: 'region', label: 'Region' },
    { value: 'script', label: 'Script (tbc)' }
  ];
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  
  // Lighting objects for different modes
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  
  // THREE.js objects
  public clock;
  public renderer;
  public scene;
  public gltf;
  public camera;
  public controls;
  public isDestroyed = false;
  
  // Movement variables for PointerLockControls
  private moveForward = false;
  private moveBackward = false;
  private moveLeft = false;
  private moveRight = false;
  private moveUp = false;
  private moveDown = false;
  private velocity = new THREE.Vector3();
  private direction = new THREE.Vector3();
  
  private containerId: string;

  constructor(public http: HttpClient, private cdr: ChangeDetectorRef) {
    this.clock = new THREE.Clock();
  }

  ngOnInit() {
    this.containerId = `world-${this.worldType}-container`;
    this.cameraStorageKey = `ff7-world-camera-${this.worldType}`;
  }

  ngAfterViewInit() {
    this.initThreeJS();
    // Use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      this.loadWorldMapMetadata();
    }, 0);
  }

  ngOnChanges() {
    // Clear previous world data when switching tabs
    if (this.scene) {
      this.clearWorldData();
      // Set a flag to indicate we're switching world types
      this.isWorldTypeSwitching = true;
      this.loadWorldMapMetadata();
    }
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    
    // Save camera position one final time before destroying
    this.saveCameraPosition();
    
    // Clear the save interval
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  private initThreeJS() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x222222);

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, this.SCENE_WIDTH / this.SCENE_HEIGHT, 0.1, 300000);
    this.camera.position.set(0, 5, 10);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(this.SCENE_WIDTH, this.SCENE_HEIGHT);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Fix dark GLTF materials with proper encoding
    this.renderer.outputEncoding = THREE.sRGBEncoding;

    // PointerLockControls
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    
    // Add click to lock pointer
    this.renderer.domElement.addEventListener('click', () => {
      this.controls.lock();
    });
    
    // Track pointer lock state
    this.controls.addEventListener('lock', () => {
      this.isPointerLocked = true;
    });
    
    this.controls.addEventListener('unlock', () => {
      this.isPointerLocked = false;
    });
    
    // Setup triangle inspection
    this.setupTriangleInspection();
    
    // Setup keyboard controls
    this.setupKeyboardControls();

    // Enhanced Lighting
    // Ambient light for overall illumination
    this.ambientLight = new THREE.AmbientLight(0xffffff, 1.0); // Start with textured mode lighting
    this.scene.add(this.ambientLight);

    // Main directional light (sun)
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.directionalLight.position.set(200000, 200000, 100000);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.width = 2048;
    this.directionalLight.shadow.mapSize.height = 2048;
    this.directionalLight.shadow.camera.near = 0.5;
    this.directionalLight.shadow.camera.far = 100000;
    this.directionalLight.visible = false; // Start hidden for textured mode
    this.scene.add(this.directionalLight);

    // // Point light for additional highlights
    // const pointLight = new THREE.PointLight(0xffffff, 0.3, 30);
    // pointLight.position.set(-5, 8, -5);
    // this.scene.add(pointLight);

    // Add axes helper for orientation (red=X, green=Y, blue=Z)
    const axesHelper = new THREE.AxesHelper(5);
    this.scene.add(axesHelper);

    // Add a test box to make sure the scene is working
    const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
    const boxMaterial = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
    const testBox = new THREE.Mesh(boxGeometry, boxMaterial);
    testBox.position.set(0, 1, 0);
    testBox.castShadow = true;
    testBox.receiveShadow = true;
    // this.scene.add(testBox);

    // Add a ground plane
    const planeGeometry = new THREE.PlaneGeometry(20, 20);
    const planeMaterial = new THREE.MeshLambertMaterial({ color: 0x808080 });
    const groundPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = -1;
    groundPlane.receiveShadow = true;
    // this.scene.add(groundPlane);

    // Add renderer to DOM
    const container = document.getElementById(this.containerId);
    if (container) {
      container.appendChild(this.renderer.domElement);
    }

    // Start render loop
    this.animate();
  }

  private clearWorldData() {
    // Clear previous world blocks from scene
    this.loadedBlocks.forEach((block) => {
      this.scene.remove(block);
    });
    this.loadedBlocks.clear();
    
    // Clear wireframe blocks from scene
    this.wireframeBlocks.forEach((wireframe) => {
      this.scene.remove(wireframe);
    });
    this.wireframeBlocks.clear();
    
    // Reset loading progress
    this.loadingProgress = { loaded: 0, total: 0 };
    
    // Clear triangle info
    this.triangleInfo = null;
    
    // Clear UV debug data
    this.uvDebugData = null;
    this.debugTriangleMesh = null;
    this.originalMaterial = null;
    this.availableTextures = [];
    this.currentTexture = '';
    this.showUVDebugPanel = false;
    
    // Clear visualization data
    this.originalMaterials.clear();
    this.visualizationMode = 'textured';
    
    // Clear walkmesh types data (will be reloaded)
    this.walkmeshTypes = null;
    
    // Reset fetch status
    this.fetchStatus = "NONE";
  }

  private getWorldMapType(): string {
    switch (this.worldType) {
      case 'overground':
        return 'wm0';
      case 'underwater':
        return 'wm2';
      case 'glacier':
        return 'wm3';
      default:
        return 'wm0'; // Default to overground
    }
  }

  private loadWorldMapMetadata() {
    this.fetchStatus = "FETCHING";
    this.cdr.detectChanges();
    
    // Load both world map metadata and walkmesh types
    const worldMapType = this.getWorldMapType();
    const metadataUrl = environment.KUJATA_DATA_BASE_URL + `/metadata/world/${worldMapType}-map.json`;
    const walkmeshTypesUrl = environment.KUJATA_DATA_BASE_URL + `/metadata/world/walkmesh-types.json`;
    
    // Use Promise.all to load both resources
    Promise.all([
      this.http.get(metadataUrl).toPromise(),
      this.http.get(walkmeshTypesUrl).toPromise()
    ]).then(([metadata, walkmeshTypes]) => {
      this.worldMapMetadata = metadata;
      this.walkmeshTypes = walkmeshTypes;
      this.loadAllWorldBlocks();
    }).catch((error) => {
      console.error(`Error loading world map data for ${worldMapType}:`, error);
      this.fetchStatus = "ERROR";
      this.cdr.detectChanges();
    });
  }

  private loadAllWorldBlocks() {
    if (!this.worldMapMetadata) return;
    
    const blockCoordinates = this.worldMapMetadata.blockCoordinates;
    const defaultBlocks = Object.keys(blockCoordinates)
      .filter(blockId => blockCoordinates[blockId].isDefault)
      .map(blockId => parseInt(blockId));
    // const defaultBlocks = [37]
    this.loadingProgress.total = defaultBlocks.length;
    this.loadingProgress.loaded = 0;
    
    // Load all default blocks (0-62)
    defaultBlocks.forEach(blockId => {
      this.loadWorldBlock(blockId);
    });
  }

  private loadWorldBlock(blockId: number) {
    const gltfLoader = new GLTFLoader();
    const worldMapType = this.getWorldMapType();
    const modelPath = `/data/world/world_us.lgp/${worldMapType}-block_${blockId}.gltf`;
    const blockCoords = this.worldMapMetadata.blockCoordinates[blockId.toString()];
    
    gltfLoader.load(
      environment.KUJATA_DATA_BASE_URL + modelPath,
      (gltf) => {
        addBlendingToMaterials(gltf);
        
        // Position the block according to metadata
        gltf.scene.position.set(
          blockCoords.x,
          0,
          blockCoords.y // Y in metadata becomes Z in Three.js
        );
        
        // Store the loaded block
        this.loadedBlocks.set(blockId, gltf.scene);
        this.scene.add(gltf.scene);
        
        // Create wireframe version for debugging
        this.createWireframeForBlock(blockId, gltf.scene);
        
        this.loadingProgress.loaded++;
        
        // Check if all blocks are loaded
        if (this.loadingProgress.loaded === this.loadingProgress.total) {
          this.fetchStatus = "SUCCESS";
          this.cdr.detectChanges();
          this.positionCameraForWorldView();
          this.initUVDebugPanel();
        }
      },
      (progress) => {
        // Loading progress for individual block
      },
      (error) => {
        console.error(`Error loading ${worldMapType} block ${blockId}:`, error);
        this.loadingProgress.loaded++;
        
        // Still check if we're done (even with errors)
        if (this.loadingProgress.loaded === this.loadingProgress.total) {
          this.fetchStatus = "SUCCESS";
          this.cdr.detectChanges();
          this.positionCameraForWorldView();
          this.initUVDebugPanel();
        }
      }
    );
  }

  private positionCameraForWorldView() {
    // Always set the camera to fit the scene first
    this.setCameraToFitScene();
    
    // Reset the world type switching flag
    this.isWorldTypeSwitching = false;
    
    // Then initialize camera persistence (which will load saved position if it exists)
    this.initCameraPersistence();
  }

  private createWireframeForBlock(blockId: number, blockScene: THREE.Object3D) {
    // Create a group to hold all wireframes for this block
    const wireframeGroup = new THREE.Group();
    wireframeGroup.position.copy(blockScene.position);
    wireframeGroup.scale.copy(blockScene.scale);
    
    // Traverse the block scene and create wireframes for all meshes
    blockScene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const wireframeGeometry = new THREE.WireframeGeometry(child.geometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({ 
          color: 0x000000,
          transparent: true,
          opacity: 0.5
        });
        const wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
        
        // Copy the mesh's transform
        wireframeMesh.position.copy(child.position);
        wireframeMesh.rotation.copy(child.rotation);
        wireframeMesh.scale.copy(child.scale);
        
        wireframeGroup.add(wireframeMesh);
      }
    });
    
    // Store the wireframe group
    this.wireframeBlocks.set(blockId, wireframeGroup);
    
    // Add to scene but make it invisible initially
    wireframeGroup.visible = this.showWireframes;
    this.scene.add(wireframeGroup);
  }

  public toggleWireframes() {
    this.showWireframes = !this.showWireframes;
    
    // Toggle visibility of all wireframe blocks
    this.wireframeBlocks.forEach((wireframeGroup, blockId) => {
      wireframeGroup.visible = this.showWireframes;
    });
  }

  private animate() {
    if (this.isDestroyed) {
      return;
    }

    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    
    // Handle movement
    this.velocity.x -= this.velocity.x * 10.0 * delta;
    this.velocity.z -= this.velocity.z * 10.0 * delta;
    this.velocity.y -= this.velocity.y * 10.0 * delta;

    this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
    this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
    this.direction.y = Number(this.moveUp) - Number(this.moveDown);
    this.direction.normalize();

    if (this.moveForward || this.moveBackward) this.velocity.z -= this.direction.z * 500000.0 * delta;
    if (this.moveLeft || this.moveRight) this.velocity.x -= this.direction.x * 500000.0 * delta;
    if (this.moveUp || this.moveDown) this.velocity.y -= this.direction.y * 500000.0 * delta;

    this.controls.moveRight(-this.velocity.x * delta);
    this.controls.moveForward(-this.velocity.z * delta);
    this.camera.position.y += (-this.velocity.y * delta);

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private focusCameraOnModel(model: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 2; // Distance from the model
    
    // Position camera to look at the model
    this.camera.position.set(
      center.x + distance,
      center.y + distance * 0.5,
      center.z + distance
    );
    
    // Make camera look at the center of the model
    this.camera.lookAt(center);
    
    // PointerLockControls don't have a reset method like other controls
    // The camera direction will be controlled by mouse movement once pointer is locked
  }

  private setupKeyboardControls() {
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          this.moveForward = true;
          break;
        case 'ArrowLeft':
        case 'KeyA':
          this.moveLeft = true;
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.moveBackward = true;
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.moveRight = true;
          break;
        case 'Space':
          this.moveUp = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.moveDown = true;
          break;
        case 'KeyU':
          this.transferTriangleToUVDebugger();
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          this.moveForward = false;
          break;
        case 'ArrowLeft':
        case 'KeyA':
          this.moveLeft = false;
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.moveBackward = false;
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.moveRight = false;
          break;
        case 'Space':
          this.moveUp = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.moveDown = false;
          break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
  }

  // Triangle inspection methods
  private setupTriangleInspection() {
    this.renderer.domElement.addEventListener('mousemove', (event) => {
      // Only inspect when pointer is not locked
      if (this.isPointerLocked) {
        this.triangleInfo = null;
        return;
      }
      
      this.inspectTriangleAtMouse(event);
    });
    
    this.renderer.domElement.addEventListener('mouseleave', () => {
      this.triangleInfo = null;
    });
  }

  private inspectTriangleAtMouse(event: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    
    // Calculate mouse position in normalized device coordinates (-1 to +1)
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Update the raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Get all meshes from loaded blocks
    const meshes: THREE.Mesh[] = [];
    this.loadedBlocks.forEach(block => {
      block.traverse(child => {
        if (child instanceof THREE.Mesh) {
          meshes.push(child);
        }
      });
    });
    
    // Perform raycast
    const intersects = this.raycaster.intersectObjects(meshes);
    
    if (intersects.length > 0) {
      const intersection = intersects[0];
      this.analyzeTriangle(intersection);
    } else {
      this.triangleInfo = null;
    }
  }

  private analyzeTriangle(intersection: THREE.Intersection) {
    const mesh = intersection.object as THREE.Mesh;
    const geometry = mesh.geometry;
    const material = mesh.material as THREE.Material;
    const faceIndex = intersection.faceIndex;
    const point = intersection.point;
    const uv = intersection.uv;
    
    // Find which block this mesh belongs to
    let blockId = -1;
    this.loadedBlocks.forEach((block, id) => {
      block.traverse(child => {
        if (child === mesh) {
          blockId = id;
        }
      });
    });
    
    // Get triangle vertices
    let triangleVertices = null;
    let triangleNormals = null;
    let triangleUVs = null;
    
    if (geometry.index && faceIndex !== undefined) {
      const indices = geometry.index.array;
      const positions = geometry.attributes.position.array;
      const normals = geometry.attributes.normal?.array;
      const uvs = geometry.attributes.uv?.array;
      
      const i1 = indices[faceIndex * 3];
      const i2 = indices[faceIndex * 3 + 1];
      const i3 = indices[faceIndex * 3 + 2];
      
      triangleVertices = {
        v1: [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]],
        v2: [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]],
        v3: [positions[i3 * 3], positions[i3 * 3 + 1], positions[i3 * 3 + 2]]
      };
      
      if (normals) {
        triangleNormals = {
          n1: [normals[i1 * 3], normals[i1 * 3 + 1], normals[i1 * 3 + 2]],
          n2: [normals[i2 * 3], normals[i2 * 3 + 1], normals[i2 * 3 + 2]],
          n3: [normals[i3 * 3], normals[i3 * 3 + 1], normals[i3 * 3 + 2]]
        };
      }
      
      if (uvs) {
        triangleUVs = {
          uv1: [uvs[i1 * 2], uvs[i1 * 2 + 1]],
          uv2: [uvs[i2 * 2], uvs[i2 * 2 + 1]],
          uv3: [uvs[i3 * 2], uvs[i3 * 2 + 1]]
        };
      }
    }
    
    // Get material information
    const materialInfo: any = {
      type: material.constructor.name,
      name: material.name || 'Unnamed'
    };
    
    if (material instanceof THREE.MeshLambertMaterial || material instanceof THREE.MeshBasicMaterial) {
      materialInfo.color = `#${material.color.getHexString()}`;
      if (material.map) {
        materialInfo.texture = {
          name: material.map.name || 'Unnamed texture',
          size: `${material.map.image?.width || 'unknown'}x${material.map.image?.height || 'unknown'}`,
          format: material.map.format,
          type: material.map.type,
          wrapS: material.map.wrapS,
          wrapT: material.map.wrapT,
          magFilter: material.map.magFilter,
          minFilter: material.map.minFilter
        };
      }
    }
    
    this.triangleInfo = {
      blockId: blockId,
      meshName: mesh.name || 'Unnamed mesh',
      faceIndex: faceIndex,
      distance: intersection.distance.toFixed(2),
      worldPosition: {
        x: point.x.toFixed(2),
        y: point.y.toFixed(2),
        z: point.z.toFixed(2)
      },
      uv: uv ? {
        u: uv.x.toFixed(4),
        v: uv.y.toFixed(4)
      } : null,
      triangleVertices: triangleVertices,
      triangleNormals: triangleNormals,
      triangleUVs: triangleUVs,
      material: materialInfo,
      geometry: {
        type: geometry.constructor.name,
        vertexCount: geometry.attributes.position.count,
        faceCount: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3,
        hasNormals: !!geometry.attributes.normal,
        hasUVs: !!geometry.attributes.uv
      },
      metadata: this.getTriangleMetadata(mesh, faceIndex)
    };
  }

  private getTriangleMetadata(mesh: THREE.Mesh, faceIndex: number): any {
    const geometry = mesh.geometry;
    const metadata: any = {
      terrain: null,
      region: null,
      script: null,
      availableAttributes: Object.keys(geometry.attributes)
    };
    
    // Check for terrain data (try multiple naming conventions)
    const terrainAttr = geometry.attributes._terrain_type || 
                       geometry.attributes._TERRAIN_TYPE || 
                       geometry.attributes.TERRAIN_TYPE;
    if (terrainAttr && faceIndex * 3 < terrainAttr.count) {
      // Just get the first vertex value since all three will be the same
      metadata.terrain = terrainAttr.getX(faceIndex * 3);
    }
    
    // Check for region data (try multiple naming conventions)
    const regionAttr = geometry.attributes._region_id || 
                      geometry.attributes._REGION_ID || 
                      geometry.attributes.REGION_ID;
    if (regionAttr && faceIndex * 3 < regionAttr.count) {
      metadata.region = regionAttr.getX(faceIndex * 3);
    }
    
    // Check for script data (try multiple naming conventions)
    const scriptAttr = geometry.attributes._script_id || 
                      geometry.attributes._SCRIPT_ID || 
                      geometry.attributes.SCRIPT_ID;
    if (scriptAttr && faceIndex * 3 < scriptAttr.count) {
      metadata.script = scriptAttr.getX(faceIndex * 3);
    }
    
    return metadata;
  }

  // Methods for triangle inspector display
  public getTerrainName(terrainId: number): string {
    if (!this.walkmeshTypes || !this.walkmeshTypes.triangleTypes) {
      return 'Loading...';
    }
    return this.walkmeshTypes.triangleTypes[terrainId] || 'Unknown';
  }

  public getRegionName(regionId: number): string {
    if (!this.walkmeshTypes || !this.walkmeshTypes.regionNames) {
      return 'Loading...';
    }
    return this.walkmeshTypes.regionNames[regionId] || 'Unknown';
  }

  private setCameraToFitScene() {
    if (this.loadedBlocks.size === 0) {
      return;
    }

    // Calculate bounding box of all loaded meshes
    const boundingBox = new THREE.Box3();
    
    this.loadedBlocks.forEach((block, blockId) => {
      block.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Get the bounding box of this mesh
          const meshBoundingBox = new THREE.Box3().setFromObject(child);
          boundingBox.union(meshBoundingBox);
        }
      });
    });

    if (boundingBox.isEmpty()) {
      return;
    }

    // Get the center and size of the bounding box
    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());
    
    // Calculate camera height to fit the world width in the viewing area
    const worldWidth = Math.max(size.x, size.z); // Use the larger horizontal dimension
    const fov = this.camera.fov * (Math.PI / 180); // Convert to radians
    
    // Calculate height needed so that worldWidth fits in the view
    // For a top-down view: height = (worldWidth / 2) / tan(fov / 2)
    const cameraHeight = (worldWidth / 2) / Math.tan(fov / 2);

    // Add some padding (10% extra height for comfortable viewing)
    const paddedHeight = cameraHeight * 0.75;
    
    // Position camera directly above the center, looking straight down
    const cameraPosition = new THREE.Vector3(
      center.x,
      center.y + paddedHeight, // Directly above at calculated height
      center.z
    );
    
    // Set camera position and look straight down at the center
    this.camera.position.copy(cameraPosition);
    this.camera.lookAt(center.x, center.y, center.z); // Look straight down
    
    // PointerLockControls doesn't have a target property like OrbitControls
    // The camera direction is controlled by mouse movement, not by a target
    // No need to update controls target for PointerLockControls
  }

  private transferTriangleToUVDebugger() {
    let targetMesh: THREE.Mesh | null = null;
    let targetFaceIndex: number = 0;
    
    if (this.triangleInfo) {
      // Use the currently inspected triangle
      
      // Find the mesh from the triangle info
      const blockId = this.triangleInfo.blockId;
      const meshName = this.triangleInfo.meshName;
      const block = this.loadedBlocks.get(blockId);
      
      if (block) {
        block.traverse((child) => {
          if (child instanceof THREE.Mesh && child.name === meshName) {
            targetMesh = child;
          }
        });
      }
      
      targetFaceIndex = this.triangleInfo.faceIndex || 0;
    } else {
      // Default to first triangle of first mesh of first block
      
      const firstBlockId = Math.min(...Array.from(this.loadedBlocks.keys()));
      const firstBlock = this.loadedBlocks.get(firstBlockId);
      
      if (firstBlock) {
        firstBlock.traverse((child) => {
          if (child instanceof THREE.Mesh && !targetMesh) {
            targetMesh = child;
          }
        });
      }
      
      targetFaceIndex = 0;
    }
    
    if (!targetMesh || !targetMesh.geometry.attributes.uv) {
      console.warn('No valid mesh with UV coordinates found for UV debugger');
      return;
    }
    
    // Set up the UV debugger with the selected triangle
    this.debugTriangleMesh = targetMesh;
    this.debugTriangleIndex = targetFaceIndex;
    
    // Store original material
    this.originalMaterial = targetMesh.material as THREE.Material;
    
    // Collect available textures (in case they changed)
    this.collectAvailableTextures();
    
    // Update the UV debug data
    this.updateUVDebugData();
    
    // Show the UV debug panel
    this.showUVDebugPanel = true;
    
    // Initialize the UV visualizer
    this.initUVVisualizer();
  }

  // UV Debug Panel methods
  private initUVDebugPanel() {
    // Find the first mesh from the first block
    const firstBlockId = Math.min(...Array.from(this.loadedBlocks.keys()));
    const firstBlock = this.loadedBlocks.get(firstBlockId);
    
    if (!firstBlock) {
      console.warn('No blocks loaded for UV debug panel');
      return;
    }
    
    let firstMesh: THREE.Mesh | null = null;
    firstBlock.traverse((child) => {
      if (child instanceof THREE.Mesh && !firstMesh) {
        firstMesh = child;
      }
    });
    
    if (!firstMesh || !firstMesh.geometry.attributes.uv) {
      console.warn('No mesh with UV coordinates found for debug panel');
      return;
    }
    
    this.debugTriangleMesh = firstMesh;
    this.debugTriangleIndex = 0; // First triangle
    
    // Store original material
    this.originalMaterial = firstMesh.material as THREE.Material;
    
    // Collect available textures from all loaded blocks
    this.collectAvailableTextures();
    
    // Get the UV data for the first triangle
    this.updateUVDebugData();
  }
  
  private updateUVDebugData() {
    if (!this.debugTriangleMesh) return;
    
    const geometry = this.debugTriangleMesh.geometry;
    const uvAttribute = geometry.attributes.uv;
    const indexAttribute = geometry.index;
    
    if (!uvAttribute || !indexAttribute) return;
    
    // Get indices for the first triangle
    const i1 = indexAttribute.array[this.debugTriangleIndex * 3];
    const i2 = indexAttribute.array[this.debugTriangleIndex * 3 + 1];
    const i3 = indexAttribute.array[this.debugTriangleIndex * 3 + 2];
    
    // Get UV coordinates
    const uvArray = uvAttribute.array;
    
    this.uvDebugData = {
      blockId: this.getBlockIdForMesh(this.debugTriangleMesh),
      meshName: this.debugTriangleMesh.name || 'Unnamed',
      triangleIndex: this.debugTriangleIndex,
      vertexIndices: [i1, i2, i3],
      uvCoords: {
        uv1: { u: uvArray[i1 * 2], v: uvArray[i1 * 2 + 1] },
        uv2: { u: uvArray[i2 * 2], v: uvArray[i2 * 2 + 1] },
        uv3: { u: uvArray[i3 * 2], v: uvArray[i3 * 2 + 1] }
      }
    };
  }
  
  private getBlockIdForMesh(mesh: THREE.Mesh): number {
    for (const [blockId, block] of this.loadedBlocks.entries()) {
      let found = false;
      block.traverse((child) => {
        if (child === mesh) {
          found = true;
        }
      });
      if (found) return blockId;
    }
    return -1;
  }
  
  public toggleUVDebugPanel() {
    this.showUVDebugPanel = !this.showUVDebugPanel;
    if (this.showUVDebugPanel && !this.uvDebugData) {
      this.initUVDebugPanel();
    }
    if (this.showUVDebugPanel) {
      this.initUVVisualizer();
    }
  }
  
  public updateUV(vertex: 'uv1' | 'uv2' | 'uv3', coordinate: 'u' | 'v', value: number) {
    if (!this.debugTriangleMesh || !this.uvDebugData) return;
    
    const geometry = this.debugTriangleMesh.geometry;
    const uvAttribute = geometry.attributes.uv;
    const indexAttribute = geometry.index;
    
    if (!uvAttribute || !indexAttribute) return;
    
    // Get the vertex index
    const vertexMap = { uv1: 0, uv2: 1, uv3: 2 };
    const vertexIndex = this.uvDebugData.vertexIndices[vertexMap[vertex]];
    
    // Update the UV array
    const coordinateOffset = coordinate === 'u' ? 0 : 1;
    uvAttribute.array[vertexIndex * 2 + coordinateOffset] = value;
    
    // Update our debug data
    this.uvDebugData.uvCoords[vertex][coordinate] = value;
    
    // Mark the attribute as needing update
    uvAttribute.needsUpdate = true;
    
    // Update the visualizer
    this.drawUVVisualizer();
  }
  
  public resetUVs() {
    if (!this.debugTriangleMesh || !this.uvDebugData) return;
    
    // Reset to original values (you might want to store originals)
    this.updateUV('uv1', 'u', 0);
    this.updateUV('uv1', 'v', 0);
    this.updateUV('uv2', 'u', 1);
    this.updateUV('uv2', 'v', 0);
    this.updateUV('uv3', 'u', 0.5);
    this.updateUV('uv3', 'v', 1);
  }

  private collectAvailableTextures() {
    const textureSet = new Set<string>();
    const textureMap = new Map<string, THREE.Texture>();
    
    // Traverse all loaded blocks to find textures
    this.loadedBlocks.forEach((block, blockId) => {
      block.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const material = child.material as THREE.Material;
          
          if (material instanceof THREE.MeshLambertMaterial || material instanceof THREE.MeshBasicMaterial) {
            if (material.map && material.map.name) {
              const textureName = material.map.name || `texture_${blockId}_${child.name}`;
              textureSet.add(textureName);
              textureMap.set(textureName, material.map);
            }
          }
        }
      });
    });
    
    this.availableTextures = Array.from(textureSet).sort();
    
    // Set current texture
    if (this.debugTriangleMesh && this.originalMaterial) {
      const material = this.originalMaterial as any;
      if (material.map && material.map.name) {
        this.currentTexture = material.map.name;
      } else if (this.availableTextures.length > 0) {
        this.currentTexture = this.availableTextures[0];
      }
    }
    
    console.log(`Found ${this.availableTextures.length} available textures:`, this.availableTextures);
  }
  
  public changeTexture(textureName: string) {
    if (!this.debugTriangleMesh || !textureName) return;
    
    // Find the texture by name
    let targetTexture: THREE.Texture | null = null;
    
    this.loadedBlocks.forEach((block) => {
      block.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const material = child.material as any;
          if (material.map && material.map.name === textureName) {
            targetTexture = material.map;
          }
        }
      });
    });
    
    if (!targetTexture) {
      console.warn(`Texture ${textureName} not found`);
      return;
    }
    
    // Create a new material with the selected texture
    const currentMaterial = this.debugTriangleMesh.material as any;
    let newMaterial: THREE.Material;
    
    if (currentMaterial instanceof THREE.MeshLambertMaterial) {
      newMaterial = new THREE.MeshLambertMaterial({
        map: targetTexture,
        color: currentMaterial.color,
        transparent: currentMaterial.transparent,
        opacity: currentMaterial.opacity
      });
    } else {
      newMaterial = new THREE.MeshBasicMaterial({
        map: targetTexture,
        color: currentMaterial.color || 0xffffff,
        transparent: currentMaterial.transparent,
        opacity: currentMaterial.opacity
      });
    }
    
    // Apply the new material
    this.debugTriangleMesh.material = newMaterial;
    this.currentTexture = textureName;
  }
  
  public resetTexture() {
    if (!this.debugTriangleMesh || !this.originalMaterial) return;
    
    this.debugTriangleMesh.material = this.originalMaterial;
    
    // Reset current texture name
    const material = this.originalMaterial as any;
    if (material.map && material.map.name) {
      this.currentTexture = material.map.name;
    }
  }

  // UV Visualizer methods
  public initUVVisualizer() {
    setTimeout(() => {
      this.uvVisualizerCanvas = document.getElementById('uv-visualizer-canvas') as HTMLCanvasElement;
      if (!this.uvVisualizerCanvas) return;
      
      this.uvVisualizerContext = this.uvVisualizerCanvas.getContext('2d');
      if (!this.uvVisualizerContext) return;
      
      // Set canvas size
      this.uvVisualizerCanvas.width = this.uvVisualizerSize;
      this.uvVisualizerCanvas.height = this.uvVisualizerSize;
      
      // Setup mouse events
      this.setupUVVisualizerEvents();
      
      // Initial draw
      this.drawUVVisualizer();
    }, 100);
  }
  
  private setupUVVisualizerEvents() {
    if (!this.uvVisualizerCanvas) return;
    
    this.uvVisualizerCanvas.addEventListener('mousedown', (event) => {
      const rect = this.uvVisualizerCanvas!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      // Convert to UV coordinates (0-1 range, standard Y)
      const u = (x / this.uvVisualizerSize);
      const v = (y / this.uvVisualizerSize);
      
      // Find closest vertex
      const closestVertex = this.findClosestUVVertex(u, v);
      if (closestVertex) {
        this.isDraggingUVPoint = true;
        this.draggedVertex = closestVertex;
        this.uvVisualizerCanvas!.style.cursor = 'grabbing';
      }
    });
    
    this.uvVisualizerCanvas.addEventListener('mousemove', (event) => {
      if (!this.isDraggingUVPoint || !this.draggedVertex) {
        // Update cursor based on hover
        const rect = this.uvVisualizerCanvas!.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const u = (x / this.uvVisualizerSize);
        const v = (y / this.uvVisualizerSize);
        
        const closestVertex = this.findClosestUVVertex(u, v);
        this.uvVisualizerCanvas!.style.cursor = closestVertex ? 'grab' : 'default';
        return;
      }
      
      // Update UV coordinates while dragging
      const rect = this.uvVisualizerCanvas!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      // Convert to UV coordinates (0-1 range, standard Y)
      const u = Math.max(0, Math.min(1, (x / this.uvVisualizerSize)));
      const v = Math.max(0, Math.min(1, (y / this.uvVisualizerSize)));
      
      // Update the UV values
      this.updateUV(this.draggedVertex, 'u', u);
      this.updateUV(this.draggedVertex, 'v', v);
      
      // Redraw visualizer
      this.drawUVVisualizer();
    });
    
    this.uvVisualizerCanvas.addEventListener('mouseup', () => {
      this.isDraggingUVPoint = false;
      this.draggedVertex = null;
      this.uvVisualizerCanvas!.style.cursor = 'default';
    });
    
    this.uvVisualizerCanvas.addEventListener('mouseleave', () => {
      this.isDraggingUVPoint = false;
      this.draggedVertex = null;
      this.uvVisualizerCanvas!.style.cursor = 'default';
    });
  }
  
  private findClosestUVVertex(u: number, v: number): 'uv1' | 'uv2' | 'uv3' | null {
    if (!this.uvDebugData) return null;
    
    const threshold = 0.2; // 20% of canvas size for click detection
    const vertices = [
      { name: 'uv1' as const, u: this.uvDebugData.uvCoords.uv1.u % 1, v: this.uvDebugData.uvCoords.uv1.v % 1 },
      { name: 'uv2' as const, u: this.uvDebugData.uvCoords.uv2.u % 1, v: this.uvDebugData.uvCoords.uv2.v % 1 },
      { name: 'uv3' as const, u: this.uvDebugData.uvCoords.uv3.u % 1, v: this.uvDebugData.uvCoords.uv3.v % 1 }
    ];
    
    let closest = null;
    let minDistance = threshold;
    
    for (const vertex of vertices) {
      const distance = Math.sqrt(Math.pow(u - vertex.u, 2) + Math.pow(v - vertex.v, 2));
      if (distance < minDistance) {
        minDistance = distance;
        closest = vertex.name;
      }
    }
    
    return closest;
  }
  
  private drawUVVisualizer() {
    if (!this.uvVisualizerContext || !this.uvDebugData) return;
    
    const ctx = this.uvVisualizerContext;
    const size = this.uvVisualizerSize;
    
    // Clear canvas
    ctx.clearRect(0, 0, size, size);
    
    // Draw texture if available
    this.drawTextureBackground(ctx, size);
    
    // Draw triangle
    this.drawUVTriangle(ctx, size);
    
    // Draw UV points
    this.drawUVPoints(ctx, size);
  }
  
  private drawTextureBackground(ctx: CanvasRenderingContext2D, size: number) {
    if (!this.debugTriangleMesh) return;
    
    const material = this.debugTriangleMesh.material as any;
    if (!material.map || !material.map.image) return;
    
    try {
      // Draw texture image as background (single texture for 0-1 range)
      const img = material.map.image;
      ctx.drawImage(img, 0, 0, size, size);
      
      // Add semi-transparent overlay for better visibility
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(0, 0, size, size);
    } catch (error) {
      // Fallback: draw a light gray background
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, size, size);
    }
  }
  
  private drawUVGrid(ctx: CanvasRenderingContext2D, size: number) {
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    
    // Draw grid lines for 0-1 range (10x10 grid)
    for (let i = 0; i <= 10; i++) {
      const pos = (i / 10) * size;
      
      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, size);
      ctx.stroke();
      
      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(size, pos);
      ctx.stroke();
    }
    
    // Highlight border
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size);
  }
  
  private drawUVTriangle(ctx: CanvasRenderingContext2D, size: number) {
    if (!this.uvDebugData) return;
    
    const coords = this.uvDebugData.uvCoords;
    
    // Convert UV coordinates to canvas coordinates with normalization
    const x1 = (coords.uv1.u % 1) * size;
    const y1 = (coords.uv1.v % 1) * size;
    const x2 = (coords.uv2.u % 1) * size;
    const y2 = (coords.uv2.v % 1) * size;
    const x3 = (coords.uv3.u % 1) * size;
    const y3 = (coords.uv3.v % 1) * size;
    
    // Draw triangle outline
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.stroke();
    
    // Fill triangle with semi-transparent color
    ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
    ctx.fill();
  }
  
  private drawUVPoints(ctx: CanvasRenderingContext2D, size: number) {
    if (!this.uvDebugData) return;
    
    const coords = this.uvDebugData.uvCoords;
    const vertices = [
      { name: 'UV1', u: coords.uv1.u, v: coords.uv1.v, color: '#ff0000' },
      { name: 'UV2', u: coords.uv2.u, v: coords.uv2.v, color: '#00ff00' },
      { name: 'UV3', u: coords.uv3.u, v: coords.uv3.v, color: '#0000ff' }
    ];
    
    vertices.forEach((vertex) => {
      // Normalize coordinates to 0-1 range for display
      const x = (vertex.u % 1) * size;
      const y = (vertex.v % 1) * size;
      
      // Draw point
      ctx.fillStyle = vertex.color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw white border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw label with actual coordinates (not normalized)
      ctx.fillStyle = '#000000';
      ctx.font = '10px Arial';
      ctx.fillText(`${vertex.name} (${vertex.u.toFixed(2)}, ${vertex.v.toFixed(2)})`, x + 8, y - 8);
    });
  }

  // Visualization mode methods
  public changeVisualizationMode(mode: string) {
    this.visualizationMode = mode;
    this.updateLightingForMode(mode);
    this.applyVisualizationMode();
  }
  
  private updateLightingForMode(mode: string) {
    if (mode === 'textured') {
      // Textured mode: bright ambient light, no directional light
      this.ambientLight.intensity = 1.0;
      this.directionalLight.visible = false;
    } else {
      // Visualization modes: dim ambient light, strong directional light for shadows
      this.ambientLight.intensity = 0.3;
      this.directionalLight.visible = true;
    }
  }
  
  private applyVisualizationMode() {
    this.loadedBlocks.forEach((block) => {
      block.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          this.applyMaterialToMesh(child, this.visualizationMode);
        }
      });
    });
    
    // Update camera position after applying visualization
    this.setCameraToFitScene();
  }
  
  private applyMaterialToMesh(mesh: THREE.Mesh, mode: string) {
    // Store original material if not already stored
    if (!this.originalMaterials.has(mesh)) {
      this.originalMaterials.set(mesh, mesh.material);
    }
    
    if (mode === 'textured') {
      // Restore original textured material and remove vertex colors
      const originalMaterial = this.originalMaterials.get(mesh);
      if (originalMaterial) {
        mesh.material = originalMaterial;
        
        // Remove vertex colors if they exist
        if (mesh.geometry.attributes.color) {
          mesh.geometry.deleteAttribute('color');
        }
      }
      return;
    }
    
    // Apply vertex colors based on metadata
    this.applyVertexColors(mesh, mode);
  }
  
  private applyVertexColors(mesh: THREE.Mesh, mode: string) {
    const geometry = mesh.geometry;
    
    // Get the appropriate metadata attribute
    let dataAttribute;
    let colorMap;
    
    const terrainAttribute = geometry.attributes._terrain_type || 
                            geometry.attributes._TERRAIN_TYPE || 
                            geometry.attributes.TERRAIN_TYPE;
    const regionAttribute = geometry.attributes._region_id || 
                           geometry.attributes._REGION_ID || 
                           geometry.attributes.REGION_ID;
    const scriptAttribute = geometry.attributes._script_id || 
                           geometry.attributes._SCRIPT_ID || 
                           geometry.attributes.SCRIPT_ID;
    
    switch (mode) {
      case 'terrain':
        dataAttribute = terrainAttribute;
        colorMap = this.getTerrainColors();
        break;
      case 'region':
        dataAttribute = regionAttribute;
        colorMap = this.getRegionColors();
        break;
      case 'script':
        dataAttribute = scriptAttribute;
        colorMap = this.getScriptColors();
        break;
      default:
        return;
    }
    
    if (!dataAttribute) {
      this.applyFallbackVertexColors(mesh, [0.8, 0.4, 0.4]);
      return;
    }
    
    const vertexCount = geometry.attributes.position.count;
    const triangleCount = geometry.index ? geometry.index.count / 3 : vertexCount / 3;
    
    // Check if we have a metadata mismatch and choose appropriate strategy
    if (dataAttribute.count !== triangleCount) {
      if (dataAttribute.count === vertexCount) {
        this.applyPerVertexMetadata(mesh, mode, dataAttribute, colorMap);
        return;
      } else {
        this.applySharedMetadata(mesh, mode, dataAttribute, colorMap);
        return;
      }
    }
    
    // Standard per-triangle metadata
    this.applyPerTriangleMetadata(mesh, mode, dataAttribute, colorMap);
  }
  
  private applyPerTriangleMetadata(mesh: THREE.Mesh, mode: string, dataAttribute: THREE.BufferAttribute, colorMap: {[key: number]: number[]}) {
    const geometry = mesh.geometry;
    const vertexCount = geometry.attributes.position.count;
    const colors = new Float32Array(vertexCount * 3);
    
    if (geometry.index) {
      const indexArray = geometry.index.array;
      
      for (let i = 0; i < indexArray.length; i += 3) {
        const triangleIndex = Math.floor(i / 3);
        const metadataValue = dataAttribute.getX(triangleIndex);
        const color = colorMap[metadataValue] || [0.7, 0.7, 0.7];
        
        const v1Index = indexArray[i];
        const v2Index = indexArray[i + 1];
        const v3Index = indexArray[i + 2];
        
        colors[v1Index * 3] = color[0];
        colors[v1Index * 3 + 1] = color[1];
        colors[v1Index * 3 + 2] = color[2];
        
        colors[v2Index * 3] = color[0];
        colors[v2Index * 3 + 1] = color[1];
        colors[v2Index * 3 + 2] = color[2];
        
        colors[v3Index * 3] = color[0];
        colors[v3Index * 3 + 1] = color[1];
        colors[v3Index * 3 + 2] = color[2];
      }
    } else {
      for (let i = 0; i < vertexCount; i += 3) {
        const triangleIndex = Math.floor(i / 3);
        const metadataValue = dataAttribute.getX(triangleIndex);
        const color = colorMap[metadataValue] || [0.7, 0.7, 0.7];
        
        for (let j = 0; j < 3; j++) {
          const vertexIndex = i + j;
          colors[vertexIndex * 3] = color[0];
          colors[vertexIndex * 3 + 1] = color[1];
          colors[vertexIndex * 3 + 2] = color[2];
        }
      }
    }
    
    this.applyColorsToMesh(mesh, colors, mode);
  }
  
  private applyPerVertexMetadata(mesh: THREE.Mesh, mode: string, dataAttribute: THREE.BufferAttribute, colorMap: {[key: number]: number[]}) {
    const geometry = mesh.geometry;
    const vertexCount = geometry.attributes.position.count;
    const colors = new Float32Array(vertexCount * 3);
    
    // Each vertex has its own metadata value
    for (let i = 0; i < vertexCount; i++) {
      const metadataValue = dataAttribute.getX(i);
      const color = colorMap[metadataValue] || [0.7, 0.7, 0.7];
      
      colors[i * 3] = color[0];
      colors[i * 3 + 1] = color[1];
      colors[i * 3 + 2] = color[2];
    }
    
    this.applyColorsToMesh(mesh, colors, mode);
  }
  
  private applySharedMetadata(mesh: THREE.Mesh, mode: string, dataAttribute: THREE.BufferAttribute, colorMap: {[key: number]: number[]}) {
    const geometry = mesh.geometry;
    const vertexCount = geometry.attributes.position.count;
    const colors = new Float32Array(vertexCount * 3);
    
    // Use modulo to wrap around the available metadata
    if (geometry.index) {
      const indexArray = geometry.index.array;
      
      for (let i = 0; i < indexArray.length; i += 3) {
        const triangleIndex = Math.floor(i / 3);
        const metadataIndex = triangleIndex % dataAttribute.count;
        const metadataValue = dataAttribute.getX(metadataIndex);
        const color = colorMap[metadataValue] || [0.7, 0.7, 0.7];
        
        const v1Index = indexArray[i];
        const v2Index = indexArray[i + 1];
        const v3Index = indexArray[i + 2];
        
        colors[v1Index * 3] = color[0];
        colors[v1Index * 3 + 1] = color[1];
        colors[v1Index * 3 + 2] = color[2];
        
        colors[v2Index * 3] = color[0];
        colors[v2Index * 3 + 1] = color[1];
        colors[v2Index * 3 + 2] = color[2];
        
        colors[v3Index * 3] = color[0];
        colors[v3Index * 3 + 1] = color[1];
        colors[v3Index * 3 + 2] = color[2];
      }
    } else {
      for (let i = 0; i < vertexCount; i += 3) {
        const triangleIndex = Math.floor(i / 3);
        const metadataIndex = triangleIndex % dataAttribute.count;
        const metadataValue = dataAttribute.getX(metadataIndex);
        const color = colorMap[metadataValue] || [0.7, 0.7, 0.7];
        
        for (let j = 0; j < 3; j++) {
          const vertexIndex = i + j;
          colors[vertexIndex * 3] = color[0];
          colors[vertexIndex * 3 + 1] = color[1];
          colors[vertexIndex * 3 + 2] = color[2];
        }
      }
    }
    
    this.applyColorsToMesh(mesh, colors, mode);
  }
  
  private applyColorsToMesh(mesh: THREE.Mesh, colors: Float32Array, mode: string) {
    const geometry = mesh.geometry;
    const colorAttribute = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute('color', colorAttribute);
    
    const vertexColorMaterial = new THREE.MeshPhongMaterial({
      vertexColors: true,
      name: `${mode}_vertex_colors`
    });
    
    mesh.material = vertexColorMaterial;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
  }
  
  private applyFallbackVertexColors(mesh: THREE.Mesh, color: number[]) {
    const geometry = mesh.geometry;
    const vertexCount = geometry.attributes.position.count;
    const colors = new Float32Array(vertexCount * 3);
    
    // Apply the same color to all vertices
    for (let i = 0; i < vertexCount; i++) {
      colors[i * 3] = color[0];
      colors[i * 3 + 1] = color[1];
      colors[i * 3 + 2] = color[2];
    }
    
    const colorAttribute = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute('color', colorAttribute);
    
    const vertexColorMaterial = new THREE.MeshPhongMaterial({
      vertexColors: true,
      name: 'fallback_vertex_colors'
    });
    
    mesh.material = vertexColorMaterial;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
  }
  
  private getTerrainColors(): {[key: number]: number[]} {
    const worldMapType = this.getWorldMapType();
    let colorMap: {[key: number]: string} = {};
    
    // Use the correct color map based on world type
    switch (worldMapType) {
      case 'wm0': // overground
        colorMap = {
          0: '#4c3', 1: '#3a3', 2: '#977', 3: '#00a', 4: '#2bad9f', 5: '#00d', 6: '#14f', 7: '#898',
          8: '#ee7', 9: '#aa5', 10: '#eee', 11: '#ff0', 12: '#aa0', 13: '#0d0', 14: '#0e0', 15: '#0f0',
          16: '#a98', 17: '#ffa', 18: '#668', 19: '#aa7', 20: '#bba', 21: '#a88', 22: '#0af', 23: '#000',
          24: '#ee7', 25: '#282', 26: '#008', 27: '#fbb', 28: '#ffc', 29: '#b99', 30: '#c99'
        };
        break;
      case 'wm2': // underwater
        colorMap = {
          0: '#258',
          3: '#69a',
          15: '#479'
        };
        break;
      case 'wm3': // glacier
        colorMap = {
          1: '#aaa',
          2: '#cce',
          9: '#eee',
          10: '#fff'
        };
        break;
    }
    
    // Convert hex colors to RGB arrays
    const rgbColors: {[key: number]: number[]} = {};
    Object.entries(colorMap).forEach(([id, hexColor]) => {
      const rgb = this.hexToRgb(hexColor);
      rgbColors[parseInt(id)] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
    });
    
    return rgbColors;
  }
  
  private getRegionColors(): {[key: number]: number[]} {
    const worldMapType = this.getWorldMapType();
    let colorMap: {[key: number]: string} = {};
    
    // Use the correct color map based on world type
    switch (worldMapType) {
      case 'wm0': // overground
        colorMap = {
          0: '#605a5a', 1: '#5c3', 2: '#69c', 3: '#988', 4: '#d0a040', 5: '#492', 6: '#aa6039', 7: '#809080',
          8: '#6a7', 9: '#e65', 10: '#5e5', 11: '#fff', 12: '#a86', 13: '#c97', 14: '#0d0', 15: '#8f0',
          16: '#f9a', 17: '#00a'
        };
        break;
      case 'wm2': // underwater
        colorMap = {
          0: '#258',
          18: '#69a'
        };
        break;
      case 'wm3': // glacier
        colorMap = {
          11: '#fff'
        };
        break;
    }
    
    // Convert hex colors to RGB arrays
    const rgbColors: {[key: number]: number[]} = {};
    Object.entries(colorMap).forEach(([id, hexColor]) => {
      const rgb = this.hexToRgb(hexColor);
      rgbColors[parseInt(id)] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
    });
    
    return rgbColors;
  }
  
  private getScriptColors(): {[key: number]: number[]} {
    const scriptColorMap = {
      0: '#6a6a6a',      // Gray for no script
      1: '#555555',      // Light gray
      2: '#000000',      // Black (unused)
      3: '#ff4a00',      // Light red
      4: '#ff0000',      // Red-orange
      5: '#ff5500',      // Bright red
      6: '#ff8800',      // Pure red
      7: '#ffaa00',      // Dark red
      8: '#cc0000'       // Darker red
    };
    
    // Convert hex colors to RGB arrays and add chocobo yellow for higher IDs
    const rgbColors: {[key: number]: number[]} = {};
    
    // Add defined script colors
    Object.entries(scriptColorMap).forEach(([id, hexColor]) => {
      const rgb = this.hexToRgb(hexColor);
      rgbColors[parseInt(id)] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
    });
    
    // For any other script IDs, use chocobo yellow or generate colors
    for (let i = 9; i < 256; i++) {
      if (i >= 100 && i <= 150) {
        // Chocobo areas - use yellow
        const rgb = this.hexToRgb('#ffff00');
        rgbColors[i] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
      } else {
        // Generate other colors using HSV
        const hue = (i * 137.508) % 360;
        const saturation = 0.7;
        const value = 0.8;
        const rgb = this.hsvToRgb(hue, saturation, value);
        rgbColors[i] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
      }
    }
    
    return rgbColors;
  }
  
  private hexToRgb(hex: string): {r: number, g: number, b: number} {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Handle 3-character hex codes
    if (hex.length === 3) {
      hex = hex.split('').map(char => char + char).join('');
    }
    
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    return { r, g, b };
  }
  
  private hsvToRgb(h: number, s: number, v: number): {r: number, g: number, b: number} {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    
    let r = 0, g = 0, b = 0;
    
    if (0 <= h && h < 60) {
      r = c; g = x; b = 0;
    } else if (60 <= h && h < 120) {
      r = x; g = c; b = 0;
    } else if (120 <= h && h < 180) {
      r = 0; g = c; b = x;
    } else if (180 <= h && h < 240) {
      r = 0; g = x; b = c;
    } else if (240 <= h && h < 300) {
      r = x; g = 0; b = c;
    } else if (300 <= h && h < 360) {
      r = c; g = 0; b = x;
    }
    
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  // Camera persistence methods
  private initCameraPersistence() {
    // Load saved camera position
    this.loadCameraPosition();
    
    // Save camera position every 2 seconds
    this.saveInterval = setInterval(() => {
      this.saveCameraPosition();
    }, 2000);
  }

  private saveCameraPosition() {
    if (!this.camera) return;
    
    const cameraData = {
      position: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z
      },
      rotation: {
        x: this.camera.rotation.x,
        y: this.camera.rotation.y,
        z: this.camera.rotation.z
      },
      quaternion: {
        x: this.camera.quaternion.x,
        y: this.camera.quaternion.y,
        z: this.camera.quaternion.z,
        w: this.camera.quaternion.w
      },
      timestamp: Date.now()
    }; 
    // console.log('cameraData', cameraData.position)
    localStorage.setItem(this.cameraStorageKey, JSON.stringify(cameraData));
  }

  private loadCameraPosition() {
    const savedData = localStorage.getItem(this.cameraStorageKey);
    if (!savedData || !this.camera) return;
    
    try {
      const cameraData = JSON.parse(savedData);
      
      // Check if data is not too old (optional - remove if you want permanent persistence)
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      if (Date.now() - cameraData.timestamp > maxAge) {
        return;
      }
      
      // Restore camera position and rotation
      this.camera.position.set(
        cameraData.position.x,
        cameraData.position.y,
        cameraData.position.z
      );
      
      this.camera.rotation.set(
        cameraData.rotation.x,
        cameraData.rotation.y,
        cameraData.rotation.z
      );
      
      // Also restore quaternion for more accurate orientation
      this.camera.quaternion.set(
        cameraData.quaternion.x,
        cameraData.quaternion.y,
        cameraData.quaternion.z,
        cameraData.quaternion.w
      );
      
    } catch (error) {
      console.error('Error loading saved camera position:', error);
    }
  }

  public resetCameraPosition() {
    // Reset to default position and clear saved data
    localStorage.removeItem(this.cameraStorageKey);
    this.positionCameraForWorldView();
  }

  public exportCameraPosition(): string {
    if (!this.camera) return '';
    
    const cameraData = {
      position: this.camera.position,
      rotation: this.camera.rotation,
      quaternion: this.camera.quaternion
    };
    
    return JSON.stringify(cameraData, null, 2);
  }
}
