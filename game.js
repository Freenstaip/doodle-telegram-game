const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();
}

let player;
let platforms;
let cursors;
let scoreText;
let bestText;
let titleText;
let tapText;
let gameOverText;
let restartText;

let score = 0;
let bestScore = Number(localStorage.getItem("jump_dude_best") || 0);
let gameStarted = false;
let gameOver = false;
let touchLeft = false;
let touchRight = false;

const PLAYER_WIDTH = 70;
const PLAYER_HEIGHT = 90;
const JUMP_POWER = -650;
const MOVE_SPEED = 310;

const config = {
    type: Phaser.AUTO,
    parent: "game",
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#f8f4ea",
    physics: {
        default: "arcade",
        arcade: {
            gravity: { y: 930 },
            debug: false
        }
    },
    scene: {
        preload,
        create,
        update
    },
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

new Phaser.Game(config);

function preload() {
    this.load.image("monster", "assets/monster.svg");
    this.load.image("platform_grass", "assets/platform_grass.svg");
    this.load.image("platform_wood", "assets/platform_wood.svg");
    this.load.image("score_flag", "assets/score_flag.svg");
    this.load.image("tap_badge", "assets/tap_badge.svg");
}

function create() {
    score = 0;
    gameStarted = false;
    gameOver = false;
    touchLeft = false;
    touchRight = false;

    cursors = this.input.keyboard.createCursorKeys();

    drawNotebookBackground.call(this);
    drawGrass.call(this);

    platforms = this.physics.add.staticGroup();
    createPlatforms.call(this);

    player = this.physics.add.sprite(
        this.scale.width / 2,
        this.scale.height - 160,
        "monster"
    );

    player.setDisplaySize(PLAYER_WIDTH, PLAYER_HEIGHT);
    player.body.setSize(46, 58);
    player.body.setOffset(37, 45);
    player.body.setAllowGravity(false);
    player.body.setCollideWorldBounds(false);

    this.physics.add.collider(player, platforms, jumpOnPlatform, null, this);

    this.add.image(62, 48, "score_flag")
        .setDisplaySize(124, 98)
        .setDepth(9);

    scoreText = this.add.text(22, 18, "SCORE\n0", {
        fontSize: "23px",
        color: "#ffffff",
        align: "center",
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold"
    }).setDepth(10);

    bestText = this.add.text(this.scale.width - 22, 22, "BEST: " + bestScore, {
        fontSize: "18px",
        color: "#111111",
        align: "right",
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold"
    }).setOrigin(1, 0).setDepth(10);

    titleText = this.add.text(this.scale.width / 2, 120, "JUMP DUDE", {
        fontSize: "42px",
        color: "#6c55c9",
        stroke: "#111111",
        strokeThickness: 5,
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold"
    }).setOrigin(0.5).setDepth(20);

    this.add.image(this.scale.width / 2, this.scale.height - 255, "tap_badge")
        .setDisplaySize(230, 60)
        .setDepth(18);

    tapText = this.add.text(this.scale.width / 2, this.scale.height - 257, "TAP TO JUMP", {
        fontSize: "23px",
        color: "#111111",
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold"
    }).setOrigin(0.5).setDepth(20);

    gameOverText = this.add.text(this.scale.width / 2, this.scale.height / 2 - 55, "", {
        fontSize: "42px",
        color: "#ff4757",
        stroke: "#111111",
        strokeThickness: 5,
        align: "center",
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold"
    }).setOrigin(0.5).setDepth(30);

    restartText = this.add.text(this.scale.width / 2, this.scale.height / 2 + 20, "", {
        fontSize: "22px",
        color: "#111111",
        align: "center",
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold"
    }).setOrigin(0.5).setDepth(30);

    this.input.on("pointerdown", (pointer) => {
        if (gameOver) {
            this.scene.restart();
            return;
        }

        if (!gameStarted) {
            startGame();
        }

        touchLeft = pointer.x < this.scale.width / 2;
        touchRight = pointer.x >= this.scale.width / 2;
    });

    this.input.on("pointermove", (pointer) => {
        if (!pointer.isDown || gameOver) return;

        touchLeft = pointer.x < this.scale.width / 2;
        touchRight = pointer.x >= this.scale.width / 2;
    });

    this.input.on("pointerup", () => {
        touchLeft = false;
        touchRight = false;
    });
}

function startGame() {
    gameStarted = true;
    titleText.setVisible(false);
    tapText.setVisible(false);
    player.body.setAllowGravity(true);
    player.body.setVelocityY(JUMP_POWER);
}

function update() {
    if (!player || !player.body || gameOver) return;

    if (gameStarted) {
        if (cursors.left.isDown || touchLeft) {
            player.body.setVelocityX(-MOVE_SPEED);
            player.setFlipX(true);
            player.setAngle(-6);
        } else if (cursors.right.isDown || touchRight) {
            player.body.setVelocityX(MOVE_SPEED);
            player.setFlipX(false);
            player.setAngle(6);
        } else {
            player.body.setVelocityX(player.body.velocity.x * 0.85);
            player.setAngle(player.angle * 0.85);
        }
    }

    if (player.x < -45) player.x = this.scale.width + 45;
    if (player.x > this.scale.width + 45) player.x = -45;

    if (!gameStarted) return;

    const cameraLine = this.scale.height * 0.38;

    if (player.y < cameraLine) {
        const diff = cameraLine - player.y;

        player.y = cameraLine;
        score += Math.floor(diff);

        scoreText.setText("SCORE\n" + score);

        if (score > bestScore) {
            bestScore = score;
            localStorage.setItem("jump_dude_best", bestScore);
            bestText.setText("BEST: " + bestScore);
        }

        platforms.children.iterate((platform) => {
            platform.y += diff;
            platform.body.updateFromGameObject();

            if (platform.y > this.scale.height + 40) {
                platform.y = -40;
                platform.x = Phaser.Math.Between(75, this.scale.width - 75);
                platform.setTexture(randomPlatformTexture());
                platform.body.updateFromGameObject();
            }
        });
    }

    if (player.y > this.scale.height + 120) {
        showGameOver.call(this);
    }
}

function showGameOver() {
    gameOver = true;
    player.body.setVelocity(0, 0);
    player.body.setAllowGravity(false);

    gameOverText.setText("GAME OVER");
    restartText.setText("Tap to restart\nScore: " + score);
}

function createPlatforms() {
    platforms.clear(true, true);

    const platformCount = Math.ceil(this.scale.height / 84) + 3;

    const startPlatform = platforms.create(
        this.scale.width / 2,
        this.scale.height - 104,
        "platform_grass"
    );
    startPlatform.setDisplaySize(150, 42);
    startPlatform.refreshBody();

    for (let i = 1; i < platformCount; i++) {
        const x = Phaser.Math.Between(75, this.scale.width - 75);
        const y = this.scale.height - 230 - i * 84;

        const platform = platforms.create(x, y, randomPlatformTexture());
        platform.setDisplaySize(112, 36);
        platform.refreshBody();
    }
}

function randomPlatformTexture() {
    return Phaser.Math.Between(0, 1) === 1 ? "platform_grass" : "platform_wood";
}

function jumpOnPlatform(playerObj) {
    if (!gameStarted || gameOver) return;

    if (playerObj.body.velocity.y > 0) {
        playerObj.body.setVelocityY(JUMP_POWER);
    }
}

function drawNotebookBackground() {
    const w = this.scale.width;
    const h = this.scale.height;

    const bg = this.add.graphics();
    bg.fillStyle(0xf8f4ea, 1);
    bg.fillRect(0, 0, w, h);

    bg.lineStyle(1, 0x9fc7df, 0.65);
    for (let y = 40; y < h; y += 34) {
        bg.beginPath();
        bg.moveTo(0, y);
        bg.lineTo(w, y);
        bg.strokePath();
    }

    bg.lineStyle(2, 0xd85959, 0.7);
    bg.beginPath();
    bg.moveTo(w - 70, 0);
    bg.lineTo(w - 70, h);
    bg.strokePath();

    bg.lineStyle(4, 0x345c8a, 0.9);
    for (let y = 18; y < h; y += 34) {
        bg.strokeCircle(18, y, 9);
    }

    bg.lineStyle(2, 0x111111, 0.25);
    bg.beginPath();
    bg.moveTo(w * 0.12, h * 0.18);
    bg.lineTo(w * 0.17, h * 0.15);
    bg.lineTo(w * 0.22, h * 0.18);
    bg.strokePath();

    bg.strokeCircle(w * 0.82, h * 0.22, 13);
    bg.strokeCircle(w * 0.82, h * 0.22, 5);
}

function drawGrass() {
    const h = this.scale.height;
    const w = this.scale.width;

    const grass = this.add.graphics();

    grass.fillStyle(0x3f8f2f, 1);
    grass.fillRect(0, h - 90, w, 90);

    grass.lineStyle(3, 0x111111, 1);
    grass.beginPath();
    grass.moveTo(0, h - 90);

    for (let x = 0; x <= w; x += 18) {
        grass.lineTo(x, h - 90 + Phaser.Math.Between(-7, 7));
    }
    grass.strokePath();

    for (let i = 0; i < 55; i++) {
        const x = Phaser.Math.Between(0, w);
        const y = Phaser.Math.Between(h - 84, h - 8);

        grass.lineStyle(2, 0x1d5f22, 0.75);
        grass.beginPath();
        grass.moveTo(x, y);
        grass.lineTo(x + Phaser.Math.Between(-8, 8), y - Phaser.Math.Between(8, 22));
        grass.strokePath();
    }
}
