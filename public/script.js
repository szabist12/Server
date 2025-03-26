const canvas = document.getElementById("drawingCanvas");
const ctx = canvas.getContext("2d");
const clearBtn = document.getElementById("clearBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const usernameInput = document.getElementById("username");

let socket = new WebSocket("ws://192.168.18.103:3000");
let isDrawing = false;
let stroke = [];
let drawingHistory = [];
let usersCursors = {};
let username = "Anonymous";
let userColor = getRandomColor();
let lastSent = Date.now();

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
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
    if (!isDrawing) {
        if (Date.now() - lastSent > 100) {
            sendCursorPosition(e);
            lastSent = Date.now();
        }
        return;
    }

    let point = { x: e.offsetX, y: e.offsetY };

    if (stroke.length > 0) {
        ctx.strokeStyle = userColor;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
    }

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

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "history") {
        drawingHistory = data.drawings;
        redrawCanvas();
    } else if (data.type === "draw") {
        drawingHistory.push(data);
        drawStroke(data);
    } else if (data.type === "cursorUpdate") {
        usersCursors = data.users;
        redrawCanvas();
    } else if (data.type === "clear") {
        drawingHistory = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
};

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

function drawStroke(data) {
    ctx.strokeStyle = data.color || "black";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";

    for (let i = 1; i < data.stroke.length; i++) {
        ctx.beginPath();
        ctx.moveTo(data.stroke[i - 1].x, data.stroke[i - 1].y);
        ctx.lineTo(data.stroke[i].x, data.stroke[i].y);
        ctx.stroke();
    }
}

function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawingHistory.forEach(drawStroke);
    drawCursors();
}

function drawCursors() {
    for (const userId in usersCursors) {
        let cursor = usersCursors[userId];
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, 5, 0, Math.PI * 2, false);
        ctx.fillStyle = cursor.color;
        ctx.fill();
        ctx.font = "12px Arial";
        ctx.fillStyle = "black";
        ctx.fillText(cursor.username, cursor.x + 10, cursor.y - 10);
    }
}

function sendCursorPosition(e) {
    socket.send(JSON.stringify({ type: "cursor", username, x: e.offsetX, y: e.offsetY, color: userColor }));
}
