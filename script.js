// --- Referencias al DOM (Elementos HTML) ---
const statusMessage = document.getElementById('status-message');
const roundWinnerDisplay = document.getElementById('round-winner');
const gameOverMessage = document.getElementById('game-over-message');
const timerDisplay = document.getElementById('timer-display');
const holdButton = document.getElementById('hold-button');
const playerStatusContainer = document.getElementById('player-status-container');
const resetButton = document.getElementById('reset-button');

// Elementos para el nombre del jugador
const nameInput = document.getElementById('name-input');
const nameSubmitButton = document.getElementById('name-submit-button');
const nameSection = document.getElementById('name-section');

// Elemento para el botón de "Listo"
const readyButton = document.getElementById('ready-button');

// --- Variables de Estado del Cliente ---
// !!! IMPORTANTE: TU URL DE HEROKU AQUÍ !!!
const HEROKU_APP_URL = 'wss://plandeldiablo-6f2d69afee20.herokuapp.com';

let socket = null; // La conexión WebSocket
let playerId = null; // El ID que el servidor asigna a este cliente
let playerName = 'Anónimo'; // El nombre que el jugador elige
let gameStarted = false; // Indica si el juego está en curso
let isHolding = false; // Indica si el botón está siendo presionado en este momento por este jugador
let isReady = false; // Estado de "listo" de este cliente

// Variables para la reconexión automática
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10; // Máximo de intentos antes de fallar
const RECONNECT_DELAY_MS = 3000;  // Esperar 3 segundos antes de cada reintento

// --- Función para establecer la conexión WebSocket ---
function connectWebSocket() {
    socket = new WebSocket(HEROKU_APP_URL);

    socket.onopen = () => {
        console.log('Conectado al servidor WebSocket');
        statusMessage.textContent = 'Conectado. Ingresa tu nombre para unirte.';
        nameSection.style.display = 'block'; // Asegura que la sección de nombre sea visible al conectar
        holdButton.disabled = true; // Deshabilita el botón de juego
        readyButton.style.display = 'none'; // Oculta el botón de listo al principio
        resetButton.style.display = 'none'; // Asegurarse de ocultar el reset al inicio

        reconnectAttempts = 0; // Resetear intentos al conectar exitosamente
        isReady = false; // Resetear el estado de listo en cada reconexión
        readyButton.disabled = false; // Asegurar que el botón de listo no esté deshabilitado si lo estaba antes
        readyButton.textContent = 'Estoy Listo'; // Resetear el texto del botón de listo
    };

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Mensaje del servidor:', data);

    switch (data.type) {
        case 'playerConnected':
            playerId = data.playerId;
            if (playerName !== 'Anónimo') {
                socket.send(JSON.stringify({ type: 'setPlayerName', playerId: playerId, name: playerName }));
                nameSection.style.display = 'none';
                readyButton.style.display = 'block';
            } else {
                statusMessage.textContent = `Eres el Jugador ${playerId}. Ingresa tu nombre para continuar.`;
            }
            break;

        case 'gameStart':
            gameStarted = true;
            holdButton.disabled = false;
            readyButton.style.display = 'none';
            statusMessage.textContent = '¡El juego ha comenzado! Mantén presionado el botón.';
            roundWinnerDisplay.textContent = '';
            gameOverMessage.textContent = '';
            resetButton.style.display = 'none';
            timerDisplay.textContent = 'Tu tiempo: --:--.--';
            updatePlayerStatus(data.players);
            break;

        case 'playerStatusUpdate':
            updatePlayerStatus(data.players);
            if (gameStarted && !statusMessage.textContent.includes('Ronda comienza en:') && !statusMessage.textContent.includes('Bloqueado')) {
                statusMessage.textContent = '¡El juego está en curso! Mantén presionado el botón.';
            }
            break;

        case 'playerEliminated':
            if (data.eliminatedPlayerId === playerId) {
                holdButton.disabled = true;
                holdButton.classList.add('eliminated-button');
                statusMessage.textContent = '¡Has sido eliminado! Tu tiempo se agotó.';
            }
            updatePlayerStatus(data.players);
            break;

        case 'roundStart':
            holdButton.disabled = false;
            holdButton.classList.remove('eliminated-button');
            holdButton.classList.remove('blocked');
            isHolding = false;
            timerDisplay.textContent = 'Tu tiempo: --:--.--';
            statusMessage.textContent = '¡Nueva ronda! Mantén presionado el botón.';
            roundWinnerDisplay.textContent = '';
            updatePlayerStatus(data.players);
            break;

        case 'roundWinner':
            roundWinnerDisplay.textContent = `¡${data.winnerName || 'El Jugador ' + data.winnerId} ganó la ronda!`;
            holdButton.disabled = true;
            updatePlayerStatus(data.players);
            break;

        case 'gameOver':
            gameStarted = false;
            holdButton.disabled = true;
            gameOverMessage.textContent = `¡Juego Terminado! ¡${data.winnerName || 'El Jugador ' + data.winnerId} es el campeón!`;
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
            const remainingMinutes = Math.floor(data.remainingTime / 60000);
            const remainingSeconds = Math.floor((data.remainingTime % 60000) / 1000);
            const remainingMs = Math.floor((data.remainingTime % 1000) / 100);
            timerDisplay.textContent = `Tu tiempo: ${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${remainingMs}`;
            break;

        case 'gameReset':
            gameStarted = false;
            holdButton.disabled = true;
            holdButton.classList.remove('eliminated-button');
            holdButton.classList.remove('blocked');
            statusMessage.textContent = 'El juego ha sido reiniciado. Ingresa tu nombre para volver a unirte.';
            roundWinnerDisplay.textContent = '';
            gameOverMessage.textContent = '';
            resetButton.style.display = 'none';
            timerDisplay.textContent = 'Tu tiempo: --:--.--';
            playerStatusContainer.innerHTML = '';
            nameSection.style.display = 'block';
            readyButton.style.display = 'none';
            playerName = 'Anónimo';
            playerId = null;
            isReady = false;
            readyButton.disabled = false;
            readyButton.textContent = 'Estoy Listo';
            break;

        case 'countdown':
            statusMessage.textContent = `Ronda comienza en: ${data.countdown} segundos...`;
            holdButton.disabled = false;
            holdButton.classList.remove('blocked');
            holdButton.classList.remove('eliminated-button');
            break;

        case 'blockPlayer':
            if (data.playerIdToBlock === playerId) {
                holdButton.disabled = true;
                holdButton.classList.add('blocked');
                statusMessage.textContent = '¡No apretaste a tiempo! Bloqueado hasta la próxima ronda.';
            }
            break;

        case 'waitingForReady':
            const readyCount = data.readyCount;
            const totalPlayers = data.totalPlayers;
            const minPlayers = data.minPlayers;
            if (!isReady) {
                statusMessage.textContent = `Esperando a los demás: ${readyCount}/${totalPlayers} listos (${minPlayers} mínimo para iniciar).`;
            } else {
                statusMessage.textContent = `¡Estás listo! Esperando a los demás: ${readyCount}/${totalPlayers} listos (${minPlayers} mínimo para iniciar).`;
            }
            readyButton.style.display = 'block';
            if (isReady) {
                readyButton.disabled = true;
                readyButton.textContent = '¡Listo!';
            } else {
                readyButton.disabled = false;
                readyButton.textContent = 'Estoy Listo';
            }
            break;

        default:
            console.warn('Tipo de mensaje desconocido:', data.type);
    }
};

    socket.onclose = (event) => {
        console.log('Desconectado del servidor WebSocket. Código:', event.code, 'Razón:', event.reason);
        statusMessage.textContent = 'Desconectado del servidor. Intentando reconectar...';
        holdButton.disabled = true; // Deshabilita el botón al desconectarse
        readyButton.style.display = 'none'; // Oculta el botón de listo
        nameSection.style.display = 'block'; // Muestra el input de nombre para que pueda volver a unirse/reconectar

        // Lógica de reconexión
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`Intento de reconexión #${reconnectAttempts}...`);
            setTimeout(connectWebSocket, RECONNECT_DELAY_MS); // Intenta reconectar después de un retraso
        } else {
            statusMessage.textContent = 'Fallo al reconectar después de varios intentos. Por favor, refresca la página.';
            console.error('Máximo de intentos de reconexión alcanzado.');
        }
    };

    socket.onerror = (error) => {
        console.error('Error en WebSocket:', error);
        // Este error también activará onclose, donde se manejará la reconexión.
    };
}

// --- Manejo de Interacción del Botón Principal (Mouse/Touch) ---
// Para PC (mouse)
holdButton.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Previene la selección de texto
    if (gameStarted && !isHolding && !holdButton.disabled) {
        isHolding = true;
        holdButton.classList.add('holding');
        socket.send(JSON.stringify({ type: 'hold', playerId: playerId }));
        console.log('Enviando hold');
    }
});

holdButton.addEventListener('mouseup', (e) => {
    e.preventDefault();
    if (gameStarted && isHolding) {
        isHolding = false;
        holdButton.classList.remove('holding');
        socket.send(JSON.stringify({ type: 'release', playerId: playerId }));
        console.log('Enviando release');
    }
});

holdButton.addEventListener('mouseleave', (e) => {
    // Si el mouse sale del botón mientras está presionado, se considera un "release"
    if (gameStarted && isHolding) {
        isHolding = false;
        holdButton.classList.remove('holding');
        socket.send(JSON.stringify({ type: 'release', playerId: playerId }));
        console.log('Enviando release (mouseleave)');
    }
});

// Para dispositivos táctiles
holdButton.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Previene el desplazamiento de la página
    if (gameStarted && !isHolding && !holdButton.disabled) {
        isHolding = true;
        holdButton.classList.add('holding');
        socket.send(JSON.stringify({ type: 'hold', playerId: playerId }));
        console.log('Enviando hold (touch)');
    }
}, { passive: false }); // Usar { passive: false } para permitir preventDefault

holdButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (gameStarted && isHolding) {
        isHolding = false;
        holdButton.classList.remove('holding');
        socket.send(JSON.stringify({ type: 'release', playerId: playerId }));
        console.log('Enviando release (touch)');
    }
});

// --- Manejo del Botón de Reinicio (Admin) ---
resetButton.addEventListener('click', () => {
    // Solo permitimos que el jugador con ID 1 (el primero en conectar) reinicie
    if (playerId === 1) {
        socket.send(JSON.stringify({ type: 'resetGame' }));
    } else {
        alert('Solo el Jugador 1 puede reiniciar el juego.');
    }
});

// --- Lógica para el Nombre del Jugador ---
nameSubmitButton.addEventListener('click', () => {
    const enteredName = nameInput.value.trim();
    if (enteredName) {
        playerName = enteredName; // Guarda el nombre elegido
        // Si ya tenemos un ID de jugador (es decir, ya estamos conectados), lo enviamos al servidor
        if (playerId) {
            socket.send(JSON.stringify({ type: 'setPlayerName', playerId: playerId, name: playerName }));
            nameSection.style.display = 'none'; // Oculta la sección del nombre
            readyButton.style.display = 'block'; // Muestra el botón de "Listo"
            isReady = false; // Resetear el estado de listo por si el jugador pone un nuevo nombre
            readyButton.disabled = false; // Asegurar que el botón de listo esté habilitado
            readyButton.textContent = 'Estoy Listo'; // Resetear el texto del botón de listo
            statusMessage.textContent = `¡Bienvenido ${playerName}! Pulsa 'Listo' para empezar.`;
        } else {
            // Si aún no tenemos un playerId (la conexión está en curso o reconectando),
            // simplemente guardamos el nombre. Se enviará una vez que 'playerConnected' ocurra.
            statusMessage.textContent = `Nombre establecido como ${playerName}. Conectando...`;
            nameSection.style.display = 'none'; // Oculta la sección del nombre inmediatamente
        }
    } else {
        alert('Por favor, ingresa un nombre.');
    }
});

// Permite presionar Enter en el campo de texto para enviar el nombre
nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        nameSubmitButton.click(); // Simula un clic en el botón
    }
});

// --- Manejo del botón "Listo" ---
readyButton.addEventListener('click', () => {
    if (socket.readyState === WebSocket.OPEN && playerId && !isReady) {
        isReady = true; // Marca a este cliente como listo
        socket.send(JSON.stringify({ type: 'playerReady', playerId: playerId })); // Envía la señal al servidor
        readyButton.disabled = true; // Deshabilita el botón una vez pulsado
        readyButton.textContent = '¡Listo!'; // Cambia el texto del botón
        statusMessage.textContent = `¡Estás listo! Esperando a los demás...`;
    }
});


// --- Funciones de Actualización de la Interfaz ---
function updateUIForGameState() {
    // Es mejor que muestres/ocultes todo aquí basado en el estado
    // y no en múltiples lugares.
    if (gameStarted) {
        document.getElementById('readyButton').style.display = 'none';
        document.getElementById('gameButton').style.display = 'block';
        document.getElementById('playerStatus').style.display = 'block';
        document.getElementById('messageArea').textContent = '¡El juego está en curso! Mantén presionado el botón.';
        document.getElementById('resetButton').style.display = 'none'; // Ocultar reset durante el juego
    } else {
        // Juego no iniciado o esperando para la siguiente ronda
        document.getElementById('readyButton').style.display = 'block'; // Mostrar el botón "Listo"
        document.getElementById('gameButton').style.display = 'none'; // Ocultar el botón de juego
        document.getElementById('playerStatus').style.display = 'block';
        document.getElementById('resetButton').style.display = 'block'; // Mostrar reset cuando el juego no está activo

        // Esto será actualizado por el mensaje 'waitingForReady'
        document.getElementById('messageArea').textContent = 'Esperando jugadores para iniciar o próxima ronda...';
    }
}

// --- Inicio de la Conexión ---
// Llama a la función para conectar el WebSocket cuando la página se carga
connectWebSocket();