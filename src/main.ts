const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.fillStyle = "#fff";
  ctx.font = "800 48px JetBrains Mono, monospace";
  ctx.textAlign = "center";
  ctx.fillText("ECHO", window.innerWidth / 2, window.innerHeight / 2);
}

window.addEventListener("resize", resize);
resize();
