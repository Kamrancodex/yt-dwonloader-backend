require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const corsOptions = {
  origin: process.env.CORS_ORIGIN,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN,
    methods: ["GET", "POST"],
  },
});

// Test route to check server is working
app.get("/test", (req, res) => {
  res.send("Test route working");
});

// Pass io to routes
const mainRouter = require("./routes/index")(io);
app.use("/api/v1", mainRouter);

app.get("/", (req, res) => {
  res.send("backend by kamran");
});

server.listen(port, () => {
  console.log(`listening at port ${port}`);
});

module.exports = { io, server };
