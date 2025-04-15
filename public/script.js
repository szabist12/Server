const canvas = document.getElementById("drawingCanvas");
const ctx = canvas.getContext("2d");
const clearBtn = document.getElementById("clearBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const usernameInput = document.getElementById("username");

let socket = new WebSocket("ws://localhost:3000"); // Main socket for drawing/cursor
let audioSocket = new WebSocket("ws://localhost:3000/audio"); // Separate socket for audio

let isDrawing = false;
let stroke = [];
let drawingHistory = [];
let usersCursors = {};
let username = "Anonymous";
let userColor = getRandomColor();
let lastSent = Date.now();

let nextPlayTime = 0;
let myAudioId = null;
let audioContext = new (window.AudioContext || window.webkitAudioContext)();
let isInCall = false;
const sampleRate = audioContext.sampleRate;

// Function to resize the canvas for high-DPI (Retina) displays
function resizeCanvas() {
    // Get the current size of the canvas in CSS pixels (visible size on the screen)
    const rect = canvas.getBoundingClientRect();

    // Set the internal canvas width to match the display's pixel density
    // This ensures sharp rendering on high-DPI displays (e.g., Retina screens)
    canvas.width = rect.width * window.devicePixelRatio;

    // Set the internal canvas height in the same way
    canvas.height = rect.height * window.devicePixelRatio;

    // Scale the drawing context so that 1 unit in canvas space = 1 CSS pixel
    // Otherwise, content will appear scaled up (blurry or too large)
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

usernameInput.addEventListener("input", () => {
    username = usernameInput.value.trim() || "Anonymous";
});

function getRandomColor() {
    return `hsl(${Math.random() * 360}, 100%, 50%)`;
}

canvas.addEventListener("mousedown", (e) => {
    isDrawing = true;
    stroke = [{ x: e.offsetX, y: e.offsetY }];
});

canvas.addEventListener("mousemove", (e) => {
    // If the user is NOT currently drawing (mouse is up)
    if (!isDrawing) {
        // Throttle how often we send the cursor position (every 100ms)
        if (Date.now() - lastSent > 100) {
            sendCursorPosition(e);     // Send the current cursor position (for example, to a server or peer)
            lastSent = Date.now();     // Update timestamp to enforce throttling
        }
        return; // Exit early — no drawing, just cursor tracking
    }

    // Create a point object with the mouse coordinates relative to the canvas
    const point = { x: e.offsetX, y: e.offsetY };

    // If there's at least one previous point, draw a line from it to the current one
    if (stroke.length > 0) {
        ctx.strokeStyle = userColor;              // Set the drawing color (unique to the user)
        ctx.lineWidth = 3;                        // Set the stroke width
        ctx.lineCap = "round";                    // Round off the ends of lines for smooth drawing
        ctx.beginPath();                          // Start a new drawing path
        ctx.moveTo(stroke[stroke.length - 1].x,   // Move to the last point in the stroke
                   stroke[stroke.length - 1].y);
        ctx.lineTo(point.x, point.y);             // Draw a line to the current point
        ctx.stroke();                             // Actually draw the line on the canvas
    }

    // Add the current point to the stroke so it can be used for the next segment
    stroke.push(point);
});


canvas.addEventListener("mouseup", () => {
    if (isDrawing && stroke.length > 1) {
        let drawData = { type: "draw", stroke, username, color: userColor };
        socket.send(JSON.stringify(drawData));
        drawingHistory.push(drawData);
    }
    isDrawing = false;
});

canvas.addEventListener("mouseleave", () => isDrawing = false);

// Main WebSocket: drawing/cursor/undo/redo
socket.onopen = () => {
    console.log("Main WebSocket connected");
    startAudioCall();
};

socket.onmessage = async (event) => {
    try {
        const json = JSON.parse(event.data);

        switch (json.type) {
            case "history":
                drawingHistory = json.drawings;
                redrawCanvas();
                break;
            case "draw":
                drawingHistory.push(json);
                drawStroke(json);
                break;
            case "cursorUpdate":
                usersCursors = json.users;
                redrawCanvas();
                break;
            case "clear":
                drawingHistory = [];
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                break;
        }
    } catch (err) {
        console.warn("Failed to parse message:", err);
    }
};

// Set up a listener for incoming messages from the audio WebSocket
audioSocket.onmessage = async (event) => {

    // Check if the message is a string (could be control metadata, like an ID)
    if (typeof event.data === "string") {
        const json = JSON.parse(event.data);

        // If the message contains an ID, store it as your own audio ID and return
        if (json.type === "id") {
            myAudioId = json.id;
            return;
        }
    }

    // Assume the message is a binary stream containing both metadata and audio data
    const reader = event.data.stream().getReader();

    // Read the binary data from the stream
    const { value } = await reader.read();

    const textDecoder = new TextDecoder();
    let raw = value;

    // Find the position of the newline character (byte 10) used to separate metadata from audio buffer
    let splitIndex = raw.indexOf(10); // 10 is the ASCII code for '\n'
    if (splitIndex === -1) return; // If no newline is found, something's wrong, exit early

    // Separate metadata (as bytes) and audio buffer
    let metaBuf = raw.slice(0, splitIndex);         // Metadata is before the newline
    let audioBuf = raw.slice(splitIndex + 1);       // Audio data is after the newline

    let metadata;
    try {
        // Decode and parse the metadata from JSON
        metadata = JSON.parse(textDecoder.decode(metaBuf));
    } catch (e) {
        console.warn("Failed to parse metadata", e);
        return; // If metadata parsing fails, skip playback
    }

    // Avoid playing back audio that you sent yourself
    if (metadata.sender === myAudioId) return;

    // Decode the audio buffer into a Float32Array (audio samples)
    const floatArray = new Float32Array(audioBuf.buffer);

    // Create an audio buffer with one channel, appropriate length, and sample rate
    const buffer = audioContext.createBuffer(1, floatArray.length, audioContext.sampleRate);

    // Copy the float array (samples) into the buffer
    buffer.copyToChannel(floatArray, 0);

    // Create a source node for playback
    const source = audioContext.createBufferSource();
    source.buffer = buffer;

    // Connect the source node to the audio output (speakers)
    source.connect(audioContext.destination);

    // Schedule playback: ensure it starts at or after current time
    if (nextPlayTime < audioContext.currentTime) {
        nextPlayTime = audioContext.currentTime;
    }

    // Start the source at the scheduled play time
    source.start(nextPlayTime);

    // Increment the next play time by the duration of the current buffer
    // This helps keep audio chunks synchronized
    nextPlayTime += buffer.duration;
};


// UI buttons
clearBtn.addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawingHistory = [];
    socket.send(JSON.stringify({ type: "clear" }));
});

undoBtn.addEventListener("click", () => {
    socket.send(JSON.stringify({ type: "undo" }));
});

redoBtn.addEventListener("click", () => {
    socket.send(JSON.stringify({ type: "redo" }));
});

function sendCursorPosition(e) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: "cursor",
            username,
            x: e.offsetX,
            y: e.offsetY,
            color: userColor
        }));
    }
}

// Function to start capturing microphone audio and streaming it to a WebSocket
async function startAudioCall() {
    try {
        // Create a new AudioContext for managing and processing audio
        // This is the main object for using the Web Audio API
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Load a custom AudioWorkletProcessor module from the given JavaScript file
        // This must define a processor class (e.g., 'audio-processor')
        await audioContext.audioWorklet.addModule('audio-processor.js');

        // Create an AudioWorkletNode that runs the loaded processor
        // 'audio-processor' should match the name used in registerProcessor()
        const audioNode = new AudioWorkletNode(audioContext, 'audio-processor');

        // Request permission to access the user's microphone and get the audio stream
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Create a MediaStreamAudioSourceNode from the microphone input
        // This wraps the MediaStream so it can be used in the Web Audio graph
        const source = audioContext.createMediaStreamSource(stream);

        // Connect the microphone source to the AudioWorkletNode for processing
        source.connect(audioNode);

        // Optional: Connect the processed audio to the output (e.g., speakers)
        // This is commented out to avoid feedback during a call
        // audioNode.connect(audioContext.destination);

        // Set up a handler to receive messages from the AudioWorklet processor
        // The processor should send back Float32Arrays containing raw audio samples
        audioNode.port.onmessage = (event) => {
            const floatArray = event.data; // The audio data from the processor

            // ✅ Only send data if the WebSocket is open and not overloaded
            // bufferedAmount is how much data is waiting to be sent; keep it below 64KB
            if (audioSocket.readyState === WebSocket.OPEN && audioSocket.bufferedAmount < 65536) {
                // Send the underlying ArrayBuffer of the Float32Array to the server
                audioSocket.send(floatArray.buffer);
            } else {
                // If the socket is not ready or backed up, skip sending this chunk
                // This prevents network congestion and lag
                console.warn("Audio socket backed up, skipping chunk");
            }
        };

        // Set a flag to indicate that the audio call is now active
        isInCall = true;
    } catch (err) {
        // If any part of the setup fails (e.g., mic denied, module load error),
        // log the error so it's easier to debug
        console.error("Error starting audio:", err);
    }
}

// Redraws everything on the canvas from scratch: strokes + cursors
function redrawCanvas() {
    // Clear the entire canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Redraw all previous strokes from the drawing history
    drawingHistory.forEach(drawStroke);

    // Draw live cursors for all active users
    drawCursors();
}

// Draws a single stroke based on recorded points and color
function drawStroke(data) {
    ctx.strokeStyle = data.color || "black"; // Use stroke's color or default to black
    ctx.lineWidth = 3;                       // Set line thickness
    ctx.lineCap = "round";                   // Smooth, rounded line ends

    // Draw line segments between each pair of consecutive points
    for (let i = 1; i < data.stroke.length; i++) {
        ctx.beginPath(); // Start a new path for the segment
        ctx.moveTo(data.stroke[i - 1].x, data.stroke[i - 1].y); // Move to previous point
        ctx.lineTo(data.stroke[i].x, data.stroke[i].y);         // Draw line to current point
        ctx.stroke(); // Render the line on the canvas
    }
}

// Draws all user cursors and their usernames on the canvas
function drawCursors() {
    for (const userId in usersCursors) {
        const cursor = usersCursors[userId]; // Get cursor data for this user

        // Draw a small colored circle at the cursor position
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, 5, 0, Math.PI * 2, false); // Circle with radius 5
        ctx.fillStyle = cursor.color; // Use user's unique color
        ctx.fill();

        // Draw the username label near the cursor
        ctx.font = "12px Arial";      // Small readable font
        ctx.fillStyle = "black";      // Black text for contrast
        ctx.fillText(cursor.username, cursor.x + 10, cursor.y - 10); // Offset label
    }
}

audioSocket.onopen = () => {
    console.log("🎧 Audio WebSocket connected");
};

audioSocket.onerror = (err) => {
    console.error("🚨 Audio WebSocket error", err);
};

audioSocket.onclose = () => {
    console.warn("🛑 Audio WebSocket closed");
};

document.body.addEventListener("click", () => {
    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
});