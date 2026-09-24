// Low-poly explorer avatars (the player and other travelers).

import * as THREE from 'three';

export function makeAvatar({ jacket, pack, hat, skin = '#E4AE85', pants = '#2D3A5A' }, scale = 3) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true });
  const add = (mesh, x, y, z, parent = g) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const body = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.8, 4, 8), mat(jacket)), 0, 1.8, 0);
  add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), mat(skin)), 0, 2.85, 0);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.08, 12), mat(hat)), 0, 3.12, 0);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.48, 0.4, 12), mat(hat)), 0, 3.34, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.45), mat(pack)), 0, 1.9, -0.58);
  const limb = (x, y, len, c) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    g.add(pivot);
    add(new THREE.Mesh(new THREE.CapsuleGeometry(0.19, len, 3, 6), mat(c)), 0, -len / 2 - 0.15, 0, pivot);
    return pivot;
  };
  const hipL = limb(-0.24, 1.15, 0.6, pants);
  const hipR = limb(0.24, 1.15, 0.6, pants);
  const armL = limb(-0.7, 2.25, 0.55, jacket);
  const armR = limb(0.7, 2.25, 0.55, jacket);
  g.userData = { hipL, hipR, armL, armR, body };
  g.scale.setScalar(scale);
  return g;
}

export function animateAvatar(av, t, moving) {
  const u = av.userData;
  const sw = moving ? Math.sin(t * 11) * 0.7 : 0;
  u.hipL.rotation.x = sw;
  u.hipR.rotation.x = -sw;
  u.armL.rotation.x = -sw * 0.8;
  u.armR.rotation.x = sw * 0.8;
  u.body.position.y = 1.8 + (moving ? Math.abs(Math.sin(t * 11)) * 0.12 : Math.sin(t * 2) * 0.03);
}
