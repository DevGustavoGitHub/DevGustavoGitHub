import * as THREE from 'three';

/**
 * Contorno (estilo "objeto selecionado") por casco invertido: cada Mesh ganha um filho com a mesma
 * geometria, faces traseiras e vértices empurrados ao longo da normal. Barato (1 draw call extra por
 * malha), sem pós-processamento — adequado para celular. Uso: addOutline(obj); removeOutline(obj).
 * Funciona melhor com normais suaves; em caixas de normais divididas o contorno fica com pequenas
 * aberturas nos cantos, aceitável para destaque de interação.
 */
const cache = new Map<string, THREE.ShaderMaterial>();

function outlineMaterial(color: number, thickness: number): THREE.ShaderMaterial {
  const key = `${color}:${thickness}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uThickness: { value: thickness } },
      vertexShader: `uniform float uThickness;
        void main(){ vec3 p = position + normalize(normal) * uThickness;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }`,
      side: THREE.BackSide,
      depthWrite: true,
    });
    cache.set(key, m);
  }
  return m;
}

export const OUTLINE_GREEN = 0x2bd94a;

/** Adiciona contorno a todas as malhas de `obj` (idempotente). `thickness` em unidades locais. */
export function addOutline(obj: THREE.Object3D, color = OUTLINE_GREEN, thickness = 0.025): void {
  const mat = outlineMaterial(color, thickness);
  const meshes: THREE.Mesh[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.isOutline && !(m as unknown as THREE.InstancedMesh).isInstancedMesh) meshes.push(m);
  });
  for (const m of meshes) {
    if (m.children.some((c) => c.userData.isOutline)) continue;
    const hull = new THREE.Mesh(m.geometry, mat);
    hull.userData.isOutline = true;
    hull.renderOrder = (m.renderOrder ?? 0) - 1;
    hull.raycast = () => {}; // nunca intercepta raycast de interação
    m.add(hull);
  }
}

/** Remove os contornos adicionados por addOutline (não descarta geometria compartilhada). */
export function removeOutline(obj: THREE.Object3D): void {
  const hulls: THREE.Object3D[] = [];
  obj.traverse((o) => { if (o.userData.isOutline) hulls.push(o); });
  for (const h of hulls) h.parent?.remove(h);
}
