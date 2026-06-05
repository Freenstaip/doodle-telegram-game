const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const player = {
  x: 160,
  y: 500,
  w: 32,
  h: 32,
  vx: 0,
  vy: 0
};

let score = 0;
let keys = {};

const gravity = 0.35;
const jumpPower = -10;

let platforms = [];

function createPlatforms() {
  platforms = [];
  for (let i = 0; i < 8; i++) {
    platforms.push({
      x: Math.random() * 280,
      y: i * 80,
      w: 80,
      h: 12
    });
  }
}

function update() {
  if (keys["ArrowLeft"]) player.vx = -4;
  else if (keys["ArrowRight"]) player.vx = 4;
  else player.vx *= 0.85;

  player.vy += gravity;
  player.x += player.vx;
  player.y += player.vy;

  if (player.x < -player.w) player.x = canvas.width;
  if (player.x > canvas.width) player.x = -player.w;

  platforms.forEach(p => {
    if (
      player.vy > 0 &&
      player.x + player.w > p.x &&
      player.x < p.x + p.w &&
      player.y + player.h > p.y &&
      player.y + player.h < p.y + p.h + 10
    ) {
      player.vy = jumpPower;
    }
  });

  if (player.y < 280) {
    let diff = 280 - player.y;
    player.y = 280;
    score += Math.floor(diff);

    platforms.forEach(p => {
      p.y += diff;

      if (p.y > canvas.height) {
        p.y = 0;
        p.x = Math.random() * 280;
      }
    });
  }

  if (player.y > canvas.height) {
    resetGame();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#222";
  ctx.font = "20px Arial";
  ctx.fillText("Score: " + score, 16, 32);

  ctx.fillStyle = "#2ecc71";
  platforms.forEach(p => {
    ctx.fillRect(p.x, p.y, p.w, p.h);
  });

  ctx.fillStyle = "#ff4757";
  ctx.fillRect(player.x, player.y, player.w, player.h);
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

function resetGame() {
  player.x = 160;
  player.y = 500;
  player.vx = 0;
  player.vy = 0;
  score = 0;
  createPlatforms();
}

document.addEventListener("keydown", e => {
  keys[e.key] = true;
});

document.addEventListener("keyup", e => {
  keys[e.key] = false;
});

createPlatforms();
loop();
