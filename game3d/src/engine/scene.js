// 渲染器 + 场景 + 光照。阴影相机跟随镜头目标,保证大地图上阴影分辨率稳定。
import * as THREE from 'three';

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd8e6);

  const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x7a6a50, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d8, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 120;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  const SUN_OFFSET = new THREE.Vector3(-22, 40, 14);

  function followSun(target, viewSize) {
    sun.position.copy(target).add(SUN_OFFSET);
    sun.target.position.copy(target);
    const half = Math.min(60, Math.max(14, viewSize * 1.6));
    if (Math.abs(sc.right - half) > 0.5) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
  }

  return { renderer, scene, sun, hemi, followSun };
}
