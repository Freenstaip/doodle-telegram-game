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

let touchLeft = false;
let touchRight = false;

const config = {
    type: Phaser.AUTO,
    parent: "game",
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#9be7ff",
    physics: {
        default: "arcade",
        arcade: {
            gravity: { y: 900 },
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

const game = new Phaser.Game(config);

function preload() {}

function create() {
    score = 0;

    cursors = this.input.keyboard.createCursorKeys();

    platforms = this.physics.add.staticGroup();

    createPlatforms.call(this);

    player = this.add.rectangle(
        this.scale.width / 2,
        this.scale.height - 180,
        36,
        36,
        0xff4757
    );

    this.physics.add.existing(player);
    player.body.setCollideWorldBounds(false);
    player.body.setVelocityY(-500);

    this.physics.add.collider(player, platforms, jumpOnPlatform, null, this);

    scoreText = this.add.text(20, 30, "Score: 0", {
        fontSize: "24px",
        color: "#222"
    });

    this.input.on("pointerdown", (pointer) => {
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

function createPlatforms() {
    platforms.clear(true, true);

    const platformCount = Math.ceil(this.scale.height / 80) + 2;

    for (let i = 0; i < platformCount; i++) {
        const x = Phaser.Math.Between(40, this.scale.width - 40);
        const y = this.scale.height - i * 80;

        const platform = this.add.rectangle(x, y, 90, 14, 0x2ecc71);
        this.physics.add.existing(platform, true);
        platforms.add(platform);
    }

    const startPlatform = this.add.rectangle(
        this.scale.width / 2,
        this.scale.height - 100,
        120,
        14,
        0x2ecc71
    );

    this.physics.add.existing(startPlatform, true);
    platforms.add(startPlatform);
}

function jumpOnPlatform(playerObj) {
    if (playerObj.body.velocity.y > 0) {
        playerObj.body.setVelocityY(-620);
    }
}

function update() {
    if (!player || !player.body) return;

    if (cursors.left.isDown || touchLeft) {
        player.body.setVelocityX(-300);
    } else if (cursors.right.isDown || touchRight) {
        player.body.setVelocityX(300);
    } else {
        player.body.setVelocityX(player.body.velocity.x * 0.85);
    }

    if (player.x < -30) {
        player.x = this.scale.width + 30;
    }

    if (player.x > this.scale.width + 30) {
        player.x = -30;
    }

    const cameraLine = this.scale.height * 0.4;

    if (player.y < cameraLine) {
        const diff = cameraLine - player.y;

        player.y = cameraLine;
        score += Math.floor(diff);
        scoreText.setText("Score: " + score);

        platforms.children.iterate((platform) => {
            platform.y += diff;
            platform.body.updateFromGameObject();

            if (platform.y > this.scale.height + 20) {
                platform.y = -20;
                platform.x = Phaser.Math.Between(40, this.scale.width - 40);
                platform.body.updateFromGameObject();
            }
        });
    }

    if (player.y > this.scale.height + 100) {
        this.scene.restart();
    }
}
