import { environment } from '../../environments/environment';
import { Component, OnInit, AfterViewInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { addBlendingToMaterials } from '../helpers/gltf-helper'

@Component({
  selector: 'world-models',
  templateUrl: './world-models.component.html',
  styleUrls: ['./world-models.component.css']
})
export class WorldModelsComponent implements OnInit {

  public environment = environment;
  public modelIds;
  public status: string;
  public status2: string;
  public uniqueBoneCounts: number[];
  public boneCountSet: Set<number>;
  // THREE.js objects
  public clock;
  public rendererGlobal = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  public displays: any[];
  public isDestroyed = false;

  constructor(private http: HttpClient) {
  }

  ngOnInit() {
    this.displays = [];
    this.status = "Loading skeleton info from database...";
    this.http.get(environment.KUJATA_DATA_BASE_URL + '/metadata/skeleton-names-world.json').subscribe(skeletonFriendlyNames => {
      this.modelIds = skeletonFriendlyNames
      this.clock = new THREE.Clock();
      var app = this;
      Object.keys(this.modelIds).forEach((skeleton, i) => {
        const friendlyName = this.modelIds[skeleton]
        var display = this.createEmptyDisplay(skeleton, friendlyName, 'world_scene_container' + i, 200, 200);
        this.displays.push(display);
      })
      this.recursiveLoadSkeletonAndAddToDisplay(0);
    });
  }

  ngOnChanges(simpleChanges) {
    console.log('simpleChanges:', simpleChanges);
  }

  ngOnDestroy() {
    console.log("ngOnDestroy() called");
    this.isDestroyed = true;
  }

  public showDisplay(app, i, delay) {
    let display = app.displays[i];
    display.renderer = app.rendererGlobal;
    display.renderer.setSize(150, 150);
    display.renderer.outputEncoding = THREE.sRGBEncoding
    var containerElement = document.getElementById(display.containerId);
    containerElement.appendChild(display.renderer.domElement);
    
    // If animated, render a few frames to capture animation
    if (display.isAnimated && display.mixer) {
      // Render a few frames to get a good animation pose
      for (let frame = 0; frame < 10; frame++) {
        display.mixer.update(0.016); // ~60fps
        display.renderer.render(display.scene, display.camera);
      }
    } else {
      display.renderer.render(display.scene, display.camera);
    }
    
    display.screenshotDataUrl = display.renderer.domElement.toDataURL();
    display.renderer.dispose();
    display.renderer = null;
  }

  // for full screen, width=window.innerWidth, height=window.innerHeight
  private createEmptyDisplay(skeleton, friendlyName, containerId, width, height) {
    let display = {
      containerId: containerId,
      skeleton,
      friendlyName,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(75, width / height, 0.1, 1000),
      renderer: null,
      mixer: null,
      clock: null,
      isAnimated: false
    };
    display.containerId = containerId;
    display.scene.background = new THREE.Color(0x505050);
    display.scene.add(display.camera);
    // add lights
    var light = new THREE.DirectionalLight(0xffffff);
    light.position.set(0, 0, 50).normalize();
    display.scene.add(light);
    var ambientLight = new THREE.AmbientLight(0x404040); // 0x404040 = soft white light
    display.scene.add(ambientLight);

    display.camera.position.x = 0;
    display.camera.position.y = 13.53;
    display.camera.position.z = 50;
    display.camera.rotation.x = 0 * Math.PI / 180.0;

    return display;
  }

  private recursiveLoadSkeletonAndAddToDisplay(i) {
    var app = this;
    if (!app || app.isDestroyed) {
      console.log("stopping recursive loading");
      return;
    }
    if (i >= app.displays.length) {
      this.status = "Finished.";
      return; // stop recursion
    }
    var display = app.displays[i];
    var skeleton = display.skeleton;
    var friendlyName = display.friendlyName;
    this.status = "Loading skeleton model " + skeleton + ' (' + friendlyName + ')...';
    var gltfLoader = new GLTFLoader();
    gltfLoader.load(environment.KUJATA_DATA_BASE_URL + '/data/world/world_us.lgp/' + skeleton + '.hrc.gltf', function (gltf) {
      if (!app || app.isDestroyed) {
        console.log("ignoring gltf load() callback");
        return;
      }
      addBlendingToMaterials(gltf)
      
      let model = gltf.scene;
      let rootNode = model.children[0];
      rootNode.position.x = 0;
      rootNode.position.y = 0;
      rootNode.position.z = 0;
      display.scene.add(model);
      
      // Start first animation if available
      if (gltf.animations && gltf.animations.length > 0) {
        display.mixer = new THREE.AnimationMixer(model);
        const action = display.mixer.clipAction(gltf.animations[0]);
        action.play();
        display.isAnimated = true;
        
        // Start animation loop for this display
        display.clock = new THREE.Clock();
        const animateDisplay = function() {
          if (!app || app.isDestroyed || !display.mixer) {
            return;
          }
          requestAnimationFrame(animateDisplay);
          const delta = display.clock.getDelta();
          display.mixer.update(delta);
        };
        animateDisplay();
      }
      
      app.showDisplay(app, i, 10);
      app.recursiveLoadSkeletonAndAddToDisplay(i + 1);
    }, undefined, function (error) {
      console.error('oops!', error);
      app.recursiveLoadSkeletonAndAddToDisplay(i + 1);
    });
  }

}
