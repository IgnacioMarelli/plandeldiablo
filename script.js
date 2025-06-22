// Conexión al servidor WebSocket.
// Asegúrate de reemplazar "TU_NOMBRE_DE_APP_HEROKU.herokuapp.com" con la URL de tu app en Heroku.
// Usa 'wss://' para conexiones seguras, que Heroku proporciona automáticamente.
const socket = new WebSocket('wss://https://plandeldiablo-6f2d69afee20.herokuapp.com/');

// Referencias a elementos del DOM
const holdButton = document.getElementById('hold-button');
const statusMessage = document.getElementById('status-message');
const playerStatusContainer = document.getElementById('player-status-container');
const timerDisplay = document.getElementById('timer-display');
const roundWinnerDisplay = document.getElementById('round-winner');
const gameOverMessage = document.getElementById('game-over-message');
const resetButton = document.getElementById('reset-button');

let playerId = null;       // ID asignado a este cliente por el servidor
let gameStarted = false;   // Estado del juego
let isHolding = false;     // Indica si este cliente está actualmente apretando el botón

// --- Manejo de Eventos del WebSocket ---

// Cuando la conexión con el servidor se abre
socket.onopen = () => {
    console.log('Conectado al servidor WebSocket');
    statusMessage.textContent = 'Conectado. Esperando jugadores...';
};

// Cuando se recibe un mensaje del servidor
socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Mensaje del servidor:', data);

    switch (data.type) {
        case 'playerConnected':
            // Se recibe el ID asignado a este jugador
            playerId = data.playerId;
            statusMessage.textContent = `Eres el Jugador ${playerId}. Esperando a los demás...`;
            break;
        case 'gameStart':
            // El juego ha iniciado
            gameStarted = true;
            holdButton.disabled = false; // Habilita el botón
            statusMessage.textContent = '¡El juego ha comenzado! Mantén presionado el botón.';
            roundWinnerDisplay.textContent = ''; // Limpia mensajes anteriores
            gameOverMessage.textContent = '';
            resetButton.style.display = 'none'; // Oculta el botón de reinicio
            timerDisplay.textContent = 'Tiempo restante: --:--'; // Resetea el temporizador visible
            updatePlayerStatus(data.players); // Actualiza la lista de jugadores
            break;
        case 'playerStatusUpdate':
            // Actualiza el estado de todos los jugadores
            updatePlayerStatus(data.players);
            if (gameStarted) {
                 statusMessage.textContent = '¡El juego está en curso! Mantén presionado el botón.';
            }
            break;
        case 'playerEliminated':
            // Un jugador ha sido eliminado
            if (data.eliminatedPlayerId === playerId) {
                holdButton.disabled = true; // Deshabilita el botón si es este jugador
                statusMessage.textContent = '¡Has sido eliminado! Su tiempo se agotó.';
            }
            updatePlayerStatus(data.players); // Actualiza la lista
            break;
        case 'roundStart':
            // Una nueva ronda ha comenzado
            holdButton.disabled = false; // Habilita el botón para todos los jugadores activos
            isHolding = false;           // Resetea el estado de "manteniendo"
            timerDisplay.textContent = 'Tiempo restante: --:--'; // Resetea el temporizador visible
            statusMessage.textContent = '¡Nueva ronda! Mantén presionado el botón.';
            roundWinnerDisplay.textContent = '';
            updatePlayerStatus(data.players);
            break;
        case 'roundWinner':
            // Se anuncia el ganador de la ronda
            roundWinnerDisplay.textContent = `¡El Jugador ${data.winnerId} ganó la ronda!`;
            holdButton.disabled = true; // Deshabilita el botón hasta la próxima acción del servidor
            updatePlayerStatus(data.players);
            break;
        case 'gameOver':
            // El juego ha terminado y hay un campeón
            gameStarted = false;
            holdButton.disabled = true;
            gameOverMessage.textContent = `¡Juego Terminado! El Jugador ${data.winnerId} es el campeón.`;
            statusMessage.textContent = '';
            roundWinnerDisplay.textContent = '';
            resetButton.style.display = 'block'; // Muestra el botón de reinicio
            updatePlayerStatus(data.players);
            break;
        case 'playerLeft':
            // Un jugador se ha desconectado (opcional: mostrar un mensaje más detallado)
            statusMessage.textContent = `Jugador ${data.playerId} se ha desconectado.`;
            updatePlayerStatus(data.players);
            break;
        case 'timeUpdate':
            // Actualiza el tiempo restante visible SOLO para el jugador que está apretando
            if (isHolding) {
                const remainingMinutes = Math.floor(data.remainingTime / 60000);
                const remainingSeconds = Math.floor((data.remainingTime % 60000) / 1000);
                timerDisplay.textContent = `Tiempo restante: ${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
            } else {
                 timerDisplay.textContent = 'Tiempo restante: --:--'; // Oculta o resetea el timer si no está apretando
            }
            break;
        case 'gameReset':
            // El juego ha sido reiniciado por el administrador
            gameStarted = false;
            holdButton.disabled = true;
            statusMessage.textContent = 'El juego ha sido reiniciado. Esperando jugadores...';
            roundWinnerDisplay.textContent = '';
            gameOverMessage.textContent = '';
            resetButton.style.display = 'none';
            timerDisplay.textContent = 'Tiempo restante: --:--';
            playerStatusContainer.innerHTML = ''; // Limpia la lista de jugadores
            break;
        default:
            console.warn('Tipo de mensaje desconocido:', data.type);
    }
};

// Cuando la conexión con el servidor se cierra
socket.onclose = () => {
    console.log('Desconectado del servidor WebSocket');
    statusMessage.textContent = 'Desconectado del servidor. Refresca la página para reconectar.';
    holdButton.disabled = true;
};

// Si hay un error en la conexión WebSocket
socket.onerror = (error) => {
    console.error('Error en WebSocket:', error);
    statusMessage.textContent = 'Error de conexión. Asegúrate de que el servidor esté corriendo.';
};

// --- Manejo de Interacción del Botón ---

// Cuando el botón es presionado (mousedown)
holdButton.addEventListener('mousedown', () => {
    if (gameStarted && !isHolding) { // Solo si el juego está activo y no se está apretando ya
        isHolding = true;
        holdButton.classList.add('holding'); // Añade una clase CSS para feedback visual
        socket.send(JSON.stringify({ type: 'hold', playerId: playerId })); // Notifica al servidor
        console.log('Enviando hold');
    }
});

// Cuando el botón es soltado (mouseup)
holdButton.addEventListener('mouseup', () => {
    if (gameStarted && isHolding) { // Solo si el juego está activo y se estaba apretando
        isHolding = false;
        holdButton.classList.remove('holding'); // Remueve la clase CSS
        socket.send(JSON.stringify({ type: 'release', playerId: playerId })); // Notifica al servidor
        console.log('Enviando release');
    }
});

// Cuando el mouse se sale del botón mientras está presionado (mouseleave)
holdButton.addEventListener('mouseleave', () => {
    if (gameStarted && isHolding) { // Similar a mouseup, para cubrir escenarios donde arrastran el mouse fuera
        isHolding = false;
        holdButton.classList.remove('holding');
        socket.send(JSON.stringify({ type: 'release', playerId: playerId }));
        console.log('Enviando release (mouseleave)');
    }
});

// --- Manejo del Botón de Reinicio ---
resetButton.addEventListener('click', () => {
    socket.send(JSON.stringify({ type: 'resetGame' })); // Pide al servidor que reinicie el juego
});

// --- Funciones de Actualización de la Interfaz ---

// Actualiza la lista de jugadores y sus estados
function updatePlayerStatus(players) {
    playerStatusContainer.innerHTML = ''; // Limpia el contenido anterior
    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-status';
        if (player.holding) {
            playerDiv.classList.add('holding'); // Estilo si está apretando
        }
        if (player.eliminated) {
            playerDiv.classList.add('eliminated'); // Estilo si está eliminado
        }

        const nameSpan = document.createElement('span');
        nameSpan.textContent = `Jugador ${player.id}`;
        playerDiv.appendChild(nameSpan);

        const statusSpan = document.createElement('span');
        if (player.eliminated) {
            statusSpan.textContent = 'ELIMINADO';
        } else if (player.holding) {
            statusSpan.textContent = 'Manteniendo...';
        } else {
            statusSpan.textContent = 'Esperando...';
        }
        playerDiv.appendChild(statusSpan);

        playerStatusContainer.appendChild(playerDiv); // Añade el div del jugador al contenedor
    });
}