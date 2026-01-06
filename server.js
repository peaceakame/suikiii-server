// Suikiii Game - Node.js Server with Matter.js
// OPTIMIZED VERSION

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
    nextFruit: null,
    contributors: {}
};

let engine;
let world;
let bodiesMap = new Map();
let processedMerges = new Set();
let gameOverTimer = null;
let lastMergeTime = 0;
let comboCount = 0;
let firstClientId = null;
let lastBroadcastState = null;
let playerQueues = new Map(); // Personal nextFruit per player

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
        gravity: { x: 0, y: 1.0 },
        enableSleeping: false,
        positionIterations: 10,
        velocityIterations: 10
    });
    
    world = engine.world;
    
    const wallOptions = { 
        isStatic: true, 
        friction: 0.5,
        restitution: 0.1,
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
function dropFruit(x, playerId, fruitToDrop) {
    const nextBlock = fruitToDrop || getRandomBlock();
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
    
    const body = Matter.Bodies.circle(newBlock.x, newBlock.y, newBlock.radius, {
        restitution: 0.15,
        friction: newBlock.level <= 3 ? 0.8 : 0.3,
        frictionAir: newBlock.level <= 3 ? 0.02 : 0.005,
        density: 0.002,
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
                
                if (dist < touchDist * 1.05) {
                    const mergeKey = `${b1.uid}-${b2.uid}`;
                    if (processedMerges.has(mergeKey)) continue;
                    
                    processedMerges.add(mergeKey);
                    
                    const newLevel = b1.level + 1;
                    const newFruit = FRUITS.find(f => f.level === newLevel);
                    const newRadius = getRadius(newFruit);
                    const mergeX = (b1.x + b2.x) / 2;
                    const mergeY = (b1.y + b2.y) / 2;
                    
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
        gameState.blocks.filter((_, idx) => toRemove.has(idx)).forEach(block => {
            const body = bodiesMap.get(block.uid);
            if (body) {
                Matter.World.remove(world, body);
                bodiesMap.delete(block.uid);
            }
        });
        
        const removedUids = gameState.blocks.filter((_, idx) => toRemove.has(idx)).map(b => b.uid);
        const newMerges = new Set();
        processedMerges.forEach(key => {
            const uids = key.split('-');
            if (!removedUids.includes(uids[0]) && !removedUids.includes(uids[1])) {
                newMerges.add(key);
            }
        });
        processedMerges = newMerges;
        
        const remaining = gameState.blocks.filter((_, idx) => !toRemove.has(idx));
        gameState.blocks = remaining;
        
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
    const settledDangerBlocks = gameState.blocks.filter(b => {
        const body = bodiesMap.get(b.uid);
        if (!body) return false;
        
        const isAboveLine = b.y - b.radius < GAME_OVER_LINE;
        const velocity = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        // Consider settled if velocity is low OR body is sleeping
        const isSettled = velocity < 0.3 || body.isSleeping;
        
        return isAboveLine && isSettled;
    });
    
    if (settledDangerBlocks.length > 0 && !gameState.gameOver) {
        if (!gameOverTimer) {
            console.log(`⚠️ Danger: ${settledDangerBlocks.length} settled blocks above line`);
            gameOverTimer = setTimeout(() => {
                gameState.gameOver = true;
                console.log('💀 Game Over! Final Score:', gameState.score);
                
                // Get currently connected clients
                const connectedSockets = Array.from(io.sockets.sockets.keys());
                
                if (connectedSockets.length > 0) {
                    io.emit('gameOver', {
                        score: gameState.score,
                        highScore: gameState.highScore,
                        maxCombo: gameState.maxCombo,
                        shouldSaveHistory: false
                    });
                    
                    // Make sure firstClientId is valid, reassign if needed
                    if (!firstClientId || !connectedSockets.includes(firstClientId)) {
                        firstClientId = connectedSockets[0];
                        console.log('📸 Reassigned firstClientId for saveHistory:', firstClientId);
                    }
                    
                    io.to(firstClientId).emit('saveHistory', {
                        score: gameState.score,
                        highScore: gameState.highScore,
                        maxCombo: gameState.maxCombo
                    });
                } else {
                    console.log('⚠️ No clients connected at game over, skipping saveHistory');
                }
            }, 3000);
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
        
        Matter.Engine.update(engine, 1000 / 60);
        
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

// OPTIMIZED Broadcast Loop - 30 FPS for smoother client interpolation
// Includes velocity data for client-side prediction
function startBroadcastLoop() {
    setInterval(() => {
        const currentStateHash = `${gameState.blocks.length}-${gameState.score}-${gameState.gameOver}`;
        const blocksMoving = gameState.blocks.some(b => {
            const body = bodiesMap.get(b.uid);
            if (!body) return false;
            const velocity = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
            return velocity > 0.05; // Lower threshold - broadcast even slow movement
        });
        
        if (!blocksMoving && lastBroadcastState === currentStateHash && gameState.blocks.length > 0) {
            return;
        }
        
        lastBroadcastState = currentStateHash;
        
        // Send position AND velocity for client interpolation/prediction
        const optimizedBlocks = gameState.blocks.map(b => ({
            uid: b.uid,
            x: Math.round(b.x * 10) / 10,
            y: Math.round(b.y * 10) / 10,
            // Include velocity for client-side prediction
            vx: Math.round((b.vx || 0) * 100) / 100,
            vy: Math.round((b.vy || 0) * 100) / 100,
            radius: b.radius,
            rotation: Math.round((b.rotation || 0) * 100) / 100,
            // Include angular velocity for rotation prediction
            av: Math.round((b.angularVelocity || 0) * 100) / 100,
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
            contributors: gameState.contributors,
            // Include server timestamp for latency compensation
            serverTime: Date.now()
        });
    }, 33); // ~30 FPS (33ms) - better balance of smoothness vs bandwidth
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
    
    if (!firstClientId) {
        firstClientId = socket.id;
        console.log('📸 First client designated for history saving:', socket.id);
    }
    
    // Generate personal nextFruit for this player
    playerQueues.set(socket.id, getRandomBlock());
    
    socket.emit('gameState', {
        blocks: gameState.blocks,
        score: gameState.score,
        highScore: gameState.highScore,
        gameOver: gameState.gameOver,
        totalBlocks: gameState.totalBlocks,
        maxCombo: gameState.maxCombo,
        combo: gameState.combo,
        nextFruit: playerQueues.get(socket.id),
        contributors: gameState.contributors,
        serverTime: Date.now()
    });
    
    // If game is already over, send gameOver event so client shows the screen
    if (gameState.gameOver) {
        socket.emit('gameOver', {
            score: gameState.score,
            highScore: gameState.highScore,
            maxCombo: gameState.maxCombo,
            shouldSaveHistory: false
        });
    }
    
    socket.on('dropFruit', (data) => {
        if (gameState.gameOver) {
            socket.emit('error', { message: 'Game is over' });
            return;
        }
        
        const { x, playerName } = data;
        const name = playerName || 'TiiiKiii';
        
        console.log(`👤 Player name received: "${playerName}" -> using: "${name}"`);
        
        // Track contributor
        if (!gameState.contributors[name]) {
            gameState.contributors[name] = 0;
        }
        gameState.contributors[name]++;
        
        console.log('📊 Contributors:', JSON.stringify(gameState.contributors));
        
        // Get this player's fruit from their personal queue
        const playerFruit = playerQueues.get(socket.id) || getRandomBlock();
        
        // Drop the fruit
        dropFruit(x, socket.id, playerFruit);
        
        // Generate new fruit for this player
        playerQueues.set(socket.id, getRandomBlock());
        
        // Broadcast game state to all (without nextFruit - each player has their own)
        io.emit('gameState', {
            blocks: gameState.blocks,
            score: gameState.score,
            highScore: gameState.highScore,
            gameOver: gameState.gameOver,
            totalBlocks: gameState.totalBlocks,
            maxCombo: gameState.maxCombo,
            combo: gameState.combo,
            contributors: gameState.contributors,
            serverTime: Date.now()
        });
        
        // Send personal nextFruit only to this player
        socket.emit('personalNextFruit', { nextFruit: playerQueues.get(socket.id) });
    });
    
    socket.on('restart', () => {
        console.log('🔄 Game restarting...');
        
        bodiesMap.forEach((body) => {
            Matter.World.remove(world, body);
        });
        bodiesMap.clear();
        
        gameState = {
            blocks: [],
            score: 0,
            highScore: gameState.highScore,
            gameOver: false,
            totalBlocks: 0,
            maxCombo: 0,
            combo: 0,
            contributors: {}
        };
        
        processedMerges.clear();
        comboCount = 0;
        lastMergeTime = 0;
        
        if (gameOverTimer) {
            clearTimeout(gameOverTimer);
            gameOverTimer = null;
        }
        
        // Generate new personal fruits for all connected players
        io.sockets.sockets.forEach((s, id) => {
            playerQueues.set(id, getRandomBlock());
            s.emit('personalNextFruit', { nextFruit: playerQueues.get(id) });
        });
        
        io.emit('gameState', {
            ...gameState,
            serverTime: Date.now()
        });
        console.log('✅ Game restarted');
    });
    
    socket.on('disconnect', () => {
        console.log('👋 Player disconnected:', socket.id);
        
        // Clean up player's queue
        playerQueues.delete(socket.id);
        
        if (socket.id === firstClientId) {
            // Reassign to another connected client if available
            const connectedSockets = Array.from(io.sockets.sockets.keys()).filter(id => id !== socket.id);
            if (connectedSockets.length > 0) {
                firstClientId = connectedSockets[0];
                console.log('📸 First client reassigned to:', firstClientId);
            } else {
                firstClientId = null;
                console.log('📸 No clients remaining, firstClientId cleared');
            }
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
