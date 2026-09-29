import { useEffect, useRef } from 'react';

export function Hero() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let stopped = false;
    let dispose: (() => void) | undefined;
    void import('three')
      .then((THREE) => {
        if (stopped) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        let renderer: InstanceType<typeof THREE.WebGLRenderer>;
        try {
          renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'low-power',
          });
        } catch {
          return;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.domElement.setAttribute('aria-hidden', 'true');
        element.appendChild(renderer.domElement);
        element.classList.add('has-webgl');
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
        camera.position.z = 4;
        const geometry = new THREE.IcosahedronGeometry(1.6, 0);
        const material = new THREE.MeshPhysicalMaterial({
          color: 0x14b8a6,
          metalness: 0.2,
          roughness: 0.3,
          transparent: true,
          opacity: 0.8,
          flatShading: true,
        });
        const shape = new THREE.Mesh(geometry, material);
        const edgeGeometry = new THREE.EdgesGeometry(geometry);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: 0x0d9488,
          transparent: true,
          opacity: 0.4,
        });
        shape.add(new THREE.LineSegments(edgeGeometry, lineMaterial));
        scene.add(shape, new THREE.AmbientLight(0xffffff, 0.7));
        const lightOne = new THREE.DirectionalLight(0xffffff, 0.8);
        lightOne.position.set(5, 5, 5);
        const lightTwo = new THREE.DirectionalLight(0xccfbf1, 0.6);
        lightTwo.position.set(-5, -5, -5);
        scene.add(lightOne, lightTwo);
        let frame = 0;
        let visible = true;
        let previous = 0;
        const render = (time: number) => {
          if (stopped || !visible || document.hidden || reduced.matches) {
            frame = 0;
            return;
          }
          const elapsed = previous ? Math.min((time - previous) / 16.67, 2) : 1;
          if (time - previous >= 32) {
            shape.rotation.x += 0.002 * elapsed;
            shape.rotation.y += 0.004 * elapsed;
            renderer.render(scene, camera);
            previous = time;
          }
          frame = requestAnimationFrame(render);
        };
        const update = () => {
          cancelAnimationFrame(frame);
          frame = 0;
          previous = 0;
          element.parentElement?.classList.toggle('hero-paused', !visible || document.hidden);
          const size = Math.min(element.clientWidth, element.clientHeight);
          if (size > 0) {
            renderer.setSize(size, size);
            renderer.render(scene, camera);
          }
          if (!stopped && visible && !document.hidden && !reduced.matches)
            frame = requestAnimationFrame(render);
        };
        const resize = new ResizeObserver(update);
        resize.observe(element);
        const intersection = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          update();
        });
        intersection.observe(element);
        document.addEventListener('visibilitychange', update);
        reduced.addEventListener('change', update);
        update();
        dispose = () => {
          cancelAnimationFrame(frame);
          resize.disconnect();
          intersection.disconnect();
          document.removeEventListener('visibilitychange', update);
          reduced.removeEventListener('change', update);
          geometry.dispose();
          edgeGeometry.dispose();
          material.dispose();
          lineMaterial.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
          element.classList.remove('has-webgl');
          element.parentElement?.classList.remove('hero-paused');
        };
      })
      .catch(() => {
        /* The static fallback remains visible if WebGL or its chunk is unavailable. */
      });
    return () => {
      stopped = true;
      dispose?.();
    };
  }, []);
  return (
    <div
      className="relative w-full aspect-square max-w-md mx-auto md:mr-0 flex items-center justify-center pt-8 md:pt-4"
      role="img"
      aria-label="Teal geometric shape with orbiting Credibility, Fast and Reliable labels"
    >
      <div
        ref={container}
        className="hero-canvas absolute inset-0 z-0 flex items-center justify-center"
      >
        <div className="hero-fallback" />
      </div>
      <div
        className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center"
        aria-hidden="true"
      >
        {['Credibility', 'Fast', 'Reliable'].map((label, index) => (
          <div key={label} className={`orbit-pill pill-${index + 1}`}>
            <div className="bg-white/90 backdrop-blur shadow-md text-brand-600 text-xs font-bold px-3 py-1.5 rounded-full border border-brand-100 text-center uppercase tracking-wide">
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
