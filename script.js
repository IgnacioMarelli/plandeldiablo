// Conexión al servidor WebSocket.
const socket = new WebSocket('https://plandeldiablo-6f2d69afee20.herokuapp.com/');

// ... (resto de tus referencias DOM y variables) ...

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10; // Limitar intentos para evitar bucles infinitos
const RECONNECT_DELAY_MS = 3000;  // Esperar 3 segundos antes de reintentar

// --- Manejo de Eventos del WebSocket ---

socket.onopen = () => {
    console.log('Conectado al servidor WebSocket');
    statusMessage.textContent = 'Conectado. Esperando jugadores...';
    reconnectAttempts = 0; // Resetear intentos al conectar exitosamente
};

socket.onmessage = (event) => {
    // ... (tu código existing de onmessage) ...
};

socket.onclose = () => {
    console.log('Desconectado del servidor WebSocket.');
    statusMessage.textContent = 'Desconectado del servidor. Intentando reconectar...';
    holdButton.disabled = true;

    // Lógica de reconexión
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`Intento de reconexión #${reconnectAttempts}...`);
        setTimeout(() => {
            // Crear una nueva instancia de WebSocket para reintentar la conexión
            // Importante: No puedes 'reutilizar' un objeto WebSocket cerrado. Debes crear uno nuevo.
            socket = new WebSocket('wss://TU_NOMBRE_DE_APP_HEROKU.herokuapp.com');
            // Re-asignar los manejadores de eventos al nuevo socket
            socket.onopen = () => {
                console.log('Reconectado al servidor WebSocket!');
                statusMessage.textContent = `Reconectado como Jugador ${playerId || 'nuevo'}.`;
                reconnectAttempts = 0; // Resetear intentos al reconectar exitosamente
                // Podrías necesitar enviar un mensaje al servidor para reidentificarte
                // si tu juego necesita saber que eres el mismo jugador después de una reconexión.
                // Por ahora, tu server.js asignará un nuevo playerId, lo cual es simple.
                // Si el jugador ya tenía un ID, podrías enviarlo: socket.send(JSON.stringify({ type: 'reconnect', oldPlayerId: playerId }));
                holdButton.disabled = false; // Habilitar el botón si el juego está activo
                if (gameStarted) { // Asegurarse de que si el juego estaba activo, el botón se habilite
                    holdButton.disabled = false;
                }
            };
            socket.onmessage = (event) => {
                 const data = JSON.parse(event.data);
                 // Actualiza el ID si el servidor te envía uno nuevo al reconectar
                 if (data.type === 'playerConnected') {
                     playerId = data.playerId;
                     statusMessage.textContent = `Reconectado como Jugador ${playerId}.`;
                 }
                 // Llama a la función original de onmessage
                 socket.onmessage.originalHandler(event);
            };
            // Para asegurar que onmessage sigue llamando al handler principal
            socket.onmessage.originalHandler = event.data; // Guardar la referencia original

            socket.onclose = this; // Re-asignar onclose a esta misma función de reconexión
            socket.onerror = this; // Re-asignar onerror a esta misma función
        }, RECONNECT_DELAY_MS);
    } else {
        statusMessage.textContent = 'Fallo al reconectar después de varios intentos. Refresca la página.';
        console.error('Máximo de intentos de reconexión alcanzado.');
    }
};

socket.onerror = (error) => {
    console.error('Error en WebSocket:', error);
    // Este error también activará onclose, donde se manejará la reconexión
};

// ... (código existente) ...

// Nuevas referencias al DOM para el nombre
const nameInput = document.getElementById('name-input');
const nameSubmitButton = document.getElementById('name-submit-button');
const nameSection = document.getElementById('name-section'); // Un div que englobe el input y el botón

// ... (resto de tus variables) ...

let playerId = null;
let playerName = 'Anónimo'; // Valor por defecto
let gameStarted = false;
let isHolding = false;

// --- Manejo de Eventos del WebSocket ---
// ... (socket.onopen, socket.onmessage, socket.onclose, socket.onerror - MANTENER ESTOS) ...

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Mensaje del servidor:', data);

    switch (data.type) {
        case 'playerConnected':
            playerId = data.playerId;
            // Aquí, si ya tenemos un nombre, lo enviamos al servidor
            if (playerName !== 'Anónimo') {
                socket.send(JSON.stringify({ type: 'setPlayerName', playerId: playerId, name: playerName }));
            }
            statusMessage.textContent = `Eres el Jugador ${playerId} (${playerName}). Esperando a los demás...`;
            nameSection.style.display = 'none'; // Oculta la sección del nombre una vez conectado
            break;
        case 'gameStart':
            gameStarted = true;
            holdButton.disabled = false;
            statusMessage.textContent = '¡El juego ha comenzado! Mantén presionado el botón.';
            roundWinnerDisplay.textContent = '';
            gameOverMessage.textContent = '';
            resetButton.style.display = 'none';
            timerDisplay.textContent = 'Tiempo restante: --:--';
            updatePlayerStatus(data.players);
            break;
        case 'playerStatusUpdate':
            updatePlayerStatus(data.players);
            if (gameStarted) {
                statusMessage.textContent = '¡El juego está en curso! Mantén presionado el botón.';
            }
            break;
        case 'playerEliminated':
            if (data.eliminatedPlayerId === playerId) {
                holdButton.disabled = true;
                holdButton.classList.add('eliminated-button'); // Nuevo estilo para botón bloqueado
                statusMessage.textContent = '¡Has sido eliminado! Su tiempo se agotó.';
            }
            updatePlayerStatus(data.players);
            break;
        case 'roundStart':
            holdButton.disabled = false;
            holdButton.classList.remove('eliminated-button'); // Asegurarse de que el botón no esté rojo al inicio de la ronda
            isHolding = false;
            timerDisplay.textContent = 'Tiempo restante: --:--';
            statusMessage.textContent = '¡Nueva ronda! Mantén presionado el botón.';
            roundWinnerDisplay.textContent = '';
            updatePlayerStatus(data.players);
            break;
        case 'roundWinner':
            roundWinnerDisplay.textContent = `¡${data.winnerName || 'El Jugador ' + data.winnerId} ganó la ronda!`; // Muestra el nombre
            holdButton.disabled = true;
            updatePlayerStatus(data.players);
            break;
        case 'gameOver':
            gameStarted = false;
            holdButton.disabled = true;
            gameOverMessage.textContent = `¡Juego Terminado! ¡${data.winnerName || 'El Jugador ' + data.winnerId} es el campeón!`; // Muestra el nombre
            statusMessage.textContent = '';
            roundWinnerDisplay.textContent = '';
            resetButton.style.display = 'block';
            updatePlayerStatus(data.players);
            break;
        case 'playerLeft':
            statusMessage.textContent = `${data.playerName || 'Jugador ' + data.playerId} se ha desconectado.`;
            updatePlayerStatus(data.players);
            break;
        case 'timeUpdate':
            // Este mensaje solo lo recibe el jugador que está apretando
            // y solo muestra su propio tiempo.
            const remainingMinutes = Math.floor(data.remainingTime / 60000);
            const remainingSeconds = Math.floor((data.remainingTime % 60000) / 1000);
            const remainingMs = Math.floor(data.remainingTime % 1000 / 100); // Para los décimas de segundo
            timerDisplay.textContent = `Tu tiempo: ${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${remainingMs}`;
            break;
        case 'gameReset':
            gameStarted = false;
            holdButton.disabled = true;
            holdButton.classList.remove('eliminated-button');
            statusMessage.textContent = 'El juego ha sido reiniciado. Esperando jugadores...';
            roundWinnerDisplay.textContent = '';
            gameOverMessage.textContent = '';
            resetButton.style.display = 'none';
            timerDisplay.textContent = 'Tiempo restante: --:--';
            playerStatusContainer.innerHTML = '';
            nameSection.style.display = 'block'; // Mostrar la sección del nombre de nuevo
            playerName = 'Anónimo'; // Resetear nombre
            playerId = null;
            break;
        case 'countdown': // Nuevo caso para la cuenta regresiva de la ronda
            statusMessage.textContent = `Ronda comienza en: ${data.countdown} segundos...`;
            holdButton.disabled = false; // El botón está habilitado durante la cuenta regresiva
            holdButton.classList.remove('blocked'); // Asegurarse de que no esté bloqueado
            holdButton.classList.remove('eliminated-button');
            break;
        case 'blockPlayer': // Nuevo caso para bloquear al jugador
            if (data.playerIdToBlock === playerId) {
                holdButton.disabled = true;
                holdButton.classList.add('blocked'); // Nueva clase para el estilo rojo
                statusMessage.textContent = '¡No apretaste a tiempo! Bloqueado hasta la próxima ronda.';
            }
            break;
        default:
            console.warn('Tipo de mensaje desconocido:', data.type);
    }
};

// ... (socket.onclose, socket.onerror - MANTENER ESTOS) ...

// --- Manejo de Interacción del Botón (mantener este como está) ---
holdButton.addEventListener('mousedown', () => {
    if (gameStarted && !isHolding && !holdButton.classList.contains('blocked') && !holdButton.classList.contains('eliminated-button')) {
        isHolding = true;
        holdButton.classList.add('holding');
        socket.send(JSON.stringify({ type: 'hold', playerId: playerId }));
        console.log('Enviando hold');
    }
});

holdButton.addEventListener('mouseup', () => {
    if (gameStarted && isHolding) {
        isHolding = false;
        holdButton.classList.remove('holding');
        socket.send(JSON.stringify({ type: 'release', playerId: playerId }));
        console.log('Enviando release');
    }
});

holdButton.addEventListener('mouseleave', () => {
    if (gameStarted && isHolding) {
        isHolding = false;
        holdButton.classList.remove('holding');
        socket.send(JSON.stringify({ type: 'release', playerId: playerId }));
        console.log('Enviando release (mouseleave)');
    }
});

// --- Manejo del Botón de Reinicio (mantener este como está) ---
resetButton.addEventListener('click', () => {
    socket.send(JSON.stringify({ type: 'resetGame' }));
});

// --- Funciones de Actualización de la Interfaz ---
function updatePlayerStatus(players) {
    playerStatusContainer.innerHTML = '';
    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-status';
        if (player.holding) {
            playerDiv.classList.add('holding');
        }
        if (player.eliminated) {
            playerDiv.classList.add('eliminated');
        }
        if (player.id === playerId) { // Resalta a este jugador
            playerDiv.classList.add('is-me');
        }

        const nameSpan = document.createElement('span');
        // Muestra el nombre si existe, de lo contrario, "Jugador [ID]"
        nameSpan.textContent = `${player.name || 'Jugador ' + player.id}`;
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

        playerStatusContainer.appendChild(playerDiv);
    });
}

// --- Nueva Lógica para el Nombre del Jugador ---
nameSubmitButton.addEventListener('click', () => {
    const enteredName = nameInput.value.trim();
    if (enteredName) {
        playerName = enteredName;
        // Si ya estamos conectados y tenemos un playerId, enviamos el nombre al servidor
        if (playerId) {
            socket.send(JSON.stringify({ type: 'setPlayerName', playerId: playerId, name: playerName }));
            statusMessage.textContent = `Eres el Jugador ${playerId} (${playerName}). Esperando a los demás...`;
            nameSection.style.display = 'none'; // Oculta la sección del nombre
        } else {
            statusMessage.textContent = `Nombre establecido como ${playerName}. Conectando...`;
            nameSection.style.display = 'none'; // Oculta la sección del nombre
        }
    } else {
        alert('Por favor, ingresa un nombre.');
    }
});
// Permitir presionar Enter para enviar el nombre
nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        nameSubmitButton.click();
    }
});