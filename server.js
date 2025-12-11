// Suikiii Game - Node.js Server with Matter.js Physics
// Deploy this on Render.com

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
    { name: 'Grape', level: 1, color: '#9333ea', baseSize: 20, sizeIncrement: 11, collisionScale: 1.0 },
    { name: 'Strawberry', level: 2, color: '#FF1493', baseSize: 20, sizeIncrement: 11, collisionScale: 1.0 },
    { name: 'Lemon', level: 3, color: '#FFF44F', baseSize: 20, sizeIncrement: 11, collisionScale: 0.95 },
    { name: 'Orange', level: 4, color: '#FF8C00', baseSize: 18, sizeIncrement: 11, collisionScale: 1.0 },
    { name: 'Apple', level: 5, color: '#FF4444', baseSize: 20, sizeIncrement: 11, collisionScale: 1.0 },
    { name: 'Peach', level: 6, color: '#FFB6C1', baseSize: 20, sizeIncrement: 11, collisionScale: 0.80 },
    { name: 'Coconut', level: 7, color: '#8B4513', baseSize: 20, sizeIncrement: 11, collisionScale: 1.0 },
    { name: 'Melon', level: 8, color: '#90EE90', baseSize: 26, sizeIncrement: 11, collisionScale: 0.95 },
    { name: 'Pineapple', level: 9, color: '#FFD700', baseSize: 20, sizeIncrement: 11, collisionScale: 1.0 },
    { name: 'Watermelon', level: 10, color: '#32CD32', baseSize: 20, sizeIncrement: 11, collisionScale: 1.0 }
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
    lastMergeTime: 0
};

let engine;
let world;
let bodiesMap = new Map(); // Maps block uid to Matter.js body
let processedMerges = new Set();
let gameOverTimer = null;
let lastMergeTime = 0;
let comboCount = 0;

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
        gravity: { x: 0, y: GRAVITY },
        enableSleeping: true,
        positionIterations: 10,
        velocityIterations: 10
    });
    
    engine.world.gravity.scale = 0.001;
    world = engine.world;
    
    // Create walls
    const wallOptions = { 
        isStatic: true, 
        friction: 0.8, 
        restitution: 0.15,
        slop: 0.05,
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
    const nextBlock = getRandomBlock();
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
        level: nextBlock.level,
        baseSize: nextBlock.baseSize,
        sizeIncrement: nextBlock.sizeIncrement,
        collisionScale: nextBlock.collisionScale,
        droppedBy: playerId,
        createdAt: Date.now()
    };
    
    // Create Matter.js body
    const body = Matter.Bodies.circle(newBlock.x, newBlock.y, newBlock.radius, {
        restitution: 0.2,
        friction: 0.5,
        frictionAir: 0.01,
        frictionStatic: 0.8,
        density: 0.001,
        slop: 0.05,
        label: `fruit-${newBlock.level}`
    });
    
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
    Matter.World.add(world, body);
    bodiesMap.set(newBlock.uid, body);
    
    gameState.blocks.push(newBlock);
    gameState.totalBlocks++;
    
    console.log(`🍎 Fruit dropped by ${playerId} at x=${x}`);
    
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
                
                if (dist < touchDist * 1.15) {
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
                restitution: 0.2,
                friction: 0.5,
                frictionAir: 0.01,
                frictionStatic: 0.8,
                density: 0.001,
                slop: 0.05,
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
    const dangerBlocks = gameState.blocks.filter(b => 
        b.y - b.radius < GAME_OVER_LINE
    );
    
    if (dangerBlocks.length > 0 && !gameState.gameOver) {
        if (!gameOverTimer) {
            gameOverTimer = setTimeout(() => {
                gameState.gameOver = true;
                console.log('💀 Game Over! Final Score:', gameState.score);
                io.emit('gameOver', {
                    score: gameState.score,
                    highScore: gameState.highScore,
                    maxCombo: gameState.maxCombo
                });
            }, 2000);
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

// Broadcast Loop (30 FPS to save bandwidth)
function startBroadcastLoop() {
    setInterval(() => {
        io.emit('gameState', {
            blocks: gameState.blocks,
            score: gameState.score,
            highScore: gameState.highScore,
            gameOver: gameState.gameOver,
            totalBlocks: gameState.totalBlocks,
            maxCombo: gameState.maxCombo,
            combo: gameState.combo
        });
    }, 1000 / 30);
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
    
    // Send current game state to new player
    socket.emit('gameState', {
        blocks: gameState.blocks,
        score: gameState.score,
        highScore: gameState.highScore,
        gameOver: gameState.gameOver,
        totalBlocks: gameState.totalBlocks,
        maxCombo: gameState.maxCombo,
        combo: gameState.combo
    });
    
    // Handle fruit drop
    socket.on('dropFruit', (data) => {
        if (gameState.gameOver) {
            socket.emit('error', { message: 'Game is over' });
            return;
        }
        
        const { x } = data;
        dropFruit(x, socket.id);
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
