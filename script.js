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

// ... (resto de tus funciones y event listeners) ...