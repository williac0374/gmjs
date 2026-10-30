// ==========================================
// ARCADE DEMO: NEON BOUNCE (game.js)
// ==========================================

let score = 0;

function startGame() {
   function playSynthKick() {
    initAudio();
    if (!audioCtx) return;

    const t = audioCtx.currentTime;

    // 1. Create Nodes
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    // WaveShaper node to create soft overdrive/saturation (gives it warmth & harmonics)
    const distortion = audioCtx.createWaveShaper();
    distortion.curve = makeDistortionCurve(15);

    // 2. Slow Pitch Slide (Starts high for punch, glides down into heavy sub-bass)
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.35); // Takes longer to pitch down

    // 3. Extended "Boom" Volume Envelope
    gain.gain.setValueAtTime(0.8, t);
    // Hold volume steady briefly to let the sub resonate before fading out
    gain.gain.setValueAtTime(0.8, t + 0.1); 
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2); // Fades out over 1.2 seconds!

    // 4. Connect Chain
    osc.connect(distortion);
    distortion.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(t);
    osc.stop(t + 1.2);
}

// Helper function to generate a smooth saturation curve
function makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
}
    canvas_init(800, 800);
    BPM = 140;
        const paddle = object_create(null, 0.4, 0.88, 0.2, 0.03, 0, 0, Infinity, 'box', 'solid');
    paddle.update = function (dt) {
        this.x = Input.normX - this.w / 2;
        this.x = Math.max(0, Math.min(1 - this.w, this.x));
    };
    paddle.draw = function (ctx) {
        fill_color("#38bdf8");
        line_color("#bae6fd");
        line_width(2);
        draw_rect(0, 0, 1, 1, true, true);
    };
    paddle.onPulse = function () {
        if (TICK === 1) {
            
        }
        if (TICK === 2) {
           
        }
        if (TICK === 3) {
            
        }
        if (TICK === 4) {
            playSynthKick();
            TICK = 0
        }

        document.title = TICK
    }

    // 2. Create Stationary Trigger Zone in the center
    const triggerZone = object_create(null, 0.3, 0.35, 0.4, 0.2, 0, 0, 1, 'box', 'trigger');
    triggerZone.update = function (dt) {
        this.activeCollisions = this.activeCollisions || new Set();
        this.activeCollisions.clear();
    };
    triggerZone.onCollide = function (other) {
        if (other === ball1 || other === ball2) {
            other.isTriggered = true;
            this.activeCollisions.add(other);
        }
    };
    triggerZone.draw = function (ctx) {
        fill_color("rgba(234, 179, 8, 0.15)");
        line_color("#eab308");
        line_width(2);
        line_style("dashed");
        draw_rect(0, 0, 1, 1, true, true);
        line_style("solid");

        fill_color("#eab308");
        draw_text("COLOR ZONE", 0.5, 0.15, 11, "#eab308", "monospace", "center middle");
    };

    // 3. Create Bouncing Balls
    const ball1 = object_create(null, 0.45, 0.1, 0.05, 0.05, 0.25, 0.35, 1, 'circle', 'bouncing');
    const ball2 = object_create(null, 0.6, 0.15, 0.04, 0.04, -0.2, 0.28, 1, 'circle', 'bouncing');

    const setupBall = (ball) => {
        ball.isTriggered = false;
        ball.onCollide = function (other) {
            if (other === paddle || other.shape === 'circle') {
                sfx_play('beep', 440, 0.05);
                if (other.shape === 'circle')
                    score += 10;
            }
        };
        ball.onPulse = function () {
            //sfx_play('snare', 220, 0.06);
        };
        ball.draw = function (ctx) {
            if (!triggerZone.activeCollisions.has(this)) {
                this.isTriggered = false;
            }

            const baseColor = this.isTriggered ? "#eab308" : (PULSE ? "#f43f5e" : "#fb7185");
            fill_color(baseColor);
            line_color("#ffffff");
            line_width(2);
            draw_circle(0.5, 0.5, 0.5, true, true);
        };
    };

    setupBall(ball1);
    setupBall(ball2);

    // 4. HUD / Score Tracker Object
    const hud = object_create(null, 0, 0, 1, 1, 0, 0, 1, 'box', false, false, 100);
    hud.draw = function (ctx) {
        fill_color("#ffffff");
        draw_text(`SCORE: ${score}`, 0.5, 0.08, 20, "#ffffff", "monospace", "center middle");
        draw_text("Balls turn yellow inside the central zone!", 0.5, 0.95, 12, "#64748b", "arial", "center middle");
    };
    // 2. Create Stationary Trigger Zone in the center
    const startButton = object_create(null, 0.3, 0.35, 0.4, 0.2, 0, 0, 1, 'box', 'trigger');
    startButton.update = function (dt) {
        document.title = Input.normX
            if (Input.pressed && this.containsPoint(Input.normX, Input.normY)) {
                goto('arcade');
            }
    };
    startButton.draw = function (ctx) {
        fill_color("rgba(234, 179, 8, 1)");
        line_color("#000000");
        line_width(12);
        line_style("dashed");
        //draw_rect(x = 0, y = 0, w = 0.1, h = 0.1, color = '#38bdf8', filled = true, line_color = '#ffffff', line_thickness = 1)
        draw_rect(0, 0, 1, 1, 'rgba(234, 179, 8, 1)', true, '#000000', 12);
        //line_style("solid");

        fill_color("#eab308");
        draw_text("PRESS TO START", 0.5, 0.5, 22, "#000000", "monospace", "center middle");
    };

    // 5. Build and Launch Room
    const menuRoom = new Room({
        bgColor: '#ffffff',
        objects: [startButton]
    });
    const arcadeRoom = new Room({
        bgColor: '#0f172a',
        objects: [triggerZone, paddle, ball1, ball2, hud]
    });
    rooms['arcade'] = arcadeRoom;
    rooms['menu'] = menuRoom;
    goto('menu');
}
