const WebSocket = require('ws');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Sirve los archivos estáticos desde el directorio raíz del proyecto
app.use(express.static(path.join(__dirname)));

const server = app.listen(PORT, () => {
    console.log(`Servidor HTTP (Backend) escuchando en el puerto ${PORT}`);
    console.log('Si estás en local, abre http://localhost:8080 en tu navegador.');
    console.log('Si estás en Heroku, esta es la URL de tu backend para el WebSocket.');
});

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
    const playerId = nextPlayerId++;
    players.push({
        id: playerId,
        ws: ws,
        name: `Jugador ${playerId}`, // Nombre por defecto inicial
        timeRemaining: INITIAL_TIME_MS,
        holding: false,
        eliminated: false,
        blockedInRound: false,
        isReady: false // Estado de listo para cada jugador
    });

    console.log(`Jugador ${playerId} conectado. Total de jugadores: ${players.length}`);

    ws.send(JSON.stringify({ type: 'playerConnected', playerId: playerId }));
    broadcastPlayerStatus(); // Enviar el estado de listo también

    // --- Manejo de Mensajes del Cliente ---
    ws.on('message', message => {
        const data = JSON.parse(message);
        const player = players.find(p => p.id === data.playerId);

        if (!player) return; // Asegurarse de que el jugador exista

        switch (data.type) {
            case 'setPlayerName':
                // Limita la longitud del nombre para evitar abusos o problemas de visualización
                player.name = data.name.substring(0, 20);
                console.log(`Jugador ${player.id} ahora se llama: ${player.name}`);
                broadcastPlayerStatus();
                break;

            case 'playerReady':
                // Solo si el juego no ha iniciado y el jugador no estaba listo
                if (!gameStarted && !player.isReady) {
                    player.isReady = true;
                    console.log(`Jugador ${player.id} (${player.name}) está listo.`);
                    broadcastPlayerStatus(); // Actualizar el estado de todos
                    checkAllPlayersReady(); // Verificar si todos los jugadores activos están listos
                }
                break;

            case 'hold':
                if (player.eliminated || !gameStarted || player.blockedInRound) return;
                // Si la ronda aún no ha iniciado (pero el juego sí), inicia la cuenta regresiva
                if (!roundActive && !countdownInterval) {
                    startCountdownAndRound();
                }
                if (!player.holding && !player.blockedInRound) {
                    player.holding = true;
                    holdingPlayers.add(player.id);
                    broadcastPlayerStatus();
                }
                break;
            case 'release':
                if (player.eliminated || !gameStarted || player.blockedInRound) return;
                if (player.holding) {
                    player.holding = false;
                    holdingPlayers.delete(player.id);
                    broadcastPlayerStatus();

                    // Si solo queda 1 jugador apretando, ese es el ganador de la ronda
                    if (holdingPlayers.size === 1) {
                        endRound(Array.from(holdingPlayers)[0]);
                    } else if (holdingPlayers.size === 0 && roundActive) {
                        // Si todos sueltan y la ronda estaba activa, se termina la ronda sin ganador y se chequea si el juego termina
                        console.log('Todos soltaron. Ronda sin ganador.');
                        roundActive = false;
                        clearInterval(timeInterval);
                        setTimeout(() => checkGameOver(), 2000); // Pequeña pausa antes de la siguiente acción
                    }
                }
                break;
            case 'resetGame':
                // Solo el jugador 1 (el host inicial) puede reiniciar el juego
                if (data.playerId === 1) {
                    resetGame();
                }
                break;
        }
    });

    ws.on('close', () => {
        const disconnectedPlayer = players.find(p => p.id === playerId);
        console.log(`Jugador ${playerId} (${disconnectedPlayer?.name || 'Desconocido'}) desconectado.`);

        // Eliminar al jugador de la lista
        players = players.filter(p => p.ws !== ws);
        holdingPlayers.delete(playerId); // Asegurarse de que no siga en la lista de los que aprietan

        broadcastPlayerStatus(); // Actualizar el estado para todos los clientes restantes

        // Lógica para el fin del juego si solo queda un jugador activo después de una desconexión
        const activePlayers = players.filter(p => !p.eliminated);
        if (gameStarted && activePlayers.length === 1) {
            endGame(activePlayers[0].id);
        } else if (players.length < MIN_PLAYERS_TO_START && gameStarted) {
            // Si el número de jugadores cae por debajo del mínimo y el juego ya había iniciado, se reinicia.
            console.log('No hay suficientes jugadores. Juego reiniciado.');
            resetGame();
            broadcast({ type: 'gameReset', message: 'No hay suficientes jugadores. Juego reiniciado.' });
        } else if (!gameStarted) {
            // Si el juego no ha iniciado, re-evaluar el estado de 'listo' de los jugadores restantes
            checkAllPlayersReady();
        }
    });

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
        name: p.name,
        holding: p.holding,
        eliminated: p.eliminated,
        blockedInRound: p.blockedInRound,
        isReady: p.isReady // Enviar el estado de listo
    }));
    broadcast({ type: 'playerStatusUpdate', players: status });

    // Mensaje de espera para que los clientes sepan cuántos están listos
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

// Verifica si todos los jugadores activos (no eliminados) han pulsado "Listo"
function checkAllPlayersReady() {
    const activePlayers = players.filter(p => !p.eliminated);
    // Para iniciar el juego, debe haber al menos MIN_PLAYERS_TO_START jugadores
    // y todos los jugadores activos deben estar marcados como 'isReady'.
    const allReady = activePlayers.length >= MIN_PLAYERS_TO_START && activePlayers.every(p => p.isReady);

    if (allReady && !gameStarted) {
        console.log('¡Todos los jugadores están listos! Iniciando juego...');
        startGame();
    } else if (!gameStarted) {
        // Si no todos están listos y el juego no ha iniciado, se actualiza el estado
        // Esto ya se maneja en broadcastPlayerStatus, que se llama después de cada cambio de estado de jugador.
    }
}

// Inicia el juego principal
function startGame() {
    if (gameStarted) return; // Evita iniciar el juego si ya está en curso
    gameStarted = true;
    console.log('Juego iniciado.');
    // Resetear el estado 'isReady' para que no afecte futuras rondas o reinicios manuales si el juego termina y vuelve a empezar
    players.forEach(p => p.isReady = false);
    broadcast({ type: 'gameStart', players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated, blockedInRound: p.blockedInRound })) });
    startCountdownAndRound(); // Inicia la primera ronda con una cuenta regresiva
}

// Inicia la cuenta regresiva antes de que comience una ronda de consumo de tiempo
function startCountdownAndRound() {
    if (roundActive || countdownInterval) return; // Evita iniciar si una ronda ya está activa o un countdown en curso

    // Reiniciar estados de los jugadores para la nueva ronda
    players.forEach(p => {
        if (!p.eliminated) {
            p.holding = false;
            p.blockedInRound = false; // Quitar el bloqueo de la ronda anterior
        }
    });
    holdingPlayers.clear(); // Limpiar la lista de jugadores apretando
    broadcastPlayerStatus(); // Enviar el estado actualizado a los clientes

    let countdown = ROUND_COUNTDOWN_SECONDS;
    broadcast({ type: 'countdown', countdown: countdown }); // Iniciar el mensaje de cuenta regresiva

    countdownInterval = setInterval(() => {
        countdown--;
        if (countdown >= 0) {
            broadcast({ type: 'countdown', countdown: countdown });
        }

        if (countdown === 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;

            // Bloquear a los jugadores que no apretaron el botón durante la cuenta regresiva
            players.forEach(p => {
                if (!p.holding && !p.eliminated) {
                    p.blockedInRound = true; // Marcar como bloqueado en esta ronda
                    p.ws.send(JSON.stringify({ type: 'blockPlayer', playerIdToBlock: p.id }));
                }
            });
            broadcastPlayerStatus(); // Enviar el estado actualizado con los bloqueados

            startRound(); // Iniciar la ronda de consumo de tiempo
        }
    }, 1000); // Actualiza cada segundo
}

// Inicia la ronda principal donde los jugadores pierden tiempo por mantener el botón
function startRound() {
    if (roundActive) return; // Evita iniciar si ya hay una ronda activa

    roundActive = true;
    console.log('Ronda iniciada (consumo de tiempo).');
    broadcast({ type: 'roundStart', players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated, blockedInRound: p.blockedInRound })) });

    clearInterval(timeInterval); // Asegura que no haya intervalos duplicados
    timeInterval = setInterval(() => {
        // Filtra solo a los jugadores que están apretando, no eliminados y no bloqueados
        let activeHoldingPlayers = players.filter(p => p.holding && !p.eliminated && !p.blockedInRound);

        if (activeHoldingPlayers.length === 1) {
            // Si solo queda uno apretando, ese es el ganador de la ronda
            endRound(activeHoldingPlayers[0].id);
            return;
        } else if (activeHoldingPlayers.length === 0 && roundActive) {
            // Si nadie está apretando y la ronda está activa, termina sin ganador
            clearInterval(timeInterval);
            roundActive = false;
            console.log('Todos soltaron/bloqueados en la ronda, deteniendo timer.');
            broadcast({ type: 'roundEndedNoWinner', message: 'Nadie mantuvo el botón en esta ronda.' });
            setTimeout(() => checkGameOver(), 2000); // Pausa antes de la siguiente acción
            return;
        }

        // Reduce el tiempo de los jugadores que están apretando
        activeHoldingPlayers.forEach(player => {
            player.timeRemaining -= 100; // Reduce 100ms (0.1 segundos)
            if (player.timeRemaining <= 0) {
                player.timeRemaining = 0;
                player.eliminated = true; // El jugador es eliminado
                player.holding = false;
                holdingPlayers.delete(player.id); // Quitar de la lista de los que apretan
                console.log(`Jugador ${player.id} (${player.name}) eliminado por tiempo.`);
                // Notificar al cliente específico que fue eliminado
                player.ws.send(JSON.stringify({ type: 'playerEliminated', eliminatedPlayerId: player.id, players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated })) }));
            }
            // Enviar actualización de tiempo solo a los que siguen apretando y no están eliminados/bloqueados
            if (player.holding && !player.eliminated && !player.blockedInRound) {
                player.ws.send(JSON.stringify({ type: 'timeUpdate', remainingTime: player.timeRemaining }));
            }
        });

        broadcastPlayerStatus(); // Actualizar el estado de todos los jugadores
        checkGameOver(); // Verificar si el juego ha terminado después de cada tick de tiempo

    }, 100); // Ejecuta cada 100ms (10 veces por segundo)
}

// Termina la ronda y declara un ganador
function endRound(winnerId) {
    if (!roundActive) return; // Evita terminar una ronda que no está activa
    roundActive = false;
    clearInterval(timeInterval); // Detiene el temporizador de la ronda
    clearInterval(countdownInterval); // Detiene el posible countdown
    countdownInterval = null; // Reinicia el intervalo del countdown
    const winner = players.find(p => p.id === winnerId);
    console.log(`Ronda terminada. Ganador: Jugador ${winnerId} (${winner?.name || 'Desconocido'})`);
    broadcast({ type: 'roundWinner', winnerId: winnerId, winnerName: winner?.name, players: players.map(p => ({ id: p.id, name: p.name, holding: p.holding, eliminated: p.eliminated, blockedInRound: p.blockedInRound })) });

    holdingPlayers.clear(); // Limpia los jugadores que apretaban

    setTimeout(() => {
        checkGameOver(); // Después de un breve retraso, verifica si el juego ha terminado o si empieza otra ronda
    }, 2000);
}

// Verifica si el juego ha terminado o si debe empezar una nueva ronda
function checkGameOver() {
    const activePlayers = players.filter(p => !p.eliminated);
    if (activePlayers.length === 1) {
        // Si solo queda un jugador activo, ese es el campeón del juego
        endGame(activePlayers[0].id);
    } else if (activePlayers.length === 0) {
        // Si todos los jugadores han sido eliminados, el juego termina sin un único ganador
        console.log('Todos los jugadores han sido eliminados. Juego terminado sin un único ganador.');
        broadcast({ type: 'gameOver', winnerId: 'Nadie', message: 'Todos los jugadores se quedaron sin tiempo.' });
        gameStarted = false;
        clearInterval(timeInterval);
        clearInterval(countdownInterval);
        countdownInterval = null;
    } else {
        // Si hay más de un jugador activo, empieza la siguiente ronda
        startCountdownAndRound();
    }
}

// Termina el juego completo y declara al campeón
function endGame(winnerId) {
    gameStarted = false; // El juego ya no está en curso
    clearInterval(timeInterval); // Detiene cualquier temporizador de ronda activo
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
    players = []; // Vacía la lista de jugadores
    nextPlayerId = 1; // Resetea el contador de IDs
    holdingPlayers.clear(); // Limpia el set de jugadores apretando
    broadcast({ type: 'gameReset' }); // Notifica a todos los clientes del reinicio
}