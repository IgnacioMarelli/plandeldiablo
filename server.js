const WebSocket = require('ws');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Sirve los archivos estáticos desde el directorio raíz del proyecto.
// Esto es útil si tienes tu frontend (index.html, script.js, style.css)
// en la misma carpeta que tu server.js en Heroku.
app.use(express.static(path.join(__dirname)));

const server = app.listen(PORT, () => {
    console.log(`Servidor HTTP (Backend) escuchando en el puerto ${PORT}`);
    console.log('Si estás en local, abre http://localhost:8080 en tu navegador.');
    console.log('Si estás en Heroku, esta es la URL de tu backend para el WebSocket.');
});

const wss = new WebSocket.Server({ server });

// --- Variables y Estado del Juego ---
const INITIAL_TIME_MS = 10 * 60 * 1000; // 10 minutos en milisegundos por jugador.
const MIN_PLAYERS_TO_START = 2;       // Mínimo de jugadores requeridos para iniciar el juego.
const ROUND_COUNTDOWN_SECONDS = 5;    // Segundos de cuenta regresiva antes de cada ronda.

let players = [];                     // Array de objetos de jugador, cada uno con su estado.
let nextPlayerId = 1;                 // Contador para asignar IDs únicos a nuevos jugadores.
let gameStarted = false;              // Booleano que indica si el juego principal está en curso.
let roundActive = false;              // Booleano que indica si una ronda de "mantener el botón" está activa.
let holdingPlayers = new Set();       // Set de IDs de los jugadores que están actualmente apretando el botón.
let timeInterval = null;              // Intervalo para el temporizador principal de la ronda (consumo de tiempo).
let countdownInterval = null;         // Intervalo para la cuenta regresiva de inicio de ronda.


// --- Manejo de Conexiones WebSocket ---
wss.on('connection', ws => {
    const playerId = nextPlayerId++; // Asigna un nuevo ID único.
    players.push({
        id: playerId,
        ws: ws, // Referencia al objeto WebSocket del cliente.
        name: `Jugador ${playerId}`, // Nombre por defecto inicial.
        timeRemaining: INITIAL_TIME_MS, // Tiempo inicial para el jugador.
        holding: false,                 // Si está apretando el botón.
        eliminated: false,              // Si ha sido eliminado del juego.
        blockedInRound: false,          // Si fue bloqueado en la ronda actual por no apretar a tiempo.
        isReady: false                  // Si el jugador ha pulsado "Listo".
    });

    console.log(`Jugador ${playerId} conectado. Total de jugadores: ${players.length}`);

    // Envía el ID del jugador recién conectado al cliente.
    ws.send(JSON.stringify({ type: 'playerConnected', playerId: playerId }));
    // Actualiza el estado de los jugadores para todos los clientes.
    broadcastPlayerStatus();

    // --- Manejo de Mensajes del Cliente ---
    ws.on('message', message => {
        const data = JSON.parse(message); // Parsea el mensaje JSON del cliente.
        const player = players.find(p => p.id === data.playerId); // Encuentra al jugador por su ID.

        if (!player) return; // Si el jugador no existe (por ejemplo, ya se desconectó), ignorar el mensaje.

        switch (data.type) {
            case 'setPlayerName':
                // Actualiza el nombre del jugador, limitándolo a 20 caracteres.
                player.name = data.name.substring(0, 20);
                console.log(`Jugador ${player.id} ahora se llama: ${player.name}`);
                broadcastPlayerStatus(); // Notifica a todos sobre el cambio de nombre.
                break;

            case 'playerReady':
                // Si el juego no ha iniciado y el jugador no estaba ya marcado como listo.
                if (!gameStarted && !player.isReady) {
                    player.isReady = true;
                    console.log(`Jugador ${player.id} (${player.name}) está listo.`);
                    broadcastPlayerStatus(); // Actualiza el estado de todos para mostrar que está listo.
                    checkAllPlayersReady(); // Revisa si todos los jugadores están listos para iniciar el juego.
                }
                break;

            case 'hold':
                // Solo permite la acción si el juego está en curso, el jugador no está eliminado o bloqueado.
                if (player.eliminated || !gameStarted || player.blockedInRound) return;
                // Si la ronda no está activa y no hay un countdown en curso, se inicia el countdown.
                if (!roundActive && !countdownInterval) {
                    startCountdownAndRound();
                }
                // Si el jugador no está apretando y no está bloqueado, lo marca como apretando.
                if (!player.holding && !player.blockedInRound) {
                    player.holding = true;
                    holdingPlayers.add(player.id); // Añade su ID al set de jugadores apretando.
                    broadcastPlayerStatus(); // Actualiza el estado.
                }
                break;

            case 'release':
                // Solo permite la acción si el juego está en curso, el jugador no está eliminado o bloqueado.
                if (player.eliminated || !gameStarted || player.blockedInRound) return;
                // Si el jugador estaba apretando, lo marca como no apretando.
                if (player.holding) {
                    player.holding = false;
                    holdingPlayers.delete(player.id); // Elimina su ID del set de jugadores apretando.
                    broadcastPlayerStatus(); // Actualiza el estado.

                    // Si solo queda un jugador apretando, ese es el ganador de la ronda.
                    if (holdingPlayers.size === 1) {
                        endRound(Array.from(holdingPlayers)[0]);
                    } else if (holdingPlayers.size === 0 && roundActive) {
                        // Si todos sueltan y la ronda estaba activa, la ronda termina sin ganador.
                        console.log('Todos soltaron. Ronda sin ganador.');
                        roundActive = false;
                        clearInterval(timeInterval); // Detiene el consumo de tiempo.
                        setTimeout(() => checkGameOver(), 2000); // Pequeña pausa antes de chequear el fin del juego.
                    }
                }
                break;

            case 'resetGame':
                // Solo el jugador con ID 1 (el primer conectado) puede reiniciar el juego.
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

        // Eliminar al jugador de la lista.
        players = players.filter(p => p.ws !== ws);
        holdingPlayers.delete(playerId); // Asegurarse de que no siga en la lista de los que aprietan.

        broadcastPlayerStatus(); // Actualizar el estado para todos los clientes restantes.

        const activePlayers = players.filter(p => !p.eliminated); // Jugadores que quedan y no están eliminados.
        if (gameStarted && activePlayers.length === 1) {
            // Si el juego estaba en curso y solo queda un jugador, ese jugador gana el juego.
            endGame(activePlayers[0].id);
        } else if (players.length < MIN_PLAYERS_TO_START && gameStarted) {
            // Si el número de jugadores cae por debajo del mínimo y el juego ya había iniciado, se reinicia.
            console.log('No hay suficientes jugadores. Juego reiniciado.');
            resetGame();
            broadcast({ type: 'gameReset', message: 'No hay suficientes jugadores. Juego reiniciado.' });
        } else if (!gameStarted) {
            // Si el juego no ha iniciado, re-evaluar el estado de 'listo' de los jugadores restantes.
            checkAllPlayersReady();
        }
    });

    // --- Manejo de Errores de WebSocket ---
    ws.on('error', error => {
        console.error(`Error del WebSocket del Jugador ${playerId} (${players.find(p => p.id === playerId)?.name || 'Desconocido'}):`, error);
    });
});

// --- Funciones de Lógica del Juego ---

/**
 * Envía un mensaje JSON a todos los clientes WebSocket conectados.
 * @param {object} message - El objeto a enviar como JSON.
 */
function broadcast(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

/**
 * Envía el estado actual de todos los jugadores a todos los clientes.
 * Incluye nombre, si está apretando, si está eliminado, si está bloqueado en ronda y si está listo.
 */
function broadcastPlayerStatus() {
    const status = players.map(p => ({
        id: p.id,
        name: p.name,
        holding: p.holding,
        eliminated: p.eliminated,
        blockedInRound: p.blockedInRound,
        isReady: p.isReady
    }));
    broadcast({ type: 'playerStatusUpdate', players: status });

    // Mensaje adicional para informar sobre el estado de "listo" si el juego no ha iniciado.
    if (!gameStarted) {
        const activePlayers = players.filter(p => !p.eliminated);
        const readyCount = activePlayers.filter(p => p.isReady).length;
        broadcast({
            type: 'waitingForReady',
            readyCount: readyCount,
            totalPlayers: activePlayers.length,
            minPlayers: MIN_PLAYERS_TO_START
        });
    }
}

/**
 * Verifica si todos los jugadores activos (no eliminados) han pulsado "Listo"
 * y si hay suficientes jugadores para iniciar el juego.
 */
function checkAllPlayersReady() {
    const activePlayers = players.filter(p => !p.eliminated); // Considera solo a los jugadores no eliminados.
    // Para iniciar el juego, debe haber al menos MIN_PLAYERS_TO_START jugadores
    // y todos los jugadores activos deben estar marcados como 'isReady'.
    const allReady = activePlayers.length >= MIN_PLAYERS_TO_START && activePlayers.every(p => p.isReady);

    if (allReady && !gameStarted) {
        console.log('¡Todos los jugadores están listos! Iniciando juego...');
        startGame();
    }
}

/**
 * Inicia el juego principal, restableciendo estados y comenzando la primera ronda.
 */
function startGame() {
    if (gameStarted) return; // Evita iniciar el juego si ya está en curso.
    gameStarted = true;
    console.log('Juego iniciado.');
    // Resetear el estado 'isReady' para que no afecte futuras rondas o reinicios manuales.
    players.forEach(p => p.isReady = false);
    broadcast({ type: 'gameStart', players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated, blockedInRound: p.blockedInRound })) });
    startCountdownAndRound(); // Inicia la primera ronda con una cuenta regresiva.
}

/**
 * Inicia la cuenta regresiva antes de que comience una ronda de consumo de tiempo.
 * Esto da tiempo a los jugadores para apretar el botón.
 */
function startCountdownAndRound() {
    if (roundActive || countdownInterval) return; // Evita iniciar si una ronda ya está activa o un countdown en curso.

    // Reiniciar estados de los jugadores para la nueva ronda.
    players.forEach(p => {
        if (!p.eliminated) { // Solo afecta a jugadores no eliminados.
            p.holding = false;
            p.blockedInRound = false; // Quitar el bloqueo de la ronda anterior.
        }
    });
    holdingPlayers.clear(); // Limpiar la lista de jugadores que apretaban.
    broadcastPlayerStatus(); // Enviar el estado actualizado a los clientes.

    let countdown = ROUND_COUNTDOWN_SECONDS;
    broadcast({ type: 'countdown', countdown: countdown }); // Enviar el mensaje de cuenta regresiva inicial.

    countdownInterval = setInterval(() => {
        countdown--;
        if (countdown >= 0) {
            broadcast({ type: 'countdown', countdown: countdown }); // Actualiza el countdown.
        }

        if (countdown === 0) {
            clearInterval(countdownInterval); // Detiene el intervalo del countdown.
            countdownInterval = null; // Limpia la referencia.

            // Bloquear a los jugadores que no apretaron el botón durante la cuenta regresiva.
            players.forEach(p => {
                if (!p.holding && !p.eliminated) {
                    p.blockedInRound = true; // Marcar como bloqueado en esta ronda.
                    p.ws.send(JSON.stringify({ type: 'blockPlayer', playerIdToBlock: p.id })); // Notificar al cliente específico.
                }
            });
            broadcastPlayerStatus(); // Enviar el estado actualizado con los bloqueados.

            startRound(); // Iniciar la ronda de consumo de tiempo.
        }
    }, 1000); // Ejecuta cada segundo.
}

/**
 * Inicia la ronda principal donde los jugadores pierden tiempo por mantener el botón.
 */
function startRound() {
    if (roundActive) return; // Evita iniciar si ya hay una ronda activa.

    roundActive = true;
    console.log('Ronda iniciada (consumo de tiempo).');
    broadcast({ type: 'roundStart', players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated, blockedInRound: p.blockedInRound })) });

    clearInterval(timeInterval); // Asegura que no haya intervalos duplicados.
    timeInterval = setInterval(() => {
        // Filtra solo a los jugadores que están apretando, no eliminados y no bloqueados en esta ronda.
        let activeHoldingPlayers = players.filter(p => p.holding && !p.eliminated && !p.blockedInRound);

        if (activeHoldingPlayers.length === 1) {
            // Si solo queda un jugador apretando, ese es el ganador de la ronda.
            endRound(activeHoldingPlayers[0].id);
            return;
        } else if (activeHoldingPlayers.length === 0 && roundActive) {
            // Si nadie está apretando y la ronda estaba activa, la ronda termina sin ganador.
            clearInterval(timeInterval);
            roundActive = false;
            console.log('Todos soltaron/bloqueados en la ronda, deteniendo timer.');
            broadcast({ type: 'roundEndedNoWinner', message: 'Nadie mantuvo el botón en esta ronda.' });
            setTimeout(() => checkGameOver(), 2000); // Pausa antes de chequear el fin del juego.
            return;
        }

        // Reduce el tiempo de los jugadores que están apretando.
        activeHoldingPlayers.forEach(player => {
            player.timeRemaining -= 100; // Reduce 100ms (0.1 segundos).
            if (player.timeRemaining <= 0) {
                player.timeRemaining = 0;
                player.eliminated = true; // El jugador es eliminado.
                player.holding = false;
                holdingPlayers.delete(player.id); // Quitar de la lista de los que aprietan.
                console.log(`Jugador ${player.id} (${player.name}) eliminado por tiempo.`);
                // Notificar al cliente específico que fue eliminado.
                player.ws.send(JSON.stringify({ type: 'playerEliminated', eliminatedPlayerId: player.id, players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated })) }));
            }
            // Enviar actualización de tiempo solo a los que siguen apretando y no están eliminados/bloqueados.
            if (player.holding && !player.eliminated && !player.blockedInRound) {
                player.ws.send(JSON.stringify({ type: 'timeUpdate', remainingTime: player.timeRemaining }));
            }
        });

        broadcastPlayerStatus(); // Actualizar el estado de todos los jugadores.
        checkGameOver(); // Verificar si el juego ha terminado después de cada tick de tiempo.

    }, 100); // Ejecuta cada 100ms (10 veces por segundo).
}

/**
 * Termina la ronda actual y declara un ganador.
 * @param {number} winnerId - El ID del jugador que ganó la ronda.
 */
function endRound(winnerId) {
    if (!roundActive) return; // Evita terminar una ronda que no está activa.
    roundActive = false;
    clearInterval(timeInterval); // Detiene el temporizador de la ronda.
    clearInterval(countdownInterval); // Detiene el posible countdown.
    countdownInterval = null; // Limpia la referencia del countdown.
    const winner = players.find(p => p.id === winnerId);
    console.log(`Ronda terminada. Ganador: Jugador ${winnerId} (${winner?.name || 'Desconocido'})`);
    broadcast({ type: 'roundWinner', winnerId: winnerId, winnerName: winner?.name, players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated, blockedInRound: p.blockedInRound })) });

    holdingPlayers.clear(); // Limpia los jugadores que apretaban.

    setTimeout(() => {
        checkGameOver(); // Después de un breve retraso, verifica si el juego ha terminado o si empieza otra ronda.
    }, 2000); // Espera 2 segundos antes de la siguiente acción.
}

/**
 * Verifica si el juego ha terminado (si solo queda un jugador o ninguno).
 * Si no ha terminado, inicia una nueva ronda.
 */
function checkGameOver() {
    const activePlayers = players.filter(p => !p.eliminated); // Filtra los jugadores que no han sido eliminados.
    if (activePlayers.length === 1) {
        // Si solo queda un jugador activo, ese es el campeón del juego.
        endGame(activePlayers[0].id);
    } else if (activePlayers.length === 0) {
        // Si todos los jugadores han sido eliminados, el juego termina sin un único ganador.
        console.log('Todos los jugadores han sido eliminados. Juego terminado sin un único ganador.');
        broadcast({ type: 'gameOver', winnerId: 'Nadie', message: 'Todos los jugadores se quedaron sin tiempo.' });
        gameStarted = false;
        clearInterval(timeInterval);
        clearInterval(countdownInterval);
        countdownInterval = null;
    } else {
        // Si hay más de un jugador activo, inicia la siguiente ronda.
        startCountdownAndRound();
    }
}

/**
 * Termina el juego completo y declara al campeón final.
 * @param {number} winnerId - El ID del jugador campeón.
 */
function endGame(winnerId) {
    gameStarted = false; // El juego ya no está en curso.
    clearInterval(timeInterval); // Detiene cualquier temporizador de ronda activo.
    clearInterval(countdownInterval); // Detiene cualquier countdown activo.
    countdownInterval = null; // Limpia la referencia del countdown.
    const winner = players.find(p => p.id === winnerId);
    console.log(`¡Juego Terminado! El Jugador ${winnerId} (${winner?.name || 'Desconocido'}) es el campeón.`);
    broadcast({ type: 'gameOver', winnerId: winnerId, winnerName: winner?.name, players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated })) });
}

/**
 * Reinicia el juego a su estado inicial, eliminando jugadores y limpiando timers.
 * Utilizado principalmente por el "administrador" (Jugador 1).
 */
function resetGame() {
    console.log('Reiniciando juego...');
    gameStarted = false;
    roundActive = false;
    clearInterval(timeInterval);
    clearInterval(countdownInterval);
    countdownInterval = null;
    players = []; // Vacía la lista de jugadores.
    nextPlayerId = 1; // Resetea el contador de IDs.
    holdingPlayers.clear(); // Limpia el set de jugadores apretando.
    broadcast({ type: 'gameReset' }); // Notifica a todos los clientes del reinicio.
}