const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

const player = {
    x: window.innerWidth / 2,
    y: window.innerHeight - 150,
    w: 36,
    h: 36,
    vx: 0,
    vy: 0
};

let score = 0;
let keys = {};
let platforms = [];

let touchLeft = false;
let touchRight = false;

const gravity = 0.35;
const jumpPower = -11;
const platformWidth = 90;
const platformHeight = 14;

function createPlatforms() {
    platforms = [];

    const count = Math.ceil(canvas.height / 80) + 2;

    for (let i = 0; i < count; i++) {
        platforms.push({
            x: Math.random() * (canvas.width - platformWidth),
            y: canvas.height - i * 80,
            w: platformWidth,
            h: platformHeight
        });
    }

    platforms[0].x = player.x - 30;
    platforms[0].y = player.y + 60;
}

function resetGame() {
    player.x = canvas.width / 2;
    player.y = canvas.height - 150;
    player.vx = 0;
    player.vy = -8;
    score = 0;

    createPlatforms();
}

function update() {
    if (keys["ArrowLeft"] || touchLeft) {
        player.vx = -5;
    } else if (keys["ArrowRight"] || touchRight) {
        player.vx = 5;
    } else {
        player.vx *= 0.85;
    }

    player.vy += gravity;
    player.x += player.vx;
    player.y += player.vy;

    if (player.x < -player.w) {
        player.x = canvas.width;
    }

    if (player.x > canvas.width) {
        player.x = -player.w;
    }

    platforms.forEach((p) => {
        if (
            player.vy > 0 &&
            player.x + player.w > p.x &&
            player.x < p.x + p.w &&
            player.y + player.h > p.y &&
            player.y + player.h < p.y + p.h + 12
        ) {
            player.vy = jumpPower;
        }
    });

    const cameraLine = canvas.height * 0.4;

    if (player.y < cameraLine) {
        const diff = cameraLine - player.y;
        player.y = cameraLine;
        score += Math.floor(diff);

        platforms.forEach((p) => {
            p.y += diff;

            if (p.y > canvas.height) {
                p.y = -platformHeight;
                p.x = Math.random() * (canvas.width - platformWidth);
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
    ctx.font = "24px Arial";
    ctx.fillText("Score: " + score, 20, 40);

    ctx.fillStyle = "#2ecc71";
    platforms.forEach((p) => {
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

document.addEventListener("keydown", (e) => {
    keys[e.key] = true;
});

document.addEventListener("keyup", (e) => {
    keys[e.key] = false;
});

canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();

    const touchX = e.touches[0].clientX;
    const middle = window.innerWidth / 2;

    touchLeft = touchX < middle;
    touchRight = touchX >= middle;
});

canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();

    const touchX = e.touches[0].clientX;
    const middle = window.innerWidth / 2;

    touchLeft = touchX < middle;
    touchRight = touchX >= middle;
});

canvas.addEventListener("touchend", () => {
    touchLeft = false;
    touchRight = false;
});

resetGame();
loop();
