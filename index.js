require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

app.use(express.json());
app.use(cors());

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

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const mainRouter = require("./routes/index");
app.use("/api/v1", mainRouter);

app.get("/", (req, res) => {
  res.send("backend by kamran");
});

server.listen(process.env.PORT, () => {
  console.log(`listening at port ${process.env.PORT}`);
});

module.exports = { io, server };
