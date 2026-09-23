export function fitCanvas(canvas, cssHeight, maxDpr) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr || 2);
  const w = Math.max(canvas.clientWidth || canvas.parentElement.clientWidth || 300, 120);
  const h = typeof cssHeight === "function" ? cssHeight() : cssHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

export function autoFit(canvas, cssHeight, onDraw) {
  let state = fitCanvas(canvas, cssHeight);
  const redraw = () => { state = fitCanvas(canvas, cssHeight); if (onDraw) onDraw(state); };
  canvas.__refit = redraw;
  if (window.ResizeObserver && !canvas.__ro) {
    canvas.__ro = new ResizeObserver(() => redraw());
    canvas.__ro.observe(canvas.parentElement || canvas);
  }
  window.addEventListener("orientationchange", () => setTimeout(redraw, 260));
  if (onDraw) onDraw(state);
  return () => state;
}

export const rr = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};
