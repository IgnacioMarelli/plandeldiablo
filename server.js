const WebSocket = require('ws');
const express = require('express');
const path = require('path');

const app = express();
// Heroku asigna un puerto a través de process.env.PORT.
// Si no está definido (por ejemplo, al ejecutar en local), usa 8080.
const PORT = process.env.PORT || 8080;

// Sirve los archivos estáticos (HTML, CSS, JS) desde la misma carpeta donde está server.js.
// Esto es útil para pruebas locales y si, en el futuro, decides servir todo desde Heroku.
app.use(express.static(path.join(__dirname)));

// Crea un servidor HTTP con Express.
// Es crucial que el servidor WebSocket se adjunte a este mismo servidor HTTP.
const server = app.listen(PORT, () => {
    console.log(`Servidor HTTP (Backend) escuchando en el puerto ${PORT}`);
    console.log('Si estás en local, abre http://localhost:8080 en tu navegador.');
    console.log('Si estás en Heroku, esta es la URL de tu backend para el WebSocket.');
});

// Crea el servidor WebSocket y lo vincula al servidor HTTP existente.
const wss = new WebSocket.Server({ server });

// --- Variables y Estado del Juego ---
const INITIAL_TIME_MS = 10 * 60 * 1000; // 10 minutos en milisegundos
const MIN_PLAYERS_TO_START = 2;       // Mínimo de jugadores para iniciar el juego

let players = [];                     // Lista de todos los jugadores conectados
let nextPlayerId = 1;                 // Para asignar IDs únicos a nuevos jugadores
let gameStarted = false;              // Indica si el juego está en curso
let roundActive = false;              // Indica si una ronda de "mantener el botón" está activa
let holdingPlayers = new Set();       // IDs de los jugadores que están actualmente apretando el botón
let timeInterval = null;              // Intervalo para el temporizador de la ronda

// --- Manejo de Conexiones WebSocket ---
wss.on('connection', ws => {
    // Asigna un ID al nuevo jugador y lo añade a la lista
    const playerId = nextPlayerId++;
    players.push({
        id: playerId,
        ws: ws, // Referencia al objeto WebSocket del cliente
        timeRemaining: INITIAL_TIME_MS, // Tiempo inicial para este jugador
        holding: false,                 // Estado de si está apretando el botón en la ronda actual
        eliminated: false               // Estado de si ha sido eliminado del juego
    });

    console.log(`Jugador ${playerId} conectado. Total de jugadores: ${players.length}`);

    // Envía el ID al nuevo cliente para que sepa quién es
    ws.send(JSON.stringify({ type: 'playerConnected', playerId: playerId }));
    // Actualiza el estado de los jugadores para todos los clientes
    broadcastPlayerStatus();

    // Si hay suficientes jugadores y el juego no ha empezado, iniciarlo
    if (players.length >= MIN_PLAYERS_TO_START && !gameStarted) {
        startGame();
    }

    // --- Manejo de Mensajes del Cliente ---
    ws.on('message', message => {
        const data = JSON.parse(message);
        const player = players.find(p => p.id === data.playerId);

        // Ignora mensajes si el jugador no existe, está eliminado o el juego no ha iniciado
        if (!player || player.eliminated || !gameStarted) return;

        switch (data.type) {
            case 'hold':
                // Si la ronda no está activa, la inicia
                if (!roundActive) {
                    startRound();
                }
                player.holding = true;
                holdingPlayers.add(player.id); // Añade el jugador al set de los que están apretando
                broadcastPlayerStatus();       // Notifica a todos sobre el cambio de estado
                break;
            case 'release':
                player.holding = false;
                holdingPlayers.delete(player.id); // Elimina el jugador del set de los que están apretando
                broadcastPlayerStatus();           // Notifica a todos sobre el cambio de estado

                // Si solo queda un jugador apretando, esa es la ronda ganadora
                if (holdingPlayers.size === 1) {
                    endRound(Array.from(holdingPlayers)[0]);
                } else if (holdingPlayers.size === 0 && roundActive) {
                    // Si todos sueltan y la ronda estaba activa, se detiene el temporizador.
                    // Nadie gana la ronda en este caso.
                    console.log('Todos soltaron. Ronda sin ganador.');
                    roundActive = false;
                    clearInterval(timeInterval);
                }
                break;
            case 'resetGame':
                // Permite que solo el primer jugador (o el administrador) reinicie el juego
                if (data.playerId === 1) {
                    resetGame();
                }
                break;
        }
    });

    // --- Manejo de Desconexiones ---
    ws.on('close', () => {
        console.log(`Jugador ${playerId} desconectado.`);
        // Remueve al jugador de la lista
        players = players.filter(p => p.ws !== ws);
        holdingPlayers.delete(playerId); // Asegura que no siga en la lista de los que apretan

        broadcastPlayerStatus(); // Actualiza el estado para todos
        broadcast({ type: 'playerLeft', playerId: playerId, players: players.map(p => ({ id: p.id, holding: p.holding, eliminated: p.eliminated })) });

        // Si el juego está activo y solo queda un jugador, ese jugador gana el juego
        const activePlayers = players.filter(p => !p.eliminated);
        if (gameStarted && activePlayers.length === 1) {
            endGame(activePlayers[0].id);
        } else if (players.length < MIN_PLAYERS_TO_START && gameStarted) {
            // Si el número de jugadores cae por debajo del mínimo y el juego ya había iniciado, se reinicia.
            console.log('No hay suficientes jugadores, terminando juego.');
            resetGame();
            broadcast({ type: 'gameReset', message: 'No hay suficientes jugadores. Juego reiniciado.' });
        }
    });

    // --- Manejo de Errores ---
    ws.on('error', error => {
        console.error(`Error del WebSocket del Jugador ${playerId}:`, error);
    });
});

// --- Funciones de Lógica del Juego ---

// Envía un mensaje a todos los clientes conectados
function broadcast(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Envía el estado actual de todos los jugadores a todos los clientes
function broadcastPlayerStatus() {
    const status = players.map(p => ({
        id: p.id,
        holding: p.holding,
        eliminated: p.eliminated,
        // No se envía el tiempo restante a todos, solo al que aprieta para mantener la "incertidumbre"
    }));
    broadcast({ type: 'playerStatusUpdate', players: status });
}

// Inicia el juego principal
function startGame() {
    if (gameStarted) return; // Si ya empezó, no hacer nada
    gameStarted = true;
    console.log('Juego iniciado.');
    broadcast({ type: 'gameStart', players: players.map(p => ({ id: p.id, holding: p.holding, eliminated: p.eliminated })) });
    startRound(); // Inicia la primera ronda
}

// Inicia una nueva ronda de "mantener el botón"
function startRound() {
    if (roundActive) return; // Si ya hay una ronda activa, no hacer nada

    // Resetea el estado de "holding" para todos los jugadores al inicio de la ronda
    players.forEach(p => p.holding = false);
    holdingPlayers.clear(); // Limpia la lista de jugadores apretando
    roundActive = true;
    console.log('Ronda iniciada.');
    broadcast({ type: 'roundStart', players: players.map(p => ({ id: p.id, holding: p.holding, eliminated: p.eliminated })) });

    clearInterval(timeInterval); // Limpia cualquier temporizador anterior
    // Inicia el temporizador que consume tiempo de los jugadores que aprietan
    timeInterval = setInterval(() => {
        let activePlayers = players.filter(p => p.holding && !p.eliminated);

        // Si solo queda un jugador apretando, esa persona gana la ronda
        if (activePlayers.length === 1) {
            endRound(activePlayers[0].id);
            return;
        } else if (activePlayers.length === 0 && roundActive) {
            // Si nadie está apretando y la ronda estaba activa, se detiene el temporizador.
            clearInterval(timeInterval);
            roundActive = false;
            console.log('Todos soltaron en la ronda, deteniendo timer.');
            return;
        }

        // Consume tiempo de los jugadores que están apretando
        activePlayers.forEach(player => {
            player.timeRemaining -= 100; // Resta 100ms cada 100ms
            if (player.timeRemaining <= 0) {
                player.timeRemaining = 0;
                player.eliminated = true; // El jugador se queda sin tiempo, es eliminado
                player.holding = false;
                holdingPlayers.delete(player.id);
                console.log(`Jugador ${player.id} eliminado por tiempo.`);
                // Envía un mensaje individual al jugador eliminado
                player.ws.send(JSON.stringify({ type: 'playerEliminated', eliminatedPlayerId: player.id, players: players.map(p => ({ id: p.id, holding: p.holding, eliminated: p.eliminated })) }));
            }
            // Envía la actualización de tiempo solo al jugador que está apretando
            if (player.holding && !player.eliminated) {
                player.ws.send(JSON.stringify({ type: 'timeUpdate', remainingTime: player.timeRemaining }));
            }
        });

        broadcastPlayerStatus(); // Actualiza el estado visual de los jugadores para todos

        // Después de consumir tiempo y potencialmente eliminar a alguien, verifica si el juego terminó
        checkGameOver();

    }, 100); // Se ejecuta cada 100 milisegundos (10 veces por segundo)
}

// Finaliza una ronda y anuncia al ganador
function endRound(winnerId) {
    if (!roundActive) return; // Si la ronda no está activa, no hacer nada
    roundActive = false;
    clearInterval(timeInterval); // Detiene el temporizador de la ronda
    console.log(`Ronda terminada. Ganador: Jugador ${winnerId}`);
    broadcast({ type: 'roundWinner', winnerId: winnerId, players: players.map(p => ({ id: p.id, holding: p.holding, eliminated: p.eliminated })) });

    holdingPlayers.clear(); // Limpia la lista de jugadores que estaban apretando

    // Espera un momento antes de la siguiente acción (nueva ronda o fin del juego)
    setTimeout(() => {
        checkGameOver();
    }, 2000); // Espera 2 segundos
}

// Verifica si el juego ha terminado (solo queda un jugador activo)
function checkGameOver() {
    const activePlayers = players.filter(p => !p.eliminated);
    if (activePlayers.length === 1) {
        endGame(activePlayers[0].id); // Si solo queda uno, es el campeón
    } else if (activePlayers.length === 0) {
        // Si todos se eliminan, el juego termina sin un único ganador claro.
        console.log('Todos los jugadores han sido eliminados. Juego terminado sin un único ganador.');
        broadcast({ type: 'gameOver', winnerId: 'Nadie', message: 'Todos los jugadores se quedaron sin tiempo.' });
        gameStarted = false;
        clearInterval(timeInterval);
    } else {
        // Si hay más de un jugador activo, se inicia una nueva ronda.
        startRound();
    }
}

// Finaliza el juego y declara al campeón
function endGame(winnerId) {
    gameStarted = false;
    clearInterval(timeInterval); // Detiene cualquier temporizador activo
    console.log(`¡Juego Terminado! El Jugador ${winnerId} es el campeón.`);
    broadcast({ type: 'gameOver', winnerId: winnerId, players: players.map(p => ({ id: p.id, holding: p.holding, eliminated: p.eliminated })) });
}

// Reinicia el juego a su estado inicial
function resetGame() {
    console.log('Reiniciando juego...');
    gameStarted = false;
    roundActive = false;
    clearInterval(timeInterval);
    players = [];          // Vacía la lista de jugadores
    nextPlayerId = 1;      // Resetea el contador de IDs
    holdingPlayers.clear(); // Limpia el set de jugadores apretando
    broadcast({ type: 'gameReset' }); // Notifica a todos los clientes del reinicio
}