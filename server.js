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
const ROUND_COUNTDOWN_SECONDS = 5;    // Segundos de cuenta regresiva al inicio de cada ronda

let players = [];                     // Lista de todos los jugadores conectados
let nextPlayerId = 1;                 // Para asignar IDs únicos a nuevos jugadores
let gameStarted = false;              // Indica si el juego está en curso
let roundActive = false;              // Indica si una ronda de "mantener el botón" está activa
let holdingPlayers = new Set();       // IDs de los jugadores que están actualmente apretando el botón
let timeInterval = null;              // Intervalo para el temporizador de la ronda (consumo de tiempo)
let countdownInterval = null;         // Intervalo para la cuenta regresiva de inicio de ronda

// --- Manejo de Conexiones WebSocket ---
wss.on('connection', ws => {
    // Asigna un ID al nuevo jugador y lo añade a la lista
    const playerId = nextPlayerId++;
    players.push({
        id: playerId,
        ws: ws, // Referencia al objeto WebSocket del cliente
        name: `Jugador ${playerId}`, // Nombre por defecto inicial
        timeRemaining: INITIAL_TIME_MS, // Tiempo inicial para este jugador
        holding: false,                 // Estado de si está apretando el botón en la ronda actual
        eliminated: false,              // Estado de si ha sido eliminado del juego
        blockedInRound: false           // Nuevo: true si el jugador fue bloqueado en la ronda actual por no apretar a tiempo
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

        // Permitir 'setPlayerName' incluso si el juego no ha iniciado o si el jugador está eliminado/bloqueado
        if (data.type === 'setPlayerName' && player) {
            player.name = data.name.substring(0, 20); // Limitar la longitud del nombre para evitar abusos
            console.log(`Jugador ${player.id} ahora se llama: ${player.name}`);
            broadcastPlayerStatus(); // Notificar a todos sobre el cambio de nombre
            return; // No procesar otros mensajes si es solo para establecer el nombre
        }

        // Ignora otros mensajes si el jugador no existe, está eliminado o está bloqueado en esta ronda.
        // También ignora si el juego no ha iniciado (excepto para 'setPlayerName').
        if (!player || player.eliminated || !gameStarted || player.blockedInRound) return;

        switch (data.type) {
            case 'hold':
                // Si una ronda aún no está activa (ej. al inicio del juego o después de una ronda),
                // iniciamos la cuenta regresiva que precede a la ronda de consumo de tiempo.
                if (!roundActive && !countdownInterval) { // Evita iniciar múltiples cuentas regresivas
                    startCountdownAndRound();
                }
                // Si la ronda (o cuenta regresiva) está activa y el jugador no está bloqueado ni ya apretando
                if (!player.holding && !player.blockedInRound) {
                    player.holding = true;
                    holdingPlayers.add(player.id); // Añade el jugador al set de los que están apretando
                    broadcastPlayerStatus();       // Notifica a todos sobre el cambio de estado
                }
                break;
            case 'release':
                if (player.holding) { // Solo si estaba apretando
                    player.holding = false;
                    holdingPlayers.delete(player.id); // Elimina el jugador del set de los que están apretando
                    broadcastPlayerStatus();           // Notifica a todos sobre el cambio de estado

                    // Si solo queda un jugador apretando, esa es la ronda ganadora
                    if (holdingPlayers.size === 1) {
                        endRound(Array.from(holdingPlayers)[0]);
                    } else if (holdingPlayers.size === 0 && roundActive) {
                        // Si todos sueltan y la ronda estaba activa, se detiene el temporizador.
                        console.log('Todos soltaron. Ronda sin ganador.');
                        roundActive = false;
                        clearInterval(timeInterval); // Detiene el consumo de tiempo
                        setTimeout(() => checkGameOver(), 2000); // Continúa el flujo del juego
                    }
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
        const disconnectedPlayer = players.find(p => p.id === playerId);
        console.log(`Jugador ${playerId} (${disconnectedPlayer?.name || 'Desconocido'}) desconectado.`);
        
        // Remueve al jugador de la lista
        players = players.filter(p => p.ws !== ws);
        holdingPlayers.delete(playerId); // Asegura que no siga en la lista de los que aprietan

        broadcastPlayerStatus(); // Actualiza el estado para todos
        broadcast({ type: 'playerLeft', playerId: playerId, playerName: disconnectedPlayer?.name, players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated, blockedInRound: p.blockedInRound })) });

        // Si el juego está activo y solo queda un jugador, ese jugador gana el juego
        const activePlayers = players.filter(p => !p.eliminated);
        if (gameStarted && activePlayers.length === 1) {
            endGame(activePlayers[0].id);
        } else if (players.length < MIN_PLAYERS_TO_START && gameStarted) {
            // Si el número de jugadores cae por debajo del mínimo y el juego ya había iniciado, se reinicia.
            console.log('No hay suficientes jugadores. Juego reiniciado.');
            resetGame();
            broadcast({ type: 'gameReset', message: 'No hay suficientes jugadores. Juego reiniciado.' });
        }
    });

    // --- Manejo de Errores ---
    ws.on('error', error => {
        console.error(`Error del WebSocket del Jugador ${playerId} (${players.find(p => p.id === playerId)?.name || 'Desconocido'}):`, error);
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
        name: p.name, // Incluir el nombre del jugador
        holding: p.holding,
        eliminated: p.eliminated,
        blockedInRound: p.blockedInRound // Incluir el estado de bloqueo
        // No se envía el tiempo restante a todos, solo al que aprieta para mantener la "incertidumbre"
    }));
    broadcast({ type: 'playerStatusUpdate', players: status });
}

// Inicia el juego principal
function startGame() {
    if (gameStarted) return; // Si ya empezó, no hacer nada
    gameStarted = true;
    console.log('Juego iniciado.');
    broadcast({ type: 'gameStart', players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated, blockedInRound: p.blockedInRound })) });
    startCountdownAndRound(); // Inicia la primera ronda con cuenta regresiva
}

// Inicia una nueva ronda de "mantener el botón" con una cuenta regresiva
function startCountdownAndRound() {
    if (roundActive || countdownInterval) return; // Si ya hay una ronda activa o un countdown, no hacer nada

    // Resetea el estado para la nueva ronda
    players.forEach(p => {
        if (!p.eliminated) { // Solo resetea si no está eliminado
            p.holding = false;
            p.blockedInRound = false; // Desbloquea a los jugadores para la nueva ronda
        }
    });
    holdingPlayers.clear(); // Limpia la lista de jugadores apretando
    broadcastPlayerStatus(); // Actualiza el estado visual de los jugadores

    let countdown = ROUND_COUNTDOWN_SECONDS;
    broadcast({ type: 'countdown', countdown: countdown }); // Envía el inicio del contador

    countdownInterval = setInterval(() => {
        countdown--;
        if (countdown >= 0) {
            broadcast({ type: 'countdown', countdown: countdown }); // Envía el progreso del contador
        }

        if (countdown === 0) {
            clearInterval(countdownInterval);
            countdownInterval = null; // Limpia el intervalo del contador

            // Después de la cuenta regresiva, bloquea a los jugadores que no apretaron el botón
            players.forEach(p => {
                if (!p.holding && !p.eliminated && !p.blockedInRound) { // Si no está apretando, no está eliminado y no está ya bloqueado
                    p.blockedInRound = true;
                    // Envía un mensaje individual al jugador bloqueado para que desactive su botón
                    p.ws.send(JSON.stringify({ type: 'blockPlayer', playerIdToBlock: p.id }));
                }
            });
            broadcastPlayerStatus(); // Actualiza el estado con los jugadores bloqueados

            // Ahora sí, inicia la ronda de consumo de tiempo solo para los jugadores no eliminados y no bloqueados
            startRound();
        }
    }, 1000); // Se ejecuta cada segundo
}

// Inicia la ronda de consumo de tiempo
function startRound() {
    if (roundActive) return; // Si ya hay una ronda activa, no hacer nada

    roundActive = true;
    console.log('Ronda iniciada (consumo de tiempo).');
    broadcast({ type: 'roundStart', players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated, blockedInRound: p.blockedInRound })) });

    clearInterval(timeInterval); // Limpia cualquier temporizador anterior de consumo de tiempo
    // Inicia el temporizador que consume tiempo de los jugadores que aprietan
    timeInterval = setInterval(() => {
        let activePlayers = players.filter(p => p.holding && !p.eliminated && !p.blockedInRound); // Solo los que aprietan, no eliminados y no bloqueados

        // Si solo queda un jugador apretando y no bloqueado, esa persona gana la ronda
        if (activePlayers.length === 1) {
            endRound(activePlayers[0].id);
            return;
        } else if (activePlayers.length === 0 && roundActive) {
            // Si nadie está apretando (o todos los que apretaron se han eliminado/bloqueado)
            clearInterval(timeInterval);
            roundActive = false;
            console.log('Todos soltaron/bloqueados en la ronda, deteniendo timer.');
            broadcast({ type: 'roundEndedNoWinner', message: 'Nadie mantuvo el botón en esta ronda.' }); // Mensaje si nadie gana la ronda
            setTimeout(() => checkGameOver(), 2000); // Continúa el juego después de un momento
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
                console.log(`Jugador ${player.id} (${player.name}) eliminado por tiempo.`);
                // Envía un mensaje individual al jugador eliminado
                player.ws.send(JSON.stringify({ type: 'playerEliminated', eliminatedPlayerId: player.id, players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated })) }));
            }
            // Envía la actualización de tiempo solo al jugador que está apretando
            if (player.holding && !player.eliminated && !player.blockedInRound) {
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
    clearInterval(countdownInterval); // Asegurarse de limpiar el contador si aún estuviera activo
    countdownInterval = null;

    const winner = players.find(p => p.id === winnerId);
    console.log(`Ronda terminada. Ganador: Jugador ${winnerId} (${winner?.name || 'Desconocido'})`);
    broadcast({ type: 'roundWinner', winnerId: winnerId, winnerName: winner?.name, players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated, blockedInRound: p.blockedInRound })) });

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
        clearInterval(countdownInterval);
        countdownInterval = null;
    } else {
        // Si hay más de un jugador activo, se inicia una nueva ronda con su cuenta regresiva.
        startCountdownAndRound();
    }
}

// Finaliza el juego y declara al campeón
function endGame(winnerId) {
    gameStarted = false;
    clearInterval(timeInterval); // Detiene cualquier temporizador activo
    clearInterval(countdownInterval); // Detiene cualquier countdown activo
    countdownInterval = null;

    const winner = players.find(p => p.id === winnerId);
    console.log(`¡Juego Terminado! El Jugador ${winnerId} (${winner?.name || 'Desconocido'}) es el campeón.`);
    broadcast({ type: 'gameOver', winnerId: winnerId, winnerName: winner?.name, players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated })) });
}

// Reinicia el juego a su estado inicial
function resetGame() {
    console.log('Reiniciando juego...');
    gameStarted = false;
    roundActive = false;
    clearInterval(timeInterval);
    clearInterval(countdownInterval);
    countdownInterval = null;
    players = [];          // Vacía la lista de jugadores
    nextPlayerId = 1;      // Resetea el contador de IDs
    holdingPlayers.clear(); // Limpia el set de jugadores apretando
    broadcast({ type: 'gameReset' }); // Notifica a todos los clientes del reinicio
}