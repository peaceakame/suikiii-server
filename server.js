// Suikiii Game - Node.js Server with Matter.js Physics

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Matter = require('matter-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Game Constants
const BOARD_WIDTH = 800;
const BOARD_HEIGHT = 1000;
const GAME_OVER_LINE = 100;
const GRAVITY = 0.28;
const BORDER_WIDTH = 4;
const MAX_LEVEL = 10;
const COMBO_WINDOW = 2000;

// Fruit Configuration (must match client)
const FRUITS = [
    { name: 'Grape', level: 1, color: '#9333ea', image: 'https://cloudy.im/kiiihub/game/assets/suikiii-jiyu-circle-grape.png', baseSize: 26, sizeIncrement: 14.3, collisionScale: 1.0 },
    { name: 'Strawberry', level: 2, color: '#FF1493', image: 'https://cloudy.im/kiiihub/game/assets/suikiii-leesol-circledown.png', baseSize: 26, sizeIncrement: 14.3, collisionScale: 1.0 },
    { name: 'Lemon', level: 3, color: '#FFF44F', image: 'https://cloudy.im/kiiihub/game/assets/suikiii-sui-circleup-lemon.png', baseSize: 26, sizeIncrement: 14.3, collisionScale: 0.95 },
    { name: 'Orange', level: 4, color: '#FF8C00', image: 'https://cloudy.im/kiiihub/game/assets/suikiii-haum-circle-orangemediu.png', baseSize: 23.4, sizeIncrement: 14.3, collisionScale: 1.0 },
    { name: 'Apple', level: 5, color: '#FF4444', image: 'https://cloudy.im/kiiihub/game/assets/suikiii-jiyu-circlemedi.png', baseSize: 26, sizeIncrement: 14.3, collisionScale: 0.85 },
    { name: 'Peach', level: 6, color: '#FFB6C1', image: 'https://cloudy.im/kiiihub/game/assets/suikiii-kya-circleup.png', baseSize: 26, sizeIncrement: 14.3, collisionScale: 0.80 },
    { name: 'Coconut', level: 7, color: '#8B4513', image: 'https://cloudy.im/kiiihub/game/assets/suikiii-kya-circle-coconut.png', baseSize: 26, sizeIncrement: 14.3, collisionScale: 1.0 },
    { name: 'Melon', level: 8, color: '#90EE90', image: 'https://cloudy.im/kiiihub/game/assets/suikiii-leesol-circle-melonbig.png', baseSize: 33.8, sizeIncrement: 14.3, collisionScale: 0.95 },
    { name: 'Pineapple', level: 9, color: '#FFD700', image: 'https://cloudy.im/kiiihub/game/assets/suikiii-haum-circle.png', baseSize: 26, sizeIncrement: 14.3, collisionScale: 1.0 },
    { name: 'Watermelon', level: 10, color: '#32CD32', image: 'https://cloudy.im/kiiihub/game/assets/suikiii-sui-circle.png', baseSize: 26, sizeIncrement: 14.3, collisionScale: 1.0 }
];

// Game State
let gameState = {
    blocks: [],
    score: 0,
    highScore: 0,
    gameOver: false,
    totalBlocks: 0,
    maxCombo: 0,
    combo: 0,
    lastMergeTime: 0,
    nextFruit: null // What fruit will be dropped next
};

let engine;
let world;
let bodiesMap = new Map(); // Maps block uid to Matter.js body
let processedMerges = new Set();
let gameOverTimer = null;
let lastMergeTime = 0;
let comboCount = 0;
let firstClientId = null; // Track first connected client for history saving
let lastBroadcastState = null; // Track last broadcast state for delta updates

// Helper Functions
function getRadius(fruit) {
    const baseSize = fruit.baseSize || 20;
    const sizeIncrement = fruit.sizeIncrement || 11;
    const collisionScale = fruit.collisionScale || 1.0;
    return (baseSize + (fruit.level * sizeIncrement)) * collisionScale;
}

function getRandomBlock() {
    const rand = Math.random();
    const level = rand < 0.35 ? 1 : 
                 (rand < 0.60 ? 2 : 
                 (rand < 0.80 ? 3 : 
                 (rand < 0.95 ? 4 : 5)));
    const fruit = FRUITS.find(f => f.level === level);
    return { ...fruit, level };
}

// Initialize Matter.js Physics
function initPhysics() {
    engine = Matter.Engine.create({
        gravity: { x: 0, y: 1.0 }, // Increased from 0.28 for faster, less floaty feel
        enableSleeping: false, // Disable sleeping to prevent floating fruits
        positionIterations: 10,
        velocityIterations: 10
    });
    
    world = engine.world;
    
    // Create walls
    const wallOptions = { 
        isStatic: true, 
        friction: 0.3, // Lower friction for walls (less sticky)
        restitution: 0.1, // Less bouncy
        label: 'wall'
    };
    const wallThickness = BORDER_WIDTH * 2;
    
    const ground = Matter.Bodies.rectangle(
        BOARD_WIDTH / 2, 
        BOARD_HEIGHT + wallThickness / 2, 
        BOARD_WIDTH, 
        wallThickness, 
        wallOptions
    );
    
    const leftWall = Matter.Bodies.rectangle(
        -wallThickness / 2, 
        BOARD_HEIGHT / 2, 
        wallThickness, 
        BOARD_HEIGHT, 
        wallOptions
    );
    
    const rightWall = Matter.Bodies.rectangle(
        BOARD_WIDTH + wallThickness / 2, 
        BOARD_HEIGHT / 2, 
        wallThickness, 
        BOARD_HEIGHT, 
        wallOptions
    );
    
    Matter.World.add(world, [ground, leftWall, rightWall]);
    
    console.log('✅ Physics engine initialized');
}

// Drop Fruit
function dropFruit(x, playerId) {
    // Use the pre-determined nextFruit (so client preview matches)
    // If none exists, generate one (first drop)
    const nextBlock = gameState.nextFruit || getRandomBlock();
    const radius = getRadius(nextBlock);
    
    const newBlock = {
        uid: `${Date.now()}-${Math.random()}`,
        x: Math.max(radius + BORDER_WIDTH, Math.min(BOARD_WIDTH - radius - BORDER_WIDTH, x)),
        y: radius + BORDER_WIDTH + 20,
        vx: 0,
        vy: 0,
        radius,
        rotation: 0,
        angularVelocity: 0,
        name: nextBlock.name,
        color: nextBlock.color,
        image: nextBlock.image,
        level: nextBlock.level,
        baseSize: nextBlock.baseSize,
        sizeIncrement: nextBlock.sizeIncrement,
        collisionScale: nextBlock.collisionScale,
        droppedBy: playerId,
        createdAt: Date.now()
    };
    
    // Prepare the NEXT fruit for preview
    gameState.nextFruit = getRandomBlock();
    
    // Create Matter.js body
    const body = Matter.Bodies.circle(newBlock.x, newBlock.y, newBlock.radius, {
        restitution: 0.15, // Less bouncy
        friction: 0.3, // Lower friction (less sticky)
        frictionAir: 0.005, // Lower air resistance (less slowmo)
        density: 0.002, // Slightly denser (heavier feel)
        label: `fruit-${newBlock.level}`
    });
    
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
    Matter.World.add(world, body);
    bodiesMap.set(newBlock.uid, body);
    
    gameState.blocks.push(newBlock);
    gameState.totalBlocks++;
    
    console.log(`🍎 Fruit dropped by ${playerId}: ${newBlock.name} at x=${x}`);
    
    return newBlock;
}

// Check for Merges
function checkForMerges() {
    const toRemove = new Set();
    const toAdd = [];
    
    for (let i = 0; i < gameState.blocks.length; i++) {
        if (toRemove.has(i)) continue;
        
        for (let j = i + 1; j < gameState.blocks.length; j++) {
            if (toRemove.has(j)) continue;
            
            const b1 = gameState.blocks[i];
            const b2 = gameState.blocks[j];
            
            if (b1.level === b2.level && b1.level < MAX_LEVEL) {
                const dx = b1.x - b2.x;
                const dy = b1.y - b2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const touchDist = b1.radius + b2.radius;
                
                if (dist < touchDist * 1.05) { // Reduced from 1.15 - require closer contact
                    const mergeKey = `${b1.uid}-${b2.uid}`;
                    if (processedMerges.has(mergeKey)) continue;
                    
                    processedMerges.add(mergeKey);
                    
                    const newLevel = b1.level + 1;
                    const newFruit = FRUITS.find(f => f.level === newLevel);
                    const newRadius = getRadius(newFruit);
                    const mergeX = (b1.x + b2.x) / 2;
                    const mergeY = (b1.y + b2.y) / 2;
                    
                    // Points calculation
                    const basePoints = Math.pow(2, newLevel) * 10;
                    const now = Date.now();
                    const timeSinceLastMerge = now - lastMergeTime;
                    lastMergeTime = now;
                    
                    let points = basePoints;
                    if (timeSinceLastMerge < COMBO_WINDOW && comboCount > 0) {
                        comboCount++;
                        gameState.combo = comboCount;
                        points = Math.floor(basePoints * (1 + comboCount * 0.1));
                    } else {
                        comboCount = 1;
                        gameState.combo = 1;
                    }
                    
                    gameState.score += points;
                    if (gameState.score > gameState.highScore) {
                        gameState.highScore = gameState.score;
                    }
                    if (comboCount > gameState.maxCombo) {
                        gameState.maxCombo = comboCount;
                    }
                    
                    // Create merged fruit
                    const mergedBlock = {
                        uid: `${Date.now()}-${Math.random()}`,
                        x: mergeX,
                        y: mergeY,
                        vx: (b1.vx + b2.vx) / 2,
                        vy: -3,
                        radius: newRadius,
                        rotation: 0,
                        angularVelocity: 0,
                        name: newFruit.name,
                        color: newFruit.color,
                        image: newFruit.image,
                        level: newLevel,
                        baseSize: newFruit.baseSize,
                        sizeIncrement: newFruit.sizeIncrement,
                        collisionScale: newFruit.collisionScale,
                        createdAt: Date.now()
                    };
                    
                    toAdd.push(mergedBlock);
                    toRemove.add(i);
                    toRemove.add(j);
                    
                    console.log(`✨ Merge: ${b1.name} + ${b2.name} → ${mergedBlock.name} (+${points} pts, combo ${comboCount}x)`);
                    
                    // Emit merge event
                    io.emit('merge', {
                        x: mergeX,
                        y: mergeY,
                        color: b1.color,
                        points,
                        combo: comboCount,
                        newFruit: mergedBlock.name
                    });
                    
                    break;
                }
            }
        }
    }
    
    if (toRemove.size > 0) {
        // Remove old bodies
        gameState.blocks.filter((_, idx) => toRemove.has(idx)).forEach(block => {
            const body = bodiesMap.get(block.uid);
            if (body) {
                Matter.World.remove(world, body);
                bodiesMap.delete(block.uid);
            }
        });
        
        // Clean up processed merges
        const removedUids = gameState.blocks.filter((_, idx) => toRemove.has(idx)).map(b => b.uid);
        const newMerges = new Set();
        processedMerges.forEach(key => {
            const uids = key.split('-');
            if (!removedUids.includes(uids[0]) && !removedUids.includes(uids[1])) {
                newMerges.add(key);
            }
        });
        processedMerges = newMerges;
        
        // Update blocks array
        const remaining = gameState.blocks.filter((_, idx) => !toRemove.has(idx));
        gameState.blocks = remaining;
        
        // Create bodies for new merged fruits
        toAdd.forEach(newBlock => {
            const body = Matter.Bodies.circle(newBlock.x, newBlock.y, newBlock.radius, {
                restitution: 0.15,
                friction: 0.3,
                frictionAir: 0.005,
                density: 0.002,
                label: `fruit-${newBlock.level}`
            });
            
            Matter.Body.setVelocity(body, { x: newBlock.vx, y: newBlock.vy });
            Matter.World.add(world, body);
            bodiesMap.set(newBlock.uid, body);
            
            gameState.blocks.push(newBlock);
        });
    }
}

// Check Game Over
function checkGameOver() {
    // Only check blocks that have settled (low velocity)
    // This prevents false game over from temporary merges or drops
    const settledDangerBlocks = gameState.blocks.filter(b => {
        const body = bodiesMap.get(b.uid);
        if (!body) return false;
        
        // Check if block is above danger line
        const isAboveLine = b.y - b.radius < GAME_OVER_LINE;
        
        // Check if block has settled (low velocity and not sleeping)
        const velocity = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        const isSettled = velocity < 0.3 && !body.isSleeping;
        
        return isAboveLine && isSettled;
    });
    
    if (settledDangerBlocks.length > 0 && !gameState.gameOver) {
        if (!gameOverTimer) {
            console.log(`⚠️ Danger: ${settledDangerBlocks.length} settled blocks above line`);
            gameOverTimer = setTimeout(() => {
                gameState.gameOver = true;
                console.log('💀 Game Over! Final Score:', gameState.score);
                io.emit('gameOver', {
                    score: gameState.score,
                    highScore: gameState.highScore,
                    maxCombo: gameState.maxCombo,
                    shouldSaveHistory: false // No client should save (server will tell first client separately)
                });
                
                // Tell only the first connected client to save history
                if (firstClientId) {
                    io.to(firstClientId).emit('saveHistory', {
                        score: gameState.score,
                        highScore: gameState.highScore,
                        maxCombo: gameState.maxCombo
                    });
                }
            }, 3000); // 3 second grace period
        }
    } else {
        if (gameOverTimer) {
            clearTimeout(gameOverTimer);
            gameOverTimer = null;
        }
    }
}

// Physics Loop (60 FPS)
function startPhysicsLoop() {
    setInterval(() => {
        if (gameState.gameOver) return;
        
        // Update Matter.js engine
        Matter.Engine.update(engine, 1000 / 60);
        
        // Sync Matter.js bodies with game state
        gameState.blocks = gameState.blocks.map(block => {
            const body = bodiesMap.get(block.uid);
            if (body) {
                return {
                    ...block,
                    x: body.position.x,
                    y: body.position.y,
                    vx: body.velocity.x,
                    vy: body.velocity.y,
                    rotation: body.angle,
                    angularVelocity: body.angularVelocity
                };
            }
            return block;
        });
        
        checkForMerges();
        checkGameOver();
    }, 1000 / 60);
}

// Broadcast Loop - OPTIMIZED to 20 FPS (still smooth, 66% less bandwidth)
function startBroadcastLoop() {
    setInterval(() => {
        // Skip broadcast if game state hasn't changed significantly
        const currentStateHash = `${gameState.blocks.length}-${gameState.score}-${gameState.gameOver}`;
        const blocksMoving = gameState.blocks.some(b => {
            const body = bodiesMap.get(b.uid);
            if (!body) return false;
            const velocity = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
            return velocity > 0.1; // Only broadcast if blocks are moving
        });
        
        // Only broadcast if: blocks are moving, score changed, or game over state changed
        if (!blocksMoving && lastBroadcastState === currentStateHash && gameState.blocks.length > 0) {
            return; // Skip this broadcast - nothing changed!
        }
        
        lastBroadcastState = currentStateHash;
        
        // Optimize for mobile: send only essential rendering data
        const optimizedBlocks = gameState.blocks.map(b => ({
            uid: b.uid,
            x: Math.round(b.x * 10) / 10, // Round to 1 decimal to reduce data
            y: Math.round(b.y * 10) / 10,
            radius: b.radius,
            rotation: Math.round((b.rotation || 0) * 100) / 100,
            image: b.image,
            name: b.name,
            level: b.level
        }));
        
        io.emit('gameState', {
            blocks: optimizedBlocks,
            score: gameState.score,
            highScore: gameState.highScore,
            gameOver: gameState.gameOver,
            totalBlocks: gameState.totalBlocks,
            maxCombo: gameState.maxCombo,
            combo: gameState.combo,
            nextFruit: gameState.nextFruit
        });
    }, 50); // 20 FPS (was 1000/60 = ~17ms, now 50ms) - Still smooth, 66% less data!
}

// Reset Combo
setInterval(() => {
    const now = Date.now();
    if (now - lastMergeTime > COMBO_WINDOW && comboCount > 0) {
        comboCount = 0;
        gameState.combo = 0;
    }
}, 100);

// WebSocket Events
io.on('connection', (socket) => {
    console.log('👤 Player connected:', socket.id);
    
    // Track first client for history saving
    if (!firstClientId) {
        firstClientId = socket.id;
        console.log('📸 First client designated for history saving:', socket.id);
    }
    
    // Send current game state to new player
    // Initialize nextFruit if not set
    if (!gameState.nextFruit) {
        gameState.nextFruit = getRandomBlock();
    }
    
    socket.emit('gameState', {
        blocks: gameState.blocks,
        score: gameState.score,
        highScore: gameState.highScore,
        gameOver: gameState.gameOver,
        totalBlocks: gameState.totalBlocks,
        maxCombo: gameState.maxCombo,
        combo: gameState.combo,
        nextFruit: gameState.nextFruit
    });
    
    // Handle fruit drop
    socket.on('dropFruit', (data) => {
        if (gameState.gameOver) {
            socket.emit('error', { message: 'Game is over' });
            return;
        }
        
        const { x } = data;
        dropFruit(x, socket.id);
        
        // Immediately broadcast new state so fruit appears instantly
        io.emit('gameState', {
            blocks: gameState.blocks,
            score: gameState.score,
            highScore: gameState.highScore,
            gameOver: gameState.gameOver,
            totalBlocks: gameState.totalBlocks,
            maxCombo: gameState.maxCombo,
            combo: gameState.combo,
            nextFruit: gameState.nextFruit
        });
    });
    
    // Handle restart
    socket.on('restart', () => {
        console.log('🔄 Game restarting...');
        
        // Clear all bodies
        bodiesMap.forEach((body) => {
            Matter.World.remove(world, body);
        });
        bodiesMap.clear();
        
        // Reset game state
        gameState = {
            blocks: [],
            score: 0,
            highScore: gameState.highScore, // Keep high score
            gameOver: false,
            totalBlocks: 0,
            maxCombo: 0,
            combo: 0
        };
        
        processedMerges.clear();
        comboCount = 0;
        lastMergeTime = 0;
        
        if (gameOverTimer) {
            clearTimeout(gameOverTimer);
            gameOverTimer = null;
        }
        
        io.emit('gameState', gameState);
        console.log('✅ Game restarted');
    });
    
    socket.on('disconnect', () => {
        console.log('👋 Player disconnected:', socket.id);
        
        // If first client disconnects, clear it (will be reassigned to next connecting client)
        if (socket.id === firstClientId) {
            firstClientId = null;
            console.log('📸 First client disconnected, will reassign on next connection');
        }
    });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        players: io.engine.clientsCount,
        blocks: gameState.blocks.length,
        score: gameState.score,
        gameOver: gameState.gameOver
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`🚀 Suikiii Server running on port ${PORT}`);
    initPhysics();
    startPhysicsLoop();
    startBroadcastLoop();
    console.log('✅ Server ready for connections!');
});
