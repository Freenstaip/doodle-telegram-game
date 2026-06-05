const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();
}

let player;
let platforms;
let cursors;
let score = 0;
let scoreText;
let tapText;
let gameStarted = false;

let touchLeft = false;
let touchRight = false;

const config = {
    type: Phaser.AUTO,
    parent: "game",
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#f7f3ea",
    physics: {
        default: "arcade",
        arcade: {
            gravity: { y: 900 },
            debug: false
        }
    },
    scene: {
        create,
        update
    },
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

new Phaser.Game(config);

function create() {
    score = 0;
    gameStarted = false;

    cursors = this.input.keyboard.createCursorKeys();

    drawNotebookBackground.call(this);
    drawGrass.call(this);

    platforms = this.physics.add.staticGroup();
    createPlatforms.call(this);

    player = createMonster.call(
        this,
        this.scale.width / 2,
        this.scale.height - 150
    );

    this.physics.add.existing(player);
    player.body.setSize(42, 50);
    player.body.setOffset(-21, -25);
    player.body.setAllowGravity(false);

    this.physics.add.collider(player, platforms, jumpOnPlatform, null, this);

    scoreText = this.add.text(22, 28, "SCORE\n0", {
        fontSize: "24px",
        color: "#ffffff",
        align: "center",
        fontFamily: "Arial"
    }).setDepth(10);

    drawScoreFlag.call(this);

    tapText = this.add.text(
        this.scale.width / 2,
        this.scale.height - 245,
        "TAP TO JUMP",
        {
            fontSize: "24px",
            color: "#111",
            fontFamily: "Arial"
        }
    ).setOrigin(0.5).setDepth(20);

    this.input.on("pointerdown", (pointer) => {
        if (!gameStarted) {
            startGame();
        }

        touchLeft = pointer.x < this.scale.width / 2;
        touchRight = pointer.x >= this.scale.width / 2;
    });

    this.input.on("pointermove", (pointer) => {
        if (!pointer.isDown) return;

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
    tapText.setVisible(false);
    player.body.setAllowGravity(true);
    player.body.setVelocityY(-620);
}

function update() {
    if (!player || !player.body) return;

    if (gameStarted) {
        if (cursors.left.isDown || touchLeft) {
            player.body.setVelocityX(-300);
        } else if (cursors.right.isDown || touchRight) {
            player.body.setVelocityX(300);
        } else {
            player.body.setVelocityX(player.body.velocity.x * 0.85);
        }
    }

    if (player.x < -40) {
        player.x = this.scale.width + 40;
    }

    if (player.x > this.scale.width + 40) {
        player.x = -40;
    }

    if (!gameStarted) return;

    const cameraLine = this.scale.height * 0.4;

    if (player.y < cameraLine) {
        const diff = cameraLine - player.y;

        player.y = cameraLine;
        score += Math.floor(diff);

        scoreText.setText("SCORE\n" + score);

        platforms.children.iterate((platform) => {
            platform.y += diff;
            platform.body.updateFromGameObject();

            if (platform.y > this.scale.height + 30) {
                platform.y = -30;
                platform.x = Phaser.Math.Between(70, this.scale.width - 70);
                platform.body.updateFromGameObject();
            }
        });
    }

    if (player.y > this.scale.height + 120) {
        this.scene.restart();
    }
}

function createPlatforms() {
    platforms.clear(true, true);

    const platformCount = Math.ceil(this.scale.height / 85) + 2;

    for (let i = 0; i < platformCount; i++) {
        const x = Phaser.Math.Between(70, this.scale.width - 70);
        const y = this.scale.height - 230 - i * 85;

        const platform = createSketchPlatform.call(this, x, y);
        this.physics.add.existing(platform, true);
        platform.body.setSize(90, 16);
        platforms.add(platform);
    }
}

function jumpOnPlatform(playerObj) {
    if (playerObj.body.velocity.y > 0) {
        playerObj.body.setVelocityY(-620);
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

    for (let i = 0; i < 90; i++) {
        const x = Phaser.Math.Between(0, w);
        const y = Phaser.Math.Between(h - 85, h - 10);

        grass.lineStyle(2, 0x1d5f22, 0.8);
        grass.beginPath();
        grass.moveTo(x, y);
        grass.lineTo(x + Phaser.Math.Between(-8, 8), y - Phaser.Math.Between(8, 22));
        grass.strokePath();
    }
}

function drawScoreFlag() {
    const g = this.add.graphics().setDepth(9);

    g.fillStyle(0x6c55c9, 1);
    g.fillRect(0, 0, 120, 95);

    g.beginPath();
    g.moveTo(0, 95);
    g.lineTo(60, 75);
    g.lineTo(120, 95);
    g.closePath();
    g.fillPath();

    g.lineStyle(3, 0x3d2e8f, 1);
    g.strokeRect(0, 0, 120, 95);
}

function createSketchPlatform(x, y) {
    const container = this.add.container(x, y);

    const g = this.add.graphics();

    const isGrass = Phaser.Math.Between(0, 1) === 1;

    if (isGrass) {
        g.fillStyle(0x7eba42, 1);
    } else {
        g.fillStyle(0xb97832, 1);
    }

    g.fillRoundedRect(-45, -8, 90, 16, 8);

    g.lineStyle(3, 0x111111, 1);
    g.strokeRoundedRect(-45, -8, 90, 16, 8);

    if (isGrass) {
        for (let i = 0; i < 12; i++) {
            g.lineStyle(1, 0x245f1e, 1);
            const gx = Phaser.Math.Between(-38, 38);
            g.beginPath();
            g.moveTo(gx, -6);
            g.lineTo(gx + Phaser.Math.Between(-4, 4), -12);
            g.strokePath();
        }
    } else {
        g.lineStyle(2, 0x5c3317, 1);
        g.beginPath();
        g.moveTo(-35, -2);
        g.lineTo(35, -4);
        g.strokePath();

        g.beginPath();
        g.moveTo(-30, 4);
        g.lineTo(28, 2);
        g.strokePath();
    }

    container.add(g);
    container.setSize(90, 16);

    return container;
}

function createMonster(x, y) {
    const container = this.add.container(x, y);

    const body = this.add.graphics();

    body.fillStyle(0x7b5ce1, 1);
    body.lineStyle(4, 0x111111, 1);

    body.beginPath();
    body.moveTo(-24, -25);
    body.lineTo(-14, -35);
    body.lineTo(-4, -25);
    body.lineTo(6, -35);
    body.lineTo(16, -25);
    body.lineTo(24, -32);
    body.lineTo(24, 28);
    body.lineTo(10, 24);
    body.lineTo(3, 34);
    body.lineTo(-5, 24);
    body.lineTo(-22, 28);
    body.closePath();

    body.fillPath();
    body.strokePath();

    const eye = this.add.graphics();
    eye.fillStyle(0xffeb3b, 1);
    eye.lineStyle(3, 0x111111, 1);
    eye.fillCircle(8, -12, 10);
    eye.strokeCircle(8, -12, 10);

    eye.fillStyle(0x111111, 1);
    eye.fillCircle(11, -14, 4);

    const mouth = this.add.graphics();
    mouth.fillStyle(0x111111, 1);
    mouth.fillRoundedRect(-12, 8, 22, 10, 4);

    mouth.fillStyle(0xffffff, 1);
    mouth.fillRect(-7, 8, 5, 5);

    container.add([body, eye, mouth]);
    container.setSize(48, 70);

    return container;
}
