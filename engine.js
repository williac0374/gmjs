/**
 * ==========================================
 * ENGINE CORE (engine.js)
 * ==========================================
 */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const hiddenInput = document.getElementById('hidden-input');

// Global Engine Configuration
let FIXED_WIDTH = null;
let FIXED_HEIGHT = null;
let BPM = 120;
let TICK = 0;
let PULSE = false;

let currentRoom = null;
let rooms = {};
let assets = {};
let audioCtx = null;

// Engine Timing, Asset Queue & Loading State
let lastTime = performance.now();
let nextPulseTime = 0;
let killQueue = [];
let assetPromises = [];
let assetsLoaded = false;

// Rendering Context Tracking
let currentDrawingInst = null;

// Unified Input State
const Input = {
    x: 0, y: 0, normX: 0, normY: 0,
    down: false, pressed: false, released: false,
    dragTarget: null, startX: 0, startY: 0
};

/**
 * ==========================================
 * VIEWPORT & CANVAS RESOLUTION
 * ==========================================
 */
function canvas_init(w, h) {
    FIXED_WIDTH = w || null;
    FIXED_HEIGHT = h || null;
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    let displayWidth, displayHeight;

    if (FIXED_WIDTH && FIXED_HEIGHT) {
        const scale = Math.min(window.innerWidth / FIXED_WIDTH, window.innerHeight / FIXED_HEIGHT);
        displayWidth = FIXED_WIDTH * scale;
        displayHeight = FIXED_HEIGHT * scale;
        canvas.width = FIXED_WIDTH * dpr;
        canvas.height = FIXED_HEIGHT * dpr;
    } else {
        displayWidth = window.innerWidth;
        displayHeight = window.innerHeight;
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
    }

    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    ctx.scale(dpr, dpr);
}

function getPixelBounds() {
    return {
        width: FIXED_WIDTH ? FIXED_WIDTH : window.innerWidth,
        height: FIXED_HEIGHT ? FIXED_HEIGHT : window.innerHeight
    };
}

/**
 * ==========================================
 * AUDIO SYSTEM (Zero-Latency AudioBuffers)
 * ==========================================
 */
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function sfx_play(soundRef, freq = 440, duration = 0.1) {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    // 1. Direct AudioBuffer Handle Passed
    if (soundRef && soundRef.constructor && soundRef.constructor.name === 'AudioBuffer') {
        const source = audioCtx.createBufferSource();
        source.buffer = soundRef;
        source.connect(audioCtx.destination);
        source.start(0);
        return source;
    }

    // 2. String Path Lookup
    if (typeof soundRef === 'string') {
        if (soundRef !== 'beep' && soundRef !== 'kick' && soundRef !== 'snare' && (soundRef.includes('.') || assets[soundRef])) {
            const asset = assets[soundRef];
            
            if (asset && asset.constructor && asset.constructor.name === 'AudioBuffer') {
                const source = audioCtx.createBufferSource();
                source.buffer = asset;
                source.connect(audioCtx.destination);
                source.start(0);
                return source;
            } else if (asset === true) {
                return; // Still decoding
            } else {
                load(soundRef);
                return;
            }
        }
    }

    // 3. Fallback: Synthesized Web Audio API tones ('beep', 'kick', 'snare')
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    let toneType = 'square';
    if (soundRef === 'kick') toneType = 'sine';
    if (soundRef === 'snare') toneType = 'triangle';
    
    osc.type = toneType;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (soundRef === 'kick') osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + duration);
    
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function sfx_loop() {}
function sfx_playing() { return false; }

/**
 * ==========================================
 * DRAWING STYLE HELPERS
 * ==========================================
 */
function fill_color(color) {
    ctx.fillStyle = color;
}

function line_color(color) {
    ctx.strokeStyle = color;
}

function line_width(width) {
    ctx.lineWidth = width;
}

function line_style(style) {
    if (style === 'dashed') {
        ctx.setLineDash([6, 6]);
    } else if (style === 'dotted') {
        ctx.setLineDash([2, 4]);
    } else if (Array.isArray(style)) {
        ctx.setLineDash(style);
    } else {
        ctx.setLineDash([]);
    }
}

/**
 * ==========================================
 * DRAWING ABSTRACTIONS
 * ==========================================
 */
function draw_text(text, x = 0.5, y = 0.5, size = 14, color = '#ffffff', font = 'arial', alignment = 'center middle') {
    const b = getPixelBounds();
    
    let nx = x;
    let ny = y;
    if (currentDrawingInst) {
        nx = currentDrawingInst.x + x * currentDrawingInst.w;
        ny = currentDrawingInst.y + y * currentDrawingInst.h;
    }
    
    const px = nx * b.width;
    const py = ny * b.height;

    ctx.save();
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = color;

    let hAlign = 'center';
    let vAlign = 'middle';
    if (typeof alignment === 'string') {
        const parts = alignment.toLowerCase().split(/\s+/);
        for (let p of parts) {
            if (['left', 'center', 'right'].includes(p)) hAlign = p;
            if (['top', 'middle', 'bottom', 'alphabetic', 'hanging'].includes(p)) vAlign = p;
        }
    }

    ctx.textAlign = hAlign;
    ctx.textBaseline = vAlign;

    ctx.fillText(text, px, py);
    ctx.restore();
}

/**
 * ==========================================
 * SHAPE DRAWING ABSTRACTIONS
 * ==========================================
 */
function draw_rect(x = 0, y = 0, w = 0.1, h = 0.1, color = '#38bdf8', filled = true, line_color = '#ffffff', line_thickness = 1) {
    const b = getPixelBounds();
    let nx = x, ny = y, nw = w, nh = h;

    if (currentDrawingInst) {
        nx = currentDrawingInst.x + x * currentDrawingInst.w;
        ny = currentDrawingInst.y + y * currentDrawingInst.h;
        nw = w * currentDrawingInst.w;
        nh = h * currentDrawingInst.h;
    }

    const px = nx * b.width;
    const py = ny * b.height;
    const pw = nw * b.width;
    const ph = nh * b.height;

    ctx.save();
    if (filled) {
        ctx.fillStyle = color;
        ctx.fillRect(px, py, pw, ph);
    }
    if (line_thickness > 0 && line_color) {
        ctx.strokeStyle = line_color;
        ctx.lineWidth = line_thickness;
        ctx.strokeRect(px, py, pw, ph);
    }
    ctx.restore();
}

function draw_circle(x = 0.5, y = 0.5, r = 0.05, filled = true, color = '#38bdf8', line_color = '#ffffff', line_thickness = 1) {
    const b = getPixelBounds();
    let nx = x, ny = y, nr = r;

    if (currentDrawingInst) {
        nx = currentDrawingInst.x + x * currentDrawingInst.w;
        ny = currentDrawingInst.y + y * currentDrawingInst.h;
        nr = r * currentDrawingInst.w;
    }

    const px = nx * b.width;
    const py = ny * b.height;
    const pr = nr * b.width;

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);

    if (filled) {
        ctx.fillStyle = color;
        ctx.fill();
    }
    if (line_thickness > 0 && line_color) {
        ctx.strokeStyle = line_color;
        ctx.lineWidth = line_thickness;
        ctx.stroke();
    }
    ctx.restore();
}

function draw_line(x1 = 0, y1 = 0, x2 = 1, y2 = 1, color = '#ffffff', thickness = 1) {
    const b = getPixelBounds();
    let nx1 = x1, ny1 = y1, nx2 = x2, ny2 = y2;

    if (currentDrawingInst) {
        nx1 = currentDrawingInst.x + x1 * currentDrawingInst.w;
        ny1 = currentDrawingInst.y + y1 * currentDrawingInst.h;
        nx2 = currentDrawingInst.x + x2 * currentDrawingInst.w;
        ny2 = currentDrawingInst.y + y2 * currentDrawingInst.h;
    }

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(nx1 * b.width, ny1 * b.height);
    ctx.lineTo(nx2 * b.width, ny2 * b.height);
    ctx.stroke();
    ctx.restore();
}

/**
 * ==========================================
 * SMART ASSET & DATA LOADER (Auto-Tracked Gate)
 * ==========================================
 */
function load(filepath, callback = null) {
    if (assets[filepath]) {
        if (callback && assets[filepath] !== true) callback(assets[filepath]);
        return assets[filepath];
    }

    const ext = filepath.split('.').pop().toLowerCase();
    const fetchPath = filepath.startsWith('/') || filepath.startsWith('http') ? filepath : './' + filepath;

    // 1. Image Assets (.png, .jpg, .webp, etc.)
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
        const promise = new Promise((resolve, reject) => {
            const img = new Image();
            img.src = fetchPath;
            img.onload = () => {
                assets[filepath] = img;
                if (callback) callback(img);
                resolve(img);
            };
            img.onerror = () => {
                console.error(`Failed to load image: ${fetchPath}`);
                reject(new Error(`Failed to load image: ${fetchPath}`));
            };
            assets[filepath] = img;
        });
        assetPromises.push(promise);
        return img;
    }
    
    // 2. Audio Assets (.mp3, .wav, .ogg) -> Decoded AudioBuffer
    else if (['mp3', 'wav', 'ogg'].includes(ext)) {
        assets[filepath] = true; // Mark as loading

        const promise = fetch(fetchPath)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status} for ${fetchPath}`);
                return res.arrayBuffer();
            })
            .then(buf => {
                // Initialize audio context only when the decoding actually finishes and user interaction is ready, 
                // or use a temporary offline/onscreen context if needed. But safe to init here since buffer is ready:
                initAudio();
                return audioCtx.decodeAudioData(buf);
            })
            .then(decodedBuffer => {
                assets[filepath] = decodedBuffer;
                if (callback) callback(decodedBuffer);
                return decodedBuffer;
            })
            .catch(err => {
                console.error(`Failed to decode audio: ${fetchPath}`, err);
                delete assets[filepath];
            });

        assetPromises.push(promise);
        return null;
    }
    
    // 3. JSON Data / Config (.json)
    else if (ext === 'json') {
        const promise = fetch(fetchPath)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then(data => {
                assets[filepath] = data;
                if (callback) callback(data);
                return data;
            })
            .catch(err => {
                console.error(`Failed to load JSON: ${fetchPath}`, err);
            });

        assetPromises.push(promise);
        assets[filepath] = promise;
        return promise;
    }
    
    // Fallback for plain text or unknown types
    else {
        const promise = fetch(fetchPath)
            .then(res => res.text())
            .then(text => {
                assets[filepath] = text;
                if (callback) callback(text);
                return text;
            });
        assetPromises.push(promise);
        assets[filepath] = promise;
        return promise;
    }
}

/**
 * ==========================================
 * BASE GAMEOBJECT CLASS
 * ==========================================
 */
class GameObject {
    constructor(x, y, w, h, options = {}) {
        this.x = x; this.y = y; this.w = w; this.h = h;
        this.vx = options.vx || 0;
        this.vy = options.vy || 0;
        this.mass = options.mass !== undefined ? options.mass : 1;
        this.shape = options.shape || 'box';
        this.collide = options.collide || false;
        this.stretch = options.stretch !== undefined ? options.stretch : true;
        this.depth = options.depth !== undefined ? options.depth : 0;
        this.visible = options.visible !== undefined ? options.visible : true;
        this.debug = options.debug || false;
        this.isDragging = false;
        this._dragOffsetX = 0;
        this._dragOffsetY = 0;
        this.activeCollisions = new Set();
        this.isTriggered = false;
    }

    start() {}
    update(dt) {}
    draw(ctx) {}
    onPulse() {}
    onCollide(other) {}
    onDestroy() {}

    destroy() {
        if (!this._markedForDestroy) {
            this._markedForDestroy = true;
            killQueue.push(this);
        }
    }

    containsPoint(nx, ny) {
        if (this.shape === 'circle') {
            const bnd = getPixelBounds();
            const cx = (this.x + this.w / 2) * bnd.width;
            const cy = (this.y + this.h / 2) * bnd.height;
            const radius = (this.w / 2) * bnd.width;
            const px = nx * bnd.width;
            const py = ny * bnd.height;
            const dx = px - cx, dy = py - cy;
            return (dx * dx + dy * dy) <= (radius * radius);
        } else {
            return nx >= this.x && nx <= this.x + this.w && ny >= this.y && ny <= this.y + this.h;
        }
    }
}

/**
 * ==========================================
 * SIMPLIFIED OBJECT FACTORY
 * ==========================================
 */
function object_create(
    sprite = null, 
    x = 0, y = 0, 
    w = 0.1, h = 0.1, 
    vx = 0, vy = 0, 
    mass = 1, 
    shape = 'box', 
    collide = false, 
    stretch = true, 
    depth = 0, 
    visible = true, 
    debug = false
) {
    class FactoryObject extends GameObject {
        constructor() {
            super(x, y, w, h, { vx, vy, mass, shape, collide, stretch, depth, visible, debug });
            this.sprite = sprite;
        }

        draw(ctx) {
            const b = getPixelBounds();
            const px = this.x * b.width;
            const py = this.y * b.height;
            const pw = this.w * b.width;
            const ph = this.h * b.height;

            if (this.sprite && this.sprite.complete && this.sprite.naturalWidth !== 0) {
                ctx.drawImage(this.sprite, px, py, pw, ph);
            } else {
                if (this.shape === 'circle') {
                    const cx = px + pw / 2;
                    const cy = py + ph / 2;
                    const r = pw / 2;
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                } else {
                    ctx.fillRect(px, py, pw, ph);
                    ctx.strokeRect(px, py, pw, ph);
                }
            }
        }
    }

    return new FactoryObject();
}

/**
 * ==========================================
 * CANVAS TEXTBOX COMPONENT
 * ==========================================
 */
class CanvasTextbox extends GameObject {
    constructor(x, y, w, h, options = {}) {
        super(x, y, w, h, { collide: 'trigger', depth: -100 });
        this.text = "";
        this.placeholder = options.placeholder || "Type here...";
        this.multiline = options.multiline || false;
        this.enterSubmits = options.enterSubmits !== undefined ? options.enterSubmits : true;
        this.onSubmit = options.onSubmit || (() => {});
        this.focused = false;
        this.cursorTimer = 0;
        this.cursorPos = 0;
    }

    start() {
        hiddenInput.addEventListener('keydown', (e) => {
            if (this.focused) {
                setTimeout(() => {
                    this.text = hiddenInput.value;
                    this.cursorPos = hiddenInput.selectionStart;
                }, 0);

                if (e.key === 'Enter' && this.enterSubmits && !this.multiline) {
                    e.preventDefault();
                    this.blur();
                    this.onSubmit(this.text);
                }
            }
        });

        hiddenInput.addEventListener('input', () => {
            if (this.focused) {
                this.text = hiddenInput.value;
                this.cursorPos = hiddenInput.selectionStart;
            }
        });

        hiddenInput.addEventListener('click', () => {
            if (this.focused) {
                this.cursorPos = hiddenInput.selectionStart;
            }
        });
    }

    blur() {
        this.focused = false;
        hiddenInput.blur();
    }

    update(dt) {
        this.cursorTimer += dt;
        if (Input.pressed) {
            if (this.containsPoint(Input.normX, Input.normY)) {
                this.focused = true;
                hiddenInput.value = this.text;
                hiddenInput.focus();
                this.cursorPos = hiddenInput.selectionStart;
            } else if (this.focused) {
                this.blur();
                this.onSubmit(this.text);
            }
        }
        
        if (this.focused) {
            this.text = hiddenInput.value;
            this.cursorPos = hiddenInput.selectionStart;
        }
    }

    draw(ctx) {
        const b = getPixelBounds();
        const px = this.x * b.width, py = this.y * b.height, pw = this.w * b.width, ph = this.h * b.height;
        
        ctx.fillStyle = this.focused ? "#1e293b" : "#0f172a";
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = this.focused ? "#38bdf8" : "#475569";
        ctx.lineWidth = this.focused ? 2 : 1;
        ctx.strokeRect(px, py, pw, ph);

        ctx.font = "14px system-ui, sans-serif";
        ctx.textBaseline = "top";

        if (this.text.length === 0 && !this.focused) {
            ctx.fillStyle = "#64748b";
            const placeholderY = this.multiline ? py + 10 : py + (ph / 2) - 7;
            ctx.fillText(this.placeholder, px + 10, placeholderY);
        } else {
            ctx.fillStyle = "#ffffff";
            if (this.multiline) {
                const lines = this.text.split('\n');
                const lineHeight = 18;
                for (let i = 0; i < lines.length; i++) {
                    ctx.fillText(lines[i], px + 10, py + 10 + (i * lineHeight));
                }
            } else {
                const textY = py + (ph / 2) - 7;
                ctx.fillText(this.text, px + 10, textY);
            }

            if (this.focused && Math.floor(this.cursorTimer * 2) % 2 === 0) {
                const textBeforeCursor = this.text.substring(0, this.cursorPos);
                
                if (this.multiline) {
                    const linesBefore = textBeforeCursor.split('\n');
                    const currentLineIndex = linesBefore.length - 1;
                    const currentLineText = linesBefore[currentLineIndex];
                    
                    const metrics = ctx.measureText(currentLineText);
                    const cursorX = px + 10 + metrics.width;
                    const lineHeight = 18;
                    const cursorY = py + 10 + (currentLineIndex * lineHeight);

                    ctx.fillStyle = "#38bdf8";
                    ctx.fillRect(cursorX, cursorY, 2, 16);
                } else {
                    const textY = py + (ph / 2) - 7;
                    const metrics = ctx.measureText(textBeforeCursor);
                    const cursorX = px + 10 + metrics.width;

                    ctx.fillStyle = "#38bdf8";
                    ctx.fillRect(cursorX, textY - 1, 2, 16);
                }
            }
        }
    }
}

/**
 * ==========================================
 * ROOMS & STATE MANAGEMENT
 * ==========================================
 */
class Room {
    constructor(config = {}) {
        this.bgColor = config.bgColor || '#0f172a';
        this.objects = config.objects || [];
        this.instances = [];
    }

    init() {
        this.instances = [...this.objects];
        for (let inst of this.instances) inst.start();
    }
}

function goto(roomName) {
    if (rooms[roomName]) {
        currentRoom = rooms[roomName];
        currentRoom.init();
    }
}

/**
 * ==========================================
 * COLLISION & PHYSICS ENGINE
 * ==========================================
 */
function checkCollisions() {
    if (!currentRoom) return;
    const collidables = currentRoom.instances.filter(i => i.collide && i.collide !== false);

    for (let i = 0; i < collidables.length; i++) {
        for (let j = i + 1; j < collidables.length; j++) {
            let a = collidables[i];
            let b = collidables[j];

            if (a._markedForDestroy || b._markedForDestroy) continue;

            if (checkOverlap(a, b)) {
                a.onCollide(b);
                b.onCollide(a);

                const isPhysA = ['solid', 'bouncing'].includes(a.collide);
                const isPhysB = ['solid', 'bouncing'].includes(b.collide);

                if (isPhysA && isPhysB) {
                    resolveCollisionPhysics(a, b);
                }
            }
        }
    }
}

function checkOverlap(a, b) {
    const bnd = getPixelBounds();

    if (a.shape === 'circle' && b.shape === 'circle') {
        const ax = (a.x + a.w / 2) * bnd.width;
        const ay = (a.y + a.h / 2) * bnd.height;
        const bx = (b.x + b.w / 2) * bnd.width;
        const by = (b.y + b.h / 2) * bnd.height;
        const dx = bx - ax;
        const dy = by - ay;
        const rA = (a.w / 2) * bnd.width;
        const rB = (b.w / 2) * bnd.width;
        return (dx * dx + dy * dy) <= ((rA + rB) * (rA + rB));
    } else if (a.shape === 'circle' && b.shape === 'box') {
        return checkCircleBoxOverlap(a, b);
    } else if (a.shape === 'box' && b.shape === 'circle') {
        return checkCircleBoxOverlap(b, a);
    } else {
        return a.x < b.x + b.w && a.x + a.w > b.x &&
               a.y < b.y + b.h && a.y + a.h > b.y;
    }
}

function checkCircleBoxOverlap(circle, box) {
    const bnd = getPixelBounds();
    const cx = (circle.x + circle.w / 2) * bnd.width;
    const cy = (circle.y + circle.h / 2) * bnd.height;
    const radius = (circle.w / 2) * bnd.width;

    const boxPxX = box.x * bnd.width;
    const boxPxY = box.y * bnd.height;
    const boxPxW = box.w * bnd.width;
    const boxPxH = box.h * bnd.height;

    const closestX = Math.max(boxPxX, Math.min(cx, boxPxX + boxPxW));
    const closestY = Math.max(boxPxY, Math.min(cy, boxPxY + boxPxH));

    const dx = cx - closestX;
    const dy = cy - closestY;

    return (dx * dx + dy * dy) <= (radius * radius);
}

function resolveCollisionPhysics(a, b) {
    const invA = a.mass === Infinity ? 0 : 1 / a.mass;
    const invB = b.mass === Infinity ? 0 : 1 / b.mass;
    const totalInv = invA + invB;
    if (totalInv === 0) return;

    const bnd = getPixelBounds();

    if (a.shape === 'circle' && b.shape === 'circle') {
        const ax = (a.x + a.w / 2) * bnd.width;
        const ay = (a.y + a.h / 2) * bnd.height;
        const bx = (b.x + b.w / 2) * bnd.width;
        const by = (b.y + b.h / 2) * bnd.height;
        let dx = bx - ax;
        let dy = by - ay;
        let distance = Math.sqrt(dx * dx + dy * dy);
        const rA = (a.w / 2) * bnd.width;
        const rB = (b.w / 2) * bnd.width;
        const minDist = rA + rB;

        if (distance < minDist) {
            if (distance === 0) { dx = 1; dy = 0; distance = 1; }
            const nx = dx / distance;
            const ny = dy / distance;
            const overlap = minDist - distance;

            a.x -= (nx * overlap / bnd.width) * (invA / totalInv);
            a.y -= (ny * overlap / bnd.height) * (invA / totalInv);
            b.x += (nx * overlap / bnd.width) * (invB / totalInv);
            b.y += (ny * overlap / bnd.height) * (invB / totalInv);

            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const velAlongNormal = rvx * nx + rvy * ny;

            if (velAlongNormal < 0) {
                const restitution = 0.9;
                const impulseScalar = -(1 + restitution) * velAlongNormal / totalInv;
                if (invA > 0) { a.vx -= nx * impulseScalar * invA; a.vy -= ny * impulseScalar * invA; }
                if (invB > 0) { b.vx += nx * impulseScalar * invB; b.vy += ny * impulseScalar * invB; }
            }
        }
    } else if ((a.shape === 'circle' && b.shape === 'box') || (a.shape === 'box' && b.shape === 'circle')) {
        let circle = a.shape === 'circle' ? a : b;
        let box = a.shape === 'box' ? a : b;
        const invC = circle.mass === Infinity ? 0 : 1 / circle.mass;
        const invB = box.mass === Infinity ? 0 : 1 / box.mass;
        const total = invC + invB;
        if (total === 0) return;

        const cx = (circle.x + circle.w / 2) * bnd.width;
        const cy = (circle.y + circle.h / 2) * bnd.height;
        const radius = (circle.w / 2) * bnd.width;

        const boxPxX = box.x * bnd.width;
        const boxPxY = box.y * bnd.height;
        const boxPxW = box.w * bnd.width;
        const boxPxH = box.h * bnd.height;

        const closestX = Math.max(boxPxX, Math.min(cx, boxPxX + boxPxW));
        const closestY = Math.max(boxPxY, Math.min(cy, boxPxY + boxPxH));

        let dx = cx - closestX;
        let dy = cy - closestY;
        let distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < radius) {
            if (distance === 0) { dx = 1; dy = 0; distance = 1; }
            const nx = dx / distance;
            const ny = dy / distance;
            const overlap = radius - distance;

            circle.x += (nx * overlap / bnd.width) * (invC / total);
            circle.y += (ny * overlap / bnd.height) * (invC / total);

            const velNormal = circle.vx * nx + circle.vy * ny;
            if (velNormal < 0) {
                const restitution = 0.8;
                circle.vx -= (1 + restitution) * velNormal * nx;
                circle.vy -= (1 + restitution) * velNormal * ny;
            }
        }
    } else {
        const overlapX = Math.min(a.x + a.w - b.x, b.x + b.w - a.x);
        const overlapY = Math.min(a.y + a.h - b.y, b.y + b.h - a.y);
        if (overlapX < overlapY) {
            const dir = a.x < b.x ? -1 : 1;
            const sep = overlapX * 0.5;
            a.x += dir * sep * (invA / totalInv);
            b.x -= dir * sep * (invB / totalInv);
            if (invA > 0) a.vx *= -0.8;
            if (invB > 0) b.vx *= -0.8;
        } else {
            const dir = a.y < b.y ? -1 : 1;
            const sep = overlapY * 0.5;
            a.y += dir * sep * (invA / totalInv);
            b.y -= dir * sep * (invB / totalInv);
            if (invA > 0) a.vy *= -0.8;
            if (invB > 0) b.vy *= -0.8;
        }
    }
}

/**
 * ==========================================
 * UNIFIED INPUT SYSTEM
 * ==========================================
 */
function setupInputListeners() {
    const handleStart = (clientX, clientY) => {
        initAudio();
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const rect = canvas.getBoundingClientRect();
        Input.x = clientX - rect.left; Input.y = clientY - rect.top;
        Input.normX = Input.x / rect.width; Input.normY = Input.y / rect.height;
        Input.down = true; Input.pressed = true;

        if (currentRoom) {
            for (let inst of currentRoom.instances) {
                if (inst.containsPoint(Input.normX, Input.normY)) {
                    Input.dragTarget = inst;
                    inst._dragOffsetX = Input.normX - inst.x;
                    inst._dragOffsetY = Input.normY - inst.y;
                    break;
                }
            }
        }
    };

    const handleMove = (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        Input.x = clientX - rect.left; Input.y = clientY - rect.top;
        Input.normX = Math.max(0, Math.min(1, Input.x / rect.width));
        Input.normY = Math.max(0, Math.min(1, Input.y / rect.height));

        if (Input.down && Input.dragTarget) {
            Input.dragTarget.x = Input.normX - Input.dragTarget._dragOffsetX;
            Input.dragTarget.y = Input.normY - Input.dragTarget._dragOffsetY;
        }
    };

    const handleEnd = () => { Input.down = false; Input.released = true; Input.dragTarget = null; };

    canvas.addEventListener('mousedown', e => { if (e.button !== 2) handleStart(e.clientX, e.clientY); });
    window.addEventListener('mousemove', e => handleMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('touchstart', e => { if (e.touches.length > 0) handleStart(e.touches[0].clientX, e.touches[0].clientY); }, {passive: true});
    canvas.addEventListener('touchmove', e => { if (e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY); }, {passive: true});
    canvas.addEventListener('touchend', handleEnd);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
}

/**
 * ==========================================
 * DEBUG OVERLAY & TELEMETRY HUD
 * ==========================================
 */
function drawDebugHUD(ctx, inst, b) {
    const px = inst.x * b.width, py = inst.y * b.height, pw = inst.w * b.width, ph = inst.h * b.height;
    ctx.strokeStyle = inst.collide === 'solid' ? '#22c55e' : inst.collide === 'bouncing' ? '#eab308' : '#38bdf8';
    ctx.lineWidth = 2;

    if (inst.shape === 'circle') {
        const cx = (inst.x + inst.w / 2) * b.width;
        const cy = (inst.y + inst.h / 2) * b.height;
        const cr = (inst.w / 2) * b.width;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.strokeRect(px, py, pw, ph);
    }

    const cardX = Math.min(b.width - 150, Math.max(10, px));
    const cardY = Math.max(10, py - 65);
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(cardX, cardY, 140, 55);
    ctx.strokeStyle = "#475569";
    ctx.strokeRect(cardX, cardY, 140, 55);

    ctx.fillStyle = "#38bdf8"; ctx.font = "bold 10px system-ui, sans-serif"; ctx.textBaseline = "top";
    ctx.fillText(`DEBUG HUD`, cardX + 6, cardY + 6);
    ctx.fillStyle = "#e2e8f0"; ctx.font = "9px monospace";
    ctx.fillText(`pos: ${inst.x.toFixed(2)}, ${inst.y.toFixed(2)}`, cardX + 6, cardY + 20);
    ctx.fillText(`vel: ${inst.vx.toFixed(2)}, ${inst.vy.toFixed(2)}`, cardX + 6, cardY + 32);
    ctx.fillText(`mass: ${inst.mass === Infinity ? 'Inf' : inst.mass}`, cardX + 6, cardY + 44);
}

/**
 * ==========================================
 * ENGINE DUAL-LOOP EXECUTION & LOADING GATE
 * ==========================================
 */
function engineStart() {
    setupInputListeners();
    if (typeof startGame === 'function') startGame();

    // Render a native loading splash screen while assets fetch and decode
    const loadingInterval = setInterval(() => {
        const b = getPixelBounds();
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        draw_text("LOADING ASSETS...", 0.5, 0.5, 18, "#38bdf8", "monospace", "center middle");
    }, 50);

    // Wait for all registered load() promises to finish before clearing splash and starting main loop
    Promise.all(assetPromises).then(() => {
        clearInterval(loadingInterval);
        assetsLoaded = true;
        console.log("[Engine] All assets loaded successfully. Starting game loop.");
        requestAnimationFrame(engineMainLoop);
    }).catch(err => {
        clearInterval(loadingInterval);
        console.error("[Engine] Asset loading error:", err);
    });
}

function engineMainLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;

    // --- HARDWARE AUDIO CLOCK RHYTHM SYNC ---
    const pulseInterval = 60 / BPM;
    if (audioCtx && audioCtx.state === 'running') {
        if (nextPulseTime === 0) {
            nextPulseTime = audioCtx.currentTime + pulseInterval;
        }

        if (audioCtx.currentTime >= nextPulseTime) {
            nextPulseTime += pulseInterval;
            TICK++;
            PULSE = true;
            if (currentRoom) {
                for (let inst of currentRoom.instances) {
                    inst.onPulse();
                }
            }
        } else {
            PULSE = false;
        }
    } else {
        PULSE = false;
    }

    if (currentRoom) {
        for (let inst of currentRoom.instances) {
            inst.x += inst.vx * dt;
            inst.y += inst.vy * dt;

            // Screen boundary check
            if (inst.x < 0) { inst.x = 0; inst.vx *= -1; }
            if (inst.x + inst.w > 1.0) { inst.x = 1.0 - inst.w; inst.vx *= -1; }
            if (inst.y < 0) { inst.y = 0; inst.vy *= -1; }
            if (inst.y + inst.h > 1.0) { inst.y = 1.0 - inst.h; inst.vy *= -1; }

            inst.update(dt);
        }

        checkCollisions();

        if (killQueue.length > 0) {
            for (let doomed of killQueue) {
                doomed.onDestroy();
                const idx = currentRoom.instances.indexOf(doomed);
                if (idx !== -1) currentRoom.instances.splice(idx, 1);
            }
            killQueue = [];
        }
    }

    const b = getPixelBounds();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentRoom) {
        ctx.fillStyle = currentRoom.bgColor;
        ctx.fillRect(0, 0, b.width, b.height);
        const sortedInstances = [...currentRoom.instances].sort((a, b) => a.depth - b.depth);

        for (let inst of sortedInstances) {
            if (!inst.visible) continue;
            ctx.save();
            currentDrawingInst = inst;
            inst.draw(ctx);
            currentDrawingInst = null;
            ctx.restore();
            if (inst.debug) drawDebugHUD(ctx, inst, b);
        }
    }

    Input.pressed = false;
    Input.released = false;
    requestAnimationFrame(engineMainLoop);
}

window.onload = () => {
    canvas_init();
    engineStart();
};