const express = require("express");
const WebSocket = require("ws");
const http = require("http");
const url = require("url");

const app = express();
const server = http.createServer(app);

const wssMain = new WebSocket.Server({ noServer: true }); // Drawing + cursors
const wssAudio = new WebSocket.Server({ noServer: true }); // Audio only

let drawingHistory = [];
let users = {};
let userUndoStacks = {};
let userRedoStacks = {};

app.use(express.static("public"));

server.on("upgrade", (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;

    if (pathname === "/audio") {
        wssAudio.handleUpgrade(request, socket, head, (ws) => {
            wssAudio.emit("connection", ws);
        });
    } else if (pathname === "/") {
        wssMain.handleUpgrade(request, socket, head, (ws) => {
            wssMain.emit("connection", ws, request);
        });
    } else {
        socket.destroy(); // Close invalid connections
    }
});

// --- Main WebSocket: Drawing, Cursors, etc.
wssMain.on("connection", (ws) => {
    console.log("New main (drawing) connection");

    ws.id = Math.random().toString(36).substr(2, 9);
    userUndoStacks[ws.id] = [];
    userRedoStacks[ws.id] = [];

    ws.send(JSON.stringify({ type: "history", drawings: drawingHistory }));
    ws.send(JSON.stringify({ type: "cursorUpdate", users }));

    broadcastMain({ type: "userJoined", usersCount: Object.keys(users).length });

    ws.on("message", (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case "draw":
                userUndoStacks[ws.id].push(data);
                drawingHistory.push(data);
                broadcastMain(data);
                break;
            case "undo":
                if (userUndoStacks[ws.id]?.length > 0) {
                    const lastStroke = userUndoStacks[ws.id].pop();
                    userRedoStacks[ws.id].push(lastStroke);
                    drawingHistory = drawingHistory.filter(stroke => stroke !== lastStroke);
                    broadcastMain({ type: "history", drawings: drawingHistory });
                }
                break;
            case "redo":
                if (userRedoStacks[ws.id]?.length > 0) {
                    const redoStroke = userRedoStacks[ws.id].pop();
                    userUndoStacks[ws.id].push(redoStroke);
                    drawingHistory.push(redoStroke);
                    broadcastMain({ type: "history", drawings: drawingHistory });
                }
                break;
            case "cursor":
                users[ws.id] = {
                    username: data.username,
                    x: data.x,
                    y: data.y,
                    color: data.color,
                };
                broadcastMain({ type: "cursorUpdate", users });
                break;
            case "clear":
                drawingHistory = [];
                userUndoStacks = {};
                userRedoStacks = {};
                broadcastMain({ type: "clear" });
                break;
        }
    });

    ws.on("close", () => {
        console.log("Main socket disconnected");
        delete users[ws.id];
        delete userUndoStacks[ws.id];
        delete userRedoStacks[ws.id];
        broadcastMain({ type: "cursorUpdate", users });
    });
});

// --- Audio WebSocket
wssAudio.on("connection", (ws) => {
    ws.id = Math.random().toString(36).substr(2, 9);
    ws.send(JSON.stringify({ type: "id", id: ws.id }));

    ws.on("message", (data, isBinary) => {
        if (isBinary) {
            // Broadcast to all others with metadata
            wssAudio.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    // Send sender ID as header before the raw audio
                    const metadata = Buffer.from(JSON.stringify({ sender: ws.id }) + "\n");
                    const combined = Buffer.concat([metadata, data]);
                    client.send(combined);
                }
            });
        }
    });
});

function broadcastMain(message) {
    wssMain.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});
