import { environment } from '../../environments/environment';
import { Component, OnInit, AfterViewInit } from '@angular/core';
import { ActivatedRoute } from "@angular/router";
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { addBlendingToMaterials } from '../helpers/gltf-helper'

@Component({
  selector: 'world-model-details',
  templateUrl: './world-model-details.component.html',
  styleUrls: ['./world-model-details.component.css']
})
export class WorldModelDetailsComponent implements OnInit {

  public environment = environment;
  public CHAR_BASE_URL = environment.KUJATA_DATA_BASE_URL + '/data/world/world_us.lgp/';
  public SCENE_WIDTH = 300;
  public SCENE_HEIGHT = 300;
  public skeletonFriendlyNames;
  public selectedHrcId;
  public availableAnimations = [];
  public modelGLTF;
  public selectedAnimationIndex = 0;
  public friendlyName;
  public Object = Object; // so the html can call Object.keys()
  // THREE.js objects
  public clock;
  public renderer;
  public scene;
  public gltf;
  public camera;
  public controls;
  public mixer;
  public isAnimationEnabled = false;
  public isDestroyed = false;

  constructor(public route: ActivatedRoute, public http: HttpClient) {
  }

  ngOnInit() {
    let url = environment.KUJATA_DATA_BASE_URL + '/metadata/skeleton-names-world.json';
    this.http.get(url).subscribe(skeletonFriendlyNames => {
      this.skeletonFriendlyNames = skeletonFriendlyNames;
      this.initialize();
    });
    this.route.paramMap.subscribe(params => {
      this.selectedHrcId = params.get("hrcId");
      this.initialize();
    });
  }

  ngOnDestroy() {
    console.log("ngOnDestroy() called");
    this.isDestroyed = true;
    this.isAnimationEnabled = false; // stop the appTick loop
  }

  initialize() {
    if (!this.skeletonFriendlyNames) { return; }
    if (!this.selectedHrcId) { return; }
    this.friendlyName = this.skeletonFriendlyNames[this.selectedHrcId];

    this.clock = new THREE.Clock();
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(this.SCENE_WIDTH, this.SCENE_HEIGHT);
    this.renderer.outputEncoding = THREE.sRGBEncoding

    // clear these variables in case a user re-visits this page after leaving it
    this.modelGLTF = null;
    this.gltf = null;
    this.scene = null;
    this.camera = new THREE.PerspectiveCamera(90, this.SCENE_WIDTH / this.SCENE_HEIGHT, 0.1, 1000);
    this.camera.position.x = 0;
    this.camera.position.y = 0;
    this.camera.position.z = 50;
    this.camera.rotation.x = 0 * Math.PI / 180.0;

    this.controls = null;

    this.http.get(this.CHAR_BASE_URL + this.selectedHrcId + '.hrc.gltf').subscribe(modelGLTF => {
      this.modelGLTF = modelGLTF;
      this.initializeSceneWithGLTF(this, modelGLTF);
    }, function (error) {
      console.error('oops!', error);
    }); // end http get modelGLTF

    var app = this;

    var appTick = function () {
      if (!app || app.isDestroyed) {
        console.log("stopping appTick()");
        return;
      }
      // Note: Even if app.isAnimationEnabled == false, we must still
      // keep calling appTick(), to let the OrbitControls adjust the
      // camera if the user moves it.
      requestAnimationFrame(appTick);
      var delta = app.clock.getDelta();
      if (app.controls) {
        app.controls.update(delta);
      }
      if (app.mixer) {
        if (app.isAnimationEnabled) {
          app.mixer.update(delta);
        }
      }
      if (app.renderer && app.scene && app.camera) {
        app.renderer.render(app.scene, app.camera);
      }
    }

    appTick();
  }

  initializeSceneWithGLTF(app, gltfData) {
    console.log("gltf data:", gltfData);
    var gltfLoader = new GLTFLoader();
    gltfLoader.parse(JSON.stringify(gltfData), app.CHAR_BASE_URL, function (gltf) {
      addBlendingToMaterials(gltf)

      console.log("loaded gltf:", gltf);
      app.gltf = gltf;
      
      // Extract animations from the glTF
      app.availableAnimations = [];
      if (gltf.animations && gltf.animations.length > 0) {
        for (let i = 0; i < gltf.animations.length; i++) {
          const animation = gltf.animations[i];
          app.availableAnimations.push({
            index: i,
            name: animation.name || `Animation ${i + 1}`,
            duration: animation.duration || 0
          });
        }
      }
      
      let model = gltf.scene;
      let rootNode = model.children[0];
      
      app.scene = new THREE.Scene();

      app.scene.background = new THREE.Color(0xBBDDFF); //0x505050
      app.scene.add(app.camera);
      // add lights
      var light = new THREE.DirectionalLight(0xffffff);
      light.position.set(0, 0, 50).normalize();
      app.scene.add(light);
      var ambientLight = new THREE.AmbientLight(0x404040); // 0x404040 = soft white light
      app.scene.add(ambientLight);

      // add ground
      var material = new THREE.MeshBasicMaterial({ color: 0x33bb55, opacity: 1.0, side: THREE.DoubleSide });
      var geometry = new THREE.CircleGeometry(50, 32);
      var plane = new THREE.Mesh(geometry, material);
      plane.rotateX(-Math.PI / 2);
      app.scene.add(plane);

      app.scene.add(model);
      var containerElement = document.getElementById("scene-container");
      containerElement.appendChild(app.renderer.domElement);

      // Set camera position based on model
      var modelRootHeight = 15.0; // default height
      if (gltfData.nodes && gltfData.nodes[1] && gltfData.nodes[1].translation) {
        modelRootHeight = gltfData.nodes[1].translation[1];
        if (modelRootHeight == 0) {
          modelRootHeight = 15.0;
        }
      }
      
      if (app.camera.position.y == 0) {
        console.log("setting camera height to:" + modelRootHeight * 2);
        app.camera.position.y = modelRootHeight * 2;
        app.camera.position.z = Math.max(modelRootHeight * 3, 50);
      }

      console.log("modelRootHeight=" + modelRootHeight);

      app.controls = new OrbitControls(app.camera, app.renderer.domElement);
      app.controls.target = new THREE.Vector3(0, modelRootHeight, 0);
      app.controls.update();

      // Start animation if available
      if (app.availableAnimations.length > 0) {
        app.startAnimation(app.selectedAnimationIndex);
      }

      app.renderer.render(app.scene, app.camera);

    }, undefined, function (error) {
      console.error('oops!', error);
    }); // end of three.js gltf loader
  }

  onSelectAnimation(animationIndex) {
    this.selectedAnimationIndex = animationIndex;
    this.startAnimation(animationIndex);
  }

  public startAnimation(animationIndex = 0) {
    if (!this.gltf || !this.gltf.animations || this.gltf.animations.length === 0) {
      console.log("No animations available");
      return;
    }
    
    // Stop current animation if running
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    
    this.isAnimationEnabled = true;
    this.mixer = new THREE.AnimationMixer(this.gltf.scene);
    
    // Play the selected animation
    if (animationIndex < this.gltf.animations.length) {
      const action = this.mixer.clipAction(this.gltf.animations[animationIndex]);
      action.play();
      console.log(`Playing animation ${animationIndex}: ${this.gltf.animations[animationIndex].name}`);
    }
  }

  public stopAnimation() {
    this.isAnimationEnabled = false;
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
  }

}
