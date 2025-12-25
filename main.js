// --- CONFIGURATION ---
const DEBUG = true; // Console debug enabled
const CONFIG = {
    moveSpeed: 0.2,
    encounterRate: 0.002,
    baseExpGain: 10
};

const STATE = {
    mode: 'TITLE', // TITLE, EXPLORE, BATTLE, ANIMATING
    player: { 
        name: 'Guillaume',
        level: 1,
        exp: 0,
        nextExp: 20,
        hp: 100, 
        maxHp: 100,
        strength: 5,
        magic: 3,
        agility: 4,
        defense: 4,
        frenchness: 7
    },
    enemy: { hp: 80, maxHp: 80, damage: 15 },
    world: {
        heroPosition: { x: 0, y: 0, z: 0 }
    }
};

const SAVE_KEY = 'expedition67_save_v1';

// --- MUSIC SYSTEM (sample-based) ---
// Uses pre-rendered audio tracks stored under assets/audio.

const SampleMusic = (() => {
    const tracks = {
        TITLE: new Audio('assets/audio/Intro.ogg'),
        EXPLORE: new Audio('assets/audio/loop.ogg'),
        BATTLE: new Audio('assets/audio/loop.ogg')
    };

    Object.values(tracks).forEach(audio => {
        audio.loop = true;
        audio.volume = 0.0; // we'll fade in
    });

    let current = null;
    let fadeInterval = null;

    function stopFade() {
        if (fadeInterval) {
            clearInterval(fadeInterval);
            fadeInterval = null;
        }
    }

    function fadeTo(target, durationMs = 800) {
        stopFade();
        const all = Object.values(tracks);
        const steps = 20;
        const stepDur = durationMs / steps;

        // Capture starting volumes
        const startVolumes = new Map();
        all.forEach(a => startVolumes.set(a, a.volume));

        const targetVol = 0.7;
        let step = 0;

        fadeInterval = setInterval(() => {
            step++;
            const t = Math.min(1, step / steps);
            all.forEach(a => {
                const startV = startVolumes.get(a) ?? 0;
                const endV = (a === target) ? targetVol : 0;
                a.volume = startV + (endV - startV) * t;
            });

            if (t >= 1) stopFade();
        }, stepDur);
    }

    function play(mode) {
        const target = tracks[mode];
        if (!target) return;

        // Ensure target is playing
        if (target.paused) {
            const p = target.play();
            if (p && p.catch) {
                p.catch(() => {/* ignore autoplay errors; will start after user gesture */});
            }
        }

        current = target;
        fadeTo(target);
    }

    function init() {
        // Attempt to start title track after first user interaction
        const handler = () => {
            play('TITLE');
            window.removeEventListener('click', handler);
            window.removeEventListener('keydown', handler);
        };
        window.addEventListener('click', handler);
        window.addEventListener('keydown', handler);
    }

    return { play, init };
})();

function getSavePayload() {
    return {
        world: {
            heroPosition: {
                x: heroGroup.position.x,
                y: heroGroup.position.y,
                z: heroGroup.position.z
            }
        },
        player: {
            name: STATE.player.name,
            level: STATE.player.level,
            exp: STATE.player.exp,
            nextExp: STATE.player.nextExp,
            hp: STATE.player.hp,
            maxHp: STATE.player.maxHp,
            strength: STATE.player.strength,
            magic: STATE.player.magic,
            agility: STATE.player.agility,
            defense: STATE.player.defense,
            frenchness: STATE.player.frenchness
        }
    };
}

function applyLoadedSave(payload) {
    if (!payload) return;

    // Restore player
    if (payload.player) {
        const p = payload.player;
        Object.assign(STATE.player, p);
    }

    // Restore hero world position if present
    if (payload.world && payload.world.heroPosition) {
        const hp = payload.world.heroPosition;
        heroGroup.position.set(hp.x ?? 0, hp.y ?? 0, hp.z ?? 0);
    }
}

function saveGame() {
    try {
        const payload = getSavePayload();
        localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
        if (DEBUG) console.log('Game saved');
    } catch (err) {
        console.error('Failed to save game', err);
    }
}

function loadGame() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;
        const payload = JSON.parse(raw);
        applyLoadedSave(payload);
        if (DEBUG) console.log('Game loaded');
        return true;
    } catch (err) {
        console.error('Failed to load game', err);
        return false;
    }
}

// --- THREE.JS SETUP ---
const scene = new THREE.Scene();

// French flag skybox: blue-white-red vertical bands
const skyGeo = new THREE.BoxGeometry(200, 200, 200);
const skyMaterials = [
    // px, nx, py, ny, pz, nz
    new THREE.MeshBasicMaterial({ color: 0xED2939, side: THREE.BackSide }), // +X (red)
    new THREE.MeshBasicMaterial({ color: 0x0055A4, side: THREE.BackSide }), // -X (blue)
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }), // +Y (white)
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }), // -Y (white)
    new THREE.MeshBasicMaterial({ color: 0x0055A4, side: THREE.BackSide }), // +Z (blue)
    new THREE.MeshBasicMaterial({ color: 0xED2939, side: THREE.BackSide })  // -Z (red)
];
const skybox = new THREE.Mesh(skyGeo, skyMaterials);
scene.add(skybox);

// Optional soft fog to keep distance pleasant
scene.fog = new THREE.Fog(0xffffff, 10, 60);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true }); // Enable antialiasing for smoother look
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game-container').insertBefore(renderer.domElement, document.getElementById('transition-overlay'));

// --- CAMERA ORBIT STATE ---
let cameraAngle = 0;           // horizontal angle around hero (radians)
let cameraPitch = 0.3;         // vertical tilt factor
const CAMERA_DISTANCE = 12;    // distance behind hero
const CAMERA_HEIGHT = 8;       // base height

let isRightMouseDown = false;
let lastMouseX = 0;
let lastMouseY = 0;

// FIX: Better Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Brighter ambient
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfffee0, 0.8); // Warm sun
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

// --- OBJECTS ---

// FIX: Colored Ground
const groundGeo = new THREE.PlaneGeometry(100, 100, 40, 40);
const count = groundGeo.attributes.position.count;
groundGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
const colors = groundGeo.attributes.color;

// Generate vertex colors for painterly look
for (let i = 0; i < count; i++) {
    const r = 0.4 + Math.random() * 0.2;
    const g = 0.5 + Math.random() * 0.3;
    const b = 0.3 + Math.random() * 0.2;
    colors.setXYZ(i, r, g, b);
}

const groundMat = new THREE.MeshStandardMaterial({ 
    vertexColors: true, 
    flatShading: true,
    roughness: 1
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Hero
const heroGroup = new THREE.Group();
// Beret
const beret = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 4, 12), new THREE.MeshLambertMaterial({color:0x2b1d0e}));
beret.rotation.x = 1.6; beret.position.y = 2.6; beret.position.z = -0.1;
heroGroup.add(beret);
// Head
const head = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.7,0.7), new THREE.MeshLambertMaterial({color:0xffccaa}));
head.position.y = 2.3;
heroGroup.add(head);
// Body
const body = new THREE.Mesh(new THREE.BoxGeometry(0.9,1.8,0.9), new THREE.MeshStandardMaterial({color:0x1a237e}));
body.position.y = 1.2;
heroGroup.add(body);
// Sword (Baguette)
const sword = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,1.5), new THREE.MeshStandardMaterial({color:0xd2a679}));
sword.position.set(0.7, 1.2, 0); sword.rotation.z = -1;
heroGroup.add(sword);

scene.add(heroGroup);

// Enemy
const enemyGroup = new THREE.Group();
enemyGroup.visible = false;

const enemyGeo = new THREE.BoxGeometry(2, 2, 2);
const enemyMat = new THREE.MeshStandardMaterial({ color: 0x880000, flatShading: true, emissive: 0x220000 });
const enemyMesh = new THREE.Mesh(enemyGeo, enemyMat);
enemyMesh.castShadow = true;
enemyGroup.add(enemyMesh);

const eyeGeo = new THREE.BoxGeometry(0.4, 0.2, 0.2);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
const eye1 = new THREE.Mesh(eyeGeo, eyeMat); eye1.position.set(-0.5, 0.5, 1.01);
const eye2 = new THREE.Mesh(eyeGeo, eyeMat); eye2.position.set(0.5, 0.5, 1.01);
enemyGroup.add(eye1); enemyGroup.add(eye2);

scene.add(enemyGroup);

// Simple particle systems
const particles = [];

function spawnHitParticles(position, color = 0xffe082, count = 20, spread = 0.6) {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
        const idx = i * 3;
        positions[idx] = position.x + (Math.random() - 0.5) * spread;
        positions[idx + 1] = position.y + (Math.random() - 0.5) * spread;
        positions[idx + 2] = position.z + (Math.random() - 0.5) * spread;
        velocities.push(new THREE.Vector3(
            (Math.random() - 0.5) * 1.5,
            Math.random() * 2.0,
            (Math.random() - 0.5) * 1.5
        ));
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        color,
        size: 0.15,
        transparent: true,
        opacity: 1.0
    });
    const points = new THREE.Points(geom, mat);
    scene.add(points);
    particles.push({ points, positions, velocities, life: 0.6, age: 0 });
}

function spawnTrailParticles(position, color = 0xffffff, count = 10) {
    spawnHitParticles(position, color, count, 0.3);
}

// Environment (Cypress Trees)
for(let i=0; i<20; i++) {
    const h = 4 + Math.random()*3;
    const propGroup = new THREE.Group();
    
    // Trunk
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.4, 3, 5),
        new THREE.MeshStandardMaterial({ color: 0x3e2723 })
    );
    trunk.position.y = 1.5;
    propGroup.add(trunk);

    // Leaves
    const leaves = new THREE.Mesh(
        new THREE.ConeGeometry(1.5, h, 5),
        new THREE.MeshStandardMaterial({ color: 0x1b5e20, flatShading: true })
    );
    leaves.position.y = 1.5 + h/2;
    propGroup.add(leaves);

    propGroup.position.set((Math.random()-0.5)*50, 0, (Math.random()-0.5)*50);
    
    // Avoid center spawn
    if(propGroup.position.distanceTo(new THREE.Vector3(0,0,0)) > 5) {
        scene.add(propGroup);
    }
}

// --- INPUT HANDLING ---
const keys = { w: false, a: false, s: false, d: false };
let menuOpen = false;

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if(DEBUG) console.log('keydown event', e.key, 'code', e.code);

    // Handle title screen start
    if (STATE.mode === 'TITLE') {
        if (e.code === 'Enter' || e.code === 'Space') {
            const titleEl = document.getElementById('title-screen');
            if (titleEl) titleEl.style.display = 'none';
            STATE.mode = 'EXPLORE';
            SampleMusic.play('EXPLORE');
            return;
        }
        // Load save with S key on title screen
        if (key === 's') {
            const loaded = loadGame();
            if (loaded) {
                const titleEl = document.getElementById('title-screen');
                if (titleEl) titleEl.style.display = 'none';
                STATE.mode = 'EXPLORE';
                SampleMusic.play('EXPLORE');
            }
            return;
        }
    }

    if(keys.hasOwnProperty(key)) {
        keys[key] = true;
    }

    // Toggle in-game menu with M key (or Escape as alternative)
    if (key === 'm' || e.code === 'Escape') {
        menuOpen = !menuOpen;
        const menuEl = document.getElementById('menu-overlay');
        if (menuOpen) {
            // Populate menu with current values before showing
            document.getElementById('menu-level').innerText = STATE.player.level;
            document.getElementById('menu-hp').innerText = STATE.player.hp;
            document.getElementById('menu-maxhp').innerText = STATE.player.maxHp;
            document.getElementById('menu-exp').innerText = STATE.player.exp;
            document.getElementById('menu-nextexp').innerText = STATE.player.nextExp;
            document.getElementById('menu-str').innerText = STATE.player.strength;
            document.getElementById('menu-mag').innerText = STATE.player.magic;
            document.getElementById('menu-agi').innerText = STATE.player.agility;
            document.getElementById('menu-def').innerText = STATE.player.defense;
            document.getElementById('menu-fr').innerText = STATE.player.frenchness;
            document.getElementById('menu-encounter').innerText = CONFIG.encounterRate;
            menuEl.style.display = 'block';
        } else {
            menuEl.style.display = 'none';
        }
        return; // Avoid triggering other actions on same keypress
    }
    if(e.code === 'Space' && STATE.mode === 'TIMING') {
        if (battle.turn === 'PLAYER') battle.checkTiming();
        else if (battle.turn === 'ENEMY') {
            // Parry Logic duplicated here for immediate response
            STATE.mode = 'BATTLE';
            timingOverlay.style.display = 'none';
            const elapsed = performance.now() - animStartTime;
            const perfectTime = 400; 
            const window = 150;
            if (Math.abs(elapsed - perfectTime) < window) battle.resolveParry(true);
            else battle.resolveParry(false);
        }
    }

    // Battle action keyboard shortcuts when it's the player's turn in battle
    if (STATE.mode === 'BATTLE' && battle.turn === 'PLAYER') {
        // A: Attaquer
        if (key === 'a') {
            battle.initiateAttack();
            return;
        }
        // S: Soigner
        if (key === 's') {
            battle.heal();
            return;
        }
        // D: Fuir
        if (key === 'd') {
            battle.run();
            return;
        }
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if(keys.hasOwnProperty(key)) {
        keys[key] = false;
        if(DEBUG) console.log("Key Up:", key);
    }
});

// Mouse-based camera orbit (right mouse button drag)
renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button === 2) { // right button
        isRightMouseDown = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
});

window.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
        isRightMouseDown = false;
    }
});

window.addEventListener('mousemove', (e) => {
    if (!isRightMouseDown) return;

    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // Adjust horizontal angle and pitch
    cameraAngle -= dx * 0.005;
    cameraPitch -= dy * 0.002;
    cameraPitch = Math.max(-0.2, Math.min(0.6, cameraPitch));
});

// Prevent context menu on right-click over canvas
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

// --- BATTLE SYSTEM ---

const transitionEl = document.getElementById('transition-overlay');
const battleUI = document.getElementById('battle-ui');
const timingOverlay = document.getElementById('timing-overlay');
const timingRing = document.getElementById('timing-ring');
const timingText = document.getElementById('timing-text');
let animStartTime = 0;

const levelupOverlay = document.getElementById('levelup-overlay');
const levelupButtons = levelupOverlay ? levelupOverlay.querySelectorAll('.levelup-btn') : [];

function applyLevelUpChoice(attrKey) {
    if (!STATE.player) return;
    if (attrKey === 'strength') STATE.player.strength++;
    else if (attrKey === 'magic') STATE.player.magic++;
    else if (attrKey === 'agility') STATE.player.agility++;
    else if (attrKey === 'defense') STATE.player.defense++;
    else if (attrKey === 'frenchness') STATE.player.frenchness++;

    if (levelupOverlay) levelupOverlay.style.display = 'none';

    // After choice, treat this as the true end of battle: autosave and return to exploration
    saveGame();
    battle.end(true);
}

if (levelupButtons && levelupButtons.length) {
    levelupButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-attr');
            applyLevelUpChoice(key);
        });
    });
}

const battle = {
    isActive: false,
    turn: 'PLAYER',

    start: () => {
        if(battle.isActive) return;
        
        transitionEl.classList.add('active');
        SampleMusic.play('BATTLE');
        
        setTimeout(() => {
            STATE.mode = 'BATTLE_START';
            battle.isActive = true;
            battleUI.style.display = 'block';
            
            // Position enemy
            enemyGroup.position.copy(heroGroup.position);
            enemyGroup.position.z -= 6;
            enemyGroup.position.y += 1;
            enemyGroup.visible = true;
            
            transitionEl.classList.remove('active');

            battle.log("Encounter! The enemy looms.");
            battle.setPlayerTurn();
        }, 1000);
    },

    end: (win) => {
        battle.isActive = false;
        timingOverlay.style.display = 'none';
        
        transitionEl.classList.add('active');
        battleUI.style.opacity = 0;

        setTimeout(() => {
            battleUI.style.display = 'none';
            battleUI.style.opacity = 1;
            enemyGroup.visible = false;
            STATE.mode = 'EXPLORE';
            SampleMusic.play('EXPLORE');
            transitionEl.classList.remove('active');
        }, 1000);
    },

    setPlayerTurn: () => {
        battle.turn = 'PLAYER';
        battle.toggleButtons(true);
    },

    initiateAttack: () => {
        battle.toggleButtons(false);
        battle.log("Preparing attack...");
        STATE.mode = 'TIMING';
        
        timingOverlay.style.display = 'block';
        timingText.innerText = "PRESS SPACE!";
        timingText.style.color = "#fff";
        
        timingRing.style.transition = 'none';
        timingRing.style.width = '350px';
        void timingRing.offsetWidth; // Trigger reflow

    timingRing.style.transition = 'width 1s linear';
    timingRing.style.width = '100px';
        
        animStartTime = performance.now();
    },

    checkTiming: () => {
        STATE.mode = 'BATTLE';
        timingOverlay.style.display = 'none';
        
        const elapsed = performance.now() - animStartTime;
        const perfectTime = 800; 
        const window = 200;
        
        if (Math.abs(elapsed - perfectTime) < window) {
            const dmg = Math.floor(Math.random() * 10) + 25;
            STATE.enemy.hp -= dmg;
            battle.log(`CRITICAL HIT! ${dmg} damage!`);
            battle.visualHit('enemy', 0xffff00);
            // Critical hit particles
            spawnHitParticles(enemyGroup.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xfff176, 35, 0.8);
        } else {
            const dmg = Math.floor(Math.random() * 10) + 10;
            STATE.enemy.hp -= dmg;
            battle.log(`Hit. ${dmg} damage.`);
            battle.visualHit('enemy', 0xffffff);
            spawnHitParticles(enemyGroup.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xffffff, 18, 0.6);
        }

        if (STATE.enemy.hp <= 0) {
            setTimeout(() => {
                // Grant EXP and handle potential level-up
                const expGain = CONFIG.baseExpGain;
                STATE.player.exp += expGain;
                let msg = `Enemy Defeated. Gained ${expGain} EXP.`;

                let leveledUp = false;
                // Level-up loop in case of large EXP gains
                while (STATE.player.exp >= STATE.player.nextExp) {
                    STATE.player.exp -= STATE.player.nextExp;
                    STATE.player.level++;
                    STATE.player.maxHp += 10;
                    STATE.player.hp = STATE.player.maxHp;
                    STATE.player.nextExp = Math.floor(STATE.player.nextExp * 1.5);
                    msg += ` Level Up! ${STATE.player.name} reached Lv. ${STATE.player.level}.`;
                    leveledUp = true;
                }

                battle.log(msg);

                // Update HUD / battle HP display after potential level change
                document.getElementById('battle-hp-val').innerText = Math.max(0, STATE.player.hp);
                document.getElementById('explore-hp').innerText = Math.max(0, STATE.player.hp);

                // If we leveled up, present the level-up choice overlay
                if (leveledUp && levelupOverlay) {
                    levelupOverlay.style.display = 'block';
                    STATE.mode = 'ANIMATING';
                    // Do not end the battle yet; wait for player to choose attribute.
                    // Autosave will happen when battle truly ends.
                } else {
                    // No level-up: immediately autosave and end battle.
                    saveGame();
                    battle.end(true);
                }

            }, 800);

            // If there was no level up, battle.end is called above. If there was a level-up,
            // the game waits for the player to choose an attribute via the overlay.
        } else {
            setTimeout(() => battle.enemyTurn(), 1500);
        }
    },

    enemyTurn: () => {
        battle.turn = 'ENEMY';
        battle.log("Enemy is charging...");
        enemyGroup.scale.set(1.2, 1.2, 1.2);
        
        setTimeout(() => {
            enemyGroup.scale.set(1, 1, 1);
            battle.initiateParry();
        }, 1000);
    },

    initiateParry: () => {
        STATE.mode = 'TIMING';
        timingOverlay.style.display = 'block';
        timingText.innerText = "PARRY NOW!";
        timingText.style.color = "#ff0000";

        timingRing.style.transition = 'none';
        timingRing.style.width = '350px';
        void timingRing.offsetWidth;
        timingRing.style.transition = 'width 0.6s linear';
        timingRing.style.width = '100px';

        animStartTime = performance.now();
        
        setTimeout(() => {
            if(STATE.mode === 'TIMING') battle.resolveParry(false);
        }, 600);
    },

    resolveParry: (success) => {
        STATE.mode = 'BATTLE';
        timingOverlay.style.display = 'none';

        if (success) {
            battle.log("PERFECT PARRY! No damage.");
            battle.visualHit('player', 0x00ffff);
            spawnHitParticles(heroGroup.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 0x80deea, 25, 0.7);
        } else {
            const dmg = STATE.enemy.damage;
            STATE.player.hp -= dmg;
            battle.log(`Hit! Took ${dmg} damage.`);
            battle.visualHit('player', 0xff0000);
            spawnHitParticles(heroGroup.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xef5350, 22, 0.7);
            camera.position.x += 0.5;
        }

        document.getElementById('battle-hp-val').innerText = Math.max(0, STATE.player.hp);
        document.getElementById('explore-hp').innerText = Math.max(0, STATE.player.hp);

        if (STATE.player.hp <= 0) {
            setTimeout(() => {
                battle.log("Defeated...");
                STATE.player.hp = STATE.player.maxHp;
                setTimeout(() => {
                    saveGame(); // autosave on defeat
                    battle.end(false);
                }, 2000);
            }, 1000);
        } else {
            setTimeout(() => battle.setPlayerTurn(), 1500);
        }
    },

    heal: () => {
        battle.toggleButtons(false);
        const heal = 30;
        STATE.player.hp = Math.min(STATE.player.maxHp, STATE.player.hp + heal);
        battle.log(`Restored ${heal} HP.`);
        document.getElementById('battle-hp-val').innerText = STATE.player.hp;
        setTimeout(() => {
            saveGame(); // autosave after meaningful state change
            battle.enemyTurn();
        }, 1000);
    },

    run: () => {
        battle.log("Escaped elegantly.");
        setTimeout(() => {
            saveGame(); // autosave on escaping battle
            battle.end(false);
        }, 1000);
    },

    toggleButtons: (enable) => {
        const btns = document.querySelectorAll('.p5-btn');
        btns.forEach(b => b.disabled = !enable);
    },

    log: (msg) => {
        const el = document.getElementById('battle-log');
        el.style.opacity = 0;
        setTimeout(() => { el.innerText = msg; el.style.opacity = 1; }, 200);
    },

    visualHit: (target, color) => {
        const obj = target === 'enemy' ? enemyMesh : body;
        const oldColor = obj.material.color.getHex();
        obj.material.color.setHex(color);
        setTimeout(() => obj.material.color.setHex(oldColor), 100);
    }
};

// --- MAIN LOOP ---
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();

    if (STATE.mode === 'TITLE') {
        // Camera can stay fixed during title; no world updates needed
    }
    else if (STATE.mode === 'EXPLORE') {
        // FIX: Ensure movement logic is robust
        let moving = false;
        
        if (keys.w) { 
            heroGroup.position.z -= CONFIG.moveSpeed; 
            heroGroup.rotation.y = 0; 
            moving = true; 
        }
        if (keys.s) { 
            heroGroup.position.z += CONFIG.moveSpeed; 
            heroGroup.rotation.y = Math.PI; 
            moving = true; 
        }
        if (keys.a) { 
            heroGroup.position.x -= CONFIG.moveSpeed; 
            heroGroup.rotation.y = Math.PI / 2; 
            moving = true; 
        }
        if (keys.d) { 
            heroGroup.position.x += CONFIG.moveSpeed; 
            heroGroup.rotation.y = -Math.PI / 2; 
            moving = true; 
        }

        heroGroup.position.y = moving ? Math.abs(Math.sin(time * 8)) * 0.15 : 0;

        if (moving && Math.random() < CONFIG.encounterRate) battle.start();

        // Camera follow with mouse-controlled orbit
        const offsetX = Math.cos(cameraAngle) * CAMERA_DISTANCE;
        const offsetZ = Math.sin(cameraAngle) * CAMERA_DISTANCE;
        const targetPos = new THREE.Vector3(
            heroGroup.position.x - offsetX,
            heroGroup.position.y + CAMERA_HEIGHT + cameraPitch * 6,
            heroGroup.position.z - offsetZ
        );

        camera.position.lerp(targetPos, 0.08);
        camera.lookAt(heroGroup.position);
    } 
    else if (STATE.mode === 'BATTLE' || STATE.mode === 'BATTLE_START' || STATE.mode === 'TIMING') {
        // Cinematic battle camera: slightly orbit around the midpoint between hero and enemy
        const mid = new THREE.Vector3().addVectors(heroGroup.position, enemyGroup.position).multiplyScalar(0.5);
        const battleRadius = 10;
        const angle = time * 0.3;
        const targetCamPos = new THREE.Vector3(
            mid.x + Math.cos(angle) * battleRadius,
            5 + Math.sin(time * 0.5) * 0.5,
            mid.z + Math.sin(angle) * battleRadius
        );
        camera.position.lerp(targetCamPos, 0.08);
        camera.lookAt(mid);

        if (enemyGroup.visible) {
            enemyGroup.rotation.y = time * 0.5;
            enemyGroup.rotation.x = Math.sin(time) * 0.1;
            enemyGroup.position.y = 1 + Math.sin(time * 2) * 0.2;
        }
    }

    // Update particles
    const dt = clock.getDelta();
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        const positions = p.positions;
        for (let j = 0; j < p.velocities.length; j++) {
            const vel = p.velocities[j];
            const idx = j * 3;
            positions[idx] += vel.x * dt;
            positions[idx + 1] += vel.y * dt;
            positions[idx + 2] += vel.z * dt;
            vel.y -= 3.0 * dt; // gravity
        }
        p.points.geometry.attributes.position.needsUpdate = true;
        const remaining = Math.max(0, 1 - p.age / p.life);
        p.points.material.opacity = remaining;
        if (p.age >= p.life) {
            scene.remove(p.points);
            p.points.geometry.dispose();
            p.points.material.dispose();
            particles.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialize sample-based music system (starts TITLE theme after first interaction)
if (SampleMusic && typeof SampleMusic.init === 'function') {
    SampleMusic.init();
}

animate();
