import { seeded } from "./random";

/**
 * How the hard invoices are made to look like paper that went through a
 * scanner or a phone camera. The clean page is rendered to an image first;
 * these pages wrap that image in the degradation and are screenshotted again.
 * Every parameter comes from the invoice's own seed, so reruns match.
 */

/** Page size in CSS pixels (96 per inch). */
export const PAPER_PX = { A4: { width: 794, height: 1123 }, Letter: { width: 816, height: 1056 } } as const;

/** Page size in PDF points (72 per inch). */
export const PAPER_PT = { A4: { width: 595.28, height: 841.89 }, Letter: { width: 612, height: 792 } } as const;

const round = (n: number, places = 2) => Number(n.toFixed(places));

export function scanLook(id: string, { light = false } = {}) {
  const r = seeded(`docwise-testset-v1/${id}/look`);
  const sign = r.chance(0.5) ? 1 : -1;
  return {
    angle: round(sign * (light ? 0.3 + r.next() * 0.5 : 0.8 + r.next() * 1.4)),
    blur: round(light ? 0.25 : 0.45 + r.next() * 0.35),
    contrast: round(light ? 0.9 : 0.68 + r.next() * 0.14),
    brightness: round(light ? 1.02 : 1.06 + r.next() * 0.08),
    noise: round(light ? 0.05 : 0.08 + r.next() * 0.07),
    // A light scan is a colour scan (the blue ink stays blue); the others are greyscale.
    grayscale: light ? 0 : 1,
    shift: { x: r.int(-10, 10), y: r.int(-8, 14) },
    seed: r.int(1, 999),
  };
}

export function photoLook(id: string) {
  const r = seeded(`docwise-testset-v1/${id}/look`);
  return {
    rotateX: round(6 + r.next() * 8),
    rotateY: round((r.chance(0.5) ? 1 : -1) * (2 + r.next() * 5)),
    rotateZ: round((r.chance(0.5) ? 1 : -1) * (1 + r.next() * 3)),
    surface: r.pick(["wood", "slate", "linen"] as const),
    shadow: { x: r.int(55, 95), y: r.int(55, 95), strength: round(0.22 + r.next() * 0.16) },
    warmth: round(0.08 + r.next() * 0.12),
    blur: round(0.2 + r.next() * 0.3),
    seed: r.int(1, 999),
  };
}

const noise = (seed: number, opacity: number) =>
  `<svg style="position:fixed;inset:0;width:100%;height:100%;mix-blend-mode:multiply;opacity:${opacity}" aria-hidden="true">
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed}"/><feColorMatrix type="saturate" values="0"/></filter>
    <rect width="100%" height="100%" filter="url(#grain)"/>
  </svg>`;

/** A flatbed scan: grey, slightly tilted and shifted, soft, low contrast, with grain and a darker edge from the lid. */
export function scanHtml(pageImage: string, look: ReturnType<typeof scanLook>): string {
  return `<!doctype html><html><body style="margin:0;background:#fff;overflow:hidden;width:100vw;height:100vh">
  <div style="width:100%;height:100%;transform:translate(${look.shift.x}px,${look.shift.y}px) rotate(${look.angle}deg);filter:grayscale(${look.grayscale}) blur(${look.blur}px) contrast(${look.contrast}) brightness(${look.brightness})">
    <img src="${pageImage}" style="display:block;width:100%;height:100%">
  </div>
  <div style="position:fixed;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,0) 3%,rgba(0,0,0,0) 97%,rgba(0,0,0,.1))"></div>
  ${noise(look.seed, look.noise)}
</body></html>`;
}

const SURFACES = {
  wood: "repeating-linear-gradient(87deg,#7d5232 0 7px,#8b5e3a 7px 15px,#74492b 15px 19px,#86593a 19px 26px)",
  slate: "radial-gradient(circle at 30% 20%,#4c535b,#2c3136 70%)",
  linen: "repeating-linear-gradient(0deg,#c9c2b4 0 2px,#d3cdc0 2px 4px),#cfc8ba",
};

/** A phone photo of the page on a desk: at an angle, with perspective, a hand's shadow and warm light. */
export function photoHtml(pageImage: string, look: ReturnType<typeof photoLook>): string {
  return `<!doctype html><html><body style="margin:0;overflow:hidden;width:100vw;height:100vh;background:${SURFACES[look.surface]};perspective:1700px">
  <div style="position:absolute;left:50%;top:50%;width:84%;transform:translate(-50%,-50%) rotateX(${look.rotateX}deg) rotateY(${look.rotateY}deg) rotateZ(${look.rotateZ}deg);box-shadow:0 22px 40px rgba(0,0,0,.4);filter:blur(${look.blur}px)">
    <img src="${pageImage}" style="display:block;width:100%">
  </div>
  <div style="position:fixed;inset:0;background:radial-gradient(ellipse 55% 45% at ${look.shadow.x}% ${look.shadow.y}%,rgba(0,0,0,${look.shadow.strength}),rgba(0,0,0,0) 70%)"></div>
  <div style="position:fixed;inset:0;background:linear-gradient(160deg,rgba(255,226,170,${look.warmth}),rgba(255,226,170,0) 55%)"></div>
  ${noise(look.seed, 0.06)}
</body></html>`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Handwritten notes in blue ink, placed in the free space below the printed content (they must not cover a value). */
export function notesHtml(id: string, notes: string[], top: number, pageWidth: number): string {
  const r = seeded(`docwise-testset-v1/${id}/ink`);
  const placed = notes.map((note, i) => {
    const left = i === 2 ? pageWidth - 340 + r.int(-20, 20) : r.int(60, 150);
    const y = top + (i === 2 ? 6 : i * 40) + r.int(0, 8);
    const angle = round((r.next() - 0.5) * 9);
    const size = r.int(25, 31);
    return `<div style="position:absolute;left:${left}px;top:${y}px;transform:rotate(${angle}deg);font-size:${size}px;white-space:nowrap">${escapeHtml(note)}</div>`;
  });
  return `<div style="position:absolute;left:0;top:0;width:100%;pointer-events:none;font-family:Caveat,cursive;font-weight:500;color:#1f3a93">${placed.join("")}</div>`;
}
