const express = require("express");
const WebSocket = require("ws");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let drawingHistory = [];
let users = {};
let userUndoStacks = {};
let userRedoStacks = {};

app.use(express.static("public"));

wss.on("connection", (ws) => {
    console.log("A new user connected");

    ws.id = Math.random().toString(36).substr(2, 9);
    userUndoStacks[ws.id] = [];
    userRedoStacks[ws.id] = [];

    ws.send(JSON.stringify({ type: "history", drawings: drawingHistory }));
    ws.send(JSON.stringify({ type: "cursorUpdate", users }));

    ws.on("message", (message) => {
        const data = JSON.parse(message);

        if (data.type === "draw") {
            if (!userUndoStacks[ws.id]) userUndoStacks[ws.id] = [];
            userUndoStacks[ws.id].push(data);
            drawingHistory.push(data);

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } else if (data.type === "undo") {
            if (userUndoStacks[ws.id]?.length > 0) {
                let lastStroke = userUndoStacks[ws.id].pop();
                userRedoStacks[ws.id].push(lastStroke);
                drawingHistory = drawingHistory.filter(stroke => stroke !== lastStroke);

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: "history", drawings: drawingHistory }));
                    }
                });
            }
        } else if (data.type === "redo") {
            if (userRedoStacks[ws.id]?.length > 0) {
                let redoStroke = userRedoStacks[ws.id].pop();
                userUndoStacks[ws.id].push(redoStroke);
                drawingHistory.push(redoStroke);

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(redoStroke));
                    }
                });
            }
        } else if (data.type === "cursor") {
            if (!users[ws.id]) {
                users[ws.id] = { x: 0, y: 0, color: data.color, username: data.username };
            }

            users[ws.id].x = data.x;
            users[ws.id].y = data.y;
            users[ws.id].username = data.username;

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: "cursorUpdate", users }));
                }
            });
        } else if (data.type === "clear") {
            drawingHistory = [];
            userUndoStacks = {};
            userRedoStacks = {};

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: "clear" }));
                }
            });
        }
    });

    ws.on("close", () => {
        console.log("A user disconnected");
        delete users[ws.id];
        delete userUndoStacks[ws.id];
        delete userRedoStacks[ws.id];

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "cursorUpdate", users }));
            }
        });
    });
});

server.listen(3000, () => {
    console.log("Server running on http://192.168.18.103:3000");
});