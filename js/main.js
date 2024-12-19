// ==========================================================
// Global Variables & Constants
// ==========================================================
// Note: Babylon.js uses a 'Scene' as a container for all 3D elements.
// 'Engine' drives rendering, and we attach a camera & lights to the scene.
// We'll also integrate WebXR for VR interactions.

let engine;
let scene;
let audioContext;
let triggersVisible = false;

const SOUND_COLLECTIONS = {
  normal: {
    lung: {
      url: "assets/audio/Bronchial.mp3",
      name: "Normal Bronchial",
    },
    heart: {
      url: "assets/audio/Normal_heart.mp3",
      name: "Normal Heart",
    },
    crackles: {
      url: "assets/audio/Crackles_Fine.mp3",
      name: "Fine Crackles",
    },
  },
  intermediate: {
    lung: {
      url: "assets/audio/Bronchial.mp3",
      name: "Normal Bronchial",
    },
    heart: {
      url: "assets/audio/Third_heart.mp3",
      name: "Third Heart",
    },
    crackles: {
      url: "assets/audio/Crackles_Late_Inspiratory.mp3",
      name: "Late Inspiratory Crackles",
    },
  },
};

let sounds = {
  activeCollection: "normal",
  soundObjects: {},
};

let currentlyPlayingText;

// ==========================================================
// Entry Point - User Interaction
// ==========================================================

document
  .getElementById("startButton")
  .addEventListener("click", startExperience);

async function startExperience() {
  // Create or resume an AudioContext after user interaction due to browser policies.
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  document.getElementById("startMessage").style.display = "none";
  document.getElementById("startButton").style.display = "none";
  document.getElementById("renderCanvas").style.display = "block";

  const canvas = document.getElementById("renderCanvas");
  engine = new BABYLON.Engine(canvas, true);

  // createScene sets up camera, lights, floor, loads models, and prepares XR.
  scene = createScene(engine, canvas);

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
}

// ==========================================================
// Scene and Environment Setup
// ==========================================================
// createScene: main setup for the environment. We define:
// - A Scene (the 3D world)
// - Camera (user viewpoint)
// - Lights for visibility
// - Floor and surrounding environment
// - Loading models (SAMII dummy, hospital bed)
// - Integrate VR (WebXR) and audio

function createScene(engine, canvas) {
  const scene = new BABYLON.Scene(engine);
  scene.metadata = {
    triggers: [],
    controllers: [],
  };

  // Audio settings let us position sounds spatially in the scene
  scene.audioEnabled = true;
  scene.audioPositioningRefreshRate = 100;

  // ArcRotateCamera lets the user orbit around a target (0,1,0)
  const camera = new BABYLON.ArcRotateCamera(
    "Camera",
    Math.PI / 2,
    Math.PI / 2,
    2,
    new BABYLON.Vector3(0, 1, 0),
    scene
  );
  camera.attachControl(canvas, true);

  // Basic lighting
  const ambientLight = new BABYLON.HemisphericLight(
    "ambientLight",
    new BABYLON.Vector3(0, 1, 0),
    scene
  );
  ambientLight.intensity = 0.7;

  const directionalLight = new BABYLON.DirectionalLight(
    "directionalLight",
    new BABYLON.Vector3(-1, -2, -1),
    scene
  );
  directionalLight.intensity = 0.5;

  const floor = createRoom(scene);
  createSounds(scene); // Load initial sound collection
  initializeXR(scene, floor); // Set up VR mode and controllers

  // Load the SAMII dummy model
  loadModel(scene, "assets/models/", "SAMII.glb")
    .then((samiiMesh) => {
      samiiMesh.position = new BABYLON.Vector3(0, 0.5, 0);
      samiiMesh.rotation = new BABYLON.Vector3(0, -2.9, 0);
      // We'll attach triggers (spheres) on this model that play sounds.
      createTriggerPoints(scene, samiiMesh, sounds.soundObjects);
      configureTriggerActionsForAllControllers(scene);
    })
    .catch((error) => {
      console.error("Model failed to load:", error);
    });

  // Load a hospital bed for environment realism
  loadModel(scene, "assets/models/", "hospital_bed.glb")
    .then((bedMesh) => {
      bedMesh.position = new BABYLON.Vector3(0, 0.5, 0);
      bedMesh.rotation = new BABYLON.Vector3(0, -Math.PI / 2, 0);
    })
    .catch((error) => {
      console.error("Model failed to load:", error);
    });

  return scene;
}

// ==========================================================
// Sound Handling
// ==========================================================
// We load collections of sounds and attach them to triggers.
// Spatial audio means sounds have a position in the 3D scene.

function createSounds(scene) {
  return loadSoundCollection(scene, sounds.activeCollection);
}

async function loadSoundCollection(scene, collectionName) {
  // Dispose old sounds before loading new collection
  Object.values(sounds.soundObjects).forEach((sound) => {
    if (sound.isPlaying) {
      sound.stop();
    }
    sound.dispose();
  });

  sounds.soundObjects = {};
  sounds.activeCollection = collectionName;

  console.log(`Loading sound collection: ${collectionName}...`);
  const collection = SOUND_COLLECTIONS[collectionName];

  const loadPromises = Object.entries(collection).map(([key, soundData]) => {
    return new Promise((resolve, reject) => {
      const sound = new BABYLON.Sound(
        soundData.name,
        soundData.url,
        scene,
        () => {
          console.log(`Loaded sound: ${soundData.name}`);
          resolve();
        },
        {
          loop: true,
          autoplay: false,
          spatialSound: true,
          distanceModel: "linear",
          maxDistance: 100,
          rolloffFactor: 1,
        }
      );

      sound.onLoadError = (error) => {
        console.error(`Error loading ${soundData.name}:`, error);
        reject(error);
      };

      sounds.soundObjects[key] = sound;
    });
  });

  try {
    await Promise.all(loadPromises);
    console.log(`All sounds loaded for collection: ${collectionName}`);
    await updateTriggerSounds(scene);
    return true;
  } catch (error) {
    console.error("Error loading sound collection:", error);
    return false;
  }
}

// Updates each trigger mesh to use the newly loaded sounds
function updateTriggerSounds(scene) {
  if (!scene.metadata.triggers) {
    return;
  }

  scene.metadata.triggers.forEach((triggerData, index) => {
    let soundKey;
    // Assign sound keys to triggers based on index
    switch (index) {
      case 0:
        soundKey = "lung";
        break;
      case 1:
        soundKey = "heart";
        break;
      case 2:
        soundKey = "crackles";
        break;
    }

    if (soundKey && sounds.soundObjects[soundKey]) {
      if (triggerData.sound && triggerData.sound.isPlaying) {
        triggerData.sound.stop();
      }

      triggerData.sound = sounds.soundObjects[soundKey];
      triggerData.sound.attachToMesh(triggerData.trigger);
    }
  });
}

// ==========================================================
// Model Loading
// ==========================================================
// loadModel uses Babylon.js SceneLoader to import GLB models.
// Once loaded, we position them in the scene.

function loadModel(scene, rootUrl, fileName) {
  return new Promise((resolve, reject) => {
    BABYLON.SceneLoader.ImportMesh(
      "",
      rootUrl,
      fileName,
      scene,
      function (meshes) {
        const importedMesh = meshes[0];
        importedMesh.position = BABYLON.Vector3.Zero();
        resolve(importedMesh);
      },
      null,
      function (scene, message, exception) {
        reject({ message, exception });
      }
    );
  });
}

// ==========================================================
// Trigger Points
// ==========================================================
// We create small spheres on the model where placing the VR controller will play sounds.
// Each trigger is associated with a sound and is toggled visible/invisible by the UI.

function createTriggerPoints(scene, importedMesh, soundObjects) {
  const trigger1 = BABYLON.MeshBuilder.CreateSphere(
    "trigger1",
    { diameter: 0.1 },
    scene
  );
  trigger1.position = new BABYLON.Vector3(0, 0.55, 0.1);
  trigger1.parent = importedMesh;
  trigger1.isVisible = triggersVisible;

  if (soundObjects.lung) {
    soundObjects.lung.attachToMesh(trigger1);
    scene.metadata.triggers.push({
      trigger: trigger1,
      sound: soundObjects.lung,
      isIntersecting: false,
    });
  }

  const trigger2 = BABYLON.MeshBuilder.CreateSphere(
    "trigger2",
    { diameter: 0.1 },
    scene
  );
  trigger2.position = new BABYLON.Vector3(0.13, 0.47, 0.09);
  trigger2.parent = importedMesh;
  trigger2.isVisible = triggersVisible;

  if (soundObjects.heart) {
    soundObjects.heart.attachToMesh(trigger2);
    scene.metadata.triggers.push({
      trigger: trigger2,
      sound: soundObjects.heart,
      isIntersecting: false,
    });
  }

  const trigger3 = BABYLON.MeshBuilder.CreateSphere(
    "trigger3",
    { diameter: 0.1 },
    scene
  );
  trigger3.position = new BABYLON.Vector3(0.12, 0.55, -0.06);
  trigger3.parent = importedMesh;
  trigger3.isVisible = triggersVisible;

  if (soundObjects.crackles) {
    soundObjects.crackles.attachToMesh(trigger3);
    scene.metadata.triggers.push({
      trigger: trigger3,
      sound: soundObjects.crackles,
      isIntersecting: false,
    });
  }
}

// ==========================================================
// XR and Controller Logic
// ==========================================================
// We use the WebXR helper to create a VR experience.
// Controllers are observed; when one is added, we can interact with triggers.
// Intersections with trigger meshes start/stop sounds.

function initializeXR(scene, floor) {
  scene
    .createDefaultXRExperienceAsync({ floorMeshes: [floor] })
    .then((xr) => {
      scene.metadata.xr = xr;
      createControllerUI(xr.input);

      xr.input.onControllerAddedObservable.add((controller) => {
        // Each VR controller can interact with triggers if they exist.
        scene.metadata.controllers.push(controller);
        if (scene.metadata.triggers && scene.metadata.triggers.length > 0) {
          configureTriggerActionsForController(scene, controller);
        }
      });
    })
    .catch((error) => {
      console.error("Error initializing XR:", error);
    });
}

// After triggers and controllers are ready, we configure intersection actions.
function configureTriggerActionsForAllControllers(scene) {
  const { triggers, controllers } = scene.metadata;
  if (!triggers || triggers.length === 0) return;
  if (!controllers || controllers.length === 0) return;

  controllers.forEach((controller) => {
    configureTriggerActionsForController(scene, controller);
  });
}

// Uses ActionManager and ExecuteCodeAction to detect when the controller "enters" or "exits" a trigger.
// On enter: play sound. On exit: stop sound.
function configureTriggerActionsForController(scene, controller) {
  const { triggers } = scene.metadata;
  if (!triggers || triggers.length === 0) return;
  if (!controller.grip) return; // grip is the 3D mesh representing the controller in VR

  triggers.forEach((triggerData) => {
    const { trigger } = triggerData;
    if (!trigger.actionManager) {
      trigger.actionManager = new BABYLON.ActionManager(scene);
    }

    trigger.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(
        {
          trigger: BABYLON.ActionManager.OnIntersectionEnterTrigger,
          parameter: {
            mesh: controller.grip,
            usePreciseIntersection: true,
          },
        },
        () => {
          const sound = triggerData.sound;
          if (sound && !sound.isPlaying) {
            sound.play();
            console.log(`Playing ${sound.name}`);
            updateCurrentlyPlayingText(sound.name);
          }
        }
      )
    );

    trigger.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(
        {
          trigger: BABYLON.ActionManager.OnIntersectionExitTrigger,
          parameter: {
            mesh: controller.grip,
            usePreciseIntersection: true,
          },
        },
        () => {
          const sound = triggerData.sound;
          if (sound && sound.isPlaying) {
            console.log(`Stopping ${sound.name}`);
            sound.stop();
            updateCurrentlyPlayingText("No sound playing");
          }
        }
      )
    );
  });
}

function updateCurrentlyPlayingText(text) {
  if (currentlyPlayingText) {
    currentlyPlayingText.text = `Currently: ${text}`;
  }
}

// ==========================================================
// UI Creation
// ==========================================================
// We create a small UI panel in VR space for toggling triggers and changing sound collections.
// The UI links to the left controller when it's added.

function createControllerUI(xrInput) {
  const manager = new BABYLON.GUI.GUI3DManager(scene);

  const stackPanel = new BABYLON.GUI.StackPanel3D();
  stackPanel.margin = 0.02;
  manager.addControl(stackPanel);
  stackPanel.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5);
  stackPanel.position = new BABYLON.Vector3(0, 1.8, 0);
  stackPanel.node.rotation = new BABYLON.Vector3(0, Math.PI, 0);

  // Toggle trigger visibility
  const visibilityButton = new BABYLON.GUI.HolographicButton("visibilityBtn");
  stackPanel.addControl(visibilityButton);
  const visibilityText = new BABYLON.GUI.TextBlock();
  visibilityText.text = triggersVisible ? "Hide Triggers" : "Show Triggers";
  visibilityText.color = "white";
  visibilityText.fontSize = 20;
  visibilityButton.content = visibilityText;

  visibilityButton.onPointerUpObservable.add(() => {
    triggersVisible = !triggersVisible;
    visibilityText.text = triggersVisible ? "Hide Triggers" : "Show Triggers";
    scene.metadata.triggers.forEach(({ trigger }) => {
      trigger.isVisible = triggersVisible;
    });
  });

  // Sound collection switching
  const soundButton = new BABYLON.GUI.HolographicButton("soundBtn");
  stackPanel.addControl(soundButton);

  const collections = Object.keys(SOUND_COLLECTIONS);
  let currentCollectionIndex = 0;

  const soundText = new BABYLON.GUI.TextBlock();
  soundText.text = `Sound: ${collections[currentCollectionIndex]}`;
  soundText.color = "white";
  soundText.fontSize = 20;
  soundButton.content = soundText;

  soundButton.onPointerUpObservable.add(async () => {
    currentCollectionIndex = (currentCollectionIndex + 1) % collections.length;
    const newCollection = collections[currentCollectionIndex];
    soundText.text = `Sound: ${newCollection}`;
    await loadSoundCollection(scene, newCollection);
  });

  // Display currently playing sound
  const currentlyPlayingLabel = new BABYLON.GUI.HolographicButton(
    "currentlyPlayingLabel"
  );
  currentlyPlayingLabel.isPointerBlocker = false;
  stackPanel.addControl(currentlyPlayingLabel);

  currentlyPlayingText = new BABYLON.GUI.TextBlock();
  currentlyPlayingText.text = "Currently: No sound playing";
  currentlyPlayingText.color = "white";
  currentlyPlayingText.fontSize = 20;
  currentlyPlayingLabel.content = currentlyPlayingText;

  // Attach UI to left controller
  xrInput.onControllerAddedObservable.add((controller) => {
    if (controller.inputSource.handedness === "left") {
      stackPanel.linkToTransformNode(controller.grip);
      stackPanel.position = new BABYLON.Vector3(0, 0.17, 0);
      stackPanel.scaling = new BABYLON.Vector3(0.125, 0.125, 0.125);
      stackPanel.node.rotation = new BABYLON.Vector3(Math.PI / 4, 0, 0);
    }
  });
}

// ==========================================================
// Room Creation
// ==========================================================
// The following code creates a simple room environment with walls, floor, and ceiling.
// Windows and beams are created via boolean operations (CSG).

function createRoom(scene) {
  const roomWidth = 5;
  const roomDepth = 5;
  const roomHeight = 3;
  const wallThickness = 0.1;
  const windowWidth = 1.2;
  const windowHeight = 1.5;
  const windowFromFloor = 0.8;
  const windowDepth = wallThickness + 0.1;

  const roomMaterial = new BABYLON.StandardMaterial("roomMaterial", scene);
  roomMaterial.diffuseTexture = new BABYLON.Texture(
    "assets/models/textures/wall_texture.jpg",
    scene
  );
  roomMaterial.diffuseColor = new BABYLON.Color3(0.95, 0.95, 0.95);
  roomMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

  const floor = BABYLON.MeshBuilder.CreateGround(
    "floor",
    { width: roomWidth, height: roomDepth },
    scene
  );
  const floorMaterial = new BABYLON.StandardMaterial("floorMaterial", scene);
  floorMaterial.diffuseTexture = new BABYLON.Texture(
    "assets/models/textures/floor_texture.jpg",
    scene
  );
  floorMaterial.diffuseTexture.uScale = 2;
  floorMaterial.diffuseTexture.vScale = 2;
  floor.material = floorMaterial;

  const ceiling = BABYLON.MeshBuilder.CreateGround(
    "ceiling",
    { width: roomWidth, height: roomDepth },
    scene
  );
  ceiling.position.y = roomHeight;
  ceiling.rotation.x = Math.PI;
  ceiling.material = roomMaterial;

  const wallConfigurations = [
    {
      position: new BABYLON.Vector3(0, roomHeight / 2, -roomDepth / 2),
      dimensions: {
        width: roomWidth,
        height: roomHeight + 0.001,
        depth: wallThickness,
      },
      hasWindow: true,
      windowOffset: 0,
    },
    {
      position: new BABYLON.Vector3(0, roomHeight / 2, roomDepth / 2),
      dimensions: {
        width: roomWidth,
        height: roomHeight + 0.001,
        depth: wallThickness,
      },
      hasWindow: false,
    },
    {
      position: new BABYLON.Vector3(-roomWidth / 2, roomHeight / 2, 0),
      dimensions: {
        width: wallThickness,
        height: roomHeight + 0.001,
        depth: roomDepth + wallThickness,
      },
      hasWindow: true,
      windowOffset: -1,
    },
    {
      position: new BABYLON.Vector3(roomWidth / 2, roomHeight / 2, 0),
      dimensions: {
        width: wallThickness,
        height: roomHeight + 0.001,
        depth: roomDepth + wallThickness,
      },
      hasWindow: false,
    },
  ];

  wallConfigurations.forEach((config, index) => {
    const wall = BABYLON.MeshBuilder.CreateBox(
      `wall${index}`,
      config.dimensions,
      scene
    );
    wall.position = new BABYLON.Vector3(
      config.position.x,
      config.dimensions.height / 2 + 0.1,
      config.position.z
    );

    if (config.hasWindow) {
      const windowOptions = {
        width: windowWidth,
        height: windowHeight,
        depth: windowDepth,
        wallCSG: BABYLON.CSG.FromMesh(wall),
        position: new BABYLON.Vector3(
          index === 0 ? config.windowOffset : -roomWidth / 2,
          windowFromFloor + windowHeight / 2 + 0.1,
          index === 0 ? -roomDepth / 2 : config.windowOffset
        ),
        isHorizontal: index < 2,
      };

      const finalWall = createWindowWithBeams(scene, windowOptions);
      const finalWallMesh = finalWall.toMesh(
        `wall${index}`,
        roomMaterial,
        scene
      );
      wall.dispose();
      finalWallMesh.material = roomMaterial;
    } else {
      wall.material = roomMaterial;
    }
  });

  const baseboardMaterial = new BABYLON.StandardMaterial(
    "baseboardMaterial",
    scene
  );
  baseboardMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.2);

  wallConfigurations.forEach((config, index) => {
    const baseboard = BABYLON.MeshBuilder.CreateBox(
      `baseboard${index}`,
      {
        width: config.dimensions.width,
        height: 0.1,
        depth: config.dimensions.depth,
      },
      scene
    );
    baseboard.position = new BABYLON.Vector3(
      config.position.x,
      0.05,
      config.position.z
    );
    baseboard.material = baseboardMaterial;
  });

  return floor;
}

// createWindowWithBeams uses CSG (Constructive Solid Geometry) to cut out a window
// and add crossbeams to the wall mesh.
function createWindowWithBeams(scene, options) {
  const { width, height, depth, wallCSG, position, isHorizontal } = options;

  const beamWidth = 0.05;
  const beamDepth = depth * 0.5;

  const windowCut = BABYLON.MeshBuilder.CreateBox(
    "windowCut",
    {
      width: isHorizontal ? width : depth,
      height: height,
      depth: isHorizontal ? depth : width,
    },
    scene
  );
  windowCut.position = position;

  const verticalBeam = BABYLON.MeshBuilder.CreateBox(
    "verticalBeam",
    {
      width: isHorizontal ? beamWidth : beamDepth,
      height: height,
      depth: isHorizontal ? beamDepth : beamWidth,
    },
    scene
  );
  verticalBeam.position = position.clone();

  const horizontalBeam = BABYLON.MeshBuilder.CreateBox(
    "horizontalBeam",
    {
      width: isHorizontal ? width : beamDepth,
      height: beamWidth,
      depth: isHorizontal ? beamDepth : width,
    },
    scene
  );
  horizontalBeam.position = position.clone();

  const windowCSG = BABYLON.CSG.FromMesh(windowCut);
  const verticalBeamCSG = BABYLON.CSG.FromMesh(verticalBeam);
  const horizontalBeamCSG = BABYLON.CSG.FromMesh(horizontalBeam);

  const finalCSG = wallCSG
    .subtract(windowCSG)
    .union(verticalBeamCSG)
    .union(horizontalBeamCSG);

  // Clean up temporary meshes
  windowCut.dispose();
  verticalBeam.dispose();
  horizontalBeam.dispose();

  return finalCSG;
}
